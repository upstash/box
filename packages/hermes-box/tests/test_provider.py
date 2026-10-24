"""The provider: classification flags core reads, cheap offline availability, settings, and the
arguments create_environment passes on."""

import socket
from types import SimpleNamespace

import pytest

import hermes_box_plugin
from hermes_box_plugin import provider as provider_mod
from hermes_box_plugin import upstash_box_env
from hermes_box_plugin.provider import UpstashBoxProvider


def _write_config(home, text):
    (home / "config.yaml").write_text(text, encoding="utf-8")


@pytest.fixture
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)


def test_classification():
    p = UpstashBoxProvider()
    assert p.name == "upstash_box"
    assert p.display_name == "Upstash Box"
    assert p.is_remote and p.is_container
    assert p.skip_container_guards  # a cloud container, like Daytona and Modal
    assert p.session_isolated_when_nonpersistent
    assert not p.supports_streams
    assert p.default_cwd == "~"
    assert p.cache_path_base == "~/.hermes"
    assert p.env_description == "an Upstash Box cloud container (Linux)"


def test_api_key_is_stripped_from_spawned_processes():
    assert "UPSTASH_BOX_API_KEY" in UpstashBoxProvider().strip_env_keys


def test_name_is_a_valid_non_reserved_backend_name():
    from agent import terminal_env_registry as reg

    name = UpstashBoxProvider().name
    assert name not in reg.BUILTIN_BACKEND_NAMES
    assert all(c.isalnum() or c == "_" for c in name) and name == name.lower()


def test_is_available_needs_the_sdk_and_a_key_and_no_network(monkeypatch, no_network):
    p = UpstashBoxProvider()
    assert not p.is_available()
    assert p.probe()[0] == "needs_setup"
    monkeypatch.setenv("UPSTASH_BOX_API_KEY", "test-key-not-real")
    assert p.is_available()
    assert p.probe() == ("ready", "")
    monkeypatch.setattr(provider_mod.importlib.util, "find_spec", lambda name: None)
    assert not p.is_available()
    assert p.probe()[0] == "unavailable"


def test_blank_key_counts_as_missing(monkeypatch):
    monkeypatch.setenv("UPSTASH_BOX_API_KEY", "   ")
    assert not UpstashBoxProvider().is_available()


def test_check_requirements_logs_actionable_errors(monkeypatch, caplog):
    p = UpstashBoxProvider()
    assert not p.check_requirements({})
    assert "UPSTASH_BOX_API_KEY is not set" in caplog.text
    monkeypatch.setenv("UPSTASH_BOX_API_KEY", "test-key-not-real")
    assert p.check_requirements({})


def test_doctor_and_setup_never_print_the_key(monkeypatch):
    monkeypatch.setenv("UPSTASH_BOX_API_KEY", "sk-box-secret-value")
    p = UpstashBoxProvider()
    rows = p.doctor_checks()
    assert [ok for ok, _, _ in rows] == [True, True]
    text = repr(rows) + "\n".join(p.setup_instructions())
    assert "sk-box-secret-value" not in text
    assert "UPSTASH_BOX_API_KEY is set" in text


def test_settings_defaults(_hermes_home):
    assert provider_mod.settings() == {
        "size": "small",
        "runtime": None,
        "keep_alive": False,
        "labels": [],
        "name_prefix": "hermes",
    }


def test_settings_from_config_yaml(_hermes_home):
    _write_config(
        _hermes_home,
        "terminal:\n  upstash_box_size: Large\n  upstash_box_runtime: python\n"
        "  upstash_box_keep_alive: true\n  upstash_box_labels: [ci, team-a]\n"
        "  upstash_box_name_prefix: laptop\n",
    )
    assert provider_mod.settings() == {
        "size": "large",
        "runtime": "python",
        "keep_alive": True,
        "labels": ["ci", "team-a"],
        "name_prefix": "laptop",
    }


def test_invalid_size_falls_back_to_small(_hermes_home, caplog):
    _write_config(_hermes_home, "terminal:\n  upstash_box_size: huge\n")
    assert provider_mod.settings()["size"] == "small"
    assert "upstash_box_size" in caplog.text


def test_comma_separated_labels(_hermes_home):
    _write_config(_hermes_home, "terminal:\n  upstash_box_labels: 'a, b'\n")
    assert provider_mod.settings()["labels"] == ["a", "b"]


def test_create_environment_passes_settings_and_ignores_unknown_kwargs(_hermes_home, monkeypatch):
    _write_config(_hermes_home, "terminal:\n  upstash_box_size: medium\n  upstash_box_labels: [ci]\n")
    monkeypatch.setenv("UPSTASH_BOX_API_KEY", "test-key-not-real")
    monkeypatch.setenv("UPSTASH_BOX_BASE_URL", "https://box.example.test")
    seen = {}
    monkeypatch.setattr(upstash_box_env, "UpstashBoxEnvironment", lambda **kw: seen.update(kw) or SimpleNamespace())
    UpstashBoxProvider().create_environment(
        cwd="~",
        timeout=60,
        task_id="t1",
        image="",
        container_config={"container_persistent": False, "container_cpu": 4, "docker_volumes": ["ignored"]},
        future_kwarg=True,
        probe_only=False,
    )
    assert seen == {
        "cwd": "~",
        "timeout": 60,
        "task_id": "t1",
        "persistent": False,
        "size": "medium",
        "runtime": None,
        "keep_alive": False,
        "labels": ["ci"],
        "name_prefix": "hermes",
        "api_key": "test-key-not-real",
        "base_url": "https://box.example.test",
    }


def test_persistent_by_default_and_image_override_names_the_runtime(monkeypatch):
    monkeypatch.setenv("UPSTASH_BOX_API_KEY", "test-key-not-real")
    seen = {}
    monkeypatch.setattr(upstash_box_env, "UpstashBoxEnvironment", lambda **kw: seen.update(kw) or SimpleNamespace())
    UpstashBoxProvider().create_environment(cwd="", timeout=30, image="golang")
    assert seen["persistent"] is True and seen["runtime"] == "golang" and seen["cwd"] == "~"
    assert seen["task_id"] == "default" and seen["base_url"] == upstash_box_env.DEFAULT_BASE_URL


def test_scoped_secrets_win_over_another_profiles_process_env(monkeypatch):
    """Profile multiplexing: secrets come from the active profile's scope only. Profile A's
    endpoint in os.environ must not receive profile B's key."""
    monkeypatch.setenv("UPSTASH_BOX_BASE_URL", "https://profile-a.example.test")
    scoped = {"UPSTASH_BOX_API_KEY": "profile-b-key-not-real"}
    monkeypatch.setattr("agent.secret_scope.get_secret", lambda name, *a, **k: scoped.get(name))
    seen = {}
    monkeypatch.setattr(upstash_box_env, "UpstashBoxEnvironment", lambda **kw: seen.update(kw) or SimpleNamespace())
    UpstashBoxProvider().create_environment(cwd="~", timeout=30)
    assert seen["api_key"] == "profile-b-key-not-real"
    assert seen["base_url"] == upstash_box_env.DEFAULT_BASE_URL


def test_create_environment_without_a_key_fails_clearly():
    with pytest.raises(RuntimeError, match="UPSTASH_BOX_API_KEY is not set"):
        UpstashBoxProvider().create_environment(cwd="~", timeout=30)


def test_register_hands_the_provider_to_the_context():
    registered = []
    hermes_box_plugin.register(SimpleNamespace(register_terminal_environment_provider=registered.append))
    assert len(registered) == 1 and isinstance(registered[0], UpstashBoxProvider)

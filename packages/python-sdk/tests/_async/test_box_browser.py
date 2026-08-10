"""Browser namespace — tabs, page ops, AI ops, recordings.

Mirrors packages/sdk/src/__tests__/box-browser.test.ts.
"""

import base64
import os

import httpx
import pytest
import respx
from helpers import TEST_BASE_URL, last_json_body, make_async_box
from pydantic import BaseModel

from upstash_box import BoxError

BASE = f"{TEST_BASE_URL}/v2/box/box-123"


# ---------- tabs / page operations ----------


@respx.mock
async def test_addresses_page_operations_through_a_tab():
    box = await make_async_box(respx.mock)
    create = respx.post(f"{BASE}/browser/tabs").mock(
        return_value=httpx.Response(
            200, json={"id": "tab-1", "url": "https://example.com", "title": "Example Domain"}
        )
    )
    content_route = respx.get(f"{BASE}/browser/content", params={"tab": "tab-1"}).mock(
        return_value=httpx.Response(
            200,
            json={
                "title": "Example Domain",
                "url": "https://example.com",
                "text": "Example Domain",
                "links": [
                    {"text": "More information", "href": "https://iana.org/help/example-domains"}
                ],
            },
        )
    )

    tab = await box.browser.tab.create(
        "https://example.com", wait_until="networkidle", timeout=45_000
    )
    content = await tab.content()

    assert tab.id == "tab-1"
    assert tab.title == "Example Domain"
    assert content.links is not None
    assert content.links[0].text == "More information"
    assert content.links[0].href == "https://iana.org/help/example-domains"
    assert content_route.called
    assert last_json_body(create) == {
        "url": "https://example.com",
        "wait_until": "networkidle",
        "timeout": 45_000,
    }
    await box.aclose()


@respx.mock
async def test_goto_list_tabs_get_tab_and_close():
    box = await make_async_box(respx.mock)
    goto = respx.post(f"{BASE}/browser/goto").mock(
        return_value=httpx.Response(
            200,
            json={"title": "Pricing", "url": "https://upstash.com/pricing", "text": "Pricing"},
        )
    )
    respx.get(f"{BASE}/browser/tabs").mock(
        return_value=httpx.Response(
            200,
            json={
                "tabs": [
                    {"id": "tab-1", "url": "https://upstash.com/pricing", "title": "Pricing"},
                    {"id": "tab-2", "url": "about:blank"},
                ]
            },
        )
    )
    close = respx.delete(f"{BASE}/browser/tabs/tab-2").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )

    tab = box.browser.get_tab("tab-1")
    content = await tab.goto("https://upstash.com/pricing")
    tabs = await box.browser.list_tabs()
    await tabs[1].close()

    assert content.title == "Pricing"
    assert last_json_body(goto) == {"url": "https://upstash.com/pricing", "tab": "tab-1"}
    assert [t.id for t in tabs] == ["tab-1", "tab-2"]
    assert close.called
    await box.aclose()


@respx.mock
async def test_tab_create_sends_timeout_zero_through():
    box = await make_async_box(respx.mock)
    create = respx.post(f"{BASE}/browser/tabs").mock(
        return_value=httpx.Response(200, json={"id": "tab-1", "url": "about:blank"})
    )

    await box.browser.tab.create("about:blank", timeout=0)

    assert last_json_body(create) == {"url": "about:blank", "timeout": 0}
    await box.aclose()


@respx.mock
async def test_screenshot_bytes_base64_and_full_page():
    box = await make_async_box(respx.mock)
    b64 = base64.b64encode(bytes([1, 2, 3])).decode()
    shot = respx.get(f"{BASE}/browser/screenshot").mock(
        return_value=httpx.Response(200, json={"data": b64})
    )

    tab = box.browser.get_tab("tab-1")
    png = await tab.screenshot()
    as_base64 = await tab.screenshot(encoding="base64", full_page=True)

    assert png == bytes([1, 2, 3])
    assert as_base64 == b64
    first, second = (c.request.url for c in shot.calls)
    assert "full_page" not in str(first)
    assert "full_page=true" in str(second)
    assert "encoding=base64" in str(first)
    await box.aclose()


# ---------- live view / CDP ----------


@respx.mock
async def test_returns_live_view_and_cdp_urls():
    box = await make_async_box(respx.mock)
    screencast = respx.post(f"{BASE}/browser/screencast").mock(
        return_value=httpx.Response(
            200,
            json={"screencast_url": "https://box.example/screencast?token=live-token&tab=tab-1"},
        )
    )
    respx.post(f"{BASE}/browser/connect").mock(
        return_value=httpx.Response(200, json={"cdp_url": "wss://box.example?token=cdp-token"})
    )

    tab = box.browser.get_tab("tab-1")
    assert await tab.live_view_url() == "https://box.example/screencast?token=live-token&tab=tab-1"
    assert await box.browser.cdp_url() == "wss://box.example?token=cdp-token"
    assert last_json_body(screencast) == {"tab": "tab-1"}
    await box.aclose()


@respx.mock
async def test_raises_when_connect_or_screencast_lack_a_url():
    box = await make_async_box(respx.mock)
    respx.post(f"{BASE}/browser/connect").mock(return_value=httpx.Response(200, json={}))
    respx.post(f"{BASE}/browser/screencast").mock(
        return_value=httpx.Response(200, json={"token": "view-token"})
    )

    with pytest.raises(BoxError, match="did not return a CDP URL"):
        await box.browser.cdp_url()
    with pytest.raises(BoxError, match="did not return a URL"):
        await box.browser.get_tab("tab-1").live_view_url()
    await box.aclose()


# ---------- AI operations ----------


class Heading(BaseModel):
    heading: str


@respx.mock
async def test_extract_with_pydantic_schema():
    box = await make_async_box(respx.mock)
    extract = respx.post(f"{BASE}/browser/extract").mock(
        return_value=httpx.Response(200, json={"data": {"heading": "Example Domain"}})
    )

    tab = box.browser.get_tab("tab-1")
    result = await tab.extract("Extract the heading", Heading)

    assert isinstance(result, Heading)
    assert result.heading == "Example Domain"
    body = last_json_body(extract)
    assert body["tab"] == "tab-1"
    assert body["schema"]["type"] == "object"
    assert body["schema"]["properties"]["heading"]["type"] == "string"
    assert body["schema"]["required"] == ["heading"]
    await box.aclose()


@respx.mock
async def test_observe_elements():
    box = await make_async_box(respx.mock)
    observe = respx.post(f"{BASE}/browser/observe").mock(
        return_value=httpx.Response(
            200,
            json={
                "elements": [
                    {"description": "Sign in button", "selector": "xpath=/html/body/button"}
                ]
            },
        )
    )

    result = await box.browser.get_tab("tab-1").observe("the sign in button")

    assert len(result.elements) == 1
    assert result.elements[0].description == "Sign in button"
    assert result.elements[0].selector == "xpath=/html/body/button"
    assert last_json_body(observe) == {"instruction": "the sign in button", "tab": "tab-1"}
    await box.aclose()


@respx.mock
async def test_act_executes_one_action():
    box = await make_async_box(respx.mock)
    act = respx.post(f"{BASE}/browser/act").mock(
        return_value=httpx.Response(
            200,
            json={
                "success": True,
                "message": "Action completed successfully",
                "action_description": "Click the sign-in button",
                "actions": [
                    {
                        "selector": "xpath=/html/body/button",
                        "description": "Sign in",
                        "method": "click",
                        "arguments": [],
                    }
                ],
                "cache_status": "MISS",
                "input_tokens": 30,
                "output_tokens": 8,
            },
        )
    )

    result = await box.browser.get_tab("tab-2").act(
        "click the sign-in button", model="openai/gpt-5"
    )

    assert result.success is True
    assert result.action_description == "Click the sign-in button"
    assert result.actions[0].selector == "xpath=/html/body/button"
    assert result.cache_status == "MISS"
    assert result.input_tokens == 30
    assert last_json_body(act) == {
        "instruction": "click the sign-in button",
        "tab": "tab-2",
        "model": "openai/gpt-5",
    }
    await box.aclose()


class Person(BaseModel):
    name: str
    headline: str
    profile_url: str


class People(BaseModel):
    people: list[Person]


@respx.mock
async def test_run_with_schema_validated_structured_output():
    box = await make_async_box(respx.mock)
    run = respx.post(f"{BASE}/browser/run").mock(
        return_value=httpx.Response(
            200,
            json={
                "result": "Found five people",
                "data": {
                    "people": [
                        {
                            "name": f"Founder {i + 1}",
                            "headline": "AI founder in Berlin",
                            "profile_url": f"https://linkedin.com/in/founder-{i + 1}",
                        }
                        for i in range(5)
                    ]
                },
                "completed": True,
                "steps": [{"step": 1, "action": "search", "url": "https://linkedin.com/search"}],
                "step_count": 1,
                "input_tokens": 100,
                "output_tokens": 25,
            },
        )
    )

    result = await box.browser.get_tab("tab-2").run(
        "Find five AI founders in Berlin", schema=People, max_steps=25
    )

    assert isinstance(result.data, People)
    assert len(result.data.people) == 5
    assert result.completed is True
    assert result.steps[0].action == "search"
    body = last_json_body(run)
    assert body["prompt"] == "Find five AI founders in Berlin"
    assert body["tab"] == "tab-2"
    assert body["max_steps"] == 25
    assert body["schema"]["type"] == "object"
    await box.aclose()


@respx.mock
async def test_run_without_schema():
    box = await make_async_box(respx.mock)
    run = respx.post(f"{BASE}/browser/run").mock(
        return_value=httpx.Response(
            200, json={"result": "done", "completed": True, "steps": [], "step_count": 3}
        )
    )

    result = await box.browser.get_tab("tab-1").run("Do the thing")

    assert result.data is None
    assert result.result == "done"
    assert result.completed is True
    assert result.step_count == 3
    assert last_json_body(run) == {"prompt": "Do the thing", "tab": "tab-1"}
    await box.aclose()


@respx.mock
async def test_rejects_non_schema_for_extract_and_run():
    box = await make_async_box(respx.mock)
    tab = box.browser.get_tab("tab-1")

    with pytest.raises(BoxError, match="extract requires"):
        await tab.extract("get data", "not-a-schema")  # type: ignore[arg-type]
    with pytest.raises(BoxError, match="run requires"):
        await tab.run("go", schema="not-a-schema")  # type: ignore[arg-type]
    await box.aclose()


# ---------- recordings ----------


@respx.mock
async def test_recording_start_stop_and_mapping():
    box = await make_async_box(respx.mock)
    start = respx.post(f"{BASE}/browser/recordings").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "recording-1",
                "box_id": "box-123",
                "status": "recording",
                "started_at": 1000,
                "max_duration_seconds": 60,
            },
        )
    )
    respx.get(f"{BASE}/browser/recordings/recording-1").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "recording-1",
                "box_id": "box-123",
                "status": "recording",
                "started_at": 1000,
            },
        )
    )
    stop = respx.post(f"{BASE}/browser/recordings/stop").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "recording-1",
                "box_id": "box-123",
                "status": "completed",
                "started_at": 1000,
                # expires_at arrives in epoch seconds (unlike the ms timestamps)
                "expires_at": 1_209_601,
                "ended_at": 5000,
                "duration_ms": 4000,
                "size_bytes": 0,
                "segment_count": 2,
                "stopped_reason": "max_duration",
                "markers": [
                    {"type": "tab_switch", "at_ms": 250, "label": "Example", "tab_id": "tab-1"}
                ],
            },
        )
    )

    handle = await box.browser.recordings.start(max_duration_seconds=60)
    recording = await handle.stop()

    assert handle.id == "recording-1"
    assert recording.status == "completed"
    assert recording.duration_ms == 4000
    # 0 must survive mapping instead of collapsing to None
    assert recording.size_bytes == 0
    # normalized from epoch seconds to ms
    assert recording.expires_at == 1_209_601_000
    assert recording.markers[0].at_ms == 250
    assert recording.markers[0].tab_id == "tab-1"
    assert recording.playlist_url.endswith(
        "/v2/box/box-123/browser/recordings/recording-1/playlist"
    )
    assert last_json_body(start) == {"max_duration_seconds": 60}
    assert stop.called
    await box.aclose()


@respx.mock
async def test_recording_download_mp4(tmp_path):
    box = await make_async_box(respx.mock)
    respx.get(f"{BASE}/browser/recordings/recording-1/download").mock(
        return_value=httpx.Response(
            # Content-type parameters must not defeat the MP4 detection.
            200,
            content=b"mp4-bytes",
            headers={"content-type": "video/mp4; some=param"},
        )
    )

    # Parent directories are created as needed.
    dest = await box.browser.recordings.download(
        "recording-1", path=str(tmp_path / "recordings" / "nested" / "demo.mp4")
    )

    assert dest == str(tmp_path / "recordings" / "nested" / "demo.mp4")
    with open(dest, "rb") as fh:
        assert fh.read() == b"mp4-bytes"
    await box.aclose()


@respx.mock
async def test_recording_download_default_extension_follows_content_type(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    box = await make_async_box(respx.mock)
    respx.get(f"{BASE}/browser/recordings/recording-1/download").mock(
        return_value=httpx.Response(
            200, content=b"ts-bytes", headers={"content-type": "video/mp2t"}
        )
    )

    # Legacy recordings without an MP4 remux stream raw MPEG-TS.
    dest = await box.browser.recordings.download("recording-1")

    assert dest == "./box-recording-recording-1.ts"
    with open(dest, "rb") as fh:
        assert fh.read() == b"ts-bytes"
    await box.aclose()


@respx.mock
async def test_recording_download_rejects_unexpected_content_type(tmp_path):
    box = await make_async_box(respx.mock)
    respx.get(f"{BASE}/browser/recordings/recording-1/download").mock(
        return_value=httpx.Response(
            200, content=b"<html>nope</html>", headers={"content-type": "text/html"}
        )
    )

    dest = str(tmp_path / "demo.mp4")
    with pytest.raises(BoxError, match="Unexpected recording content type: text/html"):
        await box.browser.recordings.download("recording-1", path=dest)
    assert not os.path.exists(dest)
    await box.aclose()


@respx.mock
async def test_recording_download_surfaces_backend_error(tmp_path):
    box = await make_async_box(respx.mock)
    respx.get(f"{BASE}/browser/recordings/recording-1/download").mock(
        return_value=httpx.Response(409, json={"error": "recording is not ready for download"})
    )

    with pytest.raises(BoxError, match="recording is not ready for download"):
        await box.browser.recordings.download("recording-1", path=str(tmp_path / "demo.mp4"))
    await box.aclose()


@respx.mock
async def test_recording_download_preserves_existing_file_on_failure(tmp_path):
    box = await make_async_box(respx.mock)
    dest = tmp_path / "demo.mp4"
    dest.write_bytes(b"existing-recording")

    # Headers arrive, then the body aborts mid-stream after a partial chunk.
    async def _partial_then_error():
        yield b"partial"
        raise httpx.ReadError("connection reset")

    respx.get(f"{BASE}/browser/recordings/recording-1/download").mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "video/mp4"},
            content=_partial_then_error(),
        )
    )

    # Interrupted streams surface as BoxError, like _request().
    with pytest.raises(BoxError, match="connection reset"):
        await box.browser.recordings.download("recording-1", path=str(dest))

    # The existing file at dest must survive intact, and no temp file is left behind.
    assert dest.read_bytes() == b"existing-recording"
    assert [p.name for p in tmp_path.iterdir()] == ["demo.mp4"]
    await box.aclose()


@respx.mock
async def test_recording_download_wraps_transport_timeout(tmp_path):
    box = await make_async_box(respx.mock)
    respx.get(f"{BASE}/browser/recordings/recording-1/download").mock(
        side_effect=httpx.ConnectTimeout("timed out")
    )

    with pytest.raises(BoxError, match="Request timeout"):
        await box.browser.recordings.download("recording-1", path=str(tmp_path / "demo.mp4"))
    await box.aclose()


@respx.mock
async def test_stale_handle_does_not_stop_newer_recording():
    box = await make_async_box(respx.mock)
    respx.post(f"{BASE}/browser/recordings").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "recording-1",
                "box_id": "box-123",
                "status": "recording",
                "started_at": 1000,
            },
        )
    )
    respx.get(f"{BASE}/browser/recordings/recording-1").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "recording-1",
                "box_id": "box-123",
                "status": "completed",
                "started_at": 1000,
                "ended_at": 4000,
                "stopped_reason": "idle",
            },
        )
    )
    stop = respx.post(f"{BASE}/browser/recordings/stop").mock(
        return_value=httpx.Response(200, json={})
    )

    handle = await box.browser.recordings.start()
    recording = await handle.stop()

    assert recording.status == "completed"
    assert recording.stopped_reason == "idle"
    assert not stop.called
    await box.aclose()


@respx.mock
async def test_recordings_list_paginates_and_get():
    box = await make_async_box(respx.mock)
    listing = respx.get(f"{BASE}/browser/recordings").mock(
        side_effect=[
            httpx.Response(
                200,
                json={
                    "recordings": [
                        {"id": "rec-1", "box_id": "box-123", "status": "completed", "started_at": 1}
                    ],
                    "next_cursor": "cursor-2",
                },
            ),
            httpx.Response(
                200,
                json={
                    "recordings": [
                        {"id": "rec-2", "box_id": "box-123", "status": "deleted", "started_at": 2}
                    ]
                },
            ),
        ]
    )
    respx.get(f"{BASE}/browser/recordings/rec-2").mock(
        return_value=httpx.Response(
            200, json={"id": "rec-2", "box_id": "box-123", "status": "deleted", "started_at": 2}
        )
    )

    recordings = await box.browser.recordings.list()
    single = await box.browser.recordings.get("rec-2")

    assert [r.id for r in recordings] == ["rec-1", "rec-2"]
    assert single.status == "deleted"
    first, second = (c.request.url for c in listing.calls)
    assert "limit=100" in str(first)
    assert "cursor=cursor-2" in str(second)
    await box.aclose()

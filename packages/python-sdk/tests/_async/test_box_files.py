import httpx
import pytest
import respx
from helpers import TEST_BASE_URL, last_json_body, make_async_box
from pydantic import ValidationError

from upstash_box import BoxError

BASE = f"{TEST_BASE_URL}/v2/box/box-123"


@respx.mock
async def test_read_file():
    box = await make_async_box(respx.mock)
    route = respx.get(url__startswith=f"{BASE}/files/read").mock(
        return_value=httpx.Response(200, json={"content": "hello"})
    )
    content = await box.files.read("hello.txt")
    assert content == "hello"
    assert "path=%2Fworkspace%2Fhome%2Fhello.txt" in str(route.calls.last.request.url)
    await box.aclose()


@respx.mock
async def test_read_file_base64():
    box = await make_async_box(respx.mock)
    route = respx.get(url__startswith=f"{BASE}/files/read").mock(
        return_value=httpx.Response(200, json={"content": "Zm9v"})
    )
    await box.files.read("image.png", encoding="base64")
    assert "encoding=base64" in str(route.calls.last.request.url)
    await box.aclose()


@respx.mock
async def test_write_file():
    box = await make_async_box(respx.mock)
    route = respx.post(f"{BASE}/files/write").mock(return_value=httpx.Response(200, json={}))
    await box.files.write(path="hello.txt", content="hi")
    body = last_json_body(route)
    assert body == {"path": "/workspace/home/hello.txt", "content": "hi"}
    await box.aclose()


@respx.mock
async def test_list_files():
    box = await make_async_box(respx.mock)
    respx.get(url__startswith=f"{BASE}/files/list").mock(
        return_value=httpx.Response(
            200,
            json={
                "files": [
                    {
                        "name": "a.txt",
                        "path": "/workspace/home/a.txt",
                        "size": 3,
                        "is_dir": False,
                        "mod_time": "t",
                    }
                ]
            },
        )
    )
    files = await box.files.list(".")
    assert len(files) == 1
    assert files[0].name == "a.txt"
    assert files[0].is_dir is False
    await box.aclose()


@respx.mock
async def test_list_files_null_returns_empty():
    box = await make_async_box(respx.mock)
    respx.get(url__startswith=f"{BASE}/files/list").mock(
        return_value=httpx.Response(200, json={"files": None})
    )
    assert await box.files.list() == []
    await box.aclose()


@respx.mock
async def test_upload_files(tmp_path):
    box = await make_async_box(respx.mock)
    local = tmp_path / "local.txt"
    local.write_text("data")
    route = respx.post(f"{BASE}/files/upload").mock(return_value=httpx.Response(200, json={}))
    await box.files.upload([{"path": str(local), "destination": "remote.txt"}])
    assert route.called
    content_type = route.calls.last.request.headers["content-type"]
    assert content_type.startswith("multipart/form-data")
    await box.aclose()


@respx.mock
async def test_download_files(tmp_path, monkeypatch):
    box = await make_async_box(respx.mock)
    monkeypatch.chdir(tmp_path)
    respx.get(url__startswith=f"{BASE}/files/list").mock(
        return_value=httpx.Response(
            200,
            json={
                "files": [
                    {
                        "name": "a.txt",
                        "path": "/workspace/home/sub/a.txt",
                        "size": 3,
                        "is_dir": False,
                        "mod_time": "t",
                    }
                ]
            },
        )
    )
    respx.get(url__startswith=f"{BASE}/files/download").mock(
        return_value=httpx.Response(200, content=b"file-bytes")
    )
    await box.files.download(folder="sub")
    written = tmp_path / "sub" / "a.txt"
    assert written.read_bytes() == b"file-bytes"
    await box.aclose()


def _list_one(name: str):
    return httpx.Response(
        200,
        json={
            "files": [
                {
                    "name": name,
                    "path": "/workspace/home/sub/x",
                    "size": 1,
                    "is_dir": False,
                    "mod_time": "t",
                }
            ]
        },
    )


@respx.mock
async def test_download_neutralizes_traversal_name(tmp_path, monkeypatch):
    box = await make_async_box(respx.mock)
    monkeypatch.chdir(tmp_path)
    # A name that tries to escape `dest` is reduced to its basename and kept inside.
    respx.get(url__startswith=f"{BASE}/files/list").mock(return_value=_list_one("../../evil.txt"))
    respx.get(url__startswith=f"{BASE}/files/download").mock(
        return_value=httpx.Response(200, content=b"pwned")
    )
    await box.files.download(folder="sub")
    assert (tmp_path / "sub" / "evil.txt").read_bytes() == b"pwned"  # contained in dest
    assert not (tmp_path / "evil.txt").exists()  # did not escape
    await box.aclose()


@respx.mock
async def test_download_rejects_dotdot_name(tmp_path, monkeypatch):
    box = await make_async_box(respx.mock)
    monkeypatch.chdir(tmp_path)
    respx.get(url__startswith=f"{BASE}/files/list").mock(return_value=_list_one(".."))
    respx.get(url__startswith=f"{BASE}/files/download").mock(
        return_value=httpx.Response(200, content=b"x")
    )
    with pytest.raises(BoxError, match="Unsafe download filename"):
        await box.files.download(folder="sub")
    await box.aclose()


@respx.mock
async def test_read_file_range():
    box = await make_async_box(respx.mock)
    route = respx.get(url__startswith=f"{BASE}/files/read").mock(
        return_value=httpx.Response(200, json={"content": "EFG"})
    )
    content = await box.files.read("big.log", offset=4, length=3)
    assert content == "EFG"
    url = str(route.calls.last.request.url)
    assert "offset=4" in url and "length=3" in url
    await box.aclose()


@respx.mock
async def test_read_file_explicit_zero_length_is_not_whole_file():
    box = await make_async_box(respx.mock)
    route = respx.get(url__startswith=f"{BASE}/files/read").mock(
        return_value=httpx.Response(200, json={"content": ""})
    )
    await box.files.read("big.log", length=0)
    assert "length=0" in str(route.calls.last.request.url)
    await box.aclose()


@respx.mock
async def test_read_file_omits_range_when_not_requested():
    box = await make_async_box(respx.mock)
    route = respx.get(url__startswith=f"{BASE}/files/read").mock(
        return_value=httpx.Response(200, json={"content": "whole"})
    )
    await box.files.read("f.txt")
    assert "length=" not in str(route.calls.last.request.url)
    await box.aclose()


@respx.mock
async def test_stat_file():
    box = await make_async_box(respx.mock)
    route = respx.get(url__startswith=f"{BASE}/files/stat").mock(
        return_value=httpx.Response(
            200,
            json={
                "type": "file",
                "size": 12,
                "mod_time": "2026-08-19T11:56:59Z",
                "inode": 42,
                "version": "42-1787-12",
            },
        )
    )
    st = await box.files.stat("a.txt")
    assert st.type == "file"
    assert st.size == 12
    assert st.version == "42-1787-12"
    url = str(route.calls.last.request.url)
    assert "path=%2Fworkspace%2Fhome%2Fa.txt" in url
    assert "follow=true" not in url
    await box.aclose()


@respx.mock
async def test_stat_file_follow():
    box = await make_async_box(respx.mock)
    route = respx.get(url__startswith=f"{BASE}/files/stat").mock(
        return_value=httpx.Response(
            200,
            json={"type": "file", "size": 0, "mod_time": "", "inode": 1, "version": "1"},
        )
    )
    await box.files.stat("link", follow=True)
    assert "follow=true" in str(route.calls.last.request.url)
    await box.aclose()


@respx.mock
async def test_mkdir():
    box = await make_async_box(respx.mock)
    route = respx.post(f"{BASE}/files/mkdir").mock(return_value=httpx.Response(200, json={}))
    await box.files.mkdir("a/b", parents=True)
    assert last_json_body(route) == {"path": "/workspace/home/a/b", "parents": True}
    await box.aclose()


@respx.mock
async def test_rename_file():
    box = await make_async_box(respx.mock)
    route = respx.post(f"{BASE}/files/rename").mock(return_value=httpx.Response(200, json={}))
    await box.files.rename("a.txt", "b.txt")
    assert last_json_body(route) == {
        "from": "/workspace/home/a.txt",
        "to": "/workspace/home/b.txt",
    }
    await box.aclose()


@respx.mock
async def test_remove_file():
    box = await make_async_box(respx.mock)
    route = respx.post(f"{BASE}/files/remove").mock(return_value=httpx.Response(200, json={}))
    await box.files.remove("dir", recursive=True)
    assert last_json_body(route) == {"path": "/workspace/home/dir", "recursive": True}
    await box.aclose()


@respx.mock
async def test_mkdir_defaults_parents_false():
    box = await make_async_box(respx.mock)
    route = respx.post(f"{BASE}/files/mkdir").mock(return_value=httpx.Response(200, json={}))
    await box.files.mkdir("dir")
    assert last_json_body(route) == {"path": "/workspace/home/dir", "parents": False}
    await box.aclose()


@respx.mock
async def test_remove_defaults_recursive_false():
    box = await make_async_box(respx.mock)
    route = respx.post(f"{BASE}/files/remove").mock(return_value=httpx.Response(200, json={}))
    await box.files.remove("f.txt")
    assert last_json_body(route) == {"path": "/workspace/home/f.txt", "recursive": False}
    await box.aclose()


@respx.mock
async def test_stat_file_rejects_unknown_type():
    """FileStat.type is a closed set; an unexpected value is a validation error."""
    box = await make_async_box(respx.mock)
    respx.get(url__startswith=f"{BASE}/files/stat").mock(
        return_value=httpx.Response(
            200,
            json={"type": "socket", "size": 0, "mod_time": "", "inode": 1, "version": "1"},
        )
    )
    with pytest.raises(ValidationError):
        await box.files.stat("weird")
    await box.aclose()

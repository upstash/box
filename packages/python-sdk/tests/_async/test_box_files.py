import httpx
import pytest
import respx
from helpers import TEST_BASE_URL, last_json_body, make_async_box

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

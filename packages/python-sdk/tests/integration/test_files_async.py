"""Files, inline code execution, and working-directory operations."""

import pytest

from upstash_box import AsyncBox

pytestmark = pytest.mark.integration


async def test_files_code_and_cwd(opts, tmp_path, monkeypatch):
    box = await AsyncBox.create(runtime="python", **opts)
    try:
        # write / read / list
        await box.files.write(path="data.txt", content="line1\nline2")
        assert await box.files.read("data.txt") == "line1\nline2"
        entries = await box.files.list(".")
        assert any(e.name == "data.txt" for e in entries)

        # base64 round-trip
        await box.files.write(path="b.bin", content="aGVsbG8=", encoding="base64")
        assert await box.files.read("b.bin", encoding="base64") == "aGVsbG8="

        # inline code (python + js)
        py = await box.exec.code(code="print(6 * 7)", lang="python")
        assert py.result.strip() == "42"
        js = await box.exec.code(code="console.log(1 + 2)", lang="js")
        assert js.result.strip() == "3"

        # working directory
        await box.exec.command("mkdir -p sub")
        await box.cd("sub")
        assert box.cwd.endswith("/sub")
        await box.files.write(path="nested.txt", content="x")
        await box.cd("..")
        assert box.cwd == "/workspace/home"

        # download to local disk
        monkeypatch.chdir(tmp_path)
        await box.files.download(folder="sub")
        assert (tmp_path / "sub" / "nested.txt").read_text() == "x"
    finally:
        await box.delete()

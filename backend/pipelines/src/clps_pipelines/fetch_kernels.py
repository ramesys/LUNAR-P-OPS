import hashlib
import shutil
import urllib.request
from pathlib import Path

from lunar_core.kernels import KERNELS, KernelFile

from clps_pipelines import data_dir


def _md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(kernel: KernelFile, target: Path) -> None:
    partial: Path = target.with_suffix(target.suffix + ".part")
    print(f"downloading {kernel.url}")
    with urllib.request.urlopen(kernel.url, timeout=60) as response, partial.open("wb") as out:
        shutil.copyfileobj(response, out)
    if kernel.md5 is not None and _md5(partial) != kernel.md5:
        partial.unlink()
        raise RuntimeError(f"MD5 mismatch for {kernel.filename}")
    partial.replace(target)


def main() -> None:
    kernel_dir: Path = data_dir() / "kernels"
    kernel_dir.mkdir(parents=True, exist_ok=True)
    for kernel in KERNELS:
        target: Path = kernel_dir / kernel.filename
        if target.is_file():
            print(f"ok          {kernel.filename}")
            continue
        _download(kernel, target)
        print(f"downloaded  {kernel.filename}")


if __name__ == "__main__":
    main()

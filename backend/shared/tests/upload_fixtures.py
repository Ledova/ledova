import io
from pathlib import Path
from unittest.mock import patch

import pymupdf
from PIL import Image

ADDRESS_SPACE_EVERY_KERNEL_ACCEPTS = 2**50
REFUSED_ADDRESS_SPACE_WARNING = (
    "WARNING:shared.upload_process:Upload workers run without RLIMIT_AS, which this platform refuses to set"
)


class StubUploadDependencies:
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for target in (
            "shared.uploads.scan_upload",
            "documents.services.extraction.scan_upload",
            "shared.upload_limits.reserve_request",
            "shared.upload_limits.reserve_bytes",
        ):
            stub = patch(target)
            stub.start()
            cls.addClassCleanup(stub.stop)


def pdf_bytes(pages=1, width=595, height=842):
    with pymupdf.open() as document:
        for _ in range(pages):
            document.new_page(width=width, height=height)
        return document.tobytes()


def image_bytes(format="PNG", size=(32, 24)):
    output = io.BytesIO()
    with Image.new("RGB", size, "white") as image:
        image.save(output, format=format)
    return output.getvalue()


def pdf_with_images(sizes):
    with pymupdf.open() as document:
        page = document.new_page(width=5, height=5)
        for size in sizes:
            page.insert_image(pymupdf.Rect(0, 0, 5, 5), stream=image_bytes(size=size))
        return document.tobytes()


def a_worker_on_a_refusing_kernel(worker, directory, refused="RLIMIT_AS", hard="resource.RLIM_INFINITY"):
    wrapper = Path(directory) / "refusing.py"
    wrapper.write_text(
        "import resource\nimport runpy\nimport sys\nimport types\n"
        "setrlimit, getrlimit = resource.setrlimit, resource.getrlimit\n"
        f"refused = resource.{refused}\n"
        "def refuse(limit, values):\n"
        "    if limit == refused:\n"
        "        raise ValueError('current limit exceeds maximum limit')\n"
        "    setrlimit(limit, values)\n"
        "def hard_limit(limit):\n"
        f"    return ({hard}, {hard}) if limit == refused else getrlimit(limit)\n"
        "class Upload:\n"
        "    def read(self, size):\n"
        f"        with open({str(Path(directory) / 'observed')!r}, 'w') as observed:\n"
        "            names = ('RLIMIT_CORE', 'RLIMIT_CPU', 'RLIMIT_FSIZE')\n"
        "            observed.write(repr([getrlimit(getattr(resource, name)) for name in names]))\n"
        "        return upload.read(size)\n"
        "upload = sys.stdin.buffer\n"
        "sys.stdin = types.SimpleNamespace(buffer=Upload())\n"
        "resource.setrlimit, resource.getrlimit = refuse, hard_limit\n"
        f"runpy.run_path({str(worker)!r}, run_name='__main__')\n"
    )
    return wrapper

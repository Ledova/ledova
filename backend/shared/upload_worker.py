import io
import json
import math
import runpy
import sys
import warnings
from pathlib import Path

apply_limits = runpy.run_path(str(Path(__file__).with_name("upload_worker_limits.py")))["apply_limits"]


class InvalidContent(Exception):
    pass


def check_dimensions(width, height, limits):
    if not math.isfinite(width) or not math.isfinite(height) or width <= 0 or height <= 0:
        raise InvalidContent()
    pixels = math.ceil(width) * math.ceil(height)
    if pixels > limits["pixels"] or pixels * 4 > limits["decoded_bytes"]:
        raise InvalidContent()


def process_pdf(raw, limits):
    import pymupdf

    with pymupdf.open(stream=raw, filetype="pdf") as document:
        if document.needs_pass or document.is_repaired or not 1 <= document.page_count <= limits["pages"]:
            raise InvalidContent()
        for page in document:
            check_dimensions(page.rect.width * 2, page.rect.height * 2, limits)
            seen = set()
            decoded = 0
            for image in page.get_images(full=True):
                xref, _, width, height = image[:4]
                check_dimensions(width, height, limits)
                if xref not in seen:
                    decoded += width * height * 4
                    seen.add(xref)
                if decoded > limits["decoded_bytes"]:
                    raise InvalidContent()
    return "application/pdf"


def process_image(raw, limits):
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = limits["pixels"]
    warnings.simplefilter("error", Image.DecompressionBombWarning)
    with Image.open(io.BytesIO(raw), formats=("PNG", "JPEG")) as image:
        check_dimensions(*image.size, limits)
        if getattr(image, "n_frames", 1) != 1:
            raise InvalidContent()
        mime = Image.MIME[image.format]
        image.verify()
    with Image.open(io.BytesIO(raw), formats=("PNG", "JPEG")) as image:
        image.load()
    return mime


def main():
    limits = json.loads(sys.argv[1])
    apply_limits(limits["memory_bytes"], limits["cpu_seconds"], limits["file_bytes"])
    raw = sys.stdin.buffer.read(limits["input_bytes"] + 1)
    if not raw or len(raw) > limits["input_bytes"]:
        return 2
    try:
        if raw.startswith(b"%PDF-"):
            mime = process_pdf(raw, limits)
        elif raw.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff")):
            mime = process_image(raw, limits)
        else:
            return 2
        print(json.dumps({"mime_type": mime}))
        return 0
    except MemoryError:
        return 3
    except Exception:
        return 2


if __name__ == "__main__":
    sys.exit(main())

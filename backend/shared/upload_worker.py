import io
import json
import logging
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
    return pixels * 4


class RefuseRepairs(logging.Handler):
    rejected = False

    def emit(self, record):
        self.rejected = True
        raise InvalidContent()


def process_pdf(raw, limits):
    from pypdf import PdfReader, apply_configuration
    from pypdf.generic import ContentStream, IndirectObject, StreamObject

    log = logging.getLogger("pypdf")
    refuse = RefuseRepairs(logging.WARNING)
    previous_level = log.level
    log.setLevel(logging.WARNING)
    log.addHandler(refuse)
    try:
        budget = limits["decoded_bytes"]
        with apply_configuration(
            maximum_declared_stream_length=limits["input_bytes"],
            array_based_stream_maximum_output_length=budget,
            zlib_maximum_output_length=budget,
            lzw_maximum_output_length=budget,
            run_length_maximum_output_length=budget,
            jbig2_maximum_output_length=budget,
            brotli_maximum_output_length=budget,
            image_maximum_buffer_size=budget,
            stream_decoding_work_maximum_length=budget,
            jbig2dec_binary=None,
        ):
            reader = PdfReader(io.BytesIO(raw), strict=True)
            if reader.is_encrypted or not 1 <= len(reader.pages) <= limits["pages"]:
                raise InvalidContent()
            for generation, entries in list(reader.xref.items()):
                for number in list(entries):
                    if number and not reader.xref_free_entry.get(generation, {}).get(number):
                        reader.get_object(IndirectObject(number, generation, reader))
            for number in list(reader.xref_objStm):
                reader.get_object(IndirectObject(number, 0, reader))
            for page in reader.pages:
                unit = page.user_unit
                for box in (page.mediabox, page.cropbox):
                    check_dimensions(
                        float(box.width) * unit * 2,
                        float(box.height) * unit * 2,
                        limits,
                    )
                seen = set()
                active = set()
                decoded = 0

                def image(value):
                    nonlocal decoded
                    value = value.get_object()
                    key = id(value)
                    if key in active:
                        raise InvalidContent()
                    if key in seen:
                        return
                    active.add(key)
                    decoded += check_dimensions(float(value["/Width"]), float(value["/Height"]), limits)
                    if decoded > budget:
                        raise InvalidContent()
                    for name in ("/SMask", "/Mask"):
                        mask = value.get(name)
                        if mask is not None and isinstance(mask.get_object(), StreamObject):
                            image(mask)
                    active.remove(key)
                    seen.add(key)

                def content(stream):
                    nonlocal decoded
                    for operands, operator in ContentStream(stream, reader).operations:
                        if operator == b"INLINE IMAGE":
                            settings = operands["settings"]
                            decoded += check_dimensions(
                                float(settings.get("/W", settings.get("/Width"))),
                                float(settings.get("/H", settings.get("/Height"))),
                                limits,
                            )
                            if decoded > budget:
                                raise InvalidContent()

                def resources(value):
                    if value is None:
                        return
                    xobjects = value.get_object().get("/XObject")
                    if xobjects is None:
                        return
                    for obj in xobjects.get_object().values():
                        obj = obj.get_object()
                        if obj.get("/Subtype") == "/Image":
                            image(obj)
                        elif obj.get("/Subtype") == "/Form":
                            key = id(obj)
                            if key in active:
                                raise InvalidContent()
                            if key in seen:
                                continue
                            active.add(key)
                            content(obj)
                            resources(obj.get("/Resources"))
                            active.remove(key)
                            seen.add(key)

                content(page.get_contents())
                resources(page.get("/Resources"))
        if refuse.rejected:
            raise InvalidContent()
        return "application/pdf"
    finally:
        log.removeHandler(refuse)
        log.setLevel(previous_level)


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

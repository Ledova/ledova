import io

from django.test import SimpleTestCase, override_settings
from pypdf import PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
)

from shared.upload_errors import UploadRejected
from shared.upload_processing import process_upload


def document_bytes(kind):
    writer = PdfWriter()
    page = writer.add_blank_page(100, 100)
    if kind == "pages":
        for _ in range(100):
            writer.add_blank_page(100, 100)
    if kind.startswith("encrypted"):
        writer.encrypt("" if kind == "encrypted-empty" else "synthetic-password")
    if kind == "user-unit":
        page[NameObject("/UserUnit")] = NumberObject(100)
    if kind in ("image", "mask", "aggregate", "inline", "nested-inline", "cycle"):
        image = DecodedStreamObject()
        image.set_data(b"\0\0\0")
        image.update(
            {
                NameObject("/Type"): NameObject("/XObject"),
                NameObject("/Subtype"): NameObject("/Image"),
                NameObject("/Width"): NumberObject(5000),
                NameObject("/Height"): NumberObject(5000),
                NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
                NameObject("/BitsPerComponent"): NumberObject(8),
            }
        )
        xobjects = DictionaryObject({NameObject("/Image"): writer._add_object(image)})
        resources = DictionaryObject({NameObject("/XObject"): xobjects})
        form = DecodedStreamObject()
        form.set_data(b"")
        form.update(
            {
                NameObject("/Subtype"): NameObject("/Form"),
                NameObject("/BBox"): ArrayObject([NumberObject(value) for value in (0, 0, 1, 1)]),
                NameObject("/Resources"): resources,
            }
        )
        if kind == "mask":
            mask = DecodedStreamObject()
            mask.set_data(b"\0")
            mask.update(dict(image))
            image[NameObject("/Width")] = NumberObject(1)
            image[NameObject("/Height")] = NumberObject(1)
            image[NameObject("/SMask")] = writer._add_object(mask)
        if kind == "aggregate":
            image[NameObject("/Width")] = NumberObject(4000)
            image[NameObject("/Height")] = NumberObject(4000)
            second = DecodedStreamObject()
            second.set_data(b"\0")
            second.update(dict(image))
            xobjects[NameObject("/Second")] = writer._add_object(second)
        inline = DecodedStreamObject()
        inline.set_data(b"BI /W 5000 /H 5000 /BPC 8 /CS /RGB ID \0\0\0 EI")
        if kind == "inline":
            page[NameObject("/Contents")] = writer._add_object(inline)
        elif kind == "cycle":
            xobjects.pop("/Image")
            xobjects[NameObject("/Form")] = writer._add_object(form)
            page[NameObject("/Resources")] = resources
        else:
            if kind == "nested-inline":
                form.set_data(inline.get_data())
                form[NameObject("/Resources")] = DictionaryObject()
            page[NameObject("/Resources")] = DictionaryObject(
                {NameObject("/XObject"): DictionaryObject({NameObject("/Form"): writer._add_object(form)})}
            )
    if kind == "decoded-stream":
        stream = DecodedStreamObject()
        stream.set_data(b"q " * 100_001)
        page[NameObject("/Contents")] = writer._add_object(stream.flate_encode())
    result = io.BytesIO()
    writer.write(result)
    raw = result.getvalue()
    if kind == "repaired-xref":
        raw = raw.replace(b"0000000015 00000 n", b"0000000001 00000 n")
    if kind == "missing-eof":
        raw = raw[:-6]
    return raw


class PdfUploadTest(SimpleTestCase):
    def test_isolated_pdf_parser_refuses_encryption_repairs_and_unbounded_content(self):
        self.assertEqual(process_upload(document_bytes("blank")), "application/pdf")
        for kind in (
            "pages",
            "encrypted-password",
            "encrypted-empty",
            "repaired-xref",
            "missing-eof",
            "user-unit",
            "image",
            "mask",
            "aggregate",
            "inline",
            "nested-inline",
            "cycle",
            "decoded-stream",
        ):
            with self.subTest(kind=kind), override_settings(
                UPLOAD_MAX_DECODED_BYTES=200_000 if kind == "decoded-stream" else 64 * 1024 * 1024
            ):
                with self.assertRaises(UploadRejected):
                    process_upload(document_bytes(kind))

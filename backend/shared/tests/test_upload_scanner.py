import contextlib
import socket
import struct
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from shared.tests.upload_fixtures import (
    ADDRESS_SPACE_EVERY_KERNEL_ACCEPTS,
    REFUSED_ADDRESS_SPACE_WARNING,
    a_worker_on_a_refusing_kernel,
    image_bytes,
)
from shared.upload_errors import UploadRejected, UploadUnavailable
from shared.upload_process import report_refused_address_space
from shared.upload_processing import process_upload
from shared.upload_scanner import SCANNER_REPLY_BYTES, WORKER, scan_upload


@contextlib.contextmanager
def a_daemon_that_finds_everything_clean():
    received = []
    stop = threading.Event()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        listener.settimeout(0.05)

        def serve():
            while not stop.is_set():
                try:
                    server, _ = listener.accept()
                except TimeoutError:
                    continue
                with server, server.makefile("rb") as source:
                    command = source.read(10)
                    data = bytearray()
                    while length := struct.unpack("!I", source.read(4))[0]:
                        data.extend(source.read(length))
                    received.append((command, bytes(data)))
                    server.sendall(b"stream: OK\0")

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        try:
            with override_settings(UPLOAD_SCANNER_HOST="127.0.0.1", UPLOAD_SCANNER_PORT=listener.getsockname()[1]):
                yield received
        finally:
            stop.set()
            thread.join(timeout=2)


class ScannerProtocolTest(SimpleTestCase):
    def scanner_reply(self, raw, reply):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        listener.settimeout(3)
        received = []

        def serve():
            server, _ = listener.accept()
            with server, server.makefile("rb") as source:
                command = source.read(10)
                data = bytearray()
                while True:
                    length = struct.unpack("!I", source.read(4))[0]
                    if length == 0:
                        break
                    data.extend(source.read(length))
                received.append((command, bytes(data)))
                server.sendall(reply)

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        try:
            with override_settings(UPLOAD_SCANNER_HOST="127.0.0.1", UPLOAD_SCANNER_PORT=listener.getsockname()[1]):
                scan_upload(raw)
        finally:
            listener.close()
            thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        return received

    def test_the_client_streams_all_bytes_and_accepts_one_complete_clean_verdict(self):
        raw = b"synthetic bytes" * 10000

        received = self.scanner_reply(raw, b"stream: OK\0")

        self.assertEqual(received, [(b"zINSTREAM\0", raw)])

    def test_a_detection_verdict_refuses_the_file_without_exposing_the_signature(self):
        with self.assertRaises(UploadRejected) as refused:
            self.scanner_reply(b"synthetic", b"stream: synthetic-sensitive-signature FOUND\0")

        self.assertNotIn("synthetic-sensitive-signature", str(refused.exception))

    def test_truncated_error_extra_and_oversized_replies_fail_closed(self):
        for reply in (
            b"stream: OK",
            b"stream: ERROR\0",
            b"stream: OK\0stream: a detection FOUND\0",
            b"stream: OK\0" + b"x" * 4096,
            b"",
        ):
            with self.subTest(reply=reply[:20]), self.assertRaises(UploadUnavailable):
                self.scanner_reply(b"synthetic", reply)

    def test_an_unavailable_daemon_fails_closed(self):
        with socket.socket() as unavailable:
            unavailable.bind(("127.0.0.1", 0))
            with override_settings(UPLOAD_SCANNER_HOST="127.0.0.1", UPLOAD_SCANNER_PORT=unavailable.getsockname()[1]):
                with self.assertRaises(UploadUnavailable) as refused:
                    scan_upload(b"synthetic")

        self.assertNotIn("127.0.0.1", str(refused.exception))

    @override_settings(UPLOAD_SCANNER_SECONDS=1)
    def test_a_daemon_that_never_replies_has_a_real_deadline(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            with override_settings(UPLOAD_SCANNER_HOST="127.0.0.1", UPLOAD_SCANNER_PORT=listener.getsockname()[1]):
                with self.assertRaises(UploadUnavailable):
                    scan_upload(b"synthetic")

    @override_settings(UPLOAD_SCANNER_SECONDS=1)
    def test_the_parent_deadline_also_terminates_a_blocked_resolver_process(self):
        with tempfile.TemporaryDirectory() as directory:
            worker = Path(directory) / "blocked_resolver.py"
            worker.write_text("import time\ntime.sleep(3)\nprint('stream: OK\\0', end='')\n")
            started = time.monotonic()
            with patch("shared.upload_scanner.WORKER", worker), self.assertRaises(UploadUnavailable):
                scan_upload(b"synthetic")
            self.assertLess(time.monotonic() - started, 2.5)


class ScannerLimitRuleTest(SimpleTestCase):
    def setUp(self):
        report_refused_address_space.cache_clear()
        self.addCleanup(report_refused_address_space.cache_clear)

    @override_settings(UPLOAD_PROCESS_CPU_SECONDS=4)
    def test_a_refused_address_space_lowering_is_skipped_reported_once_and_the_rest_still_apply(self):
        with tempfile.TemporaryDirectory() as directory:
            worker = a_worker_on_a_refusing_kernel(WORKER, directory)
            with a_daemon_that_finds_everything_clean() as received, patch("shared.upload_scanner.WORKER", worker):
                with self.assertLogs("shared.upload_process") as logs:
                    scan_upload(b"synthetic")
                    scan_upload(b"synthetic")
            observed = (Path(directory) / "observed").read_text()

        self.assertEqual(received, [(b"zINSTREAM\0", b"synthetic")] * 2)
        self.assertEqual(logs.output, [REFUSED_ADDRESS_SPACE_WARNING])
        self.assertEqual(observed, f"[(0, 0), (4, 4), ({SCANNER_REPLY_BYTES}, {SCANNER_REPLY_BYTES})]")

    def test_a_refusal_under_a_finite_hard_limit_above_the_budget_is_still_a_lowering(self):
        with tempfile.TemporaryDirectory() as directory:
            worker = a_worker_on_a_refusing_kernel(WORKER, directory, hard="2 ** 40")
            with a_daemon_that_finds_everything_clean() as received, patch("shared.upload_scanner.WORKER", worker):
                with self.assertLogs("shared.upload_process") as logs:
                    scan_upload(b"synthetic")

        self.assertEqual(received, [(b"zINSTREAM\0", b"synthetic")])
        self.assertEqual(logs.output, [REFUSED_ADDRESS_SPACE_WARNING])

    @override_settings(UPLOAD_PROCESS_MEMORY_BYTES=ADDRESS_SPACE_EVERY_KERNEL_ACCEPTS)
    def test_every_other_refusal_still_fails_the_scan_before_reading_the_upload(self):
        for refused, hard in (
            ("RLIMIT_AS", "1024 * 1024"),
            ("RLIMIT_CORE", "resource.RLIM_INFINITY"),
            ("RLIMIT_CPU", "resource.RLIM_INFINITY"),
            ("RLIMIT_FSIZE", "resource.RLIM_INFINITY"),
        ):
            with self.subTest(refused=refused), tempfile.TemporaryDirectory() as directory:
                worker = a_worker_on_a_refusing_kernel(WORKER, directory, refused=refused, hard=hard)
                with a_daemon_that_finds_everything_clean() as received, patch("shared.upload_scanner.WORKER", worker):
                    with self.assertNoLogs("shared.upload_process"), self.assertRaises(UploadUnavailable):
                        scan_upload(b"synthetic")

                self.assertEqual(received, [])
                self.assertFalse((Path(directory) / "observed").exists())

    def test_a_cpu_or_memory_setting_below_one_fails_closed_in_both_workers(self):
        with a_daemon_that_finds_everything_clean() as received:
            for name in ("UPLOAD_PROCESS_CPU_SECONDS", "UPLOAD_PROCESS_MEMORY_BYTES"):
                for value in (-5, -2, -1, 0):
                    with self.subTest(setting=name, value=value), override_settings(**{name: value}):
                        with self.assertRaises(UploadUnavailable):
                            scan_upload(b"synthetic")
                        with self.assertRaises(UploadUnavailable):
                            process_upload(image_bytes())

        self.assertEqual(received, [])

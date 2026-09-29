import http.client
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

SCRIPT = Path(__file__).resolve().parents[1] / "test-bitcoin-chain.py"
SPEC = importlib.util.spec_from_file_location("bitcoin_chain", SCRIPT)
CHAIN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHAIN)

ARCHIVE = b"release archive"


def reset():
    return ConnectionResetError(54, "Connection reset by peer")


class CutOff:
    def __init__(self, first_chunk):
        self.chunks = [first_chunk]

    def __enter__(self):
        return self

    def __exit__(self, *details):
        return False

    def read(self, size):
        if self.chunks:
            return self.chunks.pop()
        raise http.client.IncompleteRead(b"", len(ARCHIVE))


class DownloadCase(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.archive = self.directory / "bitcoin.tar.gz"
        waits = patch.object(CHAIN.time, "sleep")
        self.waits = waits.start()
        self.addCleanup(waits.stop)
        log = patch.object(CHAIN.sys, "stderr", new_callable=io.StringIO)
        self.log = log.start()
        self.addCleanup(log.stop)

    def serve(self, *answers):
        opened = patch.object(CHAIN, "urlopen", side_effect=answers)
        self.addCleanup(opened.stop)
        return opened.start()

    def test_a_reset_connection_is_tried_again_after_five_then_fifteen_seconds(self):
        urlopen = self.serve(reset(), reset(), io.BytesIO(ARCHIVE))

        CHAIN.download(CHAIN.URL, self.archive)

        self.assertEqual(self.archive.read_bytes(), ARCHIVE)
        self.assertEqual(urlopen.call_args_list, [call(CHAIN.URL, timeout=60)] * 3)
        self.assertEqual(self.waits.call_args_list, [call(5), call(15)])
        self.assertIn("trying again in 5 seconds", self.log.getvalue())
        self.assertIn("trying again in 15 seconds", self.log.getvalue())

    def test_a_download_cut_off_part_way_is_written_again_from_the_start(self):
        self.serve(CutOff(b"release"), io.BytesIO(ARCHIVE))

        CHAIN.download(CHAIN.URL, self.archive)

        self.assertEqual(self.archive.read_bytes(), ARCHIVE)
        self.assertEqual(self.waits.call_args_list, [call(5)])

    def test_the_third_failure_is_raised_without_another_wait(self):
        urlopen = self.serve(reset(), reset(), reset())

        with self.assertRaises(ConnectionResetError):
            CHAIN.download(CHAIN.URL, self.archive)

        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual(self.waits.call_args_list, [call(5), call(15)])

    def test_an_archive_downloaded_after_a_retry_still_has_to_match_the_pinned_hash(self):
        self.serve(reset(), io.BytesIO(ARCHIVE))

        with (
            patch.dict(os.environ, {"BITCOIN_TEST_BINARY": ""}),
            patch.object(CHAIN.platform, "system", return_value="Linux"),
            patch.object(CHAIN.platform, "machine", return_value="x86_64"),
            self.assertRaisesRegex(RuntimeError, "does not match its pinned SHA256"),
        ):
            CHAIN.bitcoin_binary(self.directory)

        self.assertEqual(self.waits.call_args_list, [call(5)])


if __name__ == "__main__":
    unittest.main()

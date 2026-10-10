import http.client
import importlib.util
import io
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

SCRIPT = Path(__file__).resolve().parents[1] / "test-bitcoin-chain.py"
SPEC = importlib.util.spec_from_file_location("bitcoin_chain", SCRIPT)
CHAIN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHAIN)

ARCHIVE = b"release archive"
URL = (
    "https://bitcoincore.org/bin/bitcoin-core-31.1/bitcoin-31.1-x86_64-linux-gnu.tar.gz"
)
HASHES = {
    "x86_64": "b80d9c3e04da78fb6f0569685673418cf686fadba9042d926d13fb87ff503f9e",
    "aarch64": "dcf1873f2208ba4f962f3398d47e154c39c0084be8f4553e05c940d0ace3d004",
}


def release_archive(binary):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        entry = tarfile.TarInfo("bitcoin-31.1/bin/bitcoind")
        entry.size = len(binary)
        archive.addfile(entry, io.BytesIO(binary))
    return output.getvalue()


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

        CHAIN.download(URL, self.archive)

        self.assertEqual(self.archive.read_bytes(), ARCHIVE)
        self.assertEqual(urlopen.call_args_list, [call(URL, timeout=60)] * 3)
        self.assertEqual(self.waits.call_args_list, [call(5), call(15)])
        self.assertIn("trying again in 5 seconds", self.log.getvalue())
        self.assertIn("trying again in 15 seconds", self.log.getvalue())

    def test_a_download_cut_off_part_way_is_written_again_from_the_start(self):
        self.serve(CutOff(b"release"), io.BytesIO(ARCHIVE))

        CHAIN.download(URL, self.archive)

        self.assertEqual(self.archive.read_bytes(), ARCHIVE)
        self.assertEqual(self.waits.call_args_list, [call(5)])

    def test_the_third_failure_is_raised_without_another_wait(self):
        urlopen = self.serve(reset(), reset(), reset())

        with self.assertRaises(ConnectionResetError):
            CHAIN.download(URL, self.archive)

        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual(self.waits.call_args_list, [call(5), call(15)])

    def test_an_archive_downloaded_after_a_retry_still_has_to_match_the_pinned_hash(
        self,
    ):
        self.serve(reset(), io.BytesIO(ARCHIVE))

        with (
            patch.dict(os.environ, {"BITCOIN_TEST_BINARY": ""}),
            patch.object(CHAIN.platform, "system", return_value="Linux"),
            patch.object(CHAIN.platform, "machine", return_value="x86_64"),
            self.assertRaisesRegex(RuntimeError, "does not match its pinned SHA256"),
        ):
            CHAIN.bitcoin_binary(self.directory)

        self.assertEqual(self.waits.call_args_list, [call(5)])

    def test_each_supported_linux_architecture_selects_its_signed_release_hash(self):
        binary_bytes = b"mock Bitcoin executable"
        for architecture, checksum in HASHES.items():
            with self.subTest(architecture=architecture):
                opened = self.serve(io.BytesIO(release_archive(binary_bytes)))
                with (
                    patch.dict(os.environ, {"BITCOIN_TEST_BINARY": ""}),
                    patch.object(CHAIN.platform, "system", return_value="Linux"),
                    patch.object(CHAIN.platform, "machine", return_value=architecture),
                    patch.object(CHAIN.hashlib, "file_digest") as digest,
                    patch.object(
                        CHAIN.subprocess,
                        "check_output",
                        return_value="Bitcoin Core daemon version v31.1.0 bitcoind\n",
                    ) as version,
                ):
                    digest.return_value.hexdigest.return_value = checksum
                    binary = CHAIN.bitcoin_binary(self.directory)

                expected_url = f"https://bitcoincore.org/bin/bitcoin-core-31.1/bitcoin-31.1-{architecture}-linux-gnu.tar.gz"
                opened.assert_called_once_with(expected_url, timeout=60)
                self.assertEqual(binary.read_bytes(), binary_bytes)
                self.assertEqual(binary.stat().st_mode & 0o777, 0o700)
                version.assert_called_once_with([str(binary), "-version"], text=True)
                self.assertEqual(digest.call_args.args[1], "sha256")

    def test_another_architectures_valid_hash_cannot_authorize_the_archive(self):
        for architecture, other in (("aarch64", "x86_64"), ("x86_64", "aarch64")):
            with self.subTest(architecture=architecture):
                self.serve(io.BytesIO(ARCHIVE))
                with (
                    patch.dict(os.environ, {"BITCOIN_TEST_BINARY": ""}),
                    patch.object(CHAIN.platform, "system", return_value="Linux"),
                    patch.object(CHAIN.platform, "machine", return_value=architecture),
                    patch.object(CHAIN.hashlib, "file_digest") as digest,
                    patch.object(CHAIN.tarfile, "open") as extract,
                    patch.object(CHAIN.subprocess, "check_output") as version,
                ):
                    digest.return_value.hexdigest.return_value = HASHES[other]
                    with self.assertRaisesRegex(
                        RuntimeError, "does not match its pinned SHA256"
                    ):
                        CHAIN.bitcoin_binary(self.directory)
                extract.assert_not_called()
                version.assert_not_called()

    def test_an_arm_archive_with_a_wrong_real_hash_is_not_extracted_or_executed(self):
        self.serve(io.BytesIO(ARCHIVE))
        with (
            patch.dict(os.environ, {"BITCOIN_TEST_BINARY": ""}),
            patch.object(CHAIN.platform, "system", return_value="Linux"),
            patch.object(CHAIN.platform, "machine", return_value="aarch64"),
            patch.object(CHAIN.tarfile, "open") as extract,
            patch.object(CHAIN.subprocess, "check_output") as version,
            self.assertRaisesRegex(RuntimeError, "does not match its pinned SHA256"),
        ):
            CHAIN.bitcoin_binary(self.directory)
        extract.assert_not_called()
        version.assert_not_called()

    def test_unsupported_platforms_never_download_extract_or_execute(self):
        for system, architecture in (
            ("Darwin", "arm64"),
            ("Windows", "AMD64"),
            ("Linux", "armv7l"),
            ("Linux", "arm64"),
        ):
            with self.subTest(system=system, architecture=architecture):
                opened = self.serve(AssertionError("Unexpected network access"))
                with (
                    patch.dict(os.environ, {"BITCOIN_TEST_BINARY": ""}),
                    patch.object(CHAIN.platform, "system", return_value=system),
                    patch.object(CHAIN.platform, "machine", return_value=architecture),
                    patch.object(CHAIN.tarfile, "open") as extract,
                    patch.object(CHAIN.subprocess, "check_output") as version,
                    self.assertRaisesRegex(RuntimeError, "Set BITCOIN_TEST_BINARY"),
                ):
                    CHAIN.bitcoin_binary(self.directory)
                opened.assert_not_called()
                extract.assert_not_called()
                version.assert_not_called()

    def test_an_explicit_binary_keeps_the_version_check_without_download(self):
        supplied = self.directory / "supplied-bitcoind"
        supplied.write_bytes(b"supplied mock executable")
        supplied = supplied.resolve()
        opened = self.serve(AssertionError("Unexpected network access"))
        with (
            patch.dict(os.environ, {"BITCOIN_TEST_BINARY": str(supplied)}),
            patch.object(CHAIN.platform, "system", return_value="Darwin"),
            patch.object(
                CHAIN.subprocess,
                "check_output",
                return_value="Bitcoin Core daemon version v31.1.0 bitcoind\n",
            ) as version,
        ):
            self.assertEqual(CHAIN.bitcoin_binary(self.directory), supplied)
        opened.assert_not_called()
        version.assert_called_once_with([str(supplied), "-version"], text=True)

    def test_an_explicit_binary_with_another_version_is_refused_without_download(self):
        supplied = self.directory / "supplied-bitcoind"
        supplied.write_bytes(b"supplied mock executable")
        opened = self.serve(AssertionError("Unexpected network access"))
        with (
            patch.dict(os.environ, {"BITCOIN_TEST_BINARY": str(supplied)}),
            patch.object(
                CHAIN.subprocess,
                "check_output",
                return_value="Bitcoin Core daemon version v31.1.1 bitcoind\n",
            ),
            self.assertRaisesRegex(RuntimeError, "Expected Bitcoin Core 31.1.0"),
        ):
            CHAIN.bitcoin_binary(self.directory)
        opened.assert_not_called()


if __name__ == "__main__":
    unittest.main()

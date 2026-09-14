from django.test import SimpleTestCase

from whitelist.exceptions import (
    BatchSizeLimitExceededException,
)


class WhitelistExceptionTests(SimpleTestCase):
    def test_batch_size_limit_formats_max_size(self):
        self.assertEqual(str(BatchSizeLimitExceededException(max_size=100).detail), "Maximum 100 entries per batch.")

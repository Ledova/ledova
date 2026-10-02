from types import SimpleNamespace

import requests
from django.test import SimpleTestCase
from urllib3.connectionpool import HTTPSConnectionPool
from urllib3.exceptions import MaxRetryError

from shared.utils.blockchain import failure_summary

KEYED = "https://user:secret@base-mainnet.provider.example:8443/v2/SECRET-KEY?token=SECRET-TOKEN"


def failed_request(url=KEYED):
    error = requests.ConnectionError("Max retries exceeded with url: /v2/SECRET-KEY")
    error.request = requests.Request("POST", url).prepare()
    return error


class AFailureIsDescribedWithoutItsTextTest(SimpleTestCase):
    def test_a_request_error_names_its_class_and_host_and_nothing_of_the_url_beyond_it(self):
        summary = failure_summary(failed_request())

        self.assertEqual(summary, "ConnectionError from base-mainnet.provider.example")
        for secret in ("SECRET", "user", "8443", "/v2"):
            self.assertNotIn(secret, summary)

    def test_the_host_is_found_through_the_errors_that_wrapped_the_request_error(self):
        wrapper = RuntimeError("Failed to connect to configured EVM endpoint")
        wrapper.__cause__ = failed_request()

        self.assertEqual(failure_summary(wrapper), "RuntimeError from base-mainnet.provider.example")

    def test_a_pool_error_names_the_pools_host(self):
        pool = HTTPSConnectionPool("Base-Sepolia.provider.example", 443)

        self.assertEqual(
            failure_summary(MaxRetryError(pool, "/v2/SECRET-KEY")), "MaxRetryError from base-sepolia.provider.example"
        )

    def test_an_error_without_an_endpoint_is_named_by_its_class_alone(self):
        self.assertEqual(failure_summary(ValueError("https://base.provider.example/v2/SECRET-KEY")), "ValueError")

    def test_an_unparseable_url_is_named_by_the_class_alone(self):
        error = requests.ConnectionError("Max retries exceeded with url: /v2/SECRET-KEY")
        error.request = SimpleNamespace(url="http://[::1/v2/SECRET-KEY")

        self.assertEqual(failure_summary(error), "ConnectionError")

    def test_an_error_that_causes_itself_still_ends(self):
        error = RuntimeError("loop")
        error.__cause__ = error

        self.assertEqual(failure_summary(error), "RuntimeError")

from django.core.management.base import CommandError
from django.test.runner import DiscoverRunner


class LedovaTestRunner(DiscoverRunner):
    def build_suite(self, test_labels=None, **kwargs):
        suite = super().build_suite(test_labels, **kwargs)
        if not suite.countTestCases():
            raise CommandError("No backend tests were discovered")
        return suite

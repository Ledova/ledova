from decimal import Decimal, localcontext

from django.test import SimpleTestCase

from shared.utils.token_amounts import format_units, token_full_units


class TokenUnitDisplayTest(SimpleTestCase):
    def test_formatting_preserves_the_smallest_unit_for_positive_negative_and_whole_amounts(self):
        for raw, decimals, expected in (
            (9007199254740993, 2, "90,071,992,547,409.93"),
            (-9007199254740993, 2, "-90,071,992,547,409.93"),
            (-1, 2, "-0.01"),
            (0, 2, "0.00"),
            (1234, 0, "1,234"),
            (1, 18, "0.000000000000000001"),
        ):
            with self.subTest(raw=raw, decimals=decimals), localcontext() as context:
                context.prec = 2
                self.assertEqual(format_units(raw, decimals), expected)
                self.assertEqual(token_full_units(raw, decimals), Decimal(expected.replace(",", "")))

    def test_uint256_and_the_largest_token_scale_do_not_round(self):
        maximum = 2**256 - 1
        with localcontext() as context:
            context.prec = 2
            self.assertEqual(token_full_units(maximum, 0), Decimal(maximum))
            self.assertEqual(format_units(1, 255), "0." + "0" * 254 + "1")

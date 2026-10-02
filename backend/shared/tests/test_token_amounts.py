from decimal import Decimal, localcontext

from django.test import SimpleTestCase

from shared.utils.token_amounts import (
    format_amount,
    format_units,
    plain_amount,
    token_full_units,
)

STORED = Decimal("0.000000000000000001")


class AmountTextTest(SimpleTestCase):
    def test_a_stored_amount_reads_as_the_clients_show_it(self):
        for amount, expected in (
            ("0.268752", "0.268752"),
            ("0.00012345", "0.00012345"),
            ("1250", "1,250"),
            ("12500.5", "12,500.5"),
            ("100", "100"),
            ("1000000", "1,000,000"),
            ("0.000000000000000001", "0.000000000000000001"),
            ("0.0000001", "0.0000001"),
            ("0", "0"),
            ("123456789012.123456789012345678", "123,456,789,012.123456789012345678"),
            ("-1000.50", "-1,000.5"),
        ):
            with localcontext() as context:
                context.prec = 40
                stored = Decimal(amount).quantize(STORED)
            with self.subTest(amount=amount), localcontext() as context:
                context.prec = 2
                self.assertEqual(format_amount(stored), expected)
                self.assertEqual(plain_amount(stored), expected.replace(",", ""))

    def test_an_amount_never_reads_in_scientific_notation(self):
        for amount in (Decimal("1E-18"), Decimal("1E+3"), Decimal("0E-18"), Decimal("1.00000000000E-7")):
            with self.subTest(amount=amount):
                self.assertNotIn("E", format_amount(amount))
                self.assertNotIn("E", plain_amount(amount))
                self.assertEqual(Decimal(plain_amount(amount)), amount)


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

from django.test import SimpleTestCase

from integrations.kyc.constants import VERIFICATION_STATUS_CHOICES
from integrations.kycaid.client import KYCAIDService
from integrations.sumsub.client import SumSubService
from integrations.tests.kycaid_payloads import (
    DOCUMENTED_APPLICANT_STATUSES,
    DOCUMENTED_DECLINE_REASONS,
    DOCUMENTED_VERIFICATION_STATUSES,
    applicant,
    check,
    verification_completed,
)

STATUS_CHOICES = {value for value, _ in VERIFICATION_STATUS_CHOICES}
NO_PEP = {"pep_type": "none", "details": None}


def kycaid(payload):
    return KYCAIDService().normalize_webhook(payload)


def sumsub(payload):
    return SumSubService().normalize_webhook(payload)


class KYCAIDStatusMappingTest(SimpleTestCase):
    def test_every_documented_verification_status_is_recorded_as_one_of_the_fields_choices(self):
        expected = {"unused": "init", "pending": "pending", "completed": "completed"}
        for reported in DOCUMENTED_VERIFICATION_STATUSES:
            with self.subTest(reported=reported):
                recorded = kycaid(verification_completed(status=reported, verified=None)).verification_status
                self.assertEqual(recorded, expected[reported])
                self.assertIn(recorded, STATUS_CHOICES)

    def test_every_documented_applicant_status_is_read_as_its_last_verification(self):
        expected = {"pending": ("pending", None), "valid": ("completed", "GREEN"), "invalid": ("completed", "RED")}
        for reported in DOCUMENTED_APPLICANT_STATUSES:
            with self.subTest(reported=reported):
                normalised = KYCAIDService().normalize_applicant(applicant(verification_status=reported))
                self.assertEqual((normalised.verification_status, normalised.review_result), expected[reported])
                self.assertEqual(normalised.is_verified, reported == "valid")

    def test_a_callback_without_a_status_records_no_result(self):
        with self.assertLogs("integrations.kycaid.client", level="WARNING"):
            normalised = kycaid(applicant(verification_status="valid"))

        self.assertEqual((normalised.verification_status, normalised.review_result), ("pending", None))

    def test_an_approved_applicant_record_without_the_pep_flag_records_no_result(self):
        record = {key: value for key, value in applicant(verification_status="valid").items() if key != "pep"}

        with self.assertLogs("integrations.kycaid.client", level="WARNING"):
            normalised = KYCAIDService().normalize_applicant(record)

        self.assertEqual((normalised.verification_status, normalised.review_result), ("pending", None))

    def test_an_undocumented_status_is_recorded_as_pending_without_a_result(self):
        with self.assertLogs("integrations.kycaid.client", level="WARNING") as logs:
            normalised = kycaid(verification_completed(status="declined", verified=False))

        self.assertEqual((normalised.verification_status, normalised.review_result), ("pending", None))
        self.assertIn("declined", "\n".join(logs.output))


class KYCAIDResultMappingTest(SimpleTestCase):
    def test_a_result_is_recorded_only_once_the_verification_is_completed(self):
        cases = (
            ("completed", True, "GREEN"),
            ("completed", False, "RED"),
            ("completed", None, None),
            ("pending", None, None),
            ("pending", False, None),
            ("pending", True, None),
            ("unused", None, None),
            ("unused", False, None),
        )
        for status, verified, expected in cases:
            with self.subTest(status=status, verified=verified):
                normalised = kycaid(verification_completed(status=status, verified=verified, applicant=applicant()))
                self.assertEqual(normalised.review_result, expected)
                self.assertEqual(normalised.is_verified, expected == "GREEN")

    def test_verified_reported_as_a_documented_string_is_read_as_the_boolean_it_names(self):
        self.assertEqual(kycaid(verification_completed(verified="true", applicant=applicant())).review_result, "GREEN")
        self.assertEqual(kycaid(verification_completed(verified="false")).review_result, "RED")
        self.assertFalse(kycaid(verification_completed(verified="false")).is_verified)

    def test_an_approval_without_the_applicants_pep_flag_records_no_result(self):
        without_the_flag = {key: value for key, value in applicant().items() if key != "pep"}
        for embedded in (None, without_the_flag, "not an object"):
            with self.subTest(embedded=type(embedded).__name__), self.assertLogs(
                "integrations.kycaid.client", level="WARNING"
            ):
                normalised = kycaid(verification_completed(applicant=embedded))
                self.assertEqual((normalised.verification_status, normalised.review_result), ("pending", None))
        self.assertEqual(kycaid(verification_completed(applicant=applicant(pep=None))).review_result, "GREEN")

    def test_a_pending_review_is_recorded_the_same_way_by_both_providers(self):
        kycaid_pending = kycaid(verification_completed(status="pending", verified=None))
        sumsub_pending = sumsub({"reviewStatus": "pending"})

        self.assertEqual((kycaid_pending.verification_status, kycaid_pending.review_result), ("pending", None))
        self.assertEqual((sumsub_pending.verification_status, sumsub_pending.review_result), ("pending", None))

    def test_sumsub_like_kycaid_counts_an_answer_only_once_its_check_is_completed(self):
        for status in ("init", "pending", "prechecked", "queued", "onHold", "awaitingService", "awaitingUser"):
            with self.subTest(status=status):
                normalised = sumsub({"reviewStatus": status, "reviewResult": {"reviewAnswer": "GREEN"}})
                self.assertIsNone(normalised.review_result)
                self.assertFalse(normalised.is_verified)
        completed = sumsub({"reviewStatus": "completed", "reviewResult": {"reviewAnswer": "GREEN"}})
        self.assertEqual((completed.review_result, completed.is_verified), ("GREEN", True))
        missing = sumsub({"reviewResult": {"reviewAnswer": "RED"}})
        self.assertEqual((missing.verification_status, missing.review_result), ("pending", None))

    def test_decline_reasons_reported_on_the_applicant_are_recorded_once_each(self):
        payload = verification_completed(
            verified=False,
            verifications={
                "profile": check(True),
                "document": check(False, "BAD_QUALITY"),
                "facial": check(False, "BAD_QUALITY", "DIFFERENT_FACES"),
                "database_screening": check(False),
            },
            applicant=applicant(verification_status="invalid", decline_reasons=["COMPROMISED_PERSON"]),
        )

        normalised = kycaid(payload)

        self.assertEqual(normalised.review_result, "RED")
        self.assertEqual(normalised.rejection_labels, ["BAD_QUALITY", "DIFFERENT_FACES", "COMPROMISED_PERSON"])


class KYCAIDPoliticallyExposedPersonTest(SimpleTestCase):
    def test_a_pep_flag_on_the_applicant_is_recorded_as_sumsub_records_an_uncategorised_pep(self):
        uncategorised = {"pep_type": "foreign", "details": ["PEP"]}
        sumsub_pep = sumsub(
            {"reviewStatus": "completed", "reviewResult": {"reviewAnswer": "GREEN"}, "riskLabels": ["PEP"]}
        ).pep_data

        for flag in (True, "true"):
            with self.subTest(flag=flag):
                self.assertEqual(kycaid(verification_completed(applicant=applicant(pep=flag))).pep_data, uncategorised)
                self.assertEqual(KYCAIDService().normalize_applicant(applicant(pep=flag)).pep_data, uncategorised)
        self.assertEqual(sumsub_pep, uncategorised)

    def test_no_pep_is_recorded_in_the_shape_sumsub_records_it(self):
        for flag in (None, False, "false"):
            with self.subTest(flag=flag):
                self.assertEqual(kycaid(verification_completed(applicant=applicant(pep=flag))).pep_data, NO_PEP)
        self.assertEqual(kycaid(verification_completed()).pep_data, NO_PEP)
        self.assertEqual(
            sumsub({"reviewStatus": "completed", "reviewResult": {"reviewAnswer": "GREEN"}}).pep_data, NO_PEP
        )

    def test_a_failed_pep_check_is_still_recorded_as_a_pep(self):
        verifications = {"profile": check(True), "pep": check(False, "COMPROMISED_PERSON")}

        pep = kycaid(verification_completed(verifications=verifications)).pep_data

        self.assertEqual(pep["pep_type"], "foreign")
        self.assertIn("COMPROMISED_PERSON", pep["details"])

    def test_no_documented_decline_reason_names_a_pep_category_by_itself(self):
        for reason in DOCUMENTED_DECLINE_REASONS:
            with self.subTest(reason=reason):
                verifications = {"profile": check(True), "pep": check(False, reason)}
                self.assertEqual(
                    kycaid(verification_completed(verifications=verifications)).pep_data["pep_type"], "foreign"
                )


class PEPClassificationTest(SimpleTestCase):
    CATEGORY_LABELS = {
        "pep_family_member": "family",
        "relative_of_a_pep": "family",
        "close_associate": "associate",
        "international_org_pep": "international_org",
        "intl_org": "international_org",
        "foreign_pep": "foreign",
        "domestic_pep": "domestic",
        "PEP": "foreign",
        "politically_exposed": "foreign",
        "SANCTIONS": "none",
        "ADVERSE_MEDIA": "none",
    }

    def test_sumsub_labels_are_classified_by_their_category_words_as_before(self):
        for label, expected in self.CATEGORY_LABELS.items():
            with self.subTest(label=label):
                pep = sumsub({"reviewResult": {"reviewAnswer": "GREEN"}, "riskLabels": [label]}).pep_data
                self.assertEqual(pep, NO_PEP if expected == "none" else {"pep_type": expected, "details": [label]})

    def test_the_first_label_naming_a_category_decides_and_every_label_is_kept(self):
        labels = ["SANCTIONS", "", "domestic_pep", "PEP"]

        pep = sumsub(
            {"riskLabels": labels[:2], "applicantRiskLabels": labels[2:3], "reviewResult": {"riskLabels": labels[3:]}}
        )

        self.assertEqual(pep.pep_data, {"pep_type": "domestic", "details": labels})

    def test_kycaid_pep_evidence_is_classified_by_the_same_rule_as_sumsub_labels(self):
        for label, expected in self.CATEGORY_LABELS.items():
            with self.subTest(label=label):
                verifications = {"profile": check(True), "pep": check(False, label)}
                kycaid_type = kycaid(verification_completed(verifications=verifications)).pep_data["pep_type"]
                self.assertEqual(kycaid_type, "foreign" if expected == "none" else expected)

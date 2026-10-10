import tempfile
from contextlib import redirect_stderr
from datetime import datetime, timedelta
from decimal import Decimal
from io import StringIO

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from drf_spectacular.drainage import GENERATOR_STATS
from drf_spectacular.generators import SchemaGenerator
from jsonschema import Draft4Validator, FormatChecker
from rest_framework.test import APITransactionTestCase

from assets.models import Asset, AssetChainDeployment
from companies.models import Company, CompanyDocument, CompanyStatus
from companies.serializers.document import CompanyDocumentSerializer
from documents.models import Document, DocumentExtraction, ExtractionStatus
from documents.serializers.document import DocumentSerializer
from feature_flags.models import FeatureFlag
from offerings.models import Offering, OfferingStatus
from operators.models import Operator
from shared.db import use_migrate
from shared.tests.company_eligibility import accept_company_eligibility
from shared.tests.tenants import make_eligible, make_tenant, open_to_investors
from tokens.models import YieldToken
from tokens.tests.market_fixtures import record_synthetic_admission
from tokens.tests.swap_execution_fixtures import make_execution, signed_execution
from tokens.tests.swap_state_fixtures import BUYER, SELLER
from users.models import UserProfile

ASSETS = "/api/assets/"
ELIGIBILITY = "/api/investor-classifications/eligibility/"
PROFILES = "/api/user-profiles/"
COMPANIES = "/api/v1/companies/"
DIRECTORY = "/api/v1/directory/tokens/"
DOCUMENTS = "/api/v1/documents/"
TOKENS = "/api/v1/tokens/"


class DerivedFieldResponseSchemaTest(APITransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        GENERATOR_STATS.reset()
        diagnostics = StringIO()
        with redirect_stderr(diagnostics):
            cls.document = SchemaGenerator().get_schema(request=None, public=True)
        cls.diagnostics = diagnostics.getvalue()
        cls.formats = FormatChecker()
        cls.formats.checks("date-time", raises=ValueError)(cls.valid_date_time)

    @staticmethod
    def valid_date_time(value):
        if not isinstance(value, str):
            return True
        parsed = datetime.fromisoformat(value)
        return "T" in value.upper() and parsed.utcoffset() is not None

    def setUp(self):
        Operator.get()
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        settings = override_settings(MEDIA_ROOT=media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        self.owner = make_tenant("derived-schema")
        self.client.force_authenticate(self.owner.user)

    def resolved(self, schema):
        if "$ref" in schema:
            target = self.document["components"]["schemas"][schema["$ref"].rsplit("/", 1)[-1]]
            return self.resolved({**target, **{key: value for key, value in schema.items() if key != "$ref"}})
        if "allOf" in schema and len(schema["allOf"]) == 1:
            return {
                **self.resolved(schema["allOf"][0]),
                **{key: value for key, value in schema.items() if key != "allOf"},
            }
        return schema

    def response_schema(self, path, method="get", page=False):
        operation = self.document["paths"][path][method]
        schema = self.resolved(operation["responses"]["200"]["content"]["application/json"]["schema"])
        if page:
            schema = self.resolved(schema["properties"]["results"]["items"])
        return schema

    def validation_schema(self, schema):
        schema = dict(self.resolved(schema))
        nullable = schema.pop("nullable", False)
        if "properties" in schema:
            properties = {key: self.resolved(value) for key, value in schema["properties"].items()}
            schema["properties"] = {
                key: self.validation_schema(value) for key, value in properties.items() if not value.get("writeOnly")
            }
            schema["required"] = [key for key in schema.get("required", ()) if key in schema["properties"]]
            if not schema["required"]:
                del schema["required"]
        if "items" in schema:
            schema["items"] = self.validation_schema(schema["items"])
        for keyword in ("oneOf", "anyOf", "allOf"):
            if keyword in schema:
                schema[keyword] = [self.validation_schema(value) for value in schema[keyword]]
        return {"anyOf": [schema, {"type": "null"}]} if nullable else schema

    def assert_matches(self, schema, value):
        validator = Draft4Validator(self.validation_schema(schema), format_checker=self.formats)
        errors = list(validator.iter_errors(value))
        self.assertEqual(errors, [], "\n".join(error.message for error in errors))

    def assert_fields_match(self, schema, body, names):
        for name in names:
            with self.subTest(field=name):
                self.assertIn(name, schema["properties"])
                self.assertIn(name, body)
                self.assert_matches(schema["properties"][name], body[name])

    def get_json(self, path):
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def catalogue_asset(self, asset):
        return next(row for row in self.get_json(ASSETS)["results"] if row["uuid"] == str(asset.pk))

    def test_asset_deployment_nulls_and_blank_native_address_match_the_summary(self):
        asset = Asset.objects.create(
            symbol="DERIVED", name="Derived asset", asset_type="native_crypto", is_verified=True
        )
        deployment = AssetChainDeployment.objects.create(
            asset=asset, chain="base", contract_address="", is_active=False
        )
        schema = self.response_schema(ASSETS, page=True)
        fields = ("chain", "contractAddress", "assetTypeDisplay", "isYieldToken")
        body = self.catalogue_asset(asset)
        self.assertEqual([body[name] for name in fields], [None, None, "Crypto", False])
        self.assert_fields_match(schema, body, fields)

        AssetChainDeployment.objects.filter(pk=deployment.pk).update(is_active=True)
        body = self.catalogue_asset(asset)
        self.assertEqual((body["chain"], body["contractAddress"]), ("base", ""))
        self.assert_fields_match(schema, body, fields)

        AssetChainDeployment.objects.create(asset=asset, chain="ethereum", contract_address="")
        body = self.catalogue_asset(asset)
        self.assertIsNone(body["chain"])
        self.assertIsNone(body["contractAddress"])
        self.assertEqual(len(body["chainDeployments"]), 2)
        self.assert_fields_match(schema, body, fields)

    def test_yield_nav_preserves_decimal_strings_dates_zero_and_inactive_nulls(self):
        asset = self.owner.refs.stablecoin
        moment = timezone.now().replace(microsecond=0)
        token = YieldToken.objects.create(
            symbol=asset.symbol,
            name="Synthetic yield token",
            contract_address="0x" + "9" * 40,
            nav_per_token=Decimal("1.005001"),
            last_nav_update=moment,
        )
        schema = self.response_schema(ASSETS, page=True)
        fields = ("navPerToken", "lastNavUpdate", "isYieldToken")
        body = self.catalogue_asset(asset)
        self.assertEqual(body["navPerToken"], "1.005001")
        self.assertEqual(datetime.fromisoformat(body["lastNavUpdate"]), moment)
        self.assertTrue(body["isYieldToken"])
        self.assert_fields_match(schema, body, fields)
        self.assertEqual(self.resolved(schema["properties"]["lastNavUpdate"]).get("format"), "date-time")

        YieldToken.objects.filter(pk=token.pk).update(nav_per_token=0, last_nav_update=None)
        body = self.catalogue_asset(asset)
        self.assertEqual([body[name] for name in fields], [None, None, True])
        self.assert_fields_match(schema, body, fields)

        YieldToken.objects.filter(pk=token.pk).update(is_active=False)
        body = self.catalogue_asset(asset)
        self.assertEqual([body[name] for name in fields], [None, None, False])
        self.assert_fields_match(schema, body, fields)

    def test_asset_display_fallback_is_a_string_without_an_invented_choice_list(self):
        Asset.objects.filter(pk=self.owner.refs.asset.pk).update(asset_type="legacy_security")
        AssetChainDeployment.objects.create(asset=self.owner.refs.asset, chain="base")
        body = self.catalogue_asset(self.owner.refs.asset)
        self.assertEqual(body["assetTypeDisplay"], "Legacy Security")
        field = self.response_schema(ASSETS, page=True)["properties"]["assetTypeDisplay"]
        self.assert_matches(field, body["assetTypeDisplay"])
        self.assertNotIn("enum", self.resolved(field))

    def test_readiness_without_an_account_keeps_the_nullable_account_identity(self):
        user = get_user_model().objects.create_user(
            email="no-account@example.test", password="pw-12345678", is_active=True, is_email_verified=True
        )
        UserProfile.objects.create(user=user)
        self.client.force_authenticate(user)
        body = self.get_json(ELIGIBILITY)
        self.assertFalse(body["isReady"])
        self.assertEqual(body["reasons"], ["no_investor_account"])
        self.assertIsNone(body["account"])
        self.assertEqual(set(body), {"isReady", "reasons", "account"})
        self.assert_matches(self.response_schema(ELIGIBILITY), body)

    def test_account_readiness_declares_no_global_investment_permission_or_private_source(self):
        before = self.get_json(ELIGIBILITY)
        self.assertEqual(before["account"], str(self.owner.account.uuid))
        self.assertFalse(before["isReady"])
        self.assertEqual(set(before), {"isReady", "reasons", "account"})
        schema = self.response_schema(ELIGIBILITY)
        self.assert_matches(schema, before)
        self.assertEqual(self.resolved(schema["properties"]["account"]).get("format"), "uuid")

        make_eligible(self.owner)
        body = self.get_json(ELIGIBILITY)
        self.assertEqual(body, {"isReady": True, "reasons": [], "account": str(self.owner.account.pk)})
        self.assertIsNone(self.get_json("/api/operator/")["paymentInstructions"])
        self.assert_matches(schema, body)

    def test_operator_rails_allow_denied_empty_partial_and_staff_objects(self):
        operator = Operator.get()
        names = (
            "bank_account_name",
            "bank_bsb",
            "bank_account_number",
            "payment_reference_prefix",
            "receiving_wallet_address",
        )
        Operator.objects.filter(pk=operator.pk).update(**dict.fromkeys(names, ""))
        schema = self.response_schema("/api/operator/")["properties"]["paymentInstructions"]
        body = self.get_json("/api/operator/")
        self.assertIsNone(body["paymentInstructions"])
        self.assert_matches(schema, body["paymentInstructions"])

        make_eligible(self.owner)
        accept_company_eligibility(self.owner)
        body = self.get_json("/api/operator/")
        self.assertEqual(body["paymentInstructions"], {})
        self.assert_matches(schema, body["paymentInstructions"])

        Operator.objects.filter(pk=operator.pk).update(bank_bsb="062000")
        body = self.get_json("/api/operator/")
        self.assertEqual(body["paymentInstructions"], {"bankBsb": "062000"})
        self.assert_matches(schema, body["paymentInstructions"])

        Operator.objects.filter(pk=operator.pk).update(
            bank_account_name="Synthetic Registry",
            bank_account_number="12345678",
            payment_reference_prefix="SYN",
            receiving_wallet_address="0x" + "7" * 40,
            receiving_wallet_chain="base",
        )
        staff = get_user_model().objects.create_user(email="rails@example.test", is_staff=True, is_email_verified=True)
        self.client.force_authenticate(staff)
        body = self.get_json("/api/operator/")["paymentInstructions"]
        self.assertEqual(
            set(body),
            {
                "bankAccountName",
                "bankBsb",
                "bankAccountNumber",
                "paymentReferencePrefix",
                "receivingWalletAddress",
                "receivingWalletChain",
            },
        )
        self.assertEqual(body["receivingWalletChain"], "base")
        self.assert_matches(schema, body)
        self.assertEqual(set(self.resolved(schema)["properties"]), set(body))

    def test_profile_dates_booleans_and_nullable_countries_match_the_list(self):
        profile = self.owner.profile
        UserProfile.objects.filter(pk=profile.pk).update(citizenship_country=None, residence_country=None)
        fields = ("isActive", "isStaff", "dateJoined", "lastLogin", "citizenshipCountryName", "residenceCountryName")
        schema = self.response_schema(PROFILES, page=True)
        body = self.get_json(PROFILES)["results"][0]
        self.assertIs(body["isActive"], True)
        self.assertIs(body["isStaff"], False)
        self.assertIsNone(body["lastLogin"])
        self.assertIsNone(body["citizenshipCountryName"])
        self.assertIsNone(body["residenceCountryName"])
        self.assert_fields_match(schema, body, fields)
        self.assertEqual(self.resolved(schema["properties"]["dateJoined"]).get("format"), "date-time")

        moment = timezone.now().replace(microsecond=0)
        get_user_model().objects.filter(pk=self.owner.user.pk).update(last_login=moment, is_staff=True)
        UserProfile.objects.filter(pk=profile.pk).update(
            citizenship_country=self.owner.refs.country, residence_country=self.owner.refs.country
        )
        body = self.get_json(PROFILES)["results"][0]
        self.assertIs(body["isStaff"], True)
        self.assertEqual(datetime.fromisoformat(body["lastLogin"]), moment)
        self.assertEqual(body["citizenshipCountryName"], self.owner.refs.country.name)
        self.assertEqual(body["residenceCountryName"], self.owner.refs.country.name)
        self.assert_fields_match(schema, body, fields)
        self.assertEqual(self.resolved(schema["properties"]["lastLogin"]).get("format"), "date-time")

    def test_profile_patch_keeps_derived_fields_read_only_and_existing_name_input(self):
        response = self.client.patch(
            f"{PROFILES}{self.owner.profile.uuid}/",
            {
                "fullName": "Updated synthetic name",
                "isActive": False,
                "isStaff": True,
                "dateJoined": "invalid",
                "lastLogin": "invalid",
                "citizenshipCountryName": "Forged",
                "residenceCountryName": "Forged",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["fullName"], "Updated synthetic name")
        self.assertIs(body["isActive"], True)
        self.assertIs(body["isStaff"], False)
        self.assertIsNone(body["lastLogin"])
        self.assertEqual(body["citizenshipCountryName"], self.owner.refs.country.name)
        self.assert_matches(
            self.response_schema(PROFILES + "{uuid}/", method="patch")["properties"]["dateJoined"], body["dateJoined"]
        )
        self.owner.user.refresh_from_db()
        self.assertFalse(self.owner.user.is_staff)
        self.assertTrue(self.owner.user.is_active)
        self.assertIsNone(self.owner.user.last_login)

    def test_company_status_properties_match_list_and_detail(self):
        flags = ("isActive", "isApproved", "isPendingReview", "canIssueTokens")
        cases = (
            (CompanyStatus.DRAFT, (False, False, False, False)),
            (CompanyStatus.REVIEW, (False, False, True, False)),
            (CompanyStatus.APPROVED, (False, True, False, False)),
            (CompanyStatus.ACTIVE, (True, True, False, True)),
        )
        for status, expected in cases:
            with self.subTest(status=status):
                Company.objects.filter(pk=self.owner.company.pk).update(status=status)
                body = self.get_json(f"{COMPANIES}{self.owner.company.uuid}/")
                self.assertEqual(tuple(body[name] for name in flags), expected)
                self.assert_fields_match(self.response_schema(COMPANIES + "{uuid}/"), body, flags)
                listing = self.get_json(COMPANIES)["results"][0]
                self.assert_fields_match(self.response_schema(COMPANIES, page=True), listing, flags[:2])

    def test_company_display_name_keeps_trading_name_then_legal_name_fallback(self):
        schema = self.response_schema(COMPANIES + "{uuid}/")["properties"]["displayName"]
        for trading_name, expected in (("Synthetic Trading", "Synthetic Trading"), ("", self.owner.company.name)):
            Company.objects.filter(pk=self.owner.company.pk).update(trading_name=trading_name)
            body = self.get_json(f"{COMPANIES}{self.owner.company.uuid}/")
            self.assertEqual(body["displayName"], expected)
            self.assert_matches(schema, body["displayName"])

    def test_company_document_url_preserves_uploaded_external_and_empty_strings(self):
        document = self.owner.company_document
        documents = self.response_schema(COMPANIES + "{uuid}/")["properties"]["documents"]
        schema = self.resolved(documents["items"])["properties"]["fileUrl"]
        relative = reverse(
            "companies:documents-file", kwargs={"company_uuid": self.owner.company.uuid, "uuid": document.uuid}
        )

        def file_url():
            body = self.get_json(f"{COMPANIES}{self.owner.company.uuid}/")
            return next(entry for entry in body["documents"] if entry["uuid"] == str(document.uuid))["fileUrl"]

        self.assertEqual(file_url(), "http://testserver" + relative)
        self.assert_matches(schema, file_url())
        self.assertEqual(CompanyDocumentSerializer(document).data["file_url"], relative)
        self.assert_matches(schema, relative)
        for value in ("https://docs.example.test/synthetic", ""):
            CompanyDocument.objects.filter(pk=document.pk).update(file="", external_url=value)
            self.assertEqual(file_url(), value)
            self.assert_matches(schema, value)

    def directory_row(self):
        body = self.get_json(DIRECTORY)
        return next(row for row in body["results"] if row["uuid"] == str(self.owner.deployed_token.uuid))

    def test_directory_open_offering_keeps_null_or_exact_five_field_object(self):
        make_eligible(self.owner)
        accept_company_eligibility(self.owner)
        open_to_investors(self.owner)
        schema = self.response_schema(DIRECTORY, page=True)
        field = schema["properties"]["openOffering"]
        untraded = self.directory_row()
        fields = ("lastPrice", "bestBid", "bestAsk")
        self.assertEqual(tuple(untraded[name] for name in fields), (None, None, None))
        self.assert_fields_match(schema, untraded, fields)
        self.assertIsNone(self.directory_row()["openOffering"])
        self.assert_matches(field, self.directory_row()["openOffering"])
        opened = timezone.now().replace(microsecond=0) - timedelta(days=1)
        for closes_at in (None, timezone.now() + timedelta(days=1)):
            Offering.objects.filter(pk=self.owner.offering.pk).update(
                status=OfferingStatus.APPROVED, opens_at=opened, closes_at=closes_at
            )
            body = self.directory_row()["openOffering"]
            self.assertEqual(set(body), {"uuid", "pricePerShare", "priceCurrency", "opensAt", "closesAt"})
            self.assertEqual(body["uuid"], str(self.owner.offering.uuid))
            self.assertEqual(body["pricePerShare"], "2.50")
            self.assertEqual(datetime.fromisoformat(body["opensAt"]), opened)
            self.assertEqual(body["closesAt"] is None, closes_at is None)
            self.assert_matches(field, body)
            self.assertEqual(set(self.resolved(field)["properties"]), set(body))
        company = self.directory_row()["company"]
        self.assertEqual(company["displayName"], self.owner.company.name)
        self.assert_matches(self.response_schema(DIRECTORY, page=True)["properties"]["company"], company)

    def test_document_without_extraction_or_available_content_keeps_nulls(self):
        document = self.owner.document
        path = f"{DOCUMENTS}{document.uuid}/"
        schema = self.response_schema(DOCUMENTS + "{uuid}/")
        body = self.get_json(path)
        self.assertIsNone(body["latestExtraction"])
        self.assert_fields_match(schema, body, ("latestExtraction",))
        DocumentExtraction.objects.create(
            document=document, status=ExtractionStatus.SUCCEEDED, parsed_json={"value": 1}
        )
        self.assertIsNotNone(self.get_json(path)["latestExtraction"])
        with use_migrate():
            Document.objects.filter(pk=document.pk).update(purged_at=timezone.now())
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.get_json(DOCUMENTS)["results"], [])
        document.refresh_from_db()
        body = DocumentSerializer(document).data
        self.assertIsNone(body["latest_extraction"])
        self.assert_matches(schema["properties"]["latestExtraction"], body["latest_extraction"])

    def test_latest_extraction_declares_sanitized_nested_history_and_arbitrary_json(self):
        document = self.owner.document
        older = DocumentExtraction.objects.create(document=document, parsed_json={"old": True})
        latest = DocumentExtraction.objects.create(
            document=document,
            status=ExtractionStatus.FAILED,
            raw_output="synthetic private source",
            error="synthetic internal failure",
            model_name="synthetic-model",
        )
        schema = self.response_schema(DOCUMENTS + "{uuid}/")["properties"]["latestExtraction"]
        for parsed, warnings in (
            (None, []),
            ({"nested": [1, None]}, {"reason": "synthetic"}),
            ([1, "two"], "review"),
            (7, False),
        ):
            DocumentExtraction.objects.filter(pk=latest.pk).update(parsed_json=parsed, warnings=warnings)
            body = self.get_json(f"{DOCUMENTS}{document.uuid}/")["latestExtraction"]
            self.assertEqual(body["uuid"], str(latest.uuid))
            self.assertNotEqual(body["uuid"], str(older.uuid))
            self.assertEqual(body["parsedJson"], parsed)
            self.assertEqual(body["warnings"], warnings)
            self.assertIsNone(body["confidence"])
            self.assertIsNone(body["startedAt"])
            self.assertIsNone(body["finishedAt"])
            self.assertIn("contact support", body["error"])
            self.assertNotIn("synthetic internal failure", str(body))
            self.assertNotIn("rawOutput", body)
            self.assert_matches(schema, body)
            self.assertEqual(set(self.resolved(schema)["properties"]), set(body))
        now = timezone.now().replace(microsecond=0)
        DocumentExtraction.objects.filter(pk=latest.pk).update(
            status=ExtractionStatus.SUCCEEDED, started_at=now, finished_at=now, confidence=0.75, duration_ms=23
        )
        body = self.get_json(DOCUMENTS)["results"][0]["latestExtraction"]
        self.assertEqual(body["error"], "")
        self.assertEqual(body["confidence"], 0.75)
        self.assertEqual(body["durationMs"], 23)
        self.assertEqual(datetime.fromisoformat(body["startedAt"]), now)
        self.assert_matches(self.response_schema(DOCUMENTS, page=True)["properties"]["latestExtraction"], body)

    @override_settings(ATOMIC_SWAP_ADDRESS="0x" + "a" * 40)
    def test_issuer_and_directory_prices_remain_decimal_strings_or_null(self):
        for order in (self.owner.order, self.owner.counter_order):
            record_synthetic_admission(order)
        FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
        make_eligible(self.owner)
        fields = ("lastPrice", "bestBid", "bestAsk")
        schema = self.response_schema(TOKENS, page=True)
        body = self.get_json(TOKENS)["results"]
        draft = next(row for row in body if row["uuid"] == str(self.owner.token.uuid))
        self.assertEqual(tuple(draft[name] for name in fields), (None, None, None))
        self.assert_fields_match(schema, draft, fields)
        untraded = next(row for row in body if row["uuid"] == str(self.owner.deployed_token.pk))
        self.assertIsNone(untraded["lastPrice"])
        self.assert_fields_match(schema, untraded, fields)
        self.assertEqual(self.get_json(DIRECTORY)["results"], [])
        fixture = make_execution("derived-price", issuer=self.owner)
        signed_execution(
            self,
            fixture.swap,
            (("seller", fixture.seller.user, SELLER), ("buyer", fixture.buyer.user, BUYER)),
        )
        accept_company_eligibility(self.owner)
        open_to_investors(self.owner)
        for path in (TOKENS, DIRECTORY):
            body = self.get_json(path)["results"]
            traded = next(row for row in body if row["uuid"] == str(self.owner.deployed_token.uuid))
            self.assertEqual(tuple(traded[name] for name in fields), ("1.5", "1.50", "1.50"))
            self.assert_fields_match(self.response_schema(path, page=True), traded, fields)

    def test_derived_producers_no_longer_fall_back_to_guessed_types(self):
        owners = (
            "AssetSerializer",
            "InvestorClassificationSerializer",
            "InvestorEligibilitySerializer",
            "OperatorSerializer",
            "UserProfileSerializer",
            "CompanyListSerializer",
            "CompanyDetailSerializer",
            "CompanyActivationSerializer",
            "CompanyActivationAttemptSerializer",
            "CompanyDocumentSerializer",
            "DirectoryCompanySerializer",
            "DirectoryTokenListSerializer",
            "DocumentSerializer",
            "ShareTokenListSerializer",
        )
        unresolved = [line for line in self.diagnostics.splitlines() if "unable to resolve type hint" in line]
        targeted = [line for line in unresolved if any(owner + "]" in line for owner in owners)]
        self.assertEqual(targeted, [])

    def test_schema_validation_rejects_wrong_null_dates_and_missing_nested_fields(self):
        schema = self.response_schema(PROFILES, page=True)
        joined = Draft4Validator(
            self.validation_schema(schema["properties"]["dateJoined"]), format_checker=self.formats
        )
        self.assertTrue(joined.is_valid("2026-09-01T12:00:00Z"))
        self.assertFalse(joined.is_valid(None))
        self.assertFalse(joined.is_valid("not-a-date"))
        latest = DocumentExtraction.objects.create(document=self.owner.document)
        body = self.get_json(f"{DOCUMENTS}{self.owner.document.uuid}/")["latestExtraction"]
        self.assertEqual(body["uuid"], str(latest.uuid))
        nested = self.response_schema(DOCUMENTS + "{uuid}/")["properties"]["latestExtraction"]
        validator = Draft4Validator(self.validation_schema(nested), format_checker=self.formats)
        self.assertTrue(validator.is_valid(body))
        self.assertFalse(validator.is_valid({key: value for key, value in body.items() if key != "uuid"}))

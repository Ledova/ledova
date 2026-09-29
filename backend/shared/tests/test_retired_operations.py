import re

from drf_spectacular.generators import SchemaGenerator
from rest_framework.test import APITestCase

from companies.models import Company
from feature_flags.models import FeatureFlag
from shared.api.routes import registered_routes, schema_routes
from shared.tests.tenants import an_acn, make_tenant, route_context, snapshot
from tokens.models import ShareIssuanceRequest

RETIRED = (
    ("get", "/api/v1/companies/{company}/api-key/", 404),
    ("post", "/api/v1/companies/{company}/api-key/", 404),
    ("get", "/api/feature-flags/{feature_flag}/", 404),
    ("get", "/api/financial-profiles/{financial_profile}/", 405),
    ("put", "/api/financial-profiles/{financial_profile}/", 405),
    ("get", "/api/investor-classifications/{investor_classification}/", 405),
    ("get", "/api/notifications/{notification}/", 405),
    ("get", "/api/transactions/{transaction}/", 404),
    ("get", "/api/user-accounts/{account}/", 405),
    ("get", "/api/user-preferences/{preferences}/", 404),
    ("put", "/api/user-preferences/{preferences}/", 404),
    ("patch", "/api/user-preferences/{preferences}/", 404),
    ("delete", "/api/user-preferences/{preferences}/", 404),
    ("post", "/api/user-profiles/", 405),
    ("get", "/api/user-profiles/{profile}/", 405),
    ("put", "/api/user-profiles/{profile}/", 405),
    ("put", "/api/v1/companies/{company}/", 405),
    ("delete", "/api/v1/companies/{empty_company}/", 405),
    ("get", "/api/v1/companies/{company}/documents/", 405),
    ("get", "/api/v1/companies/{company}/documents/{company_document}/", 405),
    ("put", "/api/v1/offerings/{offering}/", 405),
    ("get", "/api/v1/tokens/capital-increases/{capital_increase}/", 404),
    ("put", "/api/v1/tokens/capital-increases/{capital_increase}/", 404),
    ("patch", "/api/v1/tokens/capital-increases/{capital_increase}/", 404),
    ("delete", "/api/v1/tokens/capital-increases/{capital_increase}/", 404),
    ("get", "/api/v1/tokens/issuance-requests/{issuance_request}/", 404),
    ("put", "/api/v1/tokens/{token}/", 405),
    ("patch", "/api/v1/tokens/{token}/", 405),
    ("delete", "/api/v1/tokens/{token}/", 405),
    ("get", "/api/v1/trading/orders/{order}/", 404),
    ("get", "/api/v1/trading/orders/{order}/cancel/message/", 405),
    ("get", "/api/wallets/{wallet}/", 405),
    ("put", "/api/wallets/{wallet}/", 405),
)
RETAINED = (
    ("post", "/api/v1/companies/{company}/status/"),
    ("get", "/api/feature-flags/"),
    ("patch", "/api/financial-profiles/{financial_profile}/"),
    ("delete", "/api/investor-classifications/{investor_classification}/"),
    ("patch", "/api/notifications/{notification}/"),
    ("get", "/api/transactions/"),
    ("patch", "/api/user-accounts/{account}/"),
    ("get", "/api/user-preferences/"),
    ("post", "/api/user-preferences/"),
    ("get", "/api/user-profiles/"),
    ("patch", "/api/user-profiles/{profile}/"),
    ("get", "/api/v1/companies/{company}/"),
    ("patch", "/api/v1/companies/{company}/"),
    ("post", "/api/v1/companies/{company}/documents/"),
    ("delete", "/api/v1/companies/{company}/documents/{company_document}/"),
    ("get", "/api/v1/companies/{company}/documents/{company_document}/file/"),
    ("patch", "/api/v1/offerings/{offering}/"),
    ("delete", "/api/v1/offerings/{offering}/"),
    ("get", "/api/v1/tokens/capital-increases/"),
    ("post", "/api/v1/tokens/capital-increases/"),
    ("post", "/api/v1/tokens/capital-increases/{capital_increase}/submit/"),
    ("get", "/api/v1/tokens/issuance-requests/"),
    ("get", "/api/v1/tokens/{token}/"),
    ("get", "/api/v1/trading/orders/"),
    ("post", "/api/v1/trading/orders/{order}/cancel/message/"),
    ("get", "/api/v1/trading/tokens/{deployed_token}/"),
    ("patch", "/api/wallets/{wallet}/"),
    ("delete", "/api/wallets/{wallet}/"),
    ("get", "/api/portfolios/{portfolio}/"),
    ("put", "/api/portfolios/{portfolio}/"),
    ("patch", "/api/portfolios/{portfolio}/"),
    ("delete", "/api/portfolios/{portfolio}/"),
    ("post", "/api/signout-all/"),
)


def normalised(method, path):
    return method, re.sub(r"\{[a-z_]+\}", "{}", path)


class RetiredOperationsTest(APITestCase):
    def setUp(self):
        self.owner = make_tenant("retired-owner")
        self.staff = make_tenant("retired-staff", staff=True)
        self.feature_flag = FeatureFlag.objects.create(name="retired_probe", enabled=True)
        for number, tenant in enumerate((self.owner, self.staff), start=82000001):
            tenant.empty_company = Company.objects.create(
                owner=tenant.user, name=f"{tenant.label} empty Pty Ltd", acn=an_acn(number)
            )
            tenant.issuance_request = ShareIssuanceRequest.objects.create(
                token=tenant.deployed_token,
                recipient_address="0x" + "c" * 40,
                amount=10,
                reason="Founder allocation",
                issuance_type="additional",
                submitted_by=tenant.user,
            )

    def test_no_retired_operation_is_registered_or_in_the_schema(self):
        registered = registered_routes()
        documented = schema_routes(SchemaGenerator().get_schema(request=None, public=True))
        retired = {normalised(method, path) for method, path, _ in RETIRED}
        retained = {normalised(method, path) for method, path in RETAINED}

        self.assertEqual(retired & registered, set())
        self.assertEqual(retired & documented, set())
        self.assertEqual(retained - registered, set())
        self.assertEqual(retained - documented, set())

    def test_every_retired_operation_is_refused_for_owner_and_staff_and_changes_nothing(self):
        actors = (self.owner, self.staff)
        before = [snapshot(actor) for actor in actors]
        for actor in actors:
            context = {**route_context(actor), "feature_flag": str(self.feature_flag.pk)}
            self.client.force_authenticate(actor.user)
            for method, path, expected in RETIRED:
                with self.subTest(actor=actor.label, method=method, path=path):
                    response = getattr(self.client, method)(path.format_map(context), {}, format="json")
                    self.assertEqual(response.status_code, expected, response.content)
        self.assertEqual([snapshot(actor) for actor in actors], before)

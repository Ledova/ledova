import re

from django.test import SimpleTestCase

from shared.api.routes import registered_routes
from shared.tests import test_cross_tenant_routes as matrix

TEMPLATE = re.compile(r"\{[a-z_]+\}")

UNAUTHENTICATED_AUTH = "Unauthenticated auth surface: there is no session yet, so there is no tenant to cross."
PROVIDER_WEBHOOK = "Provider webhook: no session, authenticated by signature, and it names its own subject."
GLOBAL_CATALOGUE = "Global catalogue shared by every tenant and deliberately not owner-scoped."
CREATES_OWN_ROW = "Creation route: writes a row owned by the caller and accepts no writable relation."
CREATES_OWN_ROW_SCOPED_FK = (
    "Creation route owned by the caller. Every writable relation it accepts is scoped before the body "
    "can reach it: either declared against an already-filtered catalogue queryset, or declared as "
    "objects.none() and re-scoped in the serializer's get_fields(). Either way a foreign identifier in "
    "the body cannot name a row the caller cannot already see."
)
SELF_SCOPED = "Acts only on the caller's own rows and takes no identifier."
ELIGIBILITY_SCOPED = (
    "Cross-tenant listings require the holder's current eligibility decisions for the exact company, "
    "category and applicable offering through users.services.eligibility. Directory and secondary market "
    "purposes have distinct scopes. Pinned by users/tests/test_company_eligibility_read_consumers.py "
    "and MARKET_ROUTES and DIRECTORY_ROUTES."
)
NOT_MATRIX_AUTHENTICABLE = (
    "It cannot become a ROUTES row however well it reads as one: the cross-tenant matrix authenticates "
    "through DRF, and a plain Django view never sees force_authenticate, so every case there answers 401 "
    "and no assertion about tenancy is reachable. A route in this position stays exempt with a reason "
    "naming its scoping call and the test file that pins it instead."
)
ELIGIBILITY_SCOPED_ASYNC = (
    "tokens.services.trading_events.streamable_token_uuid requires the actual authenticated holder "
    "and a current company decision in a permitted general category for the deployed token's exact issuer. "
    "Foreign and unavailable tokens answer 404. The stream rechecks the holder and exact company decision "
    "before each matched event and heartbeat. Pinned by tokens/tests/test_trading_events_authorization.py "
    "and tokens/tests/test_company_eligibility_trading_stream.py. "
) + NOT_MATRIX_AUTHENTICABLE
STAFF_UNSCOPED = (
    "Staff-only and deliberately unscoped: CompanyViewSet.get_queryset returns Company.objects.all() "
    "for its administrative actions, so an operator reaches every company by design."
)
STAFF_WHITELIST = "Staff-only whitelist administration: the operator acts across every tenant by design."
CHAIN_ADDRESS_READ = (
    "Reads the chain for a bare wallet address in the registry of the share class at a contract address; the class "
    "resolves through its own policy and the answer belongs to no tenant row."
)
OWN_ELIGIBILITY_REQUEST = (
    "Own private source and exact known company/offering are checked before preview or request creation; "
    "the issuer reference grants no company/private-document access. Foreign source and retained history "
    "controls are pinned by users/tests/test_company_eligibility_requests.py."
)

EXEMPT = {
    ("post", "/api/signin/"): UNAUTHENTICATED_AUTH,
    ("post", "/api/signup/"): UNAUTHENTICATED_AUTH,
    ("post", "/api/signout/"): UNAUTHENTICATED_AUTH,
    ("post", "/api/token/refresh/"): UNAUTHENTICATED_AUTH,
    ("post", "/api/email-verification/"): UNAUTHENTICATED_AUTH,
    ("post", "/api/resend-verification/"): UNAUTHENTICATED_AUTH,
    ("get", "/api/auth/verify/"): UNAUTHENTICATED_AUTH,
    ("post", "/webhooks/alchemy/"): PROVIDER_WEBHOOK,
    ("post", "/webhooks/kycaid/"): PROVIDER_WEBHOOK,
    ("post", "/webhooks/kycaid/crypto/"): PROVIDER_WEBHOOK,
    ("post", "/webhooks/sumsub/"): PROVIDER_WEBHOOK,
    ("get", "/api/assets/"): GLOBAL_CATALOGUE,
    ("get", "/api/assets/exchange-rates/"): GLOBAL_CATALOGUE,
    ("get", "/api/feature-flags/"): GLOBAL_CATALOGUE,
    ("post", "/api/device-tokens/register/"): CREATES_OWN_ROW,
    ("post", "/api/financial-profiles/"): CREATES_OWN_ROW,
    ("post", "/api/user-preferences/"): CREATES_OWN_ROW,
    ("post", "/api/portfolios/"): CREATES_OWN_ROW,
    ("post", "/api/wallets/"): CREATES_OWN_ROW,
    ("post", "/api/wallets/batch-check-balances/"): SELF_SCOPED,
    ("post", "/api/investor-classifications/"): CREATES_OWN_ROW_SCOPED_FK,
    ("get", "/api/v1/company-eligibility/requests/"): SELF_SCOPED,
    ("post", "/api/v1/company-eligibility/requests/"): OWN_ELIGIBILITY_REQUEST,
    ("post", "/api/v1/company-eligibility/requests/preview/"): OWN_ELIGIBILITY_REQUEST,
    ("post", "/api/v1/companies/"): CREATES_OWN_ROW_SCOPED_FK,
    ("post", "/api/v1/documents/"): CREATES_OWN_ROW,
    ("get", "/api/notifications/unread-count/"): SELF_SCOPED,
    ("post", "/api/notifications/mark-all-read/"): SELF_SCOPED,
    ("post", "/api/signout-all/"): SELF_SCOPED,
    ("post", "/api/change-password/"): SELF_SCOPED,
    ("get", "/api/user-profiles/export-data/"): SELF_SCOPED,
    ("post", "/api/user-profiles/delete-account/"): SELF_SCOPED,
    ("get", "/api/investor-classifications/eligibility/"): SELF_SCOPED,
    ("get", "/api/users/identity-verification/status/"): SELF_SCOPED,
    ("post", "/api/users/identity-verification/token/"): SELF_SCOPED,
    ("get", "/api/v1/directory/tokens/"): ELIGIBILITY_SCOPED,
    ("get", "/api/v1/trading/tokens/"): ELIGIBILITY_SCOPED,
    ("get", "/api/v1/trading/events/stream/"): ELIGIBILITY_SCOPED_ASYNC,
    ("post", "/api/v1/companies/{}/status/"): STAFF_UNSCOPED,
    ("get", "/api/v1/whitelist/"): STAFF_WHITELIST,
    ("get", "/api/v1/whitelist/{}/"): STAFF_WHITELIST,
    ("get", "/api/v1/whitelist/entry/{}/"): STAFF_WHITELIST,
    ("get", "/api/v1/whitelist/export/"): STAFF_WHITELIST,
    ("post", "/api/v1/whitelist/sync/{}/"): STAFF_WHITELIST,
    ("get", "/api/v1/trading/whitelist/{}/{}/status/"): CHAIN_ADDRESS_READ,
}


def matrix_routes():
    routes = set()

    def add(method, path):
        routes.add((method.lower(), TEMPLATE.sub("{}", path.split("?")[0])))

    for method, path in matrix.COMPANY_WALLET_ROUTES.values():
        add(method, path)
    for method, path in matrix.COMPANY_AUTHORITY_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_CORRECTION_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_ISSUE_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_DEPLOYMENT_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_GRANT_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_TRANSFER_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_PARTICULARS_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_OPENING_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_LINK_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_IMPORT_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_RECONCILIATION_ROUTES.values():
        add(method, path)
    for method, path in matrix.REGISTER_INSTRUCTION_ROUTES.values():
        add(method, path)
    for method, path in matrix.PUBLICATION_ROUTES.values():
        add(method, path)
    for route in (
        matrix.ROUTES
        + matrix.ACTION_ROUTES
        + matrix.DIRECTORY_ROUTES
        + matrix.MARKET_ROUTES
        + matrix.ELIGIBILITY_ROUTES
    ):
        add(route.method, route.path)
    for path, _ in matrix.LIST_ROUTES:
        add("get", path)
    for path, _ in matrix.SINGLETON_ROUTES:
        add("get", path)
    for path in matrix.GLOBAL_ROUTES:
        add("get", path)
    return routes


class RouteCoverageTest(SimpleTestCase):

    def test_every_registered_route_is_pinned_by_the_matrix_or_exempt_with_a_reason(self):
        unclassified = sorted(registered_routes() - matrix_routes() - set(EXEMPT))

        self.assertEqual(
            unclassified,
            [],
            "New routes are neither in the cross-tenant matrix nor exempt. Add each to ROUTES/LIST_ROUTES in "
            "test_cross_tenant_routes.py so a foreign uuid is proven to 404, or to EXEMPT here with the reason "
            f"it cannot leak another tenant's row: {unclassified}",
        )

    def test_no_exemption_outlives_the_route_it_excuses(self):
        stale = sorted(set(EXEMPT) - registered_routes())

        self.assertEqual(stale, [], f"These routes no longer exist; delete their exemptions: {stale}")

    def test_no_matrix_entry_points_at_a_route_that_no_longer_exists(self):
        stale = sorted(matrix_routes() - registered_routes())

        self.assertEqual(stale, [], f"The matrix pins routes that are not registered: {stale}")

    def test_every_exemption_states_a_reason(self):
        thin = sorted(route for route, reason in EXEMPT.items() if len(reason) < 40)

        self.assertEqual(thin, [], f"An exemption needs a reason a reviewer can disagree with: {thin}")

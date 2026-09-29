import re

from drf_spectacular.generators import SchemaGenerator
from rest_framework.test import APITestCase

from shared.api.routes import registered_routes, schema_routes
from shared.tests.tenants import make_tenant, route_context, snapshot

RETIRED = (
    ("get", "/api/v1/companies/{company}/api-key/", 404),
    ("post", "/api/v1/companies/{company}/api-key/", 404),
)
RETAINED = (("post", "/api/v1/companies/{company}/status/"),)


def normalised(method, path):
    return method, re.sub(r"\{[a-z_]+\}", "{}", path)


class RetiredOperationsTest(APITestCase):
    def setUp(self):
        self.owner = make_tenant("retired-owner")
        self.staff = make_tenant("retired-staff", staff=True)

    def test_no_retired_operation_is_registered_or_in_the_schema(self):
        registered = registered_routes()
        documented = schema_routes(SchemaGenerator().get_schema(request=None, public=True))
        retired = {normalised(method, path) for method, path, _ in RETIRED}
        retained = {normalised(method, path) for method, path in RETAINED}

        self.assertEqual(retired & registered, set())
        self.assertEqual(retired & documented, set())
        self.assertTrue(retained <= registered)
        self.assertTrue(retained <= documented)

    def test_every_retired_operation_is_refused_for_owner_and_staff_and_changes_nothing(self):
        before = snapshot(self.owner)
        context = route_context(self.owner)
        for actor in (self.owner, self.staff):
            self.client.force_authenticate(actor.user)
            for method, path, expected in RETIRED:
                with self.subTest(actor=actor.label, method=method, path=path):
                    response = getattr(self.client, method)(path.format_map(context), {}, format="json")
                    self.assertEqual(response.status_code, expected, response.content)
        self.assertEqual(snapshot(self.owner), before)

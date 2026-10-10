import ast
from contextlib import contextmanager

from django.conf import settings
from django.db import connections, transaction
from django.urls import resolve
from rest_framework.test import APITransactionTestCase

from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    atomic,
    current_alias,
    set_principal,
    use_operator,
)
from shared.tests import test_cross_tenant_routes as matrix
from shared.tests.scoped import RunsOnTheScopedConnection


def runs_on_the_operator_connection(path, method):
    match = resolve(path.split("?", 1)[0])
    view = getattr(match.func, "cls", None) or getattr(match.func, "view_class", None)
    action = (getattr(match.func, "actions", None) or {}).get(method)
    return action in frozenset(getattr(view, "operator_actions", ()))


class TheMatrixRunsOnTheConnectionTheRouterChoosesTest(
    RunsOnTheScopedConnection, matrix.CrossTenantRouteFixtures, APITransactionTestCase
):
    def setUp(self):
        with self.as_an_operator_would():
            super().setUp()

    @contextmanager
    def undone_before_the_next_case(self, route=None, actor=None):
        if route and (route.method, route.path) in {
            ("patch", "/api/user-accounts/{account}/"),
            ("delete", "/api/wallets/{spare_wallet}/"),
        }:
            self.assertEqual(current_alias(), APP_ALIAS)
            self.assertFalse(connections[APP_ALIAS].in_atomic_block)
            with transaction.atomic(using=OPERATOR_ALIAS):
                yield
                with connections[OPERATOR_ALIAS].cursor() as cursor:
                    cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                transaction.set_rollback(True, using=OPERATOR_ALIAS)
            return
        if route and (
            route.path.endswith("/register/inspection-copy/")
            or (
                route.method == "post"
                and route.path in {"/api/v1/companies/{company}/documents/", "/api/v1/companies/{company}/activate/"}
            )
        ):
            with super().undone_before_the_next_case(route, actor):
                yield
            return
        with atomic(), transaction.atomic(using=OPERATOR_ALIAS):
            yield
            transaction.set_rollback(True, using=current_alias())
            transaction.set_rollback(True, using=OPERATOR_ALIAS)

    @contextmanager
    def as_whoever_may_write_the_fixture(self, route, context, owner, actor):
        if runs_on_the_operator_connection(route.path.format_map(context), route.method):
            with use_operator():
                yield
            return
        set_principal(owner.user.pk, current_alias())
        try:
            yield
        finally:
            set_principal(actor.user.pk, current_alias())

    def test_the_requests_really_reach_the_scoped_connection(self):
        self.assertEqual(settings.RLS_AMBIENT_ALIAS, APP_ALIAS)
        self.assertEqual(current_alias(), APP_ALIAS)

    def test_foreign_rows_are_not_found_and_left_untouched(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_foreign_rows_are_not_found_and_left_untouched(self)

    def test_own_rows_resolve_for_every_actor(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_own_rows_resolve_for_every_actor(self)

    def test_collection_routes_return_only_the_actors_rows(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_collection_routes_return_only_the_actors_rows(self)

    def test_authority_requests_are_requester_only_for_company_staff_and_missing_reference_cases(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_authority_requests_are_requester_only_for_company_staff_and_missing_reference_cases(self)

    def test_authority_admission_and_revocation_hide_foreign_requests_from_every_staff_role(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_authority_admission_and_revocation_hide_foreign_requests_from_every_staff_role(self)

    def test_team_routes_bind_company_source_and_appointee_without_exposing_foreign_history(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_team_routes_bind_company_source_and_appointee_without_exposing_foreign_history(self)

    def test_register_correction_routes_keep_evidence_private_and_decisions_company_bound(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_correction_routes_keep_evidence_private_and_decisions_company_bound(self)

    def test_register_issues_scope_all_eight_routes_to_exact_company_authority_and_private_evidence(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_issues_scope_all_eight_routes_to_exact_company_authority_and_private_evidence(self)

    def test_register_paid_issues_scope_all_seven_routes_to_current_company_authority_and_private_evidence(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_paid_issues_scope_all_seven_routes_to_current_company_authority_and_private_evidence(self)

    def test_register_pause_scope_all_six_routes_to_current_company_authority_and_private_evidence(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_pause_scope_all_six_routes_to_current_company_authority_and_private_evidence(self)

    def test_register_capital_scope_all_six_routes_to_current_company_authority_and_private_evidence(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_capital_scope_all_six_routes_to_current_company_authority_and_private_evidence(self)

    def test_register_deployments_scope_all_five_routes_to_current_company_read_and_steps(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_deployments_scope_all_five_routes_to_current_company_read_and_steps(self)

    def test_register_grants_keep_all_evidence_private_and_company_decisions_bound(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_grants_keep_all_evidence_private_and_company_decisions_bound(self)

    def test_register_transfers_keep_instruments_members_and_company_decisions_private(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_transfers_keep_instruments_members_and_company_decisions_private(self)

    def test_register_particulars_routes_keep_evidence_private_and_decisions_company_bound(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_particulars_routes_keep_evidence_private_and_decisions_company_bound(self)

    def test_register_opening_routes_keep_evidence_private_and_decisions_company_bound(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_opening_routes_keep_evidence_private_and_decisions_company_bound(self)

    def test_register_link_routes_keep_evidence_private_and_decisions_company_bound(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_link_routes_keep_evidence_private_and_decisions_company_bound(self)

    def test_register_import_routes_keep_evidence_private_and_decisions_company_bound(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_import_routes_keep_evidence_private_and_decisions_company_bound(self)

    def test_register_reconciliation_routes_keep_rows_and_acknowledgements_company_bound(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_reconciliation_routes_keep_rows_and_acknowledgements_company_bound(self)

    def test_register_instruction_routes_keep_evidence_private_and_review_operator_only(self):
        case = matrix.CrossTenantRouteMatrixTest
        case.test_register_instruction_routes_keep_evidence_private_and_review_operator_only(self)


def locking_request_views():
    names = set()
    for path in settings.BASE_DIR.glob("*/views/*.py"):
        module = ".".join(path.relative_to(settings.BASE_DIR).with_suffix("").parts)
        for node in ast.parse(path.read_text()).body:
            if isinstance(node, ast.ClassDef) and any(
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Attribute)
                and call.func.attr == "select_for_update"
                for call in ast.walk(node)
            ):
                names.add(f"{module}.{node.name}")
    return names

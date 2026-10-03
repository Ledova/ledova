from contextlib import ExitStack

from django.db import connections

from companies.tests import test_authority_admission as cases
from shared.db import APP_ALIAS, OPERATOR_ALIAS, current_alias, principal_of
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedCompanyAuthorityAdmissionTest(RunsOnTheScopedConnection, cases.CompanyAuthorityAdmissionTest):
    def test_admission_and_revocation_use_bounded_operator_writes_and_app_reads(self):
        observed = []

        def record(execute, sql, params, many, context):
            if any(
                f'"companies_{table}"' in sql
                for table in ("companyappointment", "companyappointmentrevocation", "companyauthorityrequest")
            ):
                observed.append((context["connection"].alias, sql.split()[0]))
            return execute(sql, params, many, context)

        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(record))
            self.assertEqual(self.admit().status_code, 200)
            self.assertEqual(self.client.post(self.revoke_url, {}, format="json").status_code, 200)
            self.assertEqual(self.client.get(f"{cases.URL}{self.proposal.pk}/").status_code, 200)
        self.assertIn((OPERATOR_ALIAS, "INSERT"), observed)
        self.assertIn((APP_ALIAS, "SELECT"), observed)
        self.assertNotIn((APP_ALIAS, "INSERT"), observed)
        self.assertEqual(current_alias(), APP_ALIAS)
        self.assertIn(principal_of(OPERATOR_ALIAS), (None, ""))

    def test_admission_locks_actor_profile_company_and_request_on_the_operator_connection(self):
        locked = []

        def record(execute, sql, params, many, context):
            if "FOR UPDATE" in sql:
                locked.append((context["connection"].alias, sql))
            return execute(sql, params, many, context)

        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(record))
            self.assertEqual(self.admit().status_code, 200)
        for table in (
            "authentication_customuser",
            "users_userprofile",
            "companies_company",
            "companies_companyauthorityrequest",
        ):
            self.assertTrue(any(alias == OPERATOR_ALIAS and f'"{table}"' in sql for alias, sql in locked), locked)
        self.assertFalse(any(alias == APP_ALIAS for alias, sql in locked), locked)

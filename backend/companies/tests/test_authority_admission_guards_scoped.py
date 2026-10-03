from companies.tests import test_authority_admission_guards as cases
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedCompanyAuthorityAdmissionGuardTest(RunsOnTheScopedConnection, cases.CompanyAuthorityAdmissionGuardTest):
    pass

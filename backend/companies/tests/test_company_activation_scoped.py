from companies.tests import test_company_activation as cases
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedCompanyActivationTest(RunsOnTheScopedConnection, cases.CompanyActivationTest):
    pass

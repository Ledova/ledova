from shared.tests.scoped import RunsOnTheScopedConnection
from users.tests import test_company_eligibility_consumption as consumption


class ScopedCompanyEligibilityConsumptionTest(RunsOnTheScopedConnection, consumption.CompanyEligibilityConsumptionTest):
    pass

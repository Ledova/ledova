from shared.tests.scoped import RunsOnTheScopedConnection
from whitelist.tests.test_company_eligibility_invalidation import (
    CompanyEligibilityInvalidationTest,
)


class ScopedCompanyEligibilityInvalidationTest(RunsOnTheScopedConnection, CompanyEligibilityInvalidationTest):
    pass

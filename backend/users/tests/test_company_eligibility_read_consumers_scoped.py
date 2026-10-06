from shared.tests.scoped import RunsOnTheScopedConnection
from users.tests.test_company_eligibility_read_consumers import (
    CompanyEligibilityReadConsumerTest,
)


class ScopedCompanyEligibilityReadConsumerTest(RunsOnTheScopedConnection, CompanyEligibilityReadConsumerTest):
    pass

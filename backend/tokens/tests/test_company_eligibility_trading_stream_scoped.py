from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.tests.test_company_eligibility_trading_stream import (
    CompanyEligibilityTradingStreamTest,
)


class ScopedCompanyEligibilityTradingStreamTest(RunsOnTheScopedConnection, CompanyEligibilityTradingStreamTest):
    pass

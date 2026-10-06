from shared.tests.scoped import RunsOnTheScopedConnection
from whitelist.tests.test_eligibility_loss_producers import EligibilityLossProducerTest


class ScopedEligibilityLossProducerTest(RunsOnTheScopedConnection, EligibilityLossProducerTest):
    pass

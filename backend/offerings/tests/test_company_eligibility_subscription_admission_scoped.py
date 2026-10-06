from offerings.tests import test_company_eligibility_subscription_admission as admission
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedCompanyEligibilitySubscriptionAdmissionTest(
    RunsOnTheScopedConnection, admission.CompanyEligibilitySubscriptionAdmissionTest
):
    pass


class ScopedCompanyEligibilitySubscriptionServiceTest(
    RunsOnTheScopedConnection, admission.CompanyEligibilitySubscriptionServiceTest
):
    pass


class ScopedCompanyEligibilitySubscriptionRecoveryTest(
    RunsOnTheScopedConnection, admission.CompanyEligibilitySubscriptionRecoveryTest
):
    pass


class ScopedCompanyEligibilitySubscriptionGuardTest(
    RunsOnTheScopedConnection, admission.CompanyEligibilitySubscriptionGuardTest
):
    pass

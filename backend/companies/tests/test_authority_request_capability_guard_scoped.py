from companies.tests import test_authority_request_capability_guard as cases
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedAuthorityRequestCapabilityGuardTest(RunsOnTheScopedConnection, cases.AuthorityRequestCapabilityGuardTest):
    pass

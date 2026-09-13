from .test_postgres import *  # noqa: F401,F403

RLS_AMBIENT_ALIAS = "app"
RLS_ROLE_PER_REQUEST = False
TEST_RUNNER = "shared.scoped_test_runner.ScopedTestRunner"

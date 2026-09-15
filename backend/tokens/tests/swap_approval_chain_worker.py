import json
import os
import signal
import sys
from unittest.mock import patch

import django


def run(deployment_id):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["APPROVAL_TEST_DATABASE"])
    configured = json.loads(os.environ["APPROVAL_TEST_CHAIN"])
    if database["ENGINE"] != "django.db.backends.postgresql" or configured["BLOCKCHAIN_CHAIN_ID"] != 31337:
        raise RuntimeError("Approval crash evidence requires PostgreSQL and the isolated local chain")
    settings.DATABASES = {"default": database}
    for key, value in configured.items():
        setattr(settings, key, value)
    django.setup()
    from integrations.base_chain.client import BaseChainClient
    from tokens.services import swap_approval

    original = BaseChainClient.send_raw_transaction

    def accept_then_die(client, raw):
        original(client, raw)
        os.kill(os.getpid(), signal.SIGKILL)

    with patch.object(BaseChainClient, "send_raw_transaction", accept_then_die):
        swap_approval.recover(deployment_id)


if __name__ == "__main__":
    run(*sys.argv[1:])

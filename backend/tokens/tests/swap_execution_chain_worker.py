import json
import os
import signal
import sys
from unittest.mock import patch

import django


def run(transaction_id):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["SWAP_CHAIN_TEST_DATABASE"])
    configured = json.loads(os.environ["SWAP_CHAIN_TEST_SETTINGS"])
    if database["ENGINE"] != "django.db.backends.postgresql" or configured["BLOCKCHAIN_CHAIN_ID"] != 31337:
        raise RuntimeError("Swap crash evidence requires PostgreSQL and the isolated local chain")
    settings.DATABASES = {"default": database}
    for key, value in configured.items():
        setattr(settings, key, value)
    django.setup()
    from integrations.base_chain.client import BaseChainClient
    from tokens.services import swap_execution

    original = BaseChainClient.send_raw_transaction

    def accept_then_die(client, raw):
        original(client, raw)
        os.kill(os.getpid(), signal.SIGKILL)

    with patch.object(BaseChainClient, "send_raw_transaction", accept_then_die):
        swap_execution.recover(transaction_id)


if __name__ == "__main__":
    run(*sys.argv[1:])

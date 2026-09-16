import json
import os
import signal
import sys
from unittest.mock import patch

import django


def run(swap_id, actor_id, raw_hex):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["SWAP_CHAIN_TEST_DATABASE"])
    configured = json.loads(os.environ["SWAP_CHAIN_TEST_SETTINGS"])
    if database["ENGINE"] != "django.db.backends.postgresql" or configured["BLOCKCHAIN_CHAIN_ID"] != 31337:
        raise RuntimeError("Approval crash evidence requires PostgreSQL and the isolated local chain")
    settings.DATABASES = {"default": database}
    for key, value in configured.items():
        setattr(settings, key, value)
    django.setup()
    from integrations.base_chain.client import BaseChainClient
    from tokens.models import SwapOrder
    from tokens.services import atomic_swap_service

    original = BaseChainClient.send_raw_transaction

    def accept_then_die(client, raw):
        original(client, raw)
        os.kill(os.getpid(), signal.SIGKILL)

    swap = SwapOrder.objects.get(pk=swap_id)
    with patch.object(BaseChainClient, "send_raw_transaction", accept_then_die):
        atomic_swap_service.broadcast_settlement_approval(
            swap, "seller", raw_hex, lambda snapshot: SwapOrder.objects.get(pk=snapshot.pk), int(actor_id)
        )


if __name__ == "__main__":
    run(*sys.argv[1:])

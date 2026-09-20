import json
import os
import signal
import sys
from unittest.mock import patch

import django


def run(phase, request_id, actor_id):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["ISSUANCE_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Issuance chain crash controls require real PostgreSQL")
    settings.DATABASES = {"default": database}
    settings.BLOCKCHAIN_RPC_URL = os.environ["CHAIN_TEST_RPC_URL"]
    settings.BLOCKCHAIN_CHAIN_ID = 31337
    settings.WALLET_CHAIN_FINALITY_POLICIES = {"evm:31337": {"mode": "depth", "depth": 1}}
    django.setup()

    from django.contrib.auth import get_user_model

    from integrations.base_chain.client import BaseChainClient
    from tokens.models import ShareIssuanceRequest
    from tokens.services import issuance_execution

    request = ShareIssuanceRequest.objects.get(pk=request_id)
    original = BaseChainClient.send_raw_transaction

    def accepted(client, raw):
        result = original(client, raw)
        if phase == "accepted":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    with patch.object(BaseChainClient, "send_raw_transaction", accepted):
        if phase == "accepted":
            actor = get_user_model().objects.get(pk=actor_id)
            with patch("tokens.tasks.execute_review_request_task.defer"):
                issuance_execution.admit(request, actor, confirmed=issuance_execution.confirmation(request, actor))
        result = issuance_execution.recover(request.dispatch_id)
    print(json.dumps(result))


if __name__ == "__main__":
    run(*sys.argv[1:])

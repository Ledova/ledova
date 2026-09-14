import json
import os
import signal
import sys
from unittest.mock import patch

import django


def run(token_id):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["DEPLOYMENT_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Deployment crash evidence requires PostgreSQL")
    settings.DATABASES = {"default": database}
    configured = json.loads(os.environ["DEPLOYMENT_TEST_CHAIN"])
    if configured["BLOCKCHAIN_CHAIN_ID"] != 31337:
        raise RuntimeError("Deployment crash evidence requires the isolated local chain")
    for key, value in configured.items():
        setattr(settings, key, value)
    django.setup()

    from integrations.base_chain.client import BaseChainClient
    from tokens.models import ShareToken
    from tokens.services.deployment import deploy_token

    original_send = BaseChainClient.send_raw_transaction

    def accept_then_die(client, raw):
        original_send(client, raw)
        os.kill(os.getpid(), signal.SIGKILL)

    token = ShareToken.objects.select_related("company").get(pk=token_id)
    with patch.object(BaseChainClient, "send_raw_transaction", accept_then_die):
        deploy_token(token)


if __name__ == "__main__":
    run(*sys.argv[1:])

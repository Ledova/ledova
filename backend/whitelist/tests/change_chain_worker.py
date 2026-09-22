import json
import os
import signal
import sys
from unittest.mock import patch

import django


def run(submission_id, actor_id, company_id, address):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["WHITELIST_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Whitelist crash evidence requires PostgreSQL")
    settings.DATABASES = {"default": database}
    configured = json.loads(os.environ["WHITELIST_TEST_CHAIN"])
    if configured["BLOCKCHAIN_CHAIN_ID"] != 31337:
        raise RuntimeError("Whitelist crash evidence requires the isolated local chain")
    for key, value in configured.items():
        setattr(settings, key, value)
    django.setup()

    from django.contrib.auth import get_user_model

    from companies.models import Company
    from integrations.base_chain.client import BaseChainClient
    from whitelist.services.changes import submit

    original_send = BaseChainClient.send_raw_transaction

    def accept_then_die(client, raw):
        original_send(client, raw)
        os.kill(os.getpid(), signal.SIGKILL)

    actor = get_user_model().objects.get(pk=actor_id)
    with patch.object(BaseChainClient, "send_raw_transaction", accept_then_die):
        submit(submission_id, "add", address, actor, company=Company.objects.get(pk=company_id))


if __name__ == "__main__":
    run(*sys.argv[1:])

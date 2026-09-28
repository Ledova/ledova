import json
import logging
import os
import sys
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import django


def report(stage, **values):
    from django.db import connections

    from shared.db import current_alias, principal_of

    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT pg_backend_pid(), current_user")
        pid, role = cursor.fetchone()
    print(json.dumps({"stage": stage, "pid": pid, "role": role, "principal": principal_of(), **values}), flush=True)


def released():
    if sys.stdin.readline().strip() != "continue":
        raise AssertionError("The admission worker was not released")


def run():
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test_postgres"
    from django.conf import settings

    incoming = json.loads(sys.stdin.readline())
    settings.DATABASES = json.loads(os.environ["ORDER_TEST_DATABASES"])
    settings.RLS_AMBIENT_ALIAS = "app"
    settings.RLS_ROLE_PER_REQUEST = False
    settings.ALLOWED_HOSTS = ["testserver"]
    settings.ATOMIC_SWAP_ADDRESS = "0x" + "9d" * 20
    settings.BLOCKCHAIN_OPERATOR_KEY = "0x" + "11" * 32
    settings.BLOCKCHAIN_CHAIN_ID = incoming["chain_id"]
    django.setup()
    logging.disable(logging.CRITICAL)

    from django.contrib.auth import get_user_model
    from django.db import connections
    from rest_framework.test import APIClient

    from shared.db import set_principal, use_operator
    from tokens.models import ShareToken, SwapOrder
    from tokens.services import atomic_swap_service, pause_changes, swap_execution

    set_principal(incoming["user_id"])
    for alias in ("app", "operator"):
        with connections[alias].cursor() as cursor:
            cursor.execute("SET statement_timeout = '20s'")
            cursor.execute("SET lock_timeout = '15s'")
    actor = get_user_model().objects.get(pk=incoming["user_id"])
    phase = incoming["phase"]

    def published(event, token_id):
        with (Path(incoming["directory"]) / "signature-events.jsonl").open("a") as output:
            output.write(json.dumps({"event": event, "token": token_id}) + "\n")

    with ExitStack() as stack:
        stack.enter_context(patch.object(swap_execution, "publish_trading_event", side_effect=published))
        stack.enter_context(
            patch.object(swap_execution, "get_base_chain_client", side_effect=AssertionError("Unexpected provider"))
        )
        if phase.startswith("signature"):
            verify = atomic_swap_service.verify_signature
            transaction = swap_execution.atomic
            add_signature = SwapOrder.add_seller_signature

            def verified(*args):
                valid = verify(*args)
                report("verified", valid=valid)
                released()
                return valid

            @contextmanager
            def announcing_transaction(*args, **kwargs):
                with transaction(*args, **kwargs):
                    report("locking")
                    yield

            def holding_signature(swap, value):
                report("signature-locked")
                released()
                return add_signature(swap, value)

            stack.enter_context(patch.object(atomic_swap_service, "verify_signature", side_effect=verified))
            stack.enter_context(patch.object(swap_execution, "atomic", announcing_transaction))
            if phase == "signature-hold":
                stack.enter_context(patch.object(SwapOrder, "add_seller_signature", holding_signature))
            client = APIClient()
            client.force_authenticate(actor)
            response = client.post(incoming["url"], incoming["body"], format="json")
            report("done", status=response.status_code, body=response.json())
        elif phase.startswith("project"):
            save = ShareToken.save

            def hold_projection(token, *args, **kwargs):
                result = save(token, *args, **kwargs)
                report("projected", status=token.status)
                released()
                return result

            def announcing_projection(execute, sql, params, many, context):
                if 'FROM "tokens_sharetoken"' in sql and "FOR UPDATE" in sql:
                    report("projection-locking")
                return execute(sql, params, many, context)

            stack.enter_context(connections["app"].execute_wrapper(announcing_projection))
            if phase == "project-hold":
                stack.enter_context(patch.object(ShareToken, "save", hold_projection))
            with use_operator():
                report("projecting")
                change = pause_changes.project(incoming["change_id"])
                report("done", completed=change.completed_at is not None)
        elif phase == "pause-authority":
            lock_actor = pause_changes._actor

            def holding_class(*args, **kwargs):
                if kwargs.get("lock"):
                    report("pause-class-locked")
                    released()
                return lock_actor(*args, **kwargs)

            stack.enter_context(patch.object(pause_changes, "_actor", holding_class))
            token = ShareToken.objects.get(pk=incoming["token_id"])
            change = pause_changes.submit(token, actor, uuid4(), True)
            report("done", status=change.status)
        else:
            raise AssertionError(phase)
    connections.close_all()


if __name__ == "__main__":
    run()

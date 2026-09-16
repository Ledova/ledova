import json
import logging
import os
import sys
import traceback
from datetime import datetime
from unittest import TestCase
from unittest.mock import patch

import django


def report(stage, **values):
    print(json.dumps({"stage": stage, **values}), flush=True)


def command(expected):
    received = sys.stdin.readline().strip()
    if received != expected:
        raise AssertionError(f"Expected {expected}, received {received}")


def run(mode, row_id, detail):
    from django.conf import settings

    settings.DATABASES = {"default": json.loads(os.environ["TRADING_TEST_DATABASE"])}
    settings.RLS_AMBIENT_ALIAS = "default"
    settings.ATOMIC_SWAP_ADDRESS = "0x" + "9d" * 20
    settings.BLOCKCHAIN_OPERATOR_KEY = ""
    settings.BLOCKCHAIN_CHAIN_ID = int(os.environ["TRADING_TEST_CHAIN_ID"])
    django.setup()
    logging.disable(logging.CRITICAL)

    from django.db import connections
    from eth_account.messages import encode_typed_data

    from shared.db import atomic
    from tokens.models import SwapOrder, TransferOrder
    from tokens.services import token_transfer_service
    from tokens.tests.swap_state_fixtures import (
        BUYER,
        SELLER,
        sign_swap,
        swap_service,
    )

    connection = connections["default"]
    with connection.cursor() as cursor:
        cursor.execute("SET statement_timeout = '20s'")
        cursor.execute("SET lock_timeout = '15s'")
        cursor.execute("SELECT pg_backend_pid()")
        database_pid = cursor.fetchone()[0]
    row = TransferOrder.objects.get(pk=row_id) if mode == "match" else SwapOrder.objects.get(pk=row_id)
    test_case = TestCase()
    service = swap_service(test_case)
    report("loaded", pid=os.getpid(), database_pid=database_pid)
    command("run")

    if mode in ("signature", "signature_overlap"):
        signer = SELLER if detail == "seller" else BUYER
        signature = signer.sign_message(encode_typed_data(full_message=service.get_typed_data(row))).signature.hex()
        verify = service.verify_signature

        def verified(*args):
            result = verify(*args)
            report("verified", valid=result, in_atomic=connection.in_atomic_block)
            command("store")
            return result

        service.verify_signature = verified
        if mode == "signature_overlap":
            add_signature = SwapOrder.add_seller_signature

            def before_signature(swap, value):
                report("signature_locked", in_atomic=connection.in_atomic_block)
                command("signature")
                return add_signature(swap, value)

            with patch.object(SwapOrder, "add_seller_signature", before_signature):
                result = sign_swap(row, signature, signer.address, participant=detail).status
        else:
            result = sign_swap(row, signature, signer.address, participant=detail).status
    elif mode == "expire":
        from tokens.services.swap_expiry import expire_unclaimed_swap

        report("expiring")
        result = expire_unclaimed_swap(row, datetime.fromisoformat(detail))
    elif mode == "match":
        with atomic():
            matches = token_transfer_service.find_matching_orders(row)
            result = str(matches[0][0].pk) if matches else None
    else:
        raise AssertionError(mode)
    report("done", result=result)
    connections.close_all()


if __name__ == "__main__":
    try:
        with patch("tokens.events.publish_trading_event"):
            run(*sys.argv[1:])
    except BaseException as refusal:
        traceback.print_exc()
        report("error", refused=type(refusal).__name__)
        sys.exit(1)

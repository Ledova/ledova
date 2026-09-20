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
    from django.db import connections

    from shared.db import current_alias

    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT pg_backend_pid(), current_user")
        pid, user = cursor.fetchone()
    print(json.dumps({"stage": stage, "pid": pid, "database_user": user, **values}), flush=True)


def command(expected):
    received = sys.stdin.readline().strip()
    if received != expected:
        raise AssertionError(f"Expected {expected}, received {received}")


def run(mode, row_id, detail):
    from django.conf import settings

    settings.DATABASES = json.loads(os.environ["TRADING_TEST_DATABASES"])
    settings.RLS_AMBIENT_ALIAS = "default" if mode in ("settle", "reverse_inclusion") else "app"
    settings.ATOMIC_SWAP_ADDRESS = "0x" + "9d" * 20
    settings.BLOCKCHAIN_OPERATOR_KEY = ""
    settings.BLOCKCHAIN_CHAIN_ID = int(os.environ["TRADING_TEST_CHAIN_ID"])
    django.setup()
    logging.disable(logging.CRITICAL)

    from django.db import connections
    from eth_account.messages import encode_typed_data

    from shared.db import current_alias, set_principal, use_operator
    from tokens.models import SwapOrder
    from tokens.tests.swap_state_fixtures import (
        BUYER,
        SELLER,
        sign_swap,
        swap_service,
    )

    if mode not in ("settle", "reverse_inclusion"):
        set_principal(int(os.environ["TRADING_TEST_USER"]))
    for alias in ("default", "app", "operator"):
        with connections[alias].cursor() as cursor:
            cursor.execute("SET statement_timeout = '20s'")
            cursor.execute("SET lock_timeout = '15s'")
    row = SwapOrder.objects.get(pk=row_id)
    test_case = TestCase()
    service = swap_service(test_case)
    report("loaded")
    command("run")

    if mode in ("signature", "signature_overlap"):
        signer = SELLER if detail == "seller" else BUYER
        signature = signer.sign_message(encode_typed_data(full_message=service.get_typed_data(row))).signature.hex()
        verify = service.verify_signature

        def verified(*args):
            result = verify(*args)
            report("verified", valid=result, in_atomic=connections[current_alias()].in_atomic_block)
            command("store")
            return result

        service.verify_signature = verified
        if mode == "signature_overlap":
            add_signature = SwapOrder.add_seller_signature

            def before_signature(swap, value):
                report("signature_locked", in_atomic=connections[current_alias()].in_atomic_block)
                command("signature")
                return add_signature(swap, value)

            with patch.object(SwapOrder, "add_seller_signature", before_signature):
                result = sign_swap(row, signature, signer.address, participant=detail).status
        else:
            from tokens.services import swap_execution as execution_service

            lock_authority = execution_service._lock_authority

            def announcing_lock(*args, **kwargs):
                report("locking")
                return lock_authority(*args, **kwargs)

            with patch.object(execution_service, "_lock_authority", announcing_lock):
                result = sign_swap(row, signature, signer.address, participant=detail).status
    elif mode == "expire":
        from tokens.services.swap_expiry import expire_unclaimed_swap

        with use_operator():
            report("expiring")
            result = expire_unclaimed_swap(row, datetime.fromisoformat(detail))
    elif mode == "settle":
        from blockchain.models import SignedAttempt
        from tokens.services import swap_execution
        from tokens.tests.swap_execution_fixtures import (
            ExecutionNode,
            execution_receipt,
        )

        settings.WALLET_CHAIN_FINALITY_POLICIES = {f"evm:{settings.BLOCKCHAIN_CHAIN_ID}": {"mode": "depth", "depth": 1}}
        record = row.transaction
        node = ExecutionNode(record.function_args)
        attempt = SignedAttempt.objects.get(tx_hash=record.tx_hash)
        node.receipts[record.tx_hash] = execution_receipt(
            attempt, record.function_args, status=int(record.status == "confirmed")
        )
        node.advance(head=12)
        report("settling")
        result = swap_execution.settle(record.pk, client=node.client)
    elif mode == "reverse_inclusion":
        from django.db import DatabaseError

        from shared.tests.schema import migrate_to

        report("reversing")
        try:
            migrate_to([("tokens", "0062_register_foundation")])
        except DatabaseError as exc:
            if "Cannot remove recorded swap finality evidence" not in str(exc):
                raise
            result = "refused"
        else:
            result = "reversed"
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

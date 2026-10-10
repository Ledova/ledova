from contextlib import contextmanager
from uuid import UUID, uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connections
from django.utils import timezone

from blockchain.models import OutgoingStatus
from blockchain.services import outgoing
from shared.db import current_alias, use_migrate, use_operator
from shared.tests.retained_rows import retained_rows
from tokens.tests.retained_guards import WALLET_GUARDS
from whitelist.models import (
    WhitelistAction,
    WhitelistApproval,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistChangeStatus,
)
from whitelist.services import changes
from whitelist.services.whitelist import registry_for

SOURCE_TABLES = (
    "wallets_walletpossessionproof",
    "whitelist_companywalletnomination",
    "whitelist_companywalletinstruction",
    "whitelist_companywalletinstructiondecision",
)
PERMISSIONS = {
    WhitelistAuthority.OPERATOR_API: None,
    WhitelistAuthority.WHITELIST_ADMIN: "whitelist.change_whitelistentry",
    WhitelistAuthority.SUBSCRIPTION_ADMIN: "offerings.change_subscription",
}


@contextmanager
def historical_operator():
    with use_operator():
        connection = connections[current_alias()]
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_setting('role')")
            previous = cursor.fetchone()[0]
            cursor.execute(f"SET ROLE {connection.ops.quote_name(settings.RLS_ROLES['operator'])}")
        try:
            yield
        finally:
            with connection.cursor() as cursor:
                if previous == "none":
                    cursor.execute("RESET ROLE")
                else:
                    cursor.execute(f"SET ROLE {connection.ops.quote_name(previous)}")


def retained_signed_add(
    *,
    actor,
    company,
    entry,
    client,
    submission_id=None,
    expires_at=None,
    authority=WhitelistAuthority.OPERATOR_API,
    wallet_uuid=None,
):
    return _retained_signed_change(
        action=WhitelistAction.ADD,
        actor=actor,
        company=company,
        entry=entry,
        client=client,
        submission_id=submission_id,
        expires_at=expires_at,
        authority=authority,
        wallet_uuid=wallet_uuid,
    )


def retained_signed_remove(
    *,
    actor,
    company,
    entry,
    client,
    submission_id=None,
    authority=WhitelistAuthority.OPERATOR_API,
    wallet_uuid=None,
):
    return _retained_signed_change(
        action=WhitelistAction.REMOVE,
        actor=actor,
        company=company,
        entry=entry,
        client=client,
        submission_id=submission_id,
        expires_at=None,
        authority=authority,
        wallet_uuid=wallet_uuid,
    )


def _retained_signed_change(
    *, action, actor, company, entry, client, submission_id, expires_at, authority, wallet_uuid
):
    if action not in WhitelistAction.values or (action == WhitelistAction.REMOVE and expires_at is not None):
        raise AssertionError("Predecessor staff history requires an ADD or expiry-free REMOVE.")
    with use_migrate():
        connection = connections[current_alias()]
        if connection.in_atomic_block or not connection.get_autocommit():
            raise AssertionError("A predecessor fixture needs its isolated autocommit migration connection.")
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_user")
            if cursor.fetchone()[0] != settings.RLS_ROLES["migrate"]:
                raise AssertionError("Create predecessor history outside an explicit operator role context.")
            for table in SOURCE_TABLES:
                cursor.execute(f"SELECT EXISTS (SELECT 1 FROM {connection.ops.quote_name(table)})")
                if cursor.fetchone()[0]:
                    raise AssertionError(
                        "Predecessor history cannot remove guards over retained company wallet sources."
                    )
        with retained_rows(*WALLET_GUARDS):
            with historical_operator():
                alias = current_alias()
                original_actor = get_user_model().objects.get(pk=actor.pk)
                if authority not in PERMISSIONS or not original_actor.is_active or not original_actor.is_staff:
                    raise AssertionError("Predecessor staff history needs its actual original admission actor.")
                permission = PERMISSIONS[authority]
                if permission and not original_actor.has_perm(permission):
                    raise AssertionError("Predecessor staff history needs its actual original admission permission.")
                expiry = expires_at.replace(microsecond=0) if expires_at is not None else None
                if expiry is not None and (timezone.is_naive(expiry) or expiry <= timezone.now()):
                    raise AssertionError("Predecessor ADD history needs its original future expiry.")
                address = entry.wallet_address.lower()
                intent = changes._intent(action, address, registry_for(company, client), expiry)
                with changes.target_transaction(intent["chain_id"], intent["to"], address):
                    change = WhitelistChange.objects.using(alias).create(
                        uuid=submission_id or uuid4(),
                        action=action,
                        address=address,
                        chain_id=intent["chain_id"],
                        registry_address=intent["to"],
                        company_id=company.pk,
                        expires_at=expiry,
                        intent=intent,
                        initiated_by_id=original_actor.pk,
                        authority=authority,
                        requested_wallet_id=wallet_uuid,
                        entry_id=entry.pk,
                        source_instruction_id=None,
                    )
                    approval, _ = (
                        WhitelistApproval.objects.using(alias)
                        .select_for_update()
                        .get_or_create(
                            entry_id=entry.pk, company_id=company.pk, defaults={"registry_address": intent["to"]}
                        )
                    )
                    if approval.registry_address != intent["to"]:
                        raise AssertionError("Predecessor history cannot relabel an existing approval registry.")
                    WhitelistApproval.objects.using(alias).filter(pk=approval.pk).update(
                        status="pending", updated_at=timezone.now()
                    )
                observed = changes._observe_membership(change, client)
                if type(observed) is not int or observed == changes.on_chain_expiry(change.action, change.expires_at):
                    raise AssertionError("Predecessor signed history needs an actual different membership observation.")
                with changes.target_transaction(change.chain_id, change.registry_address, change.address):
                    change.status = WhitelistChangeStatus.EXECUTING
                    change.save(using=alias, update_fields=["status", "updated_at"])
                claim = outgoing.open_operation(
                    f"whitelist-change:{change.pk}",
                    **(intent | {"value": int(intent["value"])}),
                    restart_of=UUID(int=0),
                )
                with changes.target_transaction(change.chain_id, change.registry_address, change.address):
                    change.operation_id = claim.operation_id
                    change.save(using=alias, update_fields=["operation", "updated_at"])
                prepared = outgoing.prepare_operation(claim, client)
                attempt = outgoing.sign_operation(claim, prepared, settings.BLOCKCHAIN_OPERATOR_KEY)
                retained = bytes(attempt.raw_transaction)
                operation_id, claim_id, attempt_id = claim.operation_id, claim.claim_id, attempt.pk
                change_id = change.pk
    with use_operator():
        current = WhitelistChange.objects.select_related("operation__current_attempt").get(pk=change_id)
        if (
            current.source_instruction_id is not None
            or current.operation_id != operation_id
            or current.operation.claim_id != claim_id
            or current.operation.status != OutgoingStatus.SIGNED
            or current.operation.current_attempt_id != attempt_id
            or bytes(current.operation.current_attempt.raw_transaction) != retained
        ):
            raise AssertionError("The fixture must retain its exact original NULL-source signed history.")
        return current

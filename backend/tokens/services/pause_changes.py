import hashlib
from contextlib import contextmanager
from uuid import UUID, uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.db import IntegrityError, connections
from django.utils import timezone
from eth_account import Account
from rest_framework.exceptions import NotFound, PermissionDenied
from web3 import Web3

from blockchain.models import OutgoingOperation
from blockchain.services import outgoing
from companies.models import Company
from shared.db import (
    APP_ALIAS,
    acting_for,
    atomic,
    current_alias,
    principal_of,
    use_operator,
)
from shared.db.principal import give_the_role_back, take_the_app_role
from tokens.exceptions import InvalidTokenStateException, PauseChangeConflict
from tokens.models import (
    PauseAuthority,
    PauseChange,
    PauseChangeStatus,
    ShareToken,
    ShareTokenStatus,
)

TERMINAL = (PauseChangeStatus.OBSERVED, PauseChangeStatus.CONFIRMED, PauseChangeStatus.FAILED)
CONFIRMATION_SALT = "tokens.pause.submission"


def require_autocommit():
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise PauseChangeConflict("Pause recovery requires autocommit outside every transaction block.")


def require_pausable(token):
    if token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED) or token.chain != "base":
        raise InvalidTokenStateException("Only deployed or paused Base tokens can accept a pause or unpause request.")


def _actor(actor_id, authority, *, lock=False):
    actors = get_user_model().objects
    actor = (actors.select_for_update() if lock else actors).filter(pk=actor_id).first()
    if actor is None or not actor.is_active or authority not in PauseAuthority.values:
        raise PermissionDenied("The pause submission has no current authority.")
    if authority == PauseAuthority.STAFF and (not actor.is_staff or not actor.has_perm("tokens.change_sharetoken")):
        raise PermissionDenied("Pausing from administration requires permission to change the token.")
    return actor


def lock_token(token_id, company_id, actor_id, authority):
    company = Company.objects.select_for_update().filter(pk=company_id).first()
    token = ShareToken.objects.select_for_update().filter(pk=token_id, company_id=company_id).first()
    actor = _actor(actor_id, authority, lock=True)
    if company is None or token is None or (authority == PauseAuthority.ISSUER and company.owner_id != actor.pk):
        raise PermissionDenied("The issuer no longer owns this token.")
    token.company = company
    return token


def transaction_intent(token, paused):
    require_pausable(token)
    try:
        intent = outgoing.transaction_intent(
            chain_id=settings.BLOCKCHAIN_CHAIN_ID,
            sender=Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address,
            to=token.contract_address,
            data=Web3.keccak(text="pause()" if paused else "unpause()")[:4],
        )
    except (TypeError, ValueError, AttributeError, outgoing.OutgoingTransactionError):
        raise PauseChangeConflict("The pause contract, chain or signing identity is not configured.") from None
    if intent["to"] is None or intent["to"] == "0x" + "0" * 40:
        raise PauseChangeConflict("The pause contract is not configured.")
    return intent


@contextmanager
def target_transaction(chain_id, contract_address):
    key = f"pause:{chain_id}:{contract_address.lower()}"
    lock_id = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)
    with atomic(durable=True):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_id])
        yield


def operation_key(change):
    return f"token-pause:{change.pk}"


def _same_submission(change, token, paused, actor_id, authority):
    if (
        change.token_id != token.pk
        or change.company_id != token.company_id
        or change.paused != paused
        or change.initiated_by_id != actor_id
        or change.authority != authority
    ):
        raise PauseChangeConflict("This submission already identifies different pause terms or authority.")


def submit(token, user, submission_id, paused, *, authority=PauseAuthority.ISSUER):
    from tokens.tasks.pause import recover_pause_change

    require_autocommit()
    if current_alias() == APP_ALIAS and (authority != PauseAuthority.ISSUER or principal_of() != str(user.pk)):
        raise PermissionDenied("The pause caller does not match the current issuer principal.")
    try:
        submission_id = UUID(str(submission_id))
    except (ValueError, TypeError):
        raise PauseChangeConflict("A pause submission requires a valid UUID.") from None
    if type(paused) is not bool:
        raise PauseChangeConflict("The requested pause state must be a boolean.")
    with use_operator():
        actor = _actor(user.pk, authority)
        previous = PauseChange.objects.filter(pk=submission_id).first()
        if previous:
            _same_submission(previous, token, paused, actor.pk, authority)
            with atomic(durable=True):
                lock_token(token.pk, token.company_id, actor.pk, authority)
            return previous
        intent = transaction_intent(token, paused)
        try:
            with target_transaction(intent["chain_id"], intent["to"]):
                previous = PauseChange.objects.select_for_update().filter(pk=submission_id).first()
                current = lock_token(token.pk, token.company_id, actor.pk, authority)
                if previous:
                    _same_submission(previous, current, paused, actor.pk, authority)
                    return previous
                if transaction_intent(current, paused) != intent:
                    raise PauseChangeConflict("The token identity changed while admitting the pause request.")
                refused = (
                    PauseChange.objects.unresolved()
                    .filter(chain_id=intent["chain_id"], contract_address=intent["to"])
                    .exists()
                )
                change = PauseChange.objects.create(
                    pk=submission_id,
                    token_id=current.pk,
                    company_id=current.company_id,
                    initiated_by_id=actor.pk,
                    authority=authority,
                    paused=paused,
                    chain_id=intent["chain_id"],
                    contract_address=intent["to"],
                    intent=intent,
                    status=PauseChangeStatus.FAILED if refused else PauseChangeStatus.PENDING,
                    completed_at=timezone.now() if refused else None,
                )
                if not refused:
                    recover_pause_change.defer(submission_id=str(change.pk))
        except IntegrityError:
            raise PauseChangeConflict("A competing pause submission already owns this identity or contract.") from None
        return change


def retrieve(token, user, submission_id, *, authority=PauseAuthority.ISSUER):
    with use_operator(), atomic():
        lock_token(token.pk, token.company_id, user.pk, authority)
        try:
            submission_id = UUID(str(submission_id))
        except (ValueError, TypeError):
            raise NotFound("Pause submission not found.") from None
        change = PauseChange.objects.filter(
            pk=submission_id,
            token_id=token.pk,
            company_id=token.company_id,
            initiated_by_id=user.pk,
            authority=authority,
        ).first()
        if change is None:
            raise NotFound("Pause submission not found.")
        return change


def check_authority(change):
    current = lock_token(change.token_id, change.company_id, change.initiated_by_id, change.authority)
    if transaction_intent(current, change.paused) != change.intent:
        raise PauseChangeConflict("The pause target or signing identity changed after admission.")


def record_decision(change, paused, observation):
    with atomic(durable=True):
        current = PauseChange.objects.select_for_update().get(pk=change.pk)
        if current.status != PauseChangeStatus.PENDING:
            return current
        check_authority(current)
        if current.operation_id or OutgoingOperation.objects.filter(operation_key=operation_key(current)).exists():
            raise PauseChangeConflict("An outgoing pause operation already owns this decision.")
        current.status = PauseChangeStatus.OBSERVED if paused == current.paused else PauseChangeStatus.EXECUTING
        current.observation = observation if current.status == PauseChangeStatus.OBSERVED else None
        current.save(update_fields=["status", "observation", "updated_at"])
        return current


def refuse_unsigned(change):
    with atomic(durable=True):
        current = PauseChange.objects.select_for_update().get(pk=change.pk)
        if current.status != PauseChangeStatus.PENDING:
            return current
        if current.operation_id or OutgoingOperation.objects.filter(operation_key=operation_key(current)).exists():
            raise PauseChangeConflict("An outgoing operation owns the unresolved pause request.")
        current.status = PauseChangeStatus.FAILED
        current.save(update_fields=["status", "updated_at"])
        return current


@contextmanager
def _projection_role(principal):
    with acting_for(principal):
        if principal is not None:
            take_the_app_role()
        try:
            yield
        finally:
            if principal is not None:
                give_the_role_back()


def project(change_id):
    change = PauseChange.objects.get(pk=change_id)
    with target_transaction(change.chain_id, change.contract_address):
        current = PauseChange.objects.select_for_update().get(pk=change_id)
        if current.completed_at is not None or current.status not in TERMINAL:
            return current
        if current.status != PauseChangeStatus.FAILED:
            principal = current.initiated_by_id if current.authority == PauseAuthority.ISSUER else None
            with _projection_role(principal), atomic():
                company = Company.objects.select_for_update().filter(pk=current.company_id).first()
                token = (
                    ShareToken.objects.select_for_update()
                    .filter(pk=current.token_id, company_id=current.company_id)
                    .first()
                )
                if (
                    company is None
                    or token is None
                    or (principal is not None and company.owner_id != principal)
                    or token.chain != "base"
                    or (token.contract_address or "").lower() != current.contract_address
                    or settings.BLOCKCHAIN_CHAIN_ID != current.chain_id
                    or token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED)
                ):
                    raise PauseChangeConflict("The original pause target cannot currently receive its outcome.")
                desired = ShareTokenStatus.PAUSED if current.paused else ShareTokenStatus.DEPLOYED
                if token.status != desired:
                    token.status = desired
                    token.save(update_fields=["status", "updated_at"])
        current.completed_at = timezone.now()
        current.save(update_fields=["completed_at", "updated_at"])
        return current


def outcome(change):
    return {
        "uuid": change.pk,
        "paused": change.paused,
        "status": change.status,
        "completed_at": change.completed_at,
    }


def message(change):
    action = "Pause" if change.paused else "Unpause"
    if change.completed_at is None:
        return f"{action} request retained. Its outcome is pending; this does not establish the current token state."
    if change.status == PauseChangeStatus.FAILED:
        if change.operation_id is None:
            return (
                f"The original {action.lower()} request was refused before signing. "
                "A new request needs a new submission."
            )
        return f"The original {action.lower()} request failed. A deliberate new attempt needs a new submission."
    if change.status == PauseChangeStatus.OBSERVED:
        return f"The token was already in the requested state when this {action.lower()} request was checked."
    return f"The original {action.lower()} transaction was confirmed. The token may have changed since then."


def confirmation(token, user, paused):
    with use_operator(), atomic():
        current = lock_token(token.pk, token.company_id, user.pk, PauseAuthority.STAFF)
        require_pausable(current)
    return signing.dumps(
        {"token": str(token.pk), "actor": user.pk, "paused": paused, "submission": str(uuid4())},
        salt=CONFIRMATION_SALT,
    )


def submit_confirmation(token, user, paused, value):
    try:
        confirmed = signing.loads(value, salt=CONFIRMATION_SALT)
        if confirmed["token"] != str(token.pk) or confirmed["actor"] != user.pk or confirmed["paused"] is not paused:
            raise ValueError
        submission_id = confirmed["submission"]
    except (signing.BadSignature, TypeError, ValueError, KeyError):
        raise PauseChangeConflict("Reload the pause confirmation for this token and action.") from None
    return submit(token, user, submission_id, paused, authority=PauseAuthority.STAFF)

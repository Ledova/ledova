from django.conf import settings
from django.db import connections
from django.db.models import F
from eth_account import Account
from web3 import Web3

from blockchain.constants import LOCAL_SIGNER_CHAIN_ID
from blockchain.exceptions import LocalSignerAdmissionError
from blockchain.models import (
    OutgoingStatus,
    SignedAttempt,
    SignerAdmission,
    SigningAccount,
)
from integrations.base_chain import get_base_chain_client
from shared.db import APP_ALIAS, atomic, current_alias

RESET = "make dev-clean resets the local chain and database together."


def require_local_boundary():
    if current_alias() == APP_ALIAS:
        raise LocalSignerAdmissionError("Local signer admission requires an operator connection.")
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise LocalSignerAdmissionError("Local signer admission requires autocommit outside every transaction block.")


def _local_operator():
    if type(settings.BLOCKCHAIN_CHAIN_ID) is not int or settings.BLOCKCHAIN_CHAIN_ID != LOCAL_SIGNER_CHAIN_ID:
        raise LocalSignerAdmissionError(
            f"Local signer admission is restricted to the local chain ({LOCAL_SIGNER_CHAIN_ID})."
        )
    try:
        return Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address.lower()
    except Exception:
        raise LocalSignerAdmissionError("A valid configured operator key is required.") from None


def _mined_transactions(address):
    try:
        provider = get_base_chain_client().w3.eth
        chain_id = provider.chain_id
        mined = provider.get_transaction_count(Web3.to_checksum_address(address), "latest")
    except Exception:
        raise LocalSignerAdmissionError(
            f"The configured provider could not be read as the local chain ({LOCAL_SIGNER_CHAIN_ID})."
        ) from None
    if type(chain_id) is not int or chain_id != LOCAL_SIGNER_CHAIN_ID:
        raise LocalSignerAdmissionError(f"The provider is not on the local chain ({LOCAL_SIGNER_CHAIN_ID}).")
    return mined


def _recorded_nonces(address):
    signer = SigningAccount.objects.filter(chain_id=LOCAL_SIGNER_CHAIN_ID, address=address).first()
    if signer is None:
        return 0, []
    awaiting = SignedAttempt.objects.filter(
        signer=signer,
        operation__current_attempt=F("pk"),
        operation__status=OutgoingStatus.SIGNED,
    )
    return signer.next_nonce, list(awaiting.values_list("nonce", flat=True))


def _require_chain_history(address, next_nonce, awaiting, mined):
    unmined = next_nonce - mined
    if unmined > 0 and len({nonce for nonce in awaiting if mined <= nonce < next_nonce}) != unmined:
        raise LocalSignerAdmissionError(
            f"The database has used {address}'s nonces up to {next_nonce - 1}, but the chain has "
            f"mined only {mined} of its transactions, and not every missing one is a signed transaction still "
            f"waiting for its receipt: the chain was reset, or lost its latest blocks, without the database. {RESET}"
        )


def _result(signer, unchanged):
    return {
        "chain_id": signer.chain_id,
        "address": signer.address,
        "admission_generation": signer.admission_generation,
        "unchanged": unchanged,
    }


def admit_local_signer():
    require_local_boundary()
    address = _local_operator()
    next_nonce, awaiting = _recorded_nonces(address)
    _require_chain_history(address, next_nonce, awaiting, _mined_transactions(address))
    with atomic(durable=True):
        signer, _ = SigningAccount.objects.get_or_create(chain_id=LOCAL_SIGNER_CHAIN_ID, address=address)
        signer = SigningAccount.objects.select_for_update().get(pk=signer.pk)
        if signer.admission_state == SignerAdmission.ADMITTED:
            return _result(signer, True)
        if signer.admission_generation != 0:
            raise LocalSignerAdmissionError(
                f"The local signer {address} was closed and stays closed; this command only admits it once. {RESET}"
            )
        signer.admission_state = SignerAdmission.ADMITTED
        signer.admission_generation = 1
        signer.save(update_fields=["admission_state", "admission_generation", "updated_at"])
    return _result(signer, False)

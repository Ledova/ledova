from uuid import uuid4

from django.utils import timezone

from shared.db import use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.models import RegisterEvidenceKind, RegisterMemberParticulars
from tokens.tests.evidence_fixtures import upload_evidence


def legacy_entry_before_company_transfers(token, owner, kind, changes, effective_on):
    from tokens.services.register_events import record_entry

    try:
        migrate_to([("tokens", "0095_company_register_grant_guards")])
        with use_operator():
            return record_entry(
                register_id=token.stored_register.pk,
                operation_id=uuid4(),
                kind=kind,
                changes=changes,
                effective_on=effective_on,
                recorded_by=owner,
            )
    finally:
        restore_every_migration()


def transfer_existing_member(owner, appointment, token, source, target, shares):
    from tokens.services.register_transfers import (
        decide_transfer,
        prepare_transfer,
        preview_transfer_decision,
    )

    authority = upload_evidence(owner, appointment, RegisterEvidenceKind.AUTHORITY)
    instrument = upload_evidence(owner, appointment, RegisterEvidenceKind.SUPPORTING)
    with use_operator():
        held = RegisterMemberParticulars.objects.filter(member=target).first()
        name = held.name if held else f"Synthetic member {target.pk}"
        residential_address = held.residential_address if held else "1 Synthetic Transfer Street"
    proposal = prepare_transfer(
        actor=owner,
        operation_id=uuid4(),
        appointment=appointment.pk,
        token_id=token.pk,
        from_member=source.pk,
        to_member=target.pk,
        new_member=False,
        name=name,
        residential_address=residential_address,
        shares=str(shares),
        signed_on=timezone.now().date(),
        lodged_on=timezone.now().date(),
        terms="Non-paid synthetic transfer with both parties' retained signed instrument",
        approving_director="Synthetic Independent Director",
        authority_reference="SYNTHETIC-TRANSFER-FIXTURE",
        reason="Record the genuine synthetic transfer",
        authority_evidence=authority.pk,
        instrument_evidence=instrument.pk,
    )[0]
    for kind in ("approve", "apply"):
        digest = preview_transfer_decision(actor=owner, transfer_id=proposal.pk, appointment=appointment.pk, kind=kind)[
            1
        ]["preview_digest"]
        proposal = decide_transfer(
            actor=owner,
            transfer_id=proposal.pk,
            appointment=appointment.pk,
            kind=kind,
            idempotency_key=uuid4(),
            preview_digest=digest,
            confirmation=True,
        )
    return proposal.register_entry

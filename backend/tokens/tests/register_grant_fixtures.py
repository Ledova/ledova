from uuid import uuid4

from tokens.models import RegisterEvidenceKind
from tokens.tests.evidence_fixtures import upload_evidence


def grant_existing_member(owner, appointment, token, member, shares, effective_on):
    from tokens.services.register_grants import decide_grant, prepare_grant, preview_grant_decision

    authority = upload_evidence(owner, appointment, RegisterEvidenceKind.AUTHORITY)
    terms = upload_evidence(owner, appointment, RegisterEvidenceKind.SUPPORTING)
    proposal = prepare_grant(actor=owner, operation_id=uuid4(), appointment=appointment.pk, token_id=token.pk,
        member=member.pk, new_member=False, shares=str(shares), effective_on=effective_on,
        terms="Non-paid synthetic grant", authority_reference="SYNTHETIC-GRANT-FIXTURE", reason="Record the genuine synthetic grant",
        authority_evidence=authority.pk, terms_evidence=terms.pk, acceptance_required=False)[0]
    for kind in ("approve", "apply"):
        digest = preview_grant_decision(actor=owner, grant_id=proposal.pk, appointment=appointment.pk, kind=kind)[1]["preview_digest"]
        proposal = decide_grant(actor=owner, grant_id=proposal.pk, appointment=appointment.pk, kind=kind,
            idempotency_key=uuid4(), preview_digest=digest, confirmation=True)
    return proposal.register_entry

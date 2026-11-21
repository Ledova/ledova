from uuid import UUID, uuid5

from django.db import IntegrityError
from django.db.models import Q
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyCapability, DeletionScope
from companies.services.company_deletion import (
    current_appointment,
    discard,
    follow_ups,
    remove,
    reverse_relations,
    stored_files,
)
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterImport,
    RegisterMemberDocument,
    RegisterMemberDocumentCategory,
    RegisterPosition,
)
from tokens.services.pending_deletion import RECORD_GONE
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_evidence import evidence_snapshot, matching_bytes


def document_rows(value):
    if not isinstance(value, list) or len(value) > 100:
        raise ValidationError("Choose at most 100 supporting documents for each shareholder.")
    rows = []
    try:
        for row in value:
            if (
                not isinstance(row, dict)
                or set(row) - {"evidence", "category", "snapshot"}
                or row["category"] not in RegisterMemberDocumentCategory.values
            ):
                raise ValueError
            rows.append({"evidence": str(UUID(str(row["evidence"]))), "category": row["category"]})
    except (ValueError, TypeError, KeyError, AttributeError):
        raise ValidationError("Each shareholder document needs an uploaded file and a category.") from None
    if len({row["evidence"] for row in rows}) != len(rows):
        raise ValidationError("Attach each file only once for this shareholder and share class.")
    return sorted(rows, key=lambda row: row["evidence"])


def member_document_evidence(*, company, member, token, actor, evidence_id, category):
    evidence = (
        RegisterEvidence.objects.select_for_update()
        .filter(pk=evidence_id, company=company, kind=RegisterEvidenceKind.SUPPORTING)
        .first()
    )
    retained = RegisterMemberDocument.objects.filter(
        company=company, member_id=member, token_id=token, evidence_id=evidence_id, category=category
    ).exists()
    if evidence is None or (evidence.uploaded_by_id != actor.pk and not retained):
        raise ValidationError(
            "Choose a supporting document you uploaded for this company or one already attached to this holding."
        )
    matching_bytes(evidence.file, evidence.file_size, evidence.sha256)
    return evidence


DELETED_DOCUMENT = "A shareholder document in these records was deleted. Remove it, or upload the file again."


def deleted_attachment(*, company, token, member, evidence_id):
    return (
        not RegisterMemberDocument.objects.filter(token=token, member_id=member, evidence_id=evidence_id).exists()
        and RegisterImport.objects.filter(
            company=company,
            token=token,
            status="applied",
            members__contains=[{"member": str(member), "documents": [{"evidence": str(evidence_id)}]}],
        ).exists()
    )


def retain_import_documents(members, company, token, actor):
    for member in members:
        if "documents" not in member:
            continue
        for row in member["documents"]:
            if deleted_attachment(company=company, token=token, member=member["member"], evidence_id=row["evidence"]):
                raise ValidationError(DELETED_DOCUMENT)
            evidence = member_document_evidence(
                company=company,
                member=member["member"],
                token=token.pk,
                actor=actor,
                evidence_id=row["evidence"],
                category=row["category"],
            )
            row["snapshot"] = evidence_snapshot(evidence)


def check_import_documents(proposal):
    for member in proposal.members:
        for row in member.get("documents", []):
            evidence = RegisterEvidence.objects.filter(
                pk=row["evidence"], company_id=proposal.company_id, kind=RegisterEvidenceKind.SUPPORTING
            ).first()
            if evidence is None or evidence_snapshot(evidence) != row["snapshot"]:
                raise ValidationError("A shareholder document no longer matches its retained record.")
            matching_bytes(evidence.file, row["snapshot"]["file_size"], row["snapshot"]["sha256"])


def _link(*, actor, company, member, token, evidence, category, appointment, idempotency_key, source_import=None):
    expected = {
        "company_id": company.pk,
        "member_id": UUID(str(member)),
        "token_id": UUID(str(token)),
        "evidence_id": evidence.pk,
        "category": category,
    }
    prior = RegisterMemberDocument.objects.filter(recorded_by=actor, idempotency_key=idempotency_key).first()
    if prior is None and source_import is not None:
        prior = RegisterMemberDocument.objects.filter(member_id=member, token_id=token, evidence=evidence).first()
    if prior is not None:
        if any(getattr(prior, key) != value for key, value in expected.items()):
            raise RegisterChangeConflict()
        if source_import is None and (prior.appointment_id != appointment.pk or prior.source_import_id is not None):
            raise RegisterChangeConflict()
        return prior, False
    try:
        return (
            RegisterMemberDocument.objects.create(
                **expected,
                snapshot=evidence_snapshot(evidence),
                recorded_by=actor,
                appointment=appointment,
                idempotency_key=idempotency_key,
                source_import=source_import,
            ),
            True,
        )
    except IntegrityError:
        raise RegisterChangeConflict() from None


def link_import_documents(proposal, actor, appointment):
    for member in proposal.members:
        for row in member.get("documents", []):
            evidence = RegisterEvidence.objects.get(pk=row["evidence"], company_id=proposal.company_id)
            _link(
                actor=actor,
                company=proposal.company,
                member=member["member"],
                token=proposal.token_id,
                evidence=evidence,
                category=row["category"],
                appointment=appointment,
                idempotency_key=uuid5(proposal.pk, f"{member['member']}:{evidence.pk}"),
                source_import=proposal,
            )


def add_member_document(*, actor, company_id, member, token, evidence, category, appointment, idempotency_key):
    with register_command(actor, company_id, "register_member_document") as (company, actor, profile, operator):
        source = register_appointment(company, actor, profile, operator, appointment, CompanyCapability.PREPARE)
        if not RegisterPosition.objects.filter(
            register__company=company, register__token_id=token, member_id=member, member__company=company
        ).exists():
            raise NotFound("Shareholder holding not found for this company and share class.")
        retained = member_document_evidence(
            company=company, member=member, token=token, actor=actor, evidence_id=evidence, category=category
        )
        return _link(
            actor=actor,
            company=company,
            member=member,
            token=token,
            evidence=retained,
            category=category,
            appointment=source,
            idempotency_key=idempotency_key,
        )


NO_DOCUMENT_PREPARER = "A current company administrator or preparer is required to delete this document."


def evidence_kept(evidence_id, document_id):
    for related in reverse_relations(RegisterEvidence):
        rows = related.related_model._base_manager.filter(**{related.field.attname: evidence_id})
        if related.related_model is RegisterMemberDocument:
            rows = rows.exclude(pk=document_id)
        if rows.exists():
            return True
    return RegisterImport._base_manager.filter(
        members__contains=[{"documents": [{"evidence": str(evidence_id)}]}]
    ).exists()


def delete_member_document(*, actor, document):
    with register_command(actor, document.company_id, "register_document_delete") as (
        company,
        current,
        _profile,
        operator,
    ):
        document = RegisterMemberDocument.objects.select_for_update().filter(pk=document.pk, company=company).first()
        appointment, expires_at = current_appointment(
            current, company.pk, operator, [CompanyCapability.ADMIN, CompanyCapability.PREPARE]
        )
        if document is None:
            raise NotFound(RECORD_GONE)
        if appointment is None:
            raise NotFound(NO_DOCUMENT_PREPARER)
        rows = {RegisterMemberDocument: list(RegisterMemberDocument._base_manager.filter(pk=document.pk).values())}
        evidence = RegisterEvidence._base_manager.select_for_update().filter(pk=document.evidence_id).first()
        if evidence is not None and not evidence_kept(evidence.pk, document.pk):
            rows[RegisterEvidence] = list(RegisterEvidence._base_manager.filter(pk=evidence.pk).values())
        files = stored_files(rows)
        remove(
            company_id=company.pk,
            actor_id=current.pk,
            appointment_id=appointment,
            scope=DeletionScope.DOCUMENT,
            rows=follow_ups(rows, lambda data: Q(pk__in=[])),
            expires_at=expires_at,
        )
    discard(files)

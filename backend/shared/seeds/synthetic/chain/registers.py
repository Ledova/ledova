from contextlib import nullcontext
from decimal import Decimal
from uuid import uuid4

from django.core.files.base import ContentFile
from django.utils import timezone

from companies.models import CompanyDocument, DocumentType
from companies.services.document_review import prepare_document_review, verify_document
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.records import member_id
from shared.seeds.synthetic.chain.story import ALLOTTED
from shared.seeds.synthetic.clock import frozen
from shared.seeds.synthetic.identities import slug
from shared.seeds.synthetic.paper import pdf
from tokens.models import (
    IssuanceStatus,
    RegisterPosition,
    RegisterReconciliationStatus,
    ShareIssuance,
    ShareToken,
)
from tokens.services.former_holders import fold_former_holders
from tokens.services.register_imports import (
    decide_import,
    prepare_import_review,
    submit_import,
)
from tokens.services.register_inclusions import waiting_effects
from tokens.services.register_instructions import (
    decide_instruction,
    prepare_instruction_review,
    submit_instruction,
)
from tokens.services.register_openings import (
    decide_opening,
    prepare_opening_review,
    submit_opening,
)
from tokens.services.register_reconciliation import reconcile_register
from users.models import UserProfile

PDF = "application/pdf"
RESOLUTION = "Directors' resolution"
UNMATCHED = "The {symbol} register is {status} with the chain: {detail}"
STILL_WAITING = "{count} completed effects of {symbol} are still waiting to be recorded."
HOLDING_DIFFERS = "{symbol}: the register holds {stored} for {holder}, the plan {planned}."


def acn_text(acn):
    return f"ACN {acn[:3]} {acn[3:6]} {acn[6:]}"


def authority(company_key, purpose, title, lines, records, at=None):
    company = records.companies[company_key]
    content = pdf(f"{RESOLUTION}: {title}", [company.name, acn_text(company.acn), *lines])
    name = f"{slug(company.trading_name or company.name)}-{purpose}.pdf"
    with frozen(at) if at else nullcontext():
        document = CompanyDocument(
            company=company, document_type=DocumentType.OTHER, name=name, file_size=len(content), mime_type=PDF
        )
        document.file.save(name, ContentFile(content), save=True)
        _, confirmation = prepare_document_review(document_id=document.pk, reviewer=records.documents)
        return verify_document(document_id=document.pk, reviewer=records.documents, confirmation=confirmation)


def request_item(request):
    return {"request": str(request.pk), "recipient": request.recipient_address, "amount": str(request.amount)}


def subscription_item(subscription):
    return {
        "subscription": str(subscription.pk),
        "recipient": subscription.wallet.address,
        "amount": str(subscription.allotment_quantity),
    }


def instruct(token, items, document, records, *, reference, reason, at=None):
    company_key = records.company_key(token.company_id)
    with frozen(at) if at else nullcontext():
        proposal = submit_instruction(
            actor=token.company.owner,
            operation_id=uuid4(),
            token_id=token.pk,
            document_id=document.pk,
            kind="issue",
            items=items,
            approving_director=records.plan.directors[company_key],
            authority_reference=reference,
            reason=reason,
        )
        _, _, confirmation = prepare_instruction_review(proposal_id=proposal.pk, reviewer=records.operations)
        return decide_instruction(
            proposal_id=proposal.pk, reviewer=records.operations, confirmation=confirmation, decision="apply"
        )


def open_register(share_class, records):
    token = ShareToken.objects.select_related("company").get(pk=records.classes[share_class.key].pk)
    company_key = share_class.company
    holders = sorted(
        {
            issuance.recipient_address.lower()
            for issuance in ShareIssuance.objects.filter(token=token, status=IssuanceStatus.COMPLETED)
        }
    )
    mapping = [{"address": address, "member": str(records.member(company_key, address))} for address in holders]
    document = authority(
        company_key,
        f"register-{share_class.symbol.lower()}",
        f"the register of {share_class.name}",
        [
            f"The directors resolved to keep the register of {share_class.name} ({share_class.symbol}) on Ledova,",
            "opened from the share class's deployment, with the wallets of each member listed in the mapping.",
        ],
        records,
    )
    proposal = submit_opening(
        actor=token.company.owner,
        operation_id=uuid4(),
        token_id=token.pk,
        document_id=document.pk,
        mapping=mapping,
        authority="director_resolution",
        approving_director=records.plan.directors[company_key],
        authority_reference=f"{reference_prefix(token)}-REG-{share_class.symbol}",
        reason=f"Keep the register of {share_class.symbol} on the platform from its deployment.",
    )
    _, confirmation = prepare_opening_review(proposal_id=proposal.pk, reviewer=records.operations)
    return decide_opening(
        proposal_id=proposal.pk, reviewer=records.operations, confirmation=confirmation, decision="apply"
    )


def reference_prefix(token):
    return "".join(word[0] for word in (token.company.trading_name or token.company.name).split()).upper()


def _particulars(share_class, records, allotted_on):
    planned = {}
    for position in share_class.positions:
        planned.setdefault(position.holder, []).append((position.shares, position.entered_on, position.amount_paid))
    for item in records.plan.rounds_of(share_class.key):
        for application in item.applications:
            if application.status != ALLOTTED or not application.allotted:
                continue
            paid = (Decimal(application.allotted) * item.price).quantize(Decimal("0.01"))
            planned.setdefault(application.investor, []).append((application.allotted, allotted_on, paid))
    return {
        holder: (
            sum(shares for shares, _, _ in rows),
            min(entered for _, entered, _ in rows),
            None if any(paid is None for _, _, paid in rows) else sum(paid for _, _, paid in rows),
        )
        for holder, rows in planned.items()
    }


def _identity(holder, share_class, records):
    if holder.startswith("treasury:"):
        treasury = records.plan.treasury(holder)
        return treasury.label, records.postal_address(share_class.company)
    profile = UserProfile.objects.get(user__email=holder)
    return profile.full_name, profile.residential_address


def import_particulars(share_class, records):
    token = ShareToken.objects.select_related("company").get(pk=records.classes[share_class.key].pk)
    company_key = share_class.company
    today = timezone.localdate()
    planned = _particulars(share_class, records, today)
    holders = {str(member_id(company_key, holder)): holder for holder in planned}
    rows = []
    for position in RegisterPosition.objects.filter(register__token=token, shares__gt=0).order_by("member_id"):
        holder = holders[str(position.member_id)]
        shares, entered, paid = planned[holder]
        if int(position.shares) != shares:
            raise ChainStepFailed(
                HOLDING_DIFFERS.format(symbol=token.symbol, stored=position.shares, holder=holder, planned=shares)
            )
        name, address = _identity(holder, share_class, records)
        rows.append(
            {
                "member": str(position.member_id),
                "name": name,
                "residential_address": address,
                "shares": str(shares),
                "entered_on": min(entered, today).isoformat(),
                "amount_paid": None if paid is None else f"{paid:.2f}",
            }
        )
    former = [
        {
            "name": member.name,
            "residential_address": member.address,
            "shares": str(member.shares),
            "ceased_on": member.ceased_on.isoformat(),
        }
        for member in share_class.former
    ]
    documents = CompanyDocument.objects.filter(company=token.company, is_verified=True)
    register = documents.filter(document_type=DocumentType.SHARE_REGISTER).latest("verified_at")
    extract = documents.filter(document_type=DocumentType.ASIC_EXTRACT).latest("verified_at")
    proposal = submit_import(
        actor=token.company.owner,
        operation_id=uuid4(),
        token_id=token.pk,
        document_id=register.pk,
        asic_document_id=extract.pk,
        as_at=today.isoformat(),
        members=rows,
        former_members=former,
        authority="director_resolution",
        approving_director=records.plan.directors[company_key],
        authority_reference=f"{reference_prefix(token)}-IMP-{share_class.symbol}",
        reason="Add each member's particulars, date entered and amount paid from the company's own register.",
    )
    _, _, confirmation = prepare_import_review(proposal_id=proposal.pk, reviewer=records.operations)
    return decide_import(
        proposal_id=proposal.pk,
        reviewer=records.operations,
        confirmation=confirmation,
        decision="apply",
        asic_issued_total=sum(int(row["shares"]) for row in rows),
        asic_member_count=len(rows),
    )


def settle(share_class, records):
    token = ShareToken.objects.get(pk=records.classes[share_class.key].pk)
    fold_former_holders(token)
    record = reconcile_register(token.pk)
    if record is None or record.status != RegisterReconciliationStatus.MATCHED:
        detail = record.discrepancies or record.failure if record else "no applied opening"
        status = record.status if record else "unopened"
        raise ChainStepFailed(UNMATCHED.format(symbol=token.symbol, status=status, detail=detail))
    waiting = waiting_effects(token.pk)
    if waiting != 0:
        raise ChainStepFailed(STILL_WAITING.format(count=waiting, symbol=token.symbol))
    return record

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile

from companies.models import CompanyCapability
from companies.services.activation import activate_company
from companies.services.authority import DECLARATION_VERSION, admit_authority_request
from companies.services.authority_requests import submit_authority_request
from companies.services.team import accept_team_invitation, issue_team_invitation
from companies.tests.registry_fixtures import matching_observation
from operators.models import Operator
from shared.db import acting_for, use_operator
from shared.seeds.synthetic.eligibility import accept_source
from shared.tests.upload_fixtures import pdf_bytes
from users.models import (
    CompanyEligibilityDecision,
    InvestorCategory,
    InvestorClassificationStatus,
)
from users.serializers.investor_classification import InvestorClassificationSerializer
from users.services.investor_classification import create_classification
from users.tests.factories import make_investor


def accept_company_eligibility(tenant, *, issuer_decision=None, category=InvestorCategory.PROFESSIONAL_INVESTOR):
    with use_operator():
        Operator.get()
        tenant.profile.refresh_from_db()
        tenant.account.refresh_from_db()
        if issuer_decision is None:
            tenant.company.refresh_from_db()
            company = tenant.company
            approver, _ = make_investor(f"trade-{uuid4().hex}", role="company")
        else:
            issuer_decision = CompanyEligibilityDecision.objects.select_related(
                "request__company", "decided_by", "appointment"
            ).get(pk=issuer_decision.pk)
            company = issuer_decision.request.company
            approver = issuer_decision.decided_by
            appointment = issuer_decision.appointment
            assert issuer_decision.outcome == "accepted"
    with patch("shared.uploads.scan_upload"), patch(
        "companies.services.registry.lookup_company", return_value=matching_observation(company)
    ):
        if issuer_decision is None:
            proposal, created = submit_authority_request(
                requester=tenant.user,
                company_id=company.pk,
                idempotency_key=uuid4(),
                file=SimpleUploadedFile("trading-authority.pdf", pdf_bytes(), content_type="application/pdf"),
                requested_capabilities=[CompanyCapability.ADMIN],
                delegatable_capabilities=[
                    CompanyCapability.ADMIN,
                    CompanyCapability.PREPARE,
                    CompanyCapability.APPROVE,
                ],
            )
            assert created
            initial = admit_authority_request(
                requester=tenant.user,
                request_id=proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            ).appointment
            company, activation = activate_company(
                actor=tenant.user,
                company_id=company.pk,
                idempotency_key=uuid4(),
                appointment=initial.pk,
                lifecycle_revision=company.lifecycle_revision,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
            assert activation.applied_at is not None
            tenant.company = company
            invitation, code, created = issue_team_invitation(
                requester=tenant.user,
                company_id=company.pk,
                inviter_appointment_id=initial.pk,
                idempotency_key=uuid4(),
                capabilities=[CompanyCapability.PREPARE, CompanyCapability.APPROVE],
            )
            assert created
            appointment = accept_team_invitation(
                requester=approver,
                code=code,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
            assert appointment.invitation_id == invitation.pk
        with use_operator():
            data = {
                "category": category,
                "declaration_accepted": True,
                "declared_basis": "Synthetic exact-company trading fixture evidence",
                "evidence_file": SimpleUploadedFile("trading-source.pdf", pdf_bytes(), content_type="application/pdf"),
            }
            if category == InvestorCategory.ASSOCIATED_PERSON:
                data["company"] = str(company.pk)
            serializer = InvestorClassificationSerializer(
                data=data, context={"request": SimpleNamespace(user=tenant.user)}
            )
            serializer.is_valid(raise_exception=True)
        source = create_classification(actor=tenant.user, validated_data=serializer.validated_data)
        with acting_for(tenant.user.pk):
            decision = accept_source(source, company, approver, appointment)
    assert decision is not None
    assert decision.outcome == "accepted"
    assert decision.decided_by_id == approver.pk
    assert decision.appointment_id == appointment.pk
    with use_operator():
        source.refresh_from_db()
        assert source.category == category
        if category == InvestorCategory.ASSOCIATED_PERSON:
            assert source.company_id == company.pk
        assert source.status == InvestorClassificationStatus.SUBMITTED
        assert source.reviewed_by_id is None
        assert decision.request.company_id == company.pk
        assert decision.request.user_account_id == tenant.account.pk
        assert decision.request.source_id == source.pk
        assert decision.request.sharing_accepted
    return decision

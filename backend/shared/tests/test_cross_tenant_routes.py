from collections import namedtuple
from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyAppointmentRevocation,
    CompanyDocument,
    CompanyRegistryCheck,
    CompanyStatus,
    CompanyTeamInvitation,
)
from companies.services.activation import activate_company, company_activation
from companies.services.documents import delete_document
from companies.services.editing import update_company
from companies.tests.registry_fixtures import DECLARATION, matching_observation
from companies.tests.test_document_file_access import (
    attach_file,
    legacy_company_administrators,
    make_document,
)
from feature_flags.models import FeatureFlag
from integrations.abr.client import RegistryObservation
from offerings.models import Offering, OfferingStatus, Subscription
from operators.models import Operator
from shared.db import acting_for, atomic, current_alias, use_migrate, use_operator
from shared.seeds.synthetic.eligibility import accept_source, company_approver
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.settlement import SYNTHETIC_SETTLEMENT_CONTRACT
from shared.tests.tenants import (
    make_eligible,
    make_tenant,
    phantom_context,
    route_context,
    snapshot,
)
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from tokens.models import (
    PauseChange,
    ShareIssuanceRequest,
    TransferOrder,
)
from tokens.services.register_events import open_register
from tokens.tests.order_action_fixtures import ActionFixtures
from tokens.tests.order_submission_fixtures import pending_submission
from tokens.tests.test_register_events import DAY
from tokens.tests.test_register_openings import SETTINGS
from users.models import CompanyEligibilityDecision, UserProfile
from users.models.investor_classification import InvestorClassification
from users.serializers.investor_classification import InvestorClassificationSerializer
from users.services.investor_classification import (
    create_classification,
    withdraw_classification,
)
from users.tests.factories import make_investor
from users.tests.test_company_eligibility_requests import CompanyEligibilityCases


def _classification_payload():

    return {
        "category": "product_value",
        "declaration_accepted": True,
        "declared_basis": "Holdings above the threshold.",
        "evidence_file": SimpleUploadedFile("evidence.pdf", pdf_bytes(), content_type="application/pdf"),
    }


def _clear_open_classifications(tenant):
    with use_migrate():
        InvestorClassification.objects.filter(user_account=tenant.account).delete()


def _submitted_attachment_classification(tenant):
    with use_operator():
        retained = list(
            InvestorClassification.objects.filter(user_account=tenant.account, status="submitted").values_list(
                "pk", flat=True
            )
        )
    for classification_id in retained:
        withdraw_classification(actor=tenant.user, classification_id=classification_id)
    serializer = InvestorClassificationSerializer(
        data=_classification_payload(), context={"request": SimpleNamespace(user=tenant.user)}
    )
    serializer.is_valid(raise_exception=True)
    claim = create_classification(actor=tenant.user, validated_data=serializer.validated_data)
    return {"investor_classification": str(claim.pk), "own_investor_classification": str(claim.pk)}


SIGNATURE = "0x" + "ab" * 65
DIGEST = "0x" + "cd" * 32
RECIPIENT = "0x" + "9" * 40
ALLOWANCE = {
    "token": "0x" + "7" * 40,
    "token_symbol": "TUSD",
    "required_amount": 1500,
    "current_allowance": 0,
    "has_sufficient_allowance": False,
}


def _activate_company(tenant):
    with use_migrate():
        Company.objects.filter(pk=tenant.company.pk).update(status=CompanyStatus.ACTIVE)


def _prepare_company_activation(tenant):
    with use_migrate():
        Company.objects.filter(pk=tenant.company.pk).update(status=CompanyStatus.DRAFT, activated_at=None)
        company = Company.objects.get(pk=tenant.company.pk)
    context = company_activation(company, tenant.user)
    return {
        "activation_appointment": str(context["appointment"]),
        "activation_revision": str(context["lifecycle_revision"]),
    }


def _clear_subscriptions(tenant):
    Subscription.objects.filter(user_account=tenant.account).delete()


def _open_the_offering_to_the_actor(tenant):
    _prepare_current_company(tenant, open_directory=True)
    _current_company_decision(tenant, tenant)
    Offering.objects.filter(pk=tenant.offering.pk).update(
        status=OfferingStatus.APPROVED, opens_at=timezone.now() - timedelta(days=1)
    )


def _prepare_current_company(tenant, *, open_directory=False):
    make_eligible(tenant)
    with use_operator():
        Operator.get()
        tenant.company.refresh_from_db()
        initial = CompanyAppointment.objects.get(company=tenant.company, legacy_owner__isnull=False)
    if tenant.company.status == CompanyStatus.DRAFT:
        tenant.company, activation = activate_company(
            actor=tenant.user,
            company_id=tenant.company.pk,
            idempotency_key=uuid4(),
            appointment=initial.pk,
            lifecycle_revision=tenant.company.lifecycle_revision,
            declaration_version="2026-10-04",
            accept_declaration=True,
        )
        assert activation.applied_at is not None
    assert tenant.company.status == CompanyStatus.ACTIVE
    if open_directory:
        tenant.company = update_company(tenant.company, {"is_open_to_investors": True}, actor=tenant.user)
        assert tenant.company.is_open_to_investors


def _current_company_decision(tenant, issuer):
    make_eligible(tenant)
    if not hasattr(issuer, "matrix_approver"):
        with use_operator():
            issuer.matrix_approver, _ = make_investor(f"matrix-{uuid4().hex}", role="company")
            assert not issuer.matrix_approver.is_staff
            assert CompanyAppointment.objects.filter(company=issuer.company, legacy_owner__isnull=False).exists()
        issuer.matrix_appointment = company_approver(issuer.company, issuer.matrix_approver)
        assert issuer.matrix_appointment.appointee_id == issuer.matrix_approver.pk
        assert set(issuer.matrix_appointment.capabilities) == {"prepare", "approve"}
    with use_operator():
        serializer = InvestorClassificationSerializer(
            data={
                "category": "professional_investor",
                "declaration_accepted": True,
                "declared_basis": "Exact-company matrix participant evidence",
                "evidence_file": SimpleUploadedFile("matrix-source.pdf", pdf_bytes(), content_type="application/pdf"),
            },
            context={"request": SimpleNamespace(user=tenant.user)},
        )
        serializer.is_valid(raise_exception=True)
    source = create_classification(actor=tenant.user, validated_data=serializer.validated_data)
    with acting_for(tenant.user.pk):
        decision = accept_source(source, issuer.company, issuer.matrix_approver, issuer.matrix_appointment)
    assert decision is not None
    assert decision.outcome == "accepted"
    assert decision.request.company_id == issuer.company.pk
    assert decision.request.user_account_id == tenant.account.pk
    assert decision.request.sharing_accepted
    assert decision.decided_by_id == issuer.matrix_approver.pk
    assert decision.appointment_id == issuer.matrix_appointment.pk
    with use_operator():
        source.refresh_from_db()
        assert source.status == "submitted"
        assert source.reviewed_by_id is None
    return decision


def _approve_the_offering(tenant):
    Offering.objects.filter(pk=tenant.offering.pk).update(
        status=OfferingStatus.APPROVED, opens_at=timezone.now() - timedelta(days=1)
    )


def _pause_change(token, user, submission_id, paused=True):
    return PauseChange(pk=submission_id, token_id=token.pk, company_id=token.company_id, paused=paused)


def _create_issuance_request(token, recipient, amount, user, reason="", issuance_type="additional"):
    return ShareIssuanceRequest.objects.create(
        token=token,
        recipient_address=recipient,
        amount=amount,
        reason=reason,
        issuance_type=issuance_type,
        submitted_by=user,
    )


def _an_issuance_request(tenant):
    return _create_issuance_request(
        tenant.deployed_token, "0x" + "c" * 40, 10, tenant.user, reason="Founder allocation"
    )


def _a_pending_order_submission(tenant):
    pending_submission(tenant, submission_id=tenant.account.pk)


Route = namedtuple(
    "Route",
    "method path payload foreign prepare rejects content_type",
    defaults=(None, 404, None, None, "json"),
)

OFFERING = {
    "exemption": "s708_11_professional",
    "pricePerShare": "2.50",
    "minimumShares": 10,
    "targetShares": 50,
    "capShares": 100,
    "opensAt": "2027-01-01T00:00:00Z",
    "closesAt": "2027-02-01T00:00:00Z",
    "summary": "New tranche",
    "useOfProceeds": "Working capital",
}
SUBSCRIPTION = {
    "wallet": "{wallet}",
    "quantity": 10,
}
CAPITAL_INCREASE = {
    "additionalShares": 100,
    "newAuthorizedTotal": 1100,
    "purpose": "Growth",
    "boardResolutionReference": "BOARD-NEW",
}
COMPANY_AUTHORITY_ROUTES = {
    "create": ("post", "/api/v1/company-authority/requests/"),
    "list": ("get", "/api/v1/company-authority/requests/"),
    "detail": ("get", "/api/v1/company-authority/requests/{uuid}/"),
    "file": ("get", "/api/v1/company-authority/requests/{uuid}/file/"),
    "withdraw": ("post", "/api/v1/company-authority/requests/{uuid}/withdraw/"),
    "admit": ("post", "/api/v1/company-authority/requests/{uuid}/admit/"),
    "revoke": ("post", "/api/v1/company-authority/requests/{uuid}/revoke/"),
    "invitation_create": ("post", "/api/v1/company-authority/invitations/"),
    "invitation_list": ("get", "/api/v1/company-authority/invitations/"),
    "invitation_accept": ("post", "/api/v1/company-authority/invitations/accept/"),
    "appointment_list": ("get", "/api/v1/company-authority/appointments/"),
    "appointment_team": ("get", "/api/v1/company-authority/appointments/team/?company={company}"),
    "appointment_revoke": ("post", "/api/v1/company-authority/appointments/{uuid}/revoke/"),
}

REGISTER_CORRECTION_ROUTES = {
    "create": ("post", "/api/v1/tokens/register-corrections/"),
    "list": ("get", "/api/v1/tokens/register-corrections/"),
    "detail": ("get", "/api/v1/tokens/register-corrections/{uuid}/"),
    "file": ("get", "/api/v1/tokens/register-corrections/{uuid}/file/"),
    "decision_preview": ("post", "/api/v1/tokens/register-corrections/{uuid}/decision-preview/"),
    "decide": ("post", "/api/v1/tokens/register-corrections/{uuid}/decide/"),
}
REGISTER_OPENING_ROUTES = {
    "create": ("post", "/api/v1/tokens/register-openings/"),
    "list": ("get", "/api/v1/tokens/register-openings/"),
    "detail": ("get", "/api/v1/tokens/register-openings/{uuid}/"),
    "file": ("get", "/api/v1/tokens/register-openings/{uuid}/file/"),
}
REGISTER_LINK_ROUTES = {
    "create": ("post", "/api/v1/tokens/register-links/"),
    "list": ("get", "/api/v1/tokens/register-links/"),
    "detail": ("get", "/api/v1/tokens/register-links/{uuid}/"),
    "file": ("get", "/api/v1/tokens/register-links/{uuid}/file/"),
}
REGISTER_IMPORT_ROUTES = {
    "create": ("post", "/api/v1/tokens/register-imports/"),
    "list": ("get", "/api/v1/tokens/register-imports/"),
    "detail": ("get", "/api/v1/tokens/register-imports/{uuid}/"),
    "file": ("get", "/api/v1/tokens/register-imports/{uuid}/file/"),
    "asic_file": ("get", "/api/v1/tokens/register-imports/{uuid}/asic-file/"),
    "decision_preview": ("post", "/api/v1/tokens/register-imports/{uuid}/decision-preview/"),
    "decide": ("post", "/api/v1/tokens/register-imports/{uuid}/decide/"),
    "evidence": ("post", "/api/v1/tokens/register-evidence/"),
}
REGISTER_RECONCILIATION_ROUTES = {
    "list": ("get", "/api/v1/tokens/register-reconciliations/"),
    "detail": ("get", "/api/v1/tokens/register-reconciliations/{uuid}/"),
    "acknowledge": ("post", "/api/v1/tokens/register-reconciliations/{uuid}/acknowledge/"),
}
PUBLICATION_ROUTES = {
    "list": ("get", "/api/v1/publications/"),
    "file": ("get", "/api/v1/publications/{uuid}/file/"),
    "ballot": ("post", "/api/v1/publications/{uuid}/ballot/"),
    "summary": ("get", "/api/v1/publications/summary/"),
}
REGISTER_INSTRUCTION_ROUTES = {
    "create": ("post", "/api/v1/tokens/register-instructions/"),
    "list": ("get", "/api/v1/tokens/register-instructions/"),
    "detail": ("get", "/api/v1/tokens/register-instructions/{uuid}/"),
    "file": ("get", "/api/v1/tokens/register-instructions/{uuid}/file/"),
}

ROUTES = (
    Route("patch", "/api/user-profiles/{profile}/", {"fullName": "Renamed"}),
    Route("patch", "/api/financial-profiles/{financial_profile}/", {"occupation": "Changed"}),
    Route("patch", "/api/user-accounts/{account}/", {"role": "company"}),
    Route("post", "/api/device-tokens/unregister/", {"pushToken": "{push_token}"}),
    Route("patch", "/api/notifications/{notification}/", {"isRead": True}),
    Route("delete", "/api/investor-classifications/{investor_classification}/"),
    Route("patch", "/api/wallets/{wallet}/", {"name": "Renamed"}),
    Route("delete", "/api/wallets/{spare_wallet}/"),
    Route("post", "/api/wallets/{wallet}/request-verification/", {}),
    Route("post", "/api/wallets/{wallet}/verify-signature/", {"signature": "0x01"}),
    Route("post", "/api/wallets/{wallet}/sync/", {}),
    Route("get", "/api/wallets/{wallet}/holdings/"),
    Route("post", "/api/wallets/{wallet}/prepare-transfer/", {"toAddress": "0x" + "c" * 40, "amountEth": "0.1"}),
    Route("post", "/api/wallets/{wallet}/broadcast-transfer/", {"signedTransaction": "{signed_transfer}"}),
    Route("post", "/api/fiat-purchases/transak-widget-url/", {"walletUuid": "{wallet}"}),
    Route("get", "/api/portfolios/{portfolio}/"),
    Route("put", "/api/portfolios/{portfolio}/", {"name": "Renamed"}),
    Route("patch", "/api/portfolios/{portfolio}/", {"name": "Renamed"}),
    Route("delete", "/api/portfolios/{portfolio}/"),
    Route("post", "/api/portfolios/{portfolio}/add-wallet/", {"walletUuid": "{own_spare_wallet}"}),
    Route("post", "/api/portfolios/{own_portfolio}/add-wallet/", {"walletUuid": "{spare_wallet}"}),
    Route("post", "/api/portfolios/{portfolio}/remove-wallet/", {"walletUuid": "{own_wallet}"}),
    Route("post", "/api/portfolios/{own_portfolio}/remove-wallet/", {"walletUuid": "{wallet}"}),
    Route("get", "/api/v1/companies/{company}/"),
    Route("patch", "/api/v1/companies/{company}/", {"name": "Renamed"}),
    Route(
        "post",
        "/api/v1/companies/{company}/activate/",
        {
            "idempotency_key": lambda: str(uuid4()),
            "appointment": "{activation_appointment}",
            "lifecycle_revision": "{activation_revision}",
            "declaration_version": "2026-10-04",
            "accept_declaration": True,
        },
        prepare=_prepare_company_activation,
    ),
    Route(
        "post",
        "/api/v1/companies/{company}/documents/",
        {
            "document_type": "bank_statement",
            "name": "Statement",
            "external_url": "https://docs.example.test/statement",
            "file_size": 1,
            "mime_type": "application/pdf",
        },
    ),
    Route("get", "/api/v1/companies/{company}/documents/{company_document}/file/"),
    Route("get", "/api/v1/companies/{own_company}/documents/{company_document}/file/"),
    Route("delete", "/api/v1/companies/{company}/documents/{company_document}/"),
    Route("get", "/api/v1/tokens/{token}/"),
    Route("post", "/api/v1/tokens/{token}/deploy/", {}, prepare=_activate_company),
    Route("post", "/api/v1/tokens/{deployed_token}/pause/", {"submissionId": "{deployed_token}"}),
    Route("post", "/api/v1/tokens/{deployed_token}/unpause/", {"submissionId": "{deployed_token}"}),
    Route("get", "/api/v1/tokens/{deployed_token}/pause-submissions/{deployed_token}/"),
    Route(
        "post",
        "/api/v1/tokens/{deployed_token}/issue/",
        {"recipient": RECIPIENT, "amount": 7, "reason": "Owner", "issuanceType": "additional"},
    ),
    Route("get", "/api/v1/tokens/{deployed_token}/issuances/"),
    Route("get", "/api/v1/tokens/{deployed_token}/holders/"),
    Route("get", "/api/v1/tokens/{deployed_token}/register/export/"),
    Route("get", "/api/v1/tokens/{deployed_token}/register/waiting/"),
    Route(
        "post",
        "/api/v1/tokens/",
        {"company": "{company}", "name": "New shares", "symbol": "NEW", "totalSupply": "1000"},
        foreign=400,
    ),
    Route("post", "/api/v1/tokens/capital-increases/{capital_increase}/submit/", {}),
    Route("post", "/api/v1/tokens/capital-increases/", {"token": "{deployed_token}", **CAPITAL_INCREASE}),
    Route("get", "/api/v1/offerings/{offering}/"),
    Route("patch", "/api/v1/offerings/{offering}/", {"summary": "Changed"}),
    Route("delete", "/api/v1/offerings/{offering}/", prepare=_clear_subscriptions),
    Route("post", "/api/v1/offerings/{offering}/submit/", {}, prepare=_activate_company),
    Route("post", "/api/v1/offerings/{offering}/withdraw/", {}),
    Route("get", "/api/v1/offerings/{offering}/subscriptions/"),
    Route("post", "/api/v1/offerings/{offering}/documents/", {"documents": ["{offer_document}"]}),
    Route("post", "/api/v1/offerings/", {"token": "{deployed_token}", **OFFERING}, foreign=400),
    Route("get", "/api/v1/subscriptions/{subscription}/"),
    Route("post", "/api/v1/subscriptions/{subscription}/submit/", {}, prepare=_open_the_offering_to_the_actor),
    Route("post", "/api/v1/subscriptions/{subscription}/withdraw/", {"reason": "Changed my mind"}),
    Route(
        "post",
        "/api/v1/subscriptions/",
        {"offering": "{offering}", **SUBSCRIPTION},
        foreign=400,
        prepare=_open_the_offering_to_the_actor,
    ),
    Route(
        "get",
        "/api/v1/trading/swaps/?wallet_address={wallet_address}",
    ),
    Route(
        "get",
        "/api/v1/trading/wallets/balances/?wallet_address={wallet_address}",
    ),
    Route(
        "post",
        "/api/v1/trading/orders/create/",
        {
            "submissionId": "{own_account}",
            "ownerAccountUuid": "{own_account}",
            "token": "{own_deployed_token}",
            "orderType": "sell",
            "walletUuid": "{wallet}",
            "walletAddress": "{own_wallet_address}",
            "quantity": 1,
            "pricePerShare": "2.50",
            "digest": DIGEST,
            "signature": SIGNATURE,
        },
        foreign=400,
        rejects="walletUuid",
    ),
    Route(
        "post",
        "/api/v1/trading/orders/create/message/",
        {
            "submissionId": "{own_account}",
            "ownerAccountUuid": "{own_account}",
            "token": "{own_deployed_token}",
            "orderType": "sell",
            "walletUuid": "{wallet}",
            "walletAddress": "{own_wallet_address}",
            "quantity": 1,
            "pricePerShare": "2.50",
        },
        foreign=400,
        rejects="walletUuid",
    ),
    Route(
        "get",
        "/api/v1/trading/orders/submissions/{account}/?owner_account_uuid={account}",
        prepare=_a_pending_order_submission,
    ),
    Route(
        "get",
        "/api/v1/trading/orders/{order}/swap/?swap_uuid={swap}"
        "&owner_account_uuid={own_account}&wallet_uuid={own_wallet}",
    ),
    Route(
        "post",
        "/api/v1/trading/orders/{order}/swap/sign/",
        {
            "signature": SIGNATURE,
            "signerAddress": "{own_wallet_address}",
            "swapUuid": "{swap}",
            "ownerAccountUuid": "{own_account}",
            "walletUuid": "{own_wallet}",
            "settlementDigest": "{own_settlement_digest}",
        },
    ),
    Route(
        "get",
        "/api/v1/trading/orders/{order}/swap/approval-status/?swap_uuid={swap}"
        "&owner_account_uuid={own_account}&wallet_uuid={own_wallet}&settlement_digest={own_settlement_digest}",
    ),
    Route(
        "get",
        "/api/v1/trading/orders/{order}/swap/approval-data/?swap_uuid={swap}"
        "&owner_account_uuid={own_account}&wallet_uuid={own_wallet}&settlement_digest={own_settlement_digest}",
    ),
    Route(
        "post",
        "/api/v1/trading/orders/{order}/swap/approval-broadcast/",
        {
            "swapUuid": "{swap}",
            "ownerAccountUuid": "{own_account}",
            "walletUuid": "{own_wallet}",
            "settlementDigest": "{own_settlement_digest}",
            "signedTransaction": "0xab",
        },
    ),
    Route("get", "/api/v1/documents/{document}/"),
    Route(
        "post",
        "/api/v1/documents/{document}/attach/",
        {"classification": "{own_investor_classification}"},
        prepare=_submitted_attachment_classification,
    ),
    Route(
        "post",
        "/api/v1/documents/{own_document}/attach/",
        {"classification": "{investor_classification}"},
        prepare=_submitted_attachment_classification,
    ),
    Route("delete", "/api/v1/documents/{document}/"),
)


OPERATOR_ROUTES = (
    Route(
        "post",
        "/api/v1/companies/{company}/status/",
        {"status": "warning", "reason": "Review"},
        prepare=_activate_company,
    ),
)

REGISTRY_ADMIN_ROUTES = (
    ("retry-registry", CompanyStatus.WARNING, CompanyStatus.WARNING),
    ("resolve-warning", CompanyStatus.WARNING, CompanyStatus.WARNING),
    ("reinstate", CompanyStatus.SUSPENDED, CompanyStatus.SUSPENDED),
)


LIST_ROUTES = (
    ("/api/user-profiles/", ("profile",)),
    ("/api/financial-profiles/", ("financial_profile",)),
    ("/api/notifications/", ("notification",)),
    ("/api/investor-classifications/", ("investor_classification",)),
    ("/api/wallets/", ("wallet", "spare_wallet")),
    ("/api/wallets/{wallet}/holdings/", ("holding",)),
    ("/api/transactions/", ("transaction",)),
    ("/api/portfolios/", ("portfolio",)),
    ("/api/v1/companies/", ("company",)),
    ("/api/v1/tokens/", ("token", "deployed_token")),
    ("/api/v1/tokens/register/", ("token", "deployed_token")),
    ("/api/v1/tokens/capital-increases/", ("capital_increase",)),
    ("/api/v1/tokens/issuance-requests/", ("issuance_request",)),
    ("/api/v1/offerings/", ("offering",)),
    ("/api/v1/subscriptions/", ("subscription",)),
    ("/api/v1/trading/orders/", ("order", "counter_order")),
    ("/api/v1/documents/", ("document",)),
)
SINGLETON_ROUTES = (
    ("/api/user-accounts/", "account"),
    ("/api/user-preferences/", "preferences"),
)

DIRECTORY_ROUTES = (
    Route("get", "/api/v1/directory/tokens/{deployed_token}/"),
    Route("get", "/api/v1/directory/tokens/{deployed_token}/documents/", prepare=_approve_the_offering),
    Route(
        "get",
        "/api/v1/directory/tokens/{deployed_token}/documents/{company_document}/file/",
        prepare=_approve_the_offering,
    ),
)

MARKET_ROUTES = (
    Route("get", "/api/v1/trading/tokens/{deployed_token}/"),
    Route("get", "/api/v1/trading/tokens/{deployed_token}/order-book/"),
)

GLOBAL_ROUTES = ("/api/operator/",)
RAILS = {"bankBsb": "062000"}


def _body(response):
    return b"<streamed file>" if response.streaming else response.content


def _fill(value, context):
    if callable(value):
        return _fill(value(), context)
    if isinstance(value, str):
        return value.format_map(context)
    if isinstance(value, dict):
        return {key: _fill(item, context) for key, item in value.items()}
    if isinstance(value, list):
        return [_fill(item, context) for item in value]
    return value


class CrossTenantRouteMatrixTest(StubUploadDependencies, APITransactionTestCase):

    @staticmethod
    def routes():
        return ROUTES

    @contextmanager
    def undone_before_the_next_case(self, route=None, actor=None):
        if route and route.method == "post" and route.path == "/api/v1/companies/{company}/documents/":
            with self.committed_document_upload(actor):
                yield
            return
        if route and route.path == "/api/v1/companies/{company}/activate/":
            with use_migrate():
                before = Company.objects.filter(pk=actor.company.pk).values().get()
                retained = set(CompanyRegistryCheck.objects.filter(company=actor.company).values_list("pk", flat=True))
            try:
                yield
            finally:
                with use_migrate():
                    Company.objects.filter(pk=actor.company.pk).update(**before)
                    CompanyRegistryCheck.objects.filter(company=actor.company).exclude(pk__in=retained).delete()
            return
        with atomic():
            yield
            transaction.set_rollback(True, using=current_alias())

    @contextmanager
    def committed_document_upload(self, actor):
        with self.as_an_operator_would():
            retained = set(CompanyDocument.objects.filter(company=actor.company).values_list("pk", flat=True))
        try:
            yield
        finally:
            with self.as_an_operator_would():
                new_documents = list(CompanyDocument.objects.filter(company=actor.company).exclude(pk__in=retained))
            for document in new_documents:
                delete_document(document, actor=actor.user)

    @contextmanager
    def as_an_operator_would(self):
        yield

    @contextmanager
    def committed_where_a_request_on_another_connection_can_read_it(self):
        with self.as_an_operator_would():
            yield

    @contextmanager
    def as_whoever_may_write_the_fixture(self, route, context, owner, actor):
        yield

    def setUp(self):
        FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
        self._patch("rest_framework.throttling.SimpleRateThrottle.allow_request", return_value=True)
        self.services = []
        self._service("wallets.views.wallet.sync_wallet", return_value={"status": "success"})
        wallet_transfer = self._service("wallets.views.wallet.transfers")
        wallet_transfer.prepare_transfer.return_value = {"transaction": {}}
        wallet_transfer.broadcast_transfer.return_value = {"success": True}
        self._service("wallets.services.balance.get_blockchain_client").return_value.get_native_balance.return_value = (
            Decimal("0")
        )
        self._service("wallets.services.verification.verify_wallet_signature", return_value=True)
        self._service("wallets.tasks.sync_wallet").defer.return_value = "job"
        self._service("wallets.views.fiat_purchase.generate_transak_widget_url", return_value="https://widget.test")
        self._service(
            "companies.services.registry.lookup_company",
            side_effect=lambda **inputs: matching_observation(Company.objects.get(acn=inputs["acn"])),
        )
        self._service("offerings.services.offering.send_push_notification")
        self._service("tokens.tasks.deploy_share_token_task")
        share_tokens = self._service("tokens.views.share_token.share_token_service")
        share_tokens.create_issuance_request.side_effect = _create_issuance_request
        pause_commands = self._service("tokens.views.share_token.pause_changes")
        pause_commands.submit.side_effect = _pause_change
        pause_commands.retrieve.side_effect = _pause_change
        pause_commands.message.return_value = "Pause request retained."
        pause_commands.outcome.side_effect = lambda change: {
            "uuid": str(change.pk),
            "paused": change.paused,
            "status": "pending",
            "completed_at": None,
        }
        balances_need_a_readable_chain = self._service("tokens.views.trading_wallet.share_token_service")
        balances_need_a_readable_chain.get_wallet_token_balances.return_value = {"balances": []}
        self._service("tokens.views.trading_order.execute_order_submission")
        self._service("tokens.views.trading_order.issue_order_submission")
        self._service("tokens.views.trading_order.submission_snapshot").return_value = {}
        swaps = self._service("tokens.views.trading_order.atomic_swap_service")
        swaps.settlement_contract.return_value = SYNTHETIC_SETTLEMENT_CONTRACT
        swaps.broadcast_settlement_approval.return_value = SimpleNamespace(
            tx_hash="0x" + "ab" * 32, block_number=1, gas_used=21000
        )
        self.enterContext(override_settings(ATOMIC_SWAP_ADDRESS=SYNTHETIC_SETTLEMENT_CONTRACT))
        self._service("tokens.views.trading_order.swap_execution").submit_signature.side_effect = (
            lambda swap_order, **kwargs: swap_order
        )
        swaps.get_typed_data.return_value = {}
        swaps.check_swap_allowances.return_value = {"seller": ALLOWANCE, "buyer": ALLOWANCE}
        swaps.get_approval_transaction_data.return_value = {}

        self.actors = (make_tenant("alice"), make_tenant("staff", staff=True), make_tenant("root", superuser=True))
        self.other = make_tenant("bob")
        for tenant in (*self.actors, self.other):
            tenant.issuance_request = _an_issuance_request(tenant)
            with self.as_an_operator_would():
                tenant.offering.documents.add(tenant.company_document)
                tenant.offer_document = make_document(tenant.company)
                open_register(
                    token_id=tenant.deployed_token.pk,
                    operation_id=uuid4(),
                    changes=[],
                    effective_on=DAY,
                    recorded_by=tenant.user,
                )
        legacy_company_administrators(*(tenant.company for tenant in (*self.actors, self.other)))

    def _patch(self, target, **kwargs):
        patcher = patch(target, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def _service(self, target, **kwargs):
        mock = self._patch(target, **kwargs)
        self.services.append(mock)
        return mock

    def send(self, route, actor, context):
        context = {**{f"own_{key}": value for key, value in route_context(actor).items()}, **context}
        if route.path == "/api/v1/companies/{company}/activate/":
            context.setdefault("activation_appointment", str(uuid4()))
            context.setdefault("activation_revision", "0")
        return self.perform(route, context)

    def perform(self, route, context):
        request = getattr(self.client, route.method)
        return request(route.path.format_map(context), _fill(route.payload, context), format=route.content_type)

    def assert_rejected_for_the_right_reason(self, route, response, label):
        if not route.rejects:
            return
        body = response.json()
        self.assertIn(
            route.rejects,
            body,
            f"{label} answered {response.status_code} without naming {route.rejects}: {body}",
        )

    @staticmethod
    def rows(response):
        body = response.json()
        return body.get("results", body) if isinstance(body, dict) else body

    @staticmethod
    def masked(response, context):
        text = _body(response).decode()
        for value in context.values():
            text = text.replace(value, "<target>")
        return text

    def test_foreign_rows_are_not_found_and_left_untouched(self):
        with self.as_an_operator_would():
            before = snapshot(self.other)
        foreign = route_context(self.other)
        phantom = phantom_context(self.other)

        for actor in self.actors:
            self.client.force_authenticate(actor.user)
            for route in ROUTES:
                foreign_response = self.send(route, actor, foreign)
                phantom_response = self.send(route, actor, phantom)
                with self.subTest(actor=actor.label, route=f"{route.method} {route.path}"):
                    self.assertEqual(foreign_response.status_code, route.foreign, foreign_response.content)
                    self.assertEqual(phantom_response.status_code, route.foreign, phantom_response.content)
                    self.assertEqual(self.masked(foreign_response, foreign), self.masked(phantom_response, phantom))
                    self.assert_rejected_for_the_right_reason(route, foreign_response, "foreign")
                    self.assert_rejected_for_the_right_reason(route, phantom_response, "phantom")

        with self.as_an_operator_would():
            self.assertEqual(snapshot(self.other), before)
        for service in self.services:
            self.assertEqual(service.mock_calls, [])

    def test_own_rows_resolve_for_every_actor(self):
        for actor in self.actors:
            with self.committed_where_a_request_on_another_connection_can_read_it():
                UserProfile.objects.filter(pk=actor.profile.pk).update(is_id_verified=True)
            self.client.force_authenticate(actor.user)
            own = route_context(actor)
            for route in ROUTES:
                with self.subTest(actor=actor.label, route=f"{route.method} {route.path}"):
                    context = dict(own)
                    if route.prepare in (_submitted_attachment_classification, _open_the_offering_to_the_actor):
                        with self.committed_where_a_request_on_another_connection_can_read_it():
                            prepared = route.prepare(actor)
                            if isinstance(prepared, dict):
                                context.update(prepared)
                    with self.undone_before_the_next_case(route, actor):
                        if route.prepare and route.prepare not in (
                            _submitted_attachment_classification,
                            _open_the_offering_to_the_actor,
                        ):
                            with self.as_whoever_may_write_the_fixture(route, own, actor, actor):
                                prepared = route.prepare(actor)
                                if isinstance(prepared, dict):
                                    context.update(prepared)
                        response = self.send(route, actor, context)
                        if route.path == "/api/v1/companies/{company}/activate/":
                            self.assertEqual(response.status_code, 200, _body(response))
                            self.assertEqual(response.data["company"]["status"], CompanyStatus.ACTIVE)
                            self.assertEqual(response.data["attempt"]["appointment"], context["activation_appointment"])
                            self.assertIsNotNone(response.data["attempt"]["applied_at"])
                    self.assertIn(response.status_code, (200, 201, 202, 204), _body(response))

    def test_operator_routes_are_staff_only_and_reach_every_tenant(self):
        foreign = route_context(self.other)
        phantom = phantom_context(self.other)
        for actor in self.actors:
            self.client.force_authenticate(actor.user)
            for route in OPERATOR_ROUTES:
                with self.subTest(actor=actor.label, route=f"{route.method} {route.path}"):
                    with self.undone_before_the_next_case(route, actor):
                        if route.prepare:
                            with self.as_whoever_may_write_the_fixture(route, foreign, self.other, actor):
                                route.prepare(self.other)
                        foreign_response = self.send(route, actor, foreign)
                        phantom_response = self.send(route, actor, phantom)
                    if actor.user.is_staff:
                        self.assertEqual(foreign_response.status_code, 200, foreign_response.content)
                        self.assertEqual(phantom_response.status_code, 404, phantom_response.content)
                    else:
                        self.assertEqual(foreign_response.status_code, 403, foreign_response.content)
                        self.assertEqual(phantom_response.status_code, 403, phantom_response.content)
                        self.assertEqual(self.masked(foreign_response, foreign), self.masked(phantom_response, phantom))

    def test_directory_and_market_routes_reach_every_tenant_and_hide_phantom_rows(self):
        foreign = route_context(self.other)
        phantom = phantom_context(self.other)
        for actor in self.actors:
            with self.committed_where_a_request_on_another_connection_can_read_it():
                _prepare_current_company(self.other, open_directory=True)
                _current_company_decision(actor, self.other)
            self.client.force_authenticate(actor.user)
            for route in DIRECTORY_ROUTES + MARKET_ROUTES:
                with self.subTest(actor=actor.label, route=f"{route.method} {route.path}"):
                    with self.undone_before_the_next_case(route, actor):
                        with self.as_whoever_may_write_the_fixture(route, foreign, self.other, actor):
                            if route.prepare:
                                route.prepare(self.other)
                        foreign_response = self.send(route, actor, foreign)
                        phantom_response = self.send(route, actor, phantom)
                    self.assertEqual(foreign_response.status_code, 200, _body(foreign_response))
                    self.assertEqual(phantom_response.status_code, 404, _body(phantom_response))

    def test_the_market_answers_without_the_issuers_directory_opt_in(self):
        foreign = route_context(self.other)
        for actor in self.actors:
            with self.committed_where_a_request_on_another_connection_can_read_it():
                _prepare_current_company(self.other)
                _current_company_decision(actor, self.other)
            self.client.force_authenticate(actor.user)
            for route in MARKET_ROUTES + DIRECTORY_ROUTES:
                with self.subTest(actor=actor.label, route=f"{route.method} {route.path}"):
                    with self.undone_before_the_next_case(route, actor):
                        if route.prepare:
                            with self.as_whoever_may_write_the_fixture(route, foreign, self.other, actor):
                                route.prepare(self.other)
                        foreign_response = self.send(route, actor, foreign)
                    expected = 200 if route in MARKET_ROUTES else 404
                    self.assertEqual(foreign_response.status_code, expected, _body(foreign_response))

    def test_directory_and_market_routes_are_empty_and_not_found_without_eligibility(self):
        foreign = route_context(self.other)
        phantom = phantom_context(self.other)
        for actor in self.actors:
            with self.committed_where_a_request_on_another_connection_can_read_it():
                _prepare_current_company(self.other, open_directory=True)
                make_eligible(actor)
                self.assertFalse(
                    CompanyEligibilityDecision.objects.filter(request__user_account=actor.account).exists()
                )
            self.client.force_authenticate(actor.user)
            for route in DIRECTORY_ROUTES + MARKET_ROUTES:
                with self.subTest(actor=actor.label, route=f"{route.method} {route.path}"):
                    with self.undone_before_the_next_case(route, actor):
                        with self.as_whoever_may_write_the_fixture(route, foreign, self.other, actor):
                            if route.prepare:
                                route.prepare(self.other)
                        foreign_response = self.send(route, actor, foreign)
                        phantom_response = self.send(route, actor, phantom)
                    self.assertEqual(foreign_response.status_code, 404, _body(foreign_response))
                    self.assertEqual(phantom_response.status_code, 404, _body(phantom_response))
                    self.assertEqual(self.masked(foreign_response, foreign), self.masked(phantom_response, phantom))

    def test_collection_routes_return_only_the_actors_rows(self):
        for actor in self.actors:
            self.client.force_authenticate(actor.user)
            own = route_context(actor)
            for path, keys in LIST_ROUTES:
                response = self.client.get(path.format_map(own))
                with self.subTest(actor=actor.label, path=path):
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual({row["uuid"] for row in self.rows(response)}, {own[key] for key in keys})
            for path, key in SINGLETON_ROUTES:
                response = self.client.get(path)
                with self.subTest(actor=actor.label, path=path):
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(response.json()["uuid"], own[key])

    def test_global_singleton_routes_answer_every_actor_and_refuse_anonymous(self):
        operator = Operator.get()
        operator.bank_bsb = "062000"
        operator.save(update_fields=["bank_bsb"])
        for path in GLOBAL_ROUTES:
            bodies = {}
            for actor in self.actors:
                self.client.force_authenticate(actor.user)
                response = self.client.get(path)
                with self.subTest(actor=actor.label, path=path):
                    self.assertEqual(response.status_code, 200, response.content)
                bodies[actor.label] = response.json()
            rails = {label: body.pop("paymentInstructions") for label, body in bodies.items()}
            self.assertEqual(rails, {"alice": None, "staff": RAILS, "root": RAILS})
            self.assertEqual(len({str(body) for body in bodies.values()}), 1)
            self.client.force_authenticate(None)
            self.assertEqual(self.client.get(path).status_code, 401)

    def test_the_operator_rails_follow_the_eligibility_predicate_not_the_session(self):
        operator = Operator.get()
        operator.bank_bsb = "062000"
        operator.save(update_fields=["bank_bsb"])
        alice = self.actors[0]
        self.client.force_authenticate(alice.user)

        self.assertIsNone(self.client.get(GLOBAL_ROUTES[0]).json()["paymentInstructions"])

        with self.committed_where_a_request_on_another_connection_can_read_it():
            _prepare_current_company(alice)
            _current_company_decision(alice, alice)
        self.assertEqual(self.client.get(GLOBAL_ROUTES[0]).json()["paymentInstructions"], RAILS)

    def test_authority_requests_are_requester_only_for_company_staff_and_missing_reference_cases(self):
        from companies.tests.test_authority_requests import authority_fixture

        with self.as_an_operator_would():
            owner, profile, company = authority_fixture("matrix-authority", "112233445")
        self.client.force_authenticate(owner)
        created = self.client.post(
            COMPANY_AUTHORITY_ROUTES["create"][1],
            {
                "company": str(company.pk),
                "idempotency_key": str(uuid4()),
                "requested_capabilities": ["admin"],
                "file": SimpleUploadedFile("authority.pdf", pdf_bytes(), content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(created.status_code, 201, created.content)
        proposal_id = created.json()["uuid"]
        listing = COMPANY_AUTHORITY_ROUTES["list"][1]
        self.assertEqual([row["uuid"] for row in self.rows(self.client.get(listing))], [proposal_id])
        for name in ("detail", "file", "withdraw"):
            method = COMPANY_AUTHORITY_ROUTES[name][0]
            operation = getattr(self.client, method)
            path = COMPANY_AUTHORITY_ROUTES[name][1].format(uuid=proposal_id)
            self.assertEqual(operation(path, {}, format="json").status_code, 200)
            for actor in self.actors:
                self.client.force_authenticate(actor.user)
                denied = operation(path, {}, format="json")
                missing = operation(path.replace(proposal_id, str(uuid4())), {}, format="json")
                self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
                self.assertEqual(denied.status_code, 404)
                self.assertEqual(self.rows(self.client.get(listing)), [])
            self.client.force_authenticate(None)
            self.assertEqual(operation(path, {}, format="json").status_code, 401)
            self.assertEqual(self.client.get(listing).status_code, 401)
            self.client.force_authenticate(owner)
        self.client.force_authenticate(self.actors[0].user)
        refused = self.client.post(
            COMPANY_AUTHORITY_ROUTES["create"][1],
            {
                "company": str(company.pk),
                "idempotency_key": str(uuid4()),
                "requested_capabilities": ["admin"],
                "file": SimpleUploadedFile("authority.pdf", pdf_bytes(), content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(refused.status_code, 404, refused.content)

    def test_authority_admission_and_revocation_hide_foreign_requests_from_every_staff_role(self):
        from companies.services.authority import DECLARATION_VERSION
        from companies.tests.registry_fixtures import matching_observation
        from companies.tests.test_authority_requests import authority_fixture

        with self.as_an_operator_would():
            owner, profile, company = authority_fixture("matrix-admission", "112244668")
        self.client.force_authenticate(owner)
        created = self.client.post(
            COMPANY_AUTHORITY_ROUTES["create"][1],
            {
                "company": str(company.pk),
                "idempotency_key": str(uuid4()),
                "requested_capabilities": ["admin"],
                "file": SimpleUploadedFile("authority.pdf", pdf_bytes(), content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(created.status_code, 201, created.content)
        proposal_id = created.json()["uuid"]
        declaration = {"declaration_version": DECLARATION_VERSION, "accept_declaration": True}
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
            for name, body in (("admit", declaration), ("revoke", {})):
                path = COMPANY_AUTHORITY_ROUTES[name][1].format(uuid=proposal_id)
                for actor in self.actors:
                    self.client.force_authenticate(actor.user)
                    denied = self.client.post(path, body, format="json")
                    missing = self.client.post(path.replace(proposal_id, str(uuid4())), body, format="json")
                    self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
                    self.assertEqual(denied.status_code, 404)
                self.client.force_authenticate(None)
                self.assertEqual(self.client.post(path, body, format="json").status_code, 401)
                self.client.force_authenticate(owner)
                response = self.client.post(path, body, format="json")
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["status"], "admitted")
        self.assertEqual(response.json()["appointment"]["status"], "revoked")

    def initial_team_appointment(self, label, acn):
        from companies.services.authority import DECLARATION_VERSION
        from companies.tests.registry_fixtures import matching_observation
        from companies.tests.test_authority_requests import authority_fixture

        with self.as_an_operator_would():
            owner, profile, company = authority_fixture(label, acn)
            UserProfile.objects.filter(pk=profile.pk).update(is_id_verified=True)
        self.client.force_authenticate(owner)
        created = self.client.post(
            COMPANY_AUTHORITY_ROUTES["create"][1],
            {
                "company": str(company.pk),
                "idempotency_key": str(uuid4()),
                "requested_capabilities": ["admin"],
                "delegatable_capabilities": ["approve", "prepare"],
                "file": SimpleUploadedFile("authority.pdf", pdf_bytes(), content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(created.status_code, 201, created.content)
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
            admitted = self.client.post(
                COMPANY_AUTHORITY_ROUTES["admit"][1].format(uuid=created.json()["uuid"]),
                {"declaration_version": DECLARATION_VERSION, "accept_declaration": True},
                format="json",
            )
        self.assertEqual(admitted.status_code, 200, admitted.content)
        return owner, company, admitted.json()["appointment"]["uuid"], admitted.json()["uuid"]

    def test_team_routes_bind_company_source_and_appointee_without_exposing_foreign_history(self):
        from companies.services.authority import DECLARATION_VERSION

        owner, company, initial, proposal_id = self.initial_team_appointment("matrix-team", "114455668")
        invitee, foreign_company, foreign_initial, own_proposal_id = self.initial_team_appointment(
            "matrix-team-other", "225566779"
        )
        invitation_url = COMPANY_AUTHORITY_ROUTES["invitation_create"][1]
        own_url = COMPANY_AUTHORITY_ROUTES["appointment_list"][1]
        accept_url = COMPANY_AUTHORITY_ROUTES["invitation_accept"][1]
        team_url = COMPANY_AUTHORITY_ROUTES["appointment_team"][1]
        revoke_url = COMPANY_AUTHORITY_ROUTES["appointment_revoke"][1]
        payload = {
            "company": str(company.pk),
            "inviter_appointment": initial,
            "idempotency_key": str(uuid4()),
            "capabilities": ["prepare"],
            "delegatable_capabilities": ["approve"],
        }
        self.client.force_authenticate(owner)
        issued = self.client.post(invitation_url, payload, format="json")
        self.assertEqual(issued.status_code, 201, issued.content)
        invitation = issued.json()
        code = invitation.pop("code")
        self.assertEqual(issued["Cache-Control"], "private, no-store")
        invitation_fields = {
            "uuid",
            "company",
            "companyName",
            "inviterAppointment",
            "idempotencyKey",
            "capabilities",
            "delegatableCapabilities",
            "acceptanceDeadline",
            "appointmentExpiresAt",
            "createdAt",
            "acceptedAt",
        }
        self.assertEqual(set(invitation), invitation_fields)
        self.assertEqual(self.rows(self.client.get(invitation_url)), [invitation])
        self.assertEqual([row["uuid"] for row in self.rows(self.client.get(own_url))], [initial])
        for foreign, missing in (
            ({"company": str(foreign_company.pk)}, {"company": str(uuid4())}),
            ({"inviter_appointment": foreign_initial}, {"inviter_appointment": str(uuid4())}),
            (
                {"company": str(foreign_company.pk), "inviter_appointment": foreign_initial},
                {"company": str(uuid4()), "inviter_appointment": str(uuid4())},
            ),
        ):
            with self.subTest(foreign=foreign):
                denied = self.client.post(invitation_url, {**payload, **foreign}, format="json")
                absent = self.client.post(invitation_url, {**payload, **missing}, format="json")
                self.assertEqual((denied.status_code, denied.content), (absent.status_code, absent.content))
                self.assertEqual(denied.status_code, 404)

        self.client.force_authenticate(invitee)
        declaration = {"code": code, "declaration_version": DECLARATION_VERSION, "accept_declaration": True}
        for field, foreign in (
            ("company", str(foreign_company.pk)),
            ("inviter_appointment", foreign_initial),
            ("appointee", str(owner.pk)),
        ):
            with self.subTest(acceptance_field=field):
                denied = self.client.post(accept_url, {**declaration, field: foreign}, format="json")
                absent = self.client.post(accept_url, {**declaration, field: str(uuid4())}, format="json")
                self.assertEqual((denied.status_code, denied.content), (absent.status_code, absent.content))
                self.assertEqual(denied.status_code, 400)
        self.assertEqual(
            self.client.post(accept_url, {**declaration, "code": "a" * 43}, format="json").status_code, 404
        )
        with self.as_an_operator_would():
            self.assertEqual(CompanyTeamInvitation.objects.count(), 1)
            self.assertEqual(CompanyAppointment.objects.filter(legacy_owner__isnull=True).count(), 2)
            self.assertFalse(CompanyAppointmentRevocation.objects.exists())
        accepted = self.client.post(accept_url, declaration, format="json")
        self.assertEqual(accepted.status_code, 200, accepted.content)
        child = accepted.json()
        child_id = child["uuid"]
        own_fields = {
            "uuid",
            "company",
            "companyName",
            "capabilities",
            "delegatableCapabilities",
            "expiresAt",
            "createdAt",
            "revokedAt",
            "status",
            "isEffective",
            "source",
            "declarationVersion",
            "declarationText",
        }
        self.assertEqual(set(child), own_fields)
        self.assertEqual(
            (child["company"], child["source"], child["isEffective"]), (str(company.pk), "invitation", True)
        )
        self.assertEqual(child["capabilities"], ["prepare"])
        self.assertEqual(self.client.post(accept_url, declaration, format="json").json(), child)
        self.assertEqual({row["uuid"] for row in self.rows(self.client.get(own_url))}, {foreign_initial, child_id})
        self.assertEqual(self.rows(self.client.get(invitation_url)), [])
        self.assertEqual(
            [row["uuid"] for row in self.rows(self.client.get(COMPANY_AUTHORITY_ROUTES["list"][1]))],
            [own_proposal_id],
        )
        for name in ("detail", "file"):
            path = COMPANY_AUTHORITY_ROUTES[name][1]
            denied = self.client.get(path.format(uuid=proposal_id))
            absent = self.client.get(path.format(uuid=uuid4()))
            self.assertEqual((denied.status_code, denied.content), (absent.status_code, absent.content))
            self.assertEqual(denied.status_code, 404)
        denied = self.client.post(revoke_url.format(uuid=initial), {}, format="json")
        absent = self.client.post(revoke_url.format(uuid=uuid4()), {}, format="json")
        self.assertEqual((denied.status_code, denied.content), (absent.status_code, absent.content))
        self.assertEqual(denied.status_code, 404)
        denied = self.client.get(team_url.format(company=company.pk))
        absent = self.client.get(team_url.format(company=uuid4()))
        self.assertEqual((denied.status_code, denied.content), (absent.status_code, absent.content))
        self.assertEqual(denied.status_code, 404)
        self.assertEqual(
            {row["uuid"] for row in self.rows(self.client.get(team_url.format(company=foreign_company.pk)))},
            {foreign_initial},
        )

        with use_migrate():
            Company.objects.filter(pk=company.pk).update(owner=self.actors[0].user)
        for actor in self.actors:
            self.client.force_authenticate(actor.user)
            with self.subTest(actor=actor.label):
                self.assertEqual(self.rows(self.client.get(invitation_url)), [])
                history = self.rows(self.client.get(own_url))
                self.assertEqual(len(history), 1)
                self.assertEqual((history[0]["company"], history[0]["source"]), (str(actor.company.pk), "legacy_owner"))
                denied = self.client.post(invitation_url, payload, format="json")
                absent = self.client.post(
                    invitation_url, {**payload, "inviter_appointment": str(uuid4())}, format="json"
                )
                self.assertEqual((denied.status_code, denied.content), (absent.status_code, absent.content))
                self.assertEqual(denied.status_code, 404)
                denied = self.client.get(team_url.format(company=company.pk))
                absent = self.client.get(team_url.format(company=uuid4()))
                self.assertEqual((denied.status_code, denied.content), (absent.status_code, absent.content))
                self.assertEqual(denied.status_code, 404)
                for target in (initial, child_id):
                    denied = self.client.post(revoke_url.format(uuid=target), {}, format="json")
                    absent = self.client.post(revoke_url.format(uuid=uuid4()), {}, format="json")
                    self.assertEqual((denied.status_code, denied.content), (absent.status_code, absent.content))
                    self.assertEqual(denied.status_code, 404)
                self.assertEqual(self.client.post(accept_url, declaration, format="json").status_code, 400)
        with self.as_an_operator_would():
            self.assertEqual(CompanyAppointment.objects.filter(legacy_owner__isnull=True).count(), 3)
            self.assertFalse(CompanyAppointmentRevocation.objects.exists())

        self.client.force_authenticate(owner)
        listed = self.rows(self.client.get(invitation_url))
        self.assertEqual([row["uuid"] for row in listed], [invitation["uuid"]])
        self.assertEqual(set(listed[0]), invitation_fields)
        self.assertIsNotNone(listed[0]["acceptedAt"])
        self.assertNotIn(code, str(listed))
        self.assertEqual([row["uuid"] for row in self.rows(self.client.get(own_url))], [initial])
        team = self.client.get(team_url.format(company=company.pk))
        self.assertEqual(team.status_code, 200, team.content)
        team_fields = {
            "uuid",
            "company",
            "name",
            "email",
            "capabilities",
            "delegatableCapabilities",
            "expiresAt",
            "createdAt",
            "revokedAt",
            "status",
            "isEffective",
            "source",
        }
        self.assertEqual({row["uuid"] for row in team.json()}, {initial, child_id})
        self.assertEqual({row["email"] for row in team.json()}, {owner.email, invitee.email})
        for row in team.json():
            self.assertEqual(set(row), team_fields)
            self.assertEqual(row["company"], str(company.pk))
        denied = self.client.get(team_url.format(company=foreign_company.pk))
        absent = self.client.get(team_url.format(company=uuid4()))
        self.assertEqual((denied.status_code, denied.content), (absent.status_code, absent.content))
        self.assertEqual(denied.status_code, 404)
        denied = self.client.post(revoke_url.format(uuid=foreign_initial), {}, format="json")
        absent = self.client.post(revoke_url.format(uuid=uuid4()), {}, format="json")
        self.assertEqual((denied.status_code, denied.content), (absent.status_code, absent.content))
        self.assertEqual(denied.status_code, 404)
        revoked = self.client.post(revoke_url.format(uuid=child_id), {}, format="json")
        self.assertEqual(revoked.status_code, 200, revoked.content)
        self.assertEqual(revoked.json()["status"], "revoked")
        self.assertFalse(revoked.json()["isEffective"])
        self.client.force_authenticate(invitee)
        retry = self.client.post(revoke_url.format(uuid=child_id), {}, format="json")
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.json(), revoked.json())
        own_revoked = self.client.post(revoke_url.format(uuid=foreign_initial), {}, format="json")
        self.assertEqual(own_revoked.status_code, 200, own_revoked.content)
        self.assertEqual(own_revoked.json()["status"], "revoked")
        self.assertEqual({row["uuid"] for row in self.rows(self.client.get(own_url))}, {foreign_initial, child_id})
        with self.as_an_operator_would():
            self.assertEqual(CompanyTeamInvitation.objects.count(), 1)
            self.assertEqual(CompanyAppointment.objects.filter(legacy_owner__isnull=True).count(), 3)
            self.assertEqual(CompanyAppointmentRevocation.objects.count(), 2)
            self.assertEqual(CompanyAppointmentRevocation.objects.get(appointment_id=child_id).revoked_by_id, owner.pk)

        self.client.force_authenticate(None)
        for name, body in (
            ("invitation_create", payload),
            ("invitation_list", {}),
            ("invitation_accept", declaration),
            ("appointment_list", {}),
            ("appointment_team", {}),
            ("appointment_revoke", {}),
        ):
            method, path = COMPANY_AUTHORITY_ROUTES[name]
            response = getattr(self.client, method)(path.format(company=company.pk, uuid=child_id), body, format="json")
            self.assertEqual(response.status_code, 401, response.content)

    @override_settings(
        STORAGES={
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
        }
    )
    def test_register_correction_routes_keep_evidence_private_and_decisions_company_bound(self):
        from tokens.models import RegisterCorrection
        from tokens.tests.test_register_corrections import (
            correction_fixture,
            correction_payload,
        )

        with self.as_an_operator_would():
            owner, _, appointment, issue, evidence = correction_fixture()
        self.client.force_authenticate(owner)
        payload = correction_payload(issue, evidence, appointment)
        response = self.client.post(REGISTER_CORRECTION_ROUTES["create"][1], payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        proposal_id = response.json()["uuid"]
        listing = REGISTER_CORRECTION_ROUTES["list"][1]
        self.assertEqual([row["uuid"] for row in self.rows(self.client.get(listing))], [proposal_id])
        for name in ("detail", "file"):
            path = REGISTER_CORRECTION_ROUTES[name][1].format(uuid=proposal_id)
            self.assertEqual(self.client.get(path).status_code, 200)
            for actor in self.actors:
                self.client.force_authenticate(actor.user)
                denied = self.client.get(path)
                missing = self.client.get(path.replace(proposal_id, str(uuid4())))
                self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
                self.assertEqual(denied.status_code, 404)
                self.assertEqual(self.rows(self.client.get(listing)), [])
            self.client.force_authenticate(None)
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(listing).status_code, 401)
            self.client.force_authenticate(owner)
        decision = {"appointment": str(appointment.pk), "kind": "approve"}
        bodies = {
            "decision_preview": decision,
            "decide": {**decision, "idempotency_key": str(uuid4()), "preview_digest": "0" * 64, "confirmation": True},
        }
        for name, body in bodies.items():
            path = REGISTER_CORRECTION_ROUTES[name][1].format(uuid=proposal_id)
            for actor in self.actors:
                self.client.force_authenticate(actor.user)
                denied = self.client.post(path, body, format="json")
                missing = self.client.post(path.replace(proposal_id, str(uuid4())), body, format="json")
                self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
                self.assertEqual(denied.status_code, 404)
            self.client.force_authenticate(None)
            self.assertEqual(self.client.post(path, body, format="json").status_code, 401)
        for actor in self.actors:
            self.client.force_authenticate(actor.user)
            denied = self.client.post(REGISTER_CORRECTION_ROUTES["create"][1], payload, format="json")
            self.assertEqual(denied.status_code, 404, denied.content)
        self.client.force_authenticate(owner)
        preview = self.client.post(
            REGISTER_CORRECTION_ROUTES["decision_preview"][1].format(uuid=proposal_id), decision, format="json"
        )
        self.assertEqual(preview.status_code, 200, preview.content)
        approved = self.client.post(
            REGISTER_CORRECTION_ROUTES["decide"][1].format(uuid=proposal_id),
            {
                **decision,
                "idempotency_key": str(uuid4()),
                "preview_digest": preview.json()["previewDigest"],
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual((approved.status_code, approved.json()["stage"]), (200, "approved"), approved.content)
        self.client.force_authenticate(None)
        evidence_path = reverse("admin:tokens_registercorrection_evidence", args=[proposal_id])
        for actor, expected in zip(self.actors, (302, 403, 200)):
            self.client.force_login(actor.user)
            self.assertEqual(self.client.get(evidence_path).status_code, expected)
            self.client.logout()
        with self.as_an_operator_would():
            self.assertEqual(RegisterCorrection.objects.get(pk=proposal_id).status, "submitted")

    @override_settings(
        STORAGES={
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
        },
        **SETTINGS,
    )
    def test_register_opening_routes_keep_evidence_private_and_review_operator_only(self):
        from tokens.models import RegisterOpening
        from tokens.tests.test_register_openings import opening_fixture, opening_payload

        with self.as_an_operator_would():
            tenant, owner, reviewer, document, target, node = opening_fixture()
        with (
            patch("tokens.services.register_openings.get_base_chain_client", return_value=node.client),
            patch("tokens.services.register_snapshot.get_base_chain_client", return_value=node.client),
        ):
            self.client.force_authenticate(owner)
            payload = opening_payload(document, target)
            response = self.client.post(REGISTER_OPENING_ROUTES["create"][1], payload, format="json")
            self.assertEqual(response.status_code, 201, response.content)
            proposal_id = response.json()["uuid"]
            listing = REGISTER_OPENING_ROUTES["list"][1]
            self.assertEqual([row["uuid"] for row in self.rows(self.client.get(listing))], [proposal_id])
            for name in ("detail", "file"):
                path = REGISTER_OPENING_ROUTES[name][1].format(uuid=proposal_id)
                self.assertEqual(self.client.get(path).status_code, 200)
                for actor in self.actors:
                    self.client.force_authenticate(actor.user)
                    denied = self.client.get(path)
                    missing = self.client.get(path.replace(proposal_id, str(uuid4())))
                    self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
                    self.assertEqual(denied.status_code, 404)
                    self.assertEqual(self.rows(self.client.get(listing)), [])
                self.client.force_authenticate(None)
                self.assertEqual(self.client.get(path).status_code, 401)
                self.assertEqual(self.client.get(listing).status_code, 401)
                self.client.force_authenticate(owner)
            self.client.force_authenticate(self.actors[0].user)
            self.assertEqual(
                self.client.post(REGISTER_OPENING_ROUTES["create"][1], payload, format="json").status_code, 404
            )
            self.client.force_authenticate(None)
            review = reverse("admin:tokens_registeropening_review", args=[proposal_id])
            evidence = reverse("admin:tokens_registeropening_evidence", args=[proposal_id])
            for actor, expected in zip(self.actors, (302, 403, 200)):
                self.client.force_login(actor.user)
                response = self.client.get(review)
                self.assertEqual(response.status_code, expected)
                self.assertEqual(self.client.get(evidence).status_code, expected)
                confirmation = response.context["form"].initial["confirmation"] if expected == 200 else "forged"
                response = self.client.post(
                    review, {"confirmation": confirmation, "reviewed": "on", "decision": "apply"}
                )
                self.assertEqual(response.status_code, 302 if expected == 200 else expected)
                with self.as_an_operator_would():
                    self.assertEqual(
                        RegisterOpening.objects.get(pk=proposal_id).status,
                        "applied" if expected == 200 else "submitted",
                    )
                self.client.logout()

    @override_settings(
        STORAGES={
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
        }
    )
    def test_register_link_routes_keep_evidence_private_and_review_operator_only(self):
        from tokens.models import RegisterWalletLink
        from tokens.tests.test_register_links import link_fixture, link_payload

        with self.as_an_operator_would():
            owner, company, _, _, document = link_fixture()
        self.client.force_authenticate(owner)
        payload = link_payload(company, document)
        response = self.client.post(REGISTER_LINK_ROUTES["create"][1], payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        proposal_id = response.json()["uuid"]
        listing = REGISTER_LINK_ROUTES["list"][1]
        self.assertEqual([row["uuid"] for row in self.rows(self.client.get(listing))], [proposal_id])
        for name in ("detail", "file"):
            path = REGISTER_LINK_ROUTES[name][1].format(uuid=proposal_id)
            self.assertEqual(self.client.get(path).status_code, 200)
            for actor in self.actors:
                self.client.force_authenticate(actor.user)
                denied = self.client.get(path)
                missing = self.client.get(path.replace(proposal_id, str(uuid4())))
                self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
                self.assertEqual(denied.status_code, 404)
                self.assertEqual(self.rows(self.client.get(listing)), [])
            self.client.force_authenticate(None)
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(listing).status_code, 401)
            self.client.force_authenticate(owner)
        self.client.force_authenticate(self.actors[0].user)
        self.assertEqual(self.client.post(REGISTER_LINK_ROUTES["create"][1], payload, format="json").status_code, 404)
        self.client.force_authenticate(None)
        review = reverse("admin:tokens_registerwalletlink_review", args=[proposal_id])
        evidence = reverse("admin:tokens_registerwalletlink_evidence", args=[proposal_id])
        for actor, expected in zip(self.actors, (302, 403, 200)):
            self.client.force_login(actor.user)
            response = self.client.get(review)
            self.assertEqual(response.status_code, expected)
            self.assertEqual(self.client.get(evidence).status_code, expected)
            confirmation = response.context["form"].initial["confirmation"] if expected == 200 else "forged"
            response = self.client.post(review, {"confirmation": confirmation, "reviewed": "on", "decision": "apply"})
            self.assertEqual(response.status_code, 302 if expected == 200 else expected)
            with self.as_an_operator_would():
                self.assertEqual(
                    RegisterWalletLink.objects.get(pk=proposal_id).status,
                    "applied" if expected == 200 else "submitted",
                )
            self.client.logout()

    @override_settings(
        STORAGES={
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
        }
    )
    def test_register_import_routes_keep_evidence_private_and_decisions_company_bound(self):
        from tokens.models import RegisterImport
        from tokens.tests.test_register_imports import (
            DOCUMENT_BYTES,
            import_fixture,
            import_payload,
            stated,
        )

        with self.as_an_operator_would():
            owner, company, token, member, appointment, register_copy, asic, _ = import_fixture()
        self.client.force_authenticate(owner)
        payload = stated(import_payload(token, register_copy, asic, member, appointment))
        response = self.client.post(REGISTER_IMPORT_ROUTES["create"][1], payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        proposal_id = response.json()["uuid"]
        listing = REGISTER_IMPORT_ROUTES["list"][1]
        self.assertEqual([row["uuid"] for row in self.rows(self.client.get(listing))], [proposal_id])
        for name in ("detail", "file", "asic_file"):
            path = REGISTER_IMPORT_ROUTES[name][1].format(uuid=proposal_id)
            self.assertEqual(self.client.get(path).status_code, 200)
            for actor in self.actors:
                self.client.force_authenticate(actor.user)
                denied = self.client.get(path)
                missing = self.client.get(path.replace(proposal_id, str(uuid4())))
                self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
                self.assertEqual(denied.status_code, 404)
                self.assertEqual(self.rows(self.client.get(listing)), [])
            self.client.force_authenticate(None)
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(listing).status_code, 401)
            self.client.force_authenticate(owner)
        decision = {"appointment": str(appointment.pk), "kind": "approve"}
        bodies = {
            "decision_preview": decision,
            "decide": {**decision, "idempotency_key": str(uuid4()), "preview_digest": "0" * 64, "confirmation": True},
        }
        for name, body in bodies.items():
            path = REGISTER_IMPORT_ROUTES[name][1].format(uuid=proposal_id)
            for actor in self.actors:
                self.client.force_authenticate(actor.user)
                denied = self.client.post(path, body, format="json")
                missing = self.client.post(path.replace(proposal_id, str(uuid4())), body, format="json")
                self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
                self.assertEqual(denied.status_code, 404)
            self.client.force_authenticate(None)
            self.assertEqual(self.client.post(path, body, format="json").status_code, 401)
        upload = {
            "company_id": str(company.pk),
            "appointment": str(appointment.pk),
            "kind": "share_register",
            "idempotency_key": str(uuid4()),
        }
        for actor in self.actors:
            self.client.force_authenticate(actor.user)
            denied = self.client.post(
                REGISTER_IMPORT_ROUTES["evidence"][1],
                {**upload, "file": SimpleUploadedFile("register.pdf", DOCUMENT_BYTES, content_type="application/pdf")},
                format="multipart",
            )
            self.assertEqual(denied.status_code, 404, denied.content)
            self.assertEqual(
                self.client.post(REGISTER_IMPORT_ROUTES["create"][1], payload, format="json").status_code, 404
            )
        self.client.force_authenticate(owner)
        preview = self.client.post(
            REGISTER_IMPORT_ROUTES["decision_preview"][1].format(uuid=proposal_id), decision, format="json"
        )
        self.assertEqual(preview.status_code, 200, preview.content)
        approved = self.client.post(
            REGISTER_IMPORT_ROUTES["decide"][1].format(uuid=proposal_id),
            {
                **decision,
                "idempotency_key": str(uuid4()),
                "preview_digest": preview.json()["previewDigest"],
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual((approved.status_code, approved.json()["stage"]), (200, "approved"), approved.content)
        self.client.force_authenticate(None)
        for name in ("evidence", "asic"):
            path = reverse(f"admin:tokens_registerimport_{name}", args=[proposal_id])
            for actor, expected in zip(self.actors, (302, 403, 200)):
                self.client.force_login(actor.user)
                self.assertEqual(self.client.get(path).status_code, expected)
                self.client.logout()
        with self.as_an_operator_would():
            self.assertEqual(RegisterImport.objects.get(pk=proposal_id).status, "submitted")

    def test_register_reconciliation_routes_keep_rows_and_acknowledgements_company_bound(self):
        from tokens.models import RegisterAcknowledgement
        from tokens.tests.test_register_acknowledgement_authority import (
            acknowledgement_fixture,
            reconciled,
        )

        with self.as_an_operator_would():
            owner, _, token, member, appointment = acknowledgement_fixture()
            record_id = str(reconciled(token, member).pk)
        listing = REGISTER_RECONCILIATION_ROUTES["list"][1]
        detail = REGISTER_RECONCILIATION_ROUTES["detail"][1].format(uuid=record_id)
        acknowledge = REGISTER_RECONCILIATION_ROUTES["acknowledge"][1].format(uuid=record_id)
        body = {
            "appointment": str(appointment.pk),
            "discrepancy": 0,
            "reason": "Accepted by the directors",
            "idempotency_key": str(uuid4()),
        }
        requests = (
            lambda path: self.client.get(path),
            lambda path: self.client.post(path, body, format="json"),
        )
        self.client.force_authenticate(owner)
        self.assertEqual([row["uuid"] for row in self.rows(self.client.get(listing))], [record_id])
        self.assertEqual(self.client.get(detail).status_code, 200)
        for actor in self.actors:
            self.client.force_authenticate(actor.user)
            for send, path in zip(requests, (detail, acknowledge)):
                denied = send(path)
                missing = send(path.replace(record_id, str(uuid4())))
                self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
                self.assertEqual(denied.status_code, 404)
            self.assertEqual(self.rows(self.client.get(listing)), [])
        self.client.force_authenticate(None)
        for send, path in zip((*requests, requests[0]), (detail, acknowledge, listing)):
            self.assertEqual(send(path).status_code, 401)
        with self.as_an_operator_would():
            self.assertFalse(RegisterAcknowledgement.objects.exists())
        self.client.force_authenticate(owner)
        acknowledged = requests[1](acknowledge)
        self.assertEqual(acknowledged.status_code, 201, acknowledged.content)
        with self.as_an_operator_would():
            self.assertEqual(RegisterAcknowledgement.objects.get().acknowledged_by_id, owner.pk)

    @override_settings(
        STORAGES={
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
        }
    )
    def test_register_instruction_routes_keep_evidence_private_and_review_operator_only(self):
        from tokens.models import RegisterInstruction, RequestStatus, ShareToken
        from tokens.tests.instruction_fixtures import instruction_payload
        from tokens.tests.test_register_links import link_fixture

        with self.as_an_operator_would():
            owner, company, _, _, document = link_fixture()
            token = ShareToken.objects.get(company=company)
            request = ShareIssuanceRequest.objects.create(
                token=token, recipient_address="0x" + "3c" * 20, amount=5, reason="Allotment"
            )
        self.client.force_authenticate(owner)
        payload = instruction_payload(token, document, [request])
        response = self.client.post(REGISTER_INSTRUCTION_ROUTES["create"][1], payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        proposal_id = response.json()["uuid"]
        listing = REGISTER_INSTRUCTION_ROUTES["list"][1]
        self.assertEqual([row["uuid"] for row in self.rows(self.client.get(listing))], [proposal_id])
        for name in ("detail", "file"):
            path = REGISTER_INSTRUCTION_ROUTES[name][1].format(uuid=proposal_id)
            self.assertEqual(self.client.get(path).status_code, 200)
            for actor in self.actors:
                self.client.force_authenticate(actor.user)
                denied = self.client.get(path)
                missing = self.client.get(path.replace(proposal_id, str(uuid4())))
                self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
                self.assertEqual(denied.status_code, 404)
                self.assertEqual(self.rows(self.client.get(listing)), [])
            self.client.force_authenticate(None)
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(listing).status_code, 401)
            self.client.force_authenticate(owner)
        self.client.force_authenticate(self.actors[0].user)
        self.assertEqual(
            self.client.post(REGISTER_INSTRUCTION_ROUTES["create"][1], payload, format="json").status_code, 404
        )
        self.client.force_authenticate(None)
        review = reverse("admin:tokens_registerinstruction_review", args=[proposal_id])
        evidence = reverse("admin:tokens_registerinstruction_evidence", args=[proposal_id])
        for actor, expected in zip(self.actors, (302, 403, 200)):
            self.client.force_login(actor.user)
            response = self.client.get(review)
            self.assertEqual(response.status_code, expected)
            self.assertEqual(self.client.get(evidence).status_code, expected)
            confirmation = response.context["form"].initial["confirmation"] if expected == 200 else "forged"
            response = self.client.post(review, {"confirmation": confirmation, "reviewed": "on", "decision": "apply"})
            self.assertEqual(response.status_code, 302 if expected == 200 else expected)
            with self.as_an_operator_would():
                self.assertEqual(
                    RegisterInstruction.objects.get(pk=proposal_id).status,
                    "applied" if expected == 200 else "submitted",
                )
                self.assertEqual(
                    ShareIssuanceRequest.objects.get(pk=request.pk).status,
                    RequestStatus.APPROVED if expected == 200 else RequestStatus.SUBMITTED,
                )
            self.client.logout()

    @override_settings(
        STORAGES={
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
        }
    )
    def test_publication_routes_reach_the_member_and_the_company_and_nobody_else(self):
        from shareholders.tests.fixtures import a_company_with_members, published

        with self.committed_where_a_request_on_another_connection_can_read_it():
            world = a_company_with_members("matrix-publications")
            publication = published(world)
        listing = PUBLICATION_ROUTES["list"][1]
        path = PUBLICATION_ROUTES["file"][1].format(uuid=publication.pk)
        for entitled in (world.members[0].user, world.owner):
            self.client.force_authenticate(entitled)
            self.assertEqual([row["uuid"] for row in self.rows(self.client.get(listing))], [str(publication.pk)])
            self.assertEqual(self.client.get(path).status_code, 200)
        for actor in self.actors:
            self.client.force_authenticate(actor.user)
            denied = self.client.get(path)
            missing = self.client.get(path.replace(str(publication.pk), str(uuid4())))
            self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
            self.assertEqual(denied.status_code, 404)
            self.assertEqual(self.rows(self.client.get(listing)), [])
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.get(listing).status_code, 401)

    def test_the_ballot_route_takes_a_ballot_from_a_member_on_the_roll_and_from_nobody_else(self):
        from shareholders.models import PublicationEvent
        from shareholders.tests.fixtures import a_company_with_members, a_resolution

        with self.committed_where_a_request_on_another_connection_can_read_it():
            world = a_company_with_members("matrix-ballot")
            resolution = a_resolution(world)
        path = PUBLICATION_ROUTES["ballot"][1].format(uuid=resolution.pk)
        ballot = {"choice": "for"}
        for actor in (world.owner, *(tenant.user for tenant in self.actors)):
            self.client.force_authenticate(actor)
            denied = self.client.post(path, ballot, format="json")
            missing = self.client.post(path.replace(str(resolution.pk), str(uuid4())), ballot, format="json")
            self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
            self.assertEqual(denied.status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(path, ballot, format="json").status_code, 401)
        with self.as_an_operator_would():
            self.assertFalse(PublicationEvent.objects.filter(publication=resolution).exists())
        member = world.members[0].user
        self.client.force_authenticate(member)
        cast = self.client.post(path, ballot, format="json")
        self.assertEqual(cast.status_code, 200, cast.content)
        self.assertEqual(cast.json()["myBallot"]["choice"], "for")
        with self.as_an_operator_would():
            self.assertEqual(
                list(PublicationEvent.objects.filter(publication=resolution).values_list("actor_id", "choice")),
                [(member.pk, "for")],
            )

    def test_the_publication_summary_counts_what_was_published_to_the_caller_and_nothing_of_another_company(self):
        from shareholders.tests.fixtures import (
            a_company_with_members,
            a_distribution,
            a_resolution,
            published,
        )

        with self.committed_where_a_request_on_another_connection_can_read_it():
            here = a_company_with_members("matrix-summary-here")
            there = a_company_with_members("matrix-summary-there")
            published(here)
            a_resolution(here)
            a_distribution(here)
            a_resolution(there)
            a_resolution(there)
        path = PUBLICATION_ROUTES["summary"][1]
        nothing = {"openResolutions": 0, "nextClosesAt": None, "dividendsWithoutRecord": 0}
        counted = {}
        for member in (here.members[0].user, there.members[0].user):
            self.client.force_authenticate(member)
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, response.content)
            counted[member.pk] = {key: value for key, value in response.json().items() if key != "nextClosesAt"}
        self.assertEqual(
            counted,
            {
                here.members[0].user.pk: {"openResolutions": 1, "dividendsWithoutRecord": 1},
                there.members[0].user.pk: {"openResolutions": 2, "dividendsWithoutRecord": 0},
            },
        )
        for actor in (here.owner, there.owner, *(tenant.user for tenant in self.actors)):
            self.client.force_authenticate(actor)
            self.assertEqual(self.client.get(path).json(), nothing)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(path).status_code, 401)

    def test_the_listing_addressed_to_the_caller_reaches_the_member_and_neither_the_issuer_nor_anyone_else(self):
        from shareholders.tests.fixtures import a_company_with_members, a_distribution

        with self.committed_where_a_request_on_another_connection_can_read_it():
            world = a_company_with_members("matrix-addressed")
            dividend = a_distribution(world)
        listing = PUBLICATION_ROUTES["list"][1]
        addressed = {"kind": "distribution", "addressed": "me"}
        self.client.force_authenticate(world.owner)
        self.assertEqual(
            [row["uuid"] for row in self.rows(self.client.get(listing, {"kind": "distribution"}))], [str(dividend.pk)]
        )
        self.assertEqual(self.rows(self.client.get(listing, addressed)), [])
        self.client.force_authenticate(world.members[0].user)
        self.assertEqual([row["uuid"] for row in self.rows(self.client.get(listing, addressed))], [str(dividend.pk)])
        for actor in self.actors:
            self.client.force_authenticate(actor.user)
            self.assertEqual(self.rows(self.client.get(listing, addressed)), [])
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(listing, addressed).status_code, 401)

    @override_settings(
        STORAGES={
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
        }
    )
    def test_document_review_refuses_tenants_and_unprivileged_staff_and_admits_the_operator(self):
        self.client.force_authenticate(None)
        with self.as_an_operator_would():
            document = attach_file(make_document(self.other.company))
        path = reverse("admin:companies_companydocument_verify", args=[document.pk])
        for actor, expected in zip(self.actors, (302, 403, 200)):
            self.client.force_login(actor.user)
            response = self.client.get(path)
            self.assertEqual(response.status_code, expected)
            with self.as_an_operator_would():
                self.assertFalse(CompanyDocument.objects.get(pk=document.pk).is_verified)
            confirmation = response.context["form"].initial["confirmation"] if expected == 200 else "forged"
            response = self.client.post(path, {"confirmation": confirmation, "reviewed": "on"})
            self.assertEqual(response.status_code, 302 if expected == 200 else expected)
            with self.as_an_operator_would():
                self.assertEqual(CompanyDocument.objects.get(pk=document.pk).is_verified, expected == 200)
            self.client.logout()

    @override_settings(
        STORAGES={
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
        }
    )
    def test_registry_admin_actions_refuse_tenant_and_unprivileged_staff_and_admit_the_operator(self):
        self.client.force_authenticate(None)
        with patch(
            "companies.services.registry.lookup_company", return_value=RegistryObservation(reason="unconfigured")
        ) as provider:
            for actor, expected in zip(self.actors, (302, 403, 200)):
                self.client.force_login(actor.user)
                for action, predecessor, successor in REGISTRY_ADMIN_ROUTES:
                    with self.subTest(actor=actor.label, action=action):
                        with use_migrate():
                            Company.objects.filter(pk=self.other.company.pk).update(status=predecessor)
                            before = CompanyRegistryCheck.objects.count()
                        path = reverse("admin:companies_company_transition", args=[self.other.company.pk, action])
                        page = self.client.get(path)
                        self.assertEqual(page.status_code, expected)
                        with self.as_an_operator_would():
                            self.assertEqual(Company.objects.get(pk=self.other.company.pk).status, predecessor)
                            self.assertEqual(CompanyRegistryCheck.objects.count(), before)
                        response = self.client.post(path, {"confirm": True, **DECLARATION})
                        self.assertEqual(response.status_code, 302 if expected == 200 else expected)
                        with self.as_an_operator_would():
                            current = Company.objects.get(pk=self.other.company.pk)
                            self.assertEqual(current.status, successor if expected == 200 else predecessor)
                            if expected == 200:
                                self.assertEqual(CompanyRegistryCheck.objects.count(), before + 1)
                            else:
                                self.assertEqual(CompanyRegistryCheck.objects.count(), before)
                self.client.logout()
            self.assertEqual(provider.call_count, len(REGISTRY_ADMIN_ROUTES))


ACTION_ROUTES = (
    Route("get", "/api/v1/trading/orders/{order}/action-context/?owner_account_uuid={account}"),
    Route("get", "/api/v1/trading/orders/actions/{action}/?owner_account_uuid={account}"),
    Route("post", "/api/v1/trading/orders/{order}/cancel/message/"),
    Route("post", "/api/v1/trading/orders/{order}/modify/message/"),
    Route("post", "/api/v1/trading/orders/{order}/cancel/"),
    Route("post", "/api/v1/trading/orders/{order}/modify/"),
)


class OrderActionRouteChecks(ActionFixtures):
    def setUp(self):
        super().setUp()
        self.cancel_order = self.order
        self.cancel_signed = self.signed()
        with use_migrate():
            self.order = TransferOrder.objects.create(
                token=self.order.token,
                payment_asset=self.order.payment_asset,
                wallet=self.wallet,
                owner_account=self.tenant.account,
                wallet_address=self.wallet.address,
                order_type="buy",
                quantity=10,
                price_per_share=Decimal("2.50"),
            )
        with use_operator():
            self.other = make_tenant("action-matrix-other")
        self.action_id = uuid4()
        self.modify_signed = self.signed("modify", self.modify_body())

    def request_route(self, route, missing=False):
        modify = "/modify" in route.path
        signed = self.modify_signed if modify else self.cancel_signed
        order = self.order if modify else self.cancel_order
        context = {
            "order": str(uuid4() if missing else order.pk),
            "account": str(self.tenant.account.pk),
            "action": str(uuid4() if missing else signed["action_id"]),
        }
        body = {**signed, "action_id": context["action"]}
        if modify and "/message/" in route.path:
            body = {**self.modify_body(), **body}
        return getattr(self.client, route.method)(
            route.path.format_map(context), body if route.method == "post" else None, format="json"
        )

    def test_owned_action_routes_reach_the_real_service(self):
        for route in ACTION_ROUTES:
            with self.subTest(method=route.method, path=route.path):
                response = self.request_route(route)
                self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([event for event, _ in self.events], ["order_cancelled", "order_modified"])

    def test_foreign_and_missing_actions_stay_hidden_for_regular_staff_and_superusers(self):
        for staff, superuser in ((False, False), (True, False), (True, True)):
            with use_operator():
                self.other.user.is_staff = staff
                self.other.user.is_superuser = superuser
                self.other.user.save(update_fields=["is_staff", "is_superuser"])
            self.client.force_authenticate(self.other.user)
            for route in ACTION_ROUTES:
                with self.subTest(staff=staff, superuser=superuser, path=route.path, method=route.method):
                    foreign = self.request_route(route)
                    missing = self.request_route(route, missing=True)
                    self.assertEqual(foreign.status_code, route.foreign, foreign.content)
                    self.assertEqual(missing.status_code, route.foreign, missing.content)
                    self.assertEqual(foreign.json(), missing.json())
        self.assert_pending(self.cancel_signed)
        self.assert_pending(self.modify_signed)
        self.client.force_authenticate(self.tenant.user)
        for signed, purpose, order in (
            (self.cancel_signed, "cancel", self.cancel_order),
            (self.modify_signed, "modify", self.order),
        ):
            self.assertEqual(self.execute(purpose, signed, order).status_code, 200)

    def test_all_action_routes_refuse_anonymous_and_recover_after_authentication(self):
        self.client.force_authenticate(None)
        for route in ACTION_ROUTES:
            with self.subTest(method=route.method, path=route.path):
                response = self.request_route(route)
                self.assertEqual(response.status_code, 401, response.content)
        self.client.force_authenticate(self.tenant.user)
        self.assertEqual(self.context().status_code, 200)
        self.assertEqual(self.recover().status_code, 200)


class OrderActionRouteMatrixTest(OrderActionRouteChecks, APITransactionTestCase):
    pass


class ScopedOrderActionRouteMatrixTest(RunsOnTheScopedConnection, OrderActionRouteChecks, APITransactionTestCase):
    pass


ELIGIBILITY_ROUTES = (
    Route("get", "/api/v1/companies/{company}/eligibility-requests/"),
    Route("get", "/api/v1/company-eligibility/requests/{eligibility_request}/"),
    Route("post", "/api/v1/company-eligibility/requests/{eligibility_request}/withdraw/"),
    Route("get", "/api/v1/companies/{company}/eligibility-requests/{eligibility_request}/"),
    Route("post", "/api/v1/companies/{company}/eligibility-requests/{eligibility_request}/decision-preview/"),
    Route("post", "/api/v1/companies/{company}/eligibility-requests/{eligibility_request}/decide/"),
    Route("post", "/api/v1/companies/{company}/eligibility-requests/{eligibility_request}/revoke/"),
)


class CompanyEligibilityRouteChecks(CompanyEligibilityCases, StubUploadDependencies):
    def setUp(self):
        super().setUp()
        self.proposal, _ = self.created_request()

    def request_eligibility_route(self, route, *, missing=False):
        context = {
            "company": str(uuid4() if missing and "{eligibility_request}" not in route.path else self.company.pk),
            "eligibility_request": str(uuid4() if missing else self.proposal.pk),
        }
        if route.method == "get":
            return self.client.get(route.path.format_map(context))
        body = {"idempotency_key": str(uuid4())}
        if "/eligibility-requests/" in route.path:
            body = {**body, **self.decision_terms(), "preview_digest": "a" * 64}
        return self.client.post(route.path.format_map(context), body, format="json")

    def test_every_retained_eligibility_detail_and_action_hides_foreign_and_missing_rows(self):
        for staff, superuser in ((False, False), (True, False), (True, True)):
            with use_migrate():
                self.other.is_staff = staff
                self.other.is_superuser = superuser
                self.other.save(update_fields=["is_staff", "is_superuser"])
            self.client.force_authenticate(self.other)
            for route in ELIGIBILITY_ROUTES:
                with self.subTest(staff=staff, superuser=superuser, path=route.path):
                    foreign = self.request_eligibility_route(route)
                    missing = self.request_eligibility_route(route, missing=True)
                    self.assertEqual(foreign.status_code, 404, foreign.content)
                    self.assertEqual(missing.status_code, 404, missing.content)
                    self.assertEqual(foreign.json(), missing.json())
        with use_operator():
            self.proposal.refresh_from_db()
            self.assertIsNone(getattr(self.proposal, "decision", None))
            self.assertIsNone(getattr(self.proposal, "withdrawal", None))
        self.client.force_authenticate(self.participant)
        self.assertEqual(self.client.get(f"/api/v1/company-eligibility/requests/{self.proposal.pk}/").status_code, 200)

    def test_every_eligibility_detail_and_action_refuses_anonymous_and_recovers_with_authority(self):
        self.client.force_authenticate(None)
        for route in ELIGIBILITY_ROUTES:
            with self.subTest(path=route.path):
                response = self.request_eligibility_route(route)
                self.assertEqual(response.status_code, 401, response.content)
        self.client.force_authenticate(self.approver)
        response = self.decision_preview(self.proposal)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["canDecide"])


class CompanyEligibilityRouteMatrixTest(CompanyEligibilityRouteChecks, APITransactionTestCase):
    pass


class ScopedCompanyEligibilityRouteMatrixTest(
    RunsOnTheScopedConnection, CompanyEligibilityRouteChecks, APITransactionTestCase
):
    pass

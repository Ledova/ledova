from rest_framework.routers import DefaultRouter

from tokens import views
from tokens.views.member_access import (
    MemberAssociationViewSet,
    MemberCertificateRequestViewSet,
    MemberInvitationViewSet,
    MemberParticularsRequestViewSet,
    MemberRecordViewSet,
)
from tokens.views.register_allotment import RegisterAllotmentViewSet
from tokens.views.register_award import (
    RegisterAwardEndViewSet,
    RegisterAwardVestingReversalViewSet,
    RegisterAwardVestingViewSet,
    RegisterAwardViewSet,
)
from tokens.views.register_capital_increase import RegisterCapitalIncreaseViewSet
from tokens.views.register_correction import RegisterCorrectionViewSet
from tokens.views.register_deployment import RegisterDeploymentViewSet
from tokens.views.register_evidence import RegisterEvidenceViewSet
from tokens.views.register_grant import RegisterGrantViewSet
from tokens.views.register_import import RegisterImportViewSet
from tokens.views.register_instruction import RegisterInstructionViewSet
from tokens.views.register_issue import RegisterIssueViewSet
from tokens.views.register_member_document import RegisterMemberDocumentViewSet
from tokens.views.register_opening import (
    RegisterOpeningViewSet,
    RegisterWalletLinkViewSet,
)
from tokens.views.register_particulars import RegisterParticularsChangeViewSet
from tokens.views.register_pause_change import RegisterPauseChangeViewSet
from tokens.views.register_person import RegisterPersonViewSet
from tokens.views.register_reconciliation import RegisterReconciliationViewSet
from tokens.views.register_transfer import RegisterTransferViewSet

app_name = "tokens"

router = DefaultRouter()
router.register(r"member-invitations", MemberInvitationViewSet, basename="member-invitations")
router.register(r"member-associations", MemberAssociationViewSet, basename="member-associations")
router.register(r"member-records", MemberRecordViewSet, basename="member-records")
router.register(r"member-particulars-requests", MemberParticularsRequestViewSet, basename="member-particulars-requests")
router.register(r"member-certificate-requests", MemberCertificateRequestViewSet, basename="member-certificate-requests")
router.register(r"register-people", RegisterPersonViewSet, basename="register-people")
router.register(r"register-pause-changes", RegisterPauseChangeViewSet, basename="register-pause-changes")
router.register(r"register-capital-increases", RegisterCapitalIncreaseViewSet, basename="register-capital-increases")
router.register(r"register-deployments", RegisterDeploymentViewSet, basename="register-deployments")
router.register(r"register-issues", RegisterIssueViewSet, basename="register-issues")
router.register(r"register-corrections", RegisterCorrectionViewSet, basename="register-corrections")
router.register(r"register-openings", RegisterOpeningViewSet, basename="register-openings")
router.register(r"register-links", RegisterWalletLinkViewSet, basename="register-links")
router.register(r"register-allotments", RegisterAllotmentViewSet, basename="register-allotments")
router.register(r"register-grants", RegisterGrantViewSet, basename="register-grants")
router.register(r"register-award-ends", RegisterAwardEndViewSet, basename="register-award-ends")
router.register(
    r"register-award-vesting-reversals",
    RegisterAwardVestingReversalViewSet,
    basename="register-award-vesting-reversals",
)
router.register(r"register-awards", RegisterAwardViewSet, basename="register-awards")
router.register(r"register-award-vestings", RegisterAwardVestingViewSet, basename="register-award-vestings")
router.register(r"register-transfers", RegisterTransferViewSet, basename="register-transfers")
router.register(r"register-imports", RegisterImportViewSet, basename="register-imports")
router.register(r"register-evidence", RegisterEvidenceViewSet, basename="register-evidence")
router.register(r"register-member-documents", RegisterMemberDocumentViewSet, basename="register-member-documents")
router.register(
    r"register-particulars-changes", RegisterParticularsChangeViewSet, basename="register-particulars-changes"
)
router.register(r"register-instructions", RegisterInstructionViewSet, basename="register-instructions")
router.register(r"register-reconciliations", RegisterReconciliationViewSet, basename="register-reconciliations")
router.register(r"capital-increases", views.CapitalIncreaseViewSet, basename="capital-increases")
router.register(r"issuance-requests", views.ShareIssuanceRequestViewSet, basename="issuance-requests")
router.register(r"", views.ShareTokenViewSet, basename="tokens")

urlpatterns = router.urls

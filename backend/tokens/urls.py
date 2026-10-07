from rest_framework.routers import DefaultRouter

from tokens import views
from tokens.views.register_correction import RegisterCorrectionViewSet
from tokens.views.register_evidence import RegisterEvidenceViewSet
from tokens.views.register_grant import RegisterGrantViewSet
from tokens.views.register_import import RegisterImportViewSet
from tokens.views.register_instruction import RegisterInstructionViewSet
from tokens.views.register_opening import (
    RegisterOpeningViewSet,
    RegisterWalletLinkViewSet,
)
from tokens.views.register_particulars import RegisterParticularsChangeViewSet
from tokens.views.register_reconciliation import RegisterReconciliationViewSet

app_name = "tokens"

router = DefaultRouter()
router.register(r"register-corrections", RegisterCorrectionViewSet, basename="register-corrections")
router.register(r"register-openings", RegisterOpeningViewSet, basename="register-openings")
router.register(r"register-links", RegisterWalletLinkViewSet, basename="register-links")
router.register(r"register-grants", RegisterGrantViewSet, basename="register-grants")
router.register(r"register-imports", RegisterImportViewSet, basename="register-imports")
router.register(r"register-evidence", RegisterEvidenceViewSet, basename="register-evidence")
router.register(
    r"register-particulars-changes", RegisterParticularsChangeViewSet, basename="register-particulars-changes"
)
router.register(r"register-instructions", RegisterInstructionViewSet, basename="register-instructions")
router.register(r"register-reconciliations", RegisterReconciliationViewSet, basename="register-reconciliations")
router.register(r"capital-increases", views.CapitalIncreaseViewSet, basename="capital-increases")
router.register(r"issuance-requests", views.ShareIssuanceRequestViewSet, basename="issuance-requests")
router.register(r"", views.ShareTokenViewSet, basename="tokens")

urlpatterns = router.urls

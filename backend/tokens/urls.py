from rest_framework.routers import DefaultRouter

from tokens import views
from tokens.views.register_correction import RegisterCorrectionViewSet
from tokens.views.register_import import RegisterImportViewSet
from tokens.views.register_opening import (
    RegisterOpeningViewSet,
    RegisterWalletLinkViewSet,
)

app_name = "tokens"

router = DefaultRouter()
router.register(r"register-corrections", RegisterCorrectionViewSet, basename="register-corrections")
router.register(r"register-openings", RegisterOpeningViewSet, basename="register-openings")
router.register(r"register-links", RegisterWalletLinkViewSet, basename="register-links")
router.register(r"register-imports", RegisterImportViewSet, basename="register-imports")
router.register(r"capital-increases", views.CapitalIncreaseViewSet, basename="capital-increases")
router.register(r"issuance-requests", views.ShareIssuanceRequestViewSet, basename="issuance-requests")
router.register(r"", views.ShareTokenViewSet, basename="tokens")

urlpatterns = router.urls

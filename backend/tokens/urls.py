from rest_framework.routers import DefaultRouter

from tokens import views
from tokens.views.register_correction import RegisterCorrectionViewSet

app_name = "tokens"

router = DefaultRouter()
router.register(r"register-corrections", RegisterCorrectionViewSet, basename="register-corrections")
router.register(r"capital-increases", views.CapitalIncreaseViewSet, basename="capital-increases")
router.register(r"issuance-requests", views.ShareIssuanceRequestViewSet, basename="issuance-requests")
router.register(r"", views.ShareTokenViewSet, basename="tokens")

urlpatterns = router.urls

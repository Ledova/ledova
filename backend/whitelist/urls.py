from django.urls import include, path
from rest_framework.routers import DefaultRouter

from whitelist import views
from whitelist.views.company_wallet import (
    CompanyWalletInstructionViewSet,
    CompanyWalletNominationViewSet,
    CompanyWalletTargetViewSet,
    WalletNominationViewSet,
)

app_name = "whitelist"

router = DefaultRouter()
router.register(r"wallet-nominations", WalletNominationViewSet, basename="wallet-nominations")
router.register(r"company-wallet-nominations", CompanyWalletNominationViewSet, basename="company-wallet-nominations")
router.register(r"company-wallet-instructions", CompanyWalletInstructionViewSet, basename="company-wallet-instructions")
router.register(r"company-wallet-targets", CompanyWalletTargetViewSet, basename="company-wallet-targets")
router.register(r"", views.WhitelistEntryViewSet, basename="whitelist")

urlpatterns = [
    path("", include(router.urls)),
]

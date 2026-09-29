from users.views.device_token import DeviceTokenViewSet
from users.views.financial_profile import FinancialProfileViewSet
from users.views.identity_verification import IdentityVerificationViewSet
from users.views.investor_classification import InvestorClassificationViewSet
from users.views.notification import NotificationViewSet
from users.views.user_account import UserAccountViewSet
from users.views.user_preferences import UserPreferencesViewSet
from users.views.user_profile import UserProfileViewSet

__all__ = [
    "DeviceTokenViewSet",
    "FinancialProfileViewSet",
    "InvestorClassificationViewSet",
    "NotificationViewSet",
    "IdentityVerificationViewSet",
    "UserAccountViewSet",
    "UserPreferencesViewSet",
    "UserProfileViewSet",
]

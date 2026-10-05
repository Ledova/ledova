from rest_framework.routers import DefaultRouter

from users.views.company_eligibility import CompanyEligibilityRequestViewSet

app_name = "company-eligibility"
router = DefaultRouter()
router.register("requests", CompanyEligibilityRequestViewSet, basename="requests")
urlpatterns = router.urls

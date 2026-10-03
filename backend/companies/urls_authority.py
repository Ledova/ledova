from rest_framework.routers import DefaultRouter

from companies.views.authority_request import CompanyAuthorityRequestViewSet

app_name = "company-authority"
router = DefaultRouter()
router.register("requests", CompanyAuthorityRequestViewSet, basename="requests")
urlpatterns = router.urls

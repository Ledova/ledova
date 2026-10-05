from django.urls import include, path
from rest_framework.routers import DefaultRouter

from companies import views
from users.views.company_eligibility import CompanyEligibilityQueueViewSet

app_name = "companies"

router = DefaultRouter()
router.register(r"", views.CompanyViewSet, basename="companies")

document_router = DefaultRouter()
document_router.register(r"", views.DocumentViewSet, basename="documents")

eligibility_router = DefaultRouter()
eligibility_router.register(r"", CompanyEligibilityQueueViewSet, basename="eligibility-requests")

urlpatterns = [
    path("", include(router.urls)),
    path("<uuid:company_uuid>/documents/", include(document_router.urls)),
    path("<uuid:company_uuid>/eligibility-requests/", include(eligibility_router.urls)),
]

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from companies import views

app_name = "companies"

router = DefaultRouter()
router.register(r"", views.CompanyViewSet, basename="companies")

urlpatterns = [
    path("", include(router.urls)),
]

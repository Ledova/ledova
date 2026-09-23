from django.urls import include, path
from rest_framework.routers import DefaultRouter

from shareholders.views import PublicationViewSet

app_name = "publications"

router = DefaultRouter()
router.register(r"", PublicationViewSet, basename="publications")

urlpatterns = [
    path("", include(router.urls)),
]

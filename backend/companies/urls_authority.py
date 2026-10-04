from rest_framework.routers import DefaultRouter

from companies.views.authority_request import CompanyAuthorityRequestViewSet
from companies.views.team import CompanyAppointmentViewSet, CompanyTeamInvitationViewSet

app_name = "company-authority"
router = DefaultRouter()
router.register("requests", CompanyAuthorityRequestViewSet, basename="requests")
router.register("invitations", CompanyTeamInvitationViewSet, basename="invitations")
router.register("appointments", CompanyAppointmentViewSet, basename="appointments")
urlpatterns = router.urls

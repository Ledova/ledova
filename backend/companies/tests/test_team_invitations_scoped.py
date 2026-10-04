from companies.tests import test_team_invitations as cases
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedCompanyTeamInvitationTest(RunsOnTheScopedConnection, cases.CompanyTeamInvitationTest):
    def test_app_read_policy_hides_other_invitations_and_appointments_and_denies_writes(self):
        from django.db import DatabaseError

        from companies.models import CompanyAppointment, CompanyTeamInvitation
        from shared.db import atomic

        issued, appointed = self.issue_and_accept()
        with self.app_as(self.other):
            self.assertFalse(CompanyTeamInvitation.objects.exists())
            self.assertFalse(CompanyAppointment.objects.exists())
        with self.app_as(self.owner):
            self.assertEqual(CompanyTeamInvitation.objects.count(), 1)
            self.assertEqual(CompanyAppointment.objects.count(), 1)
            with self.assertRaises(DatabaseError), atomic():
                CompanyTeamInvitation.objects.filter(pk=issued.json()["uuid"]).update(capabilities=["admin"])
        with self.app_as(self.invitee):
            self.assertEqual(list(CompanyAppointment.objects.values_list("uuid", flat=True)), [appointed.pk])
            self.assertFalse(CompanyTeamInvitation.objects.exists())

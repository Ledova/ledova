from django.contrib.auth import get_user_model
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyAppointment, CompanyLegacyOwnerSource
from companies.tests import test_legacy_owner_appointments as cases
from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedCompanyLegacyOwnerAppointmentTest(
    RunsOnTheScopedConnection, cases.CompanyLegacyOwnerAppointmentFixtures, APITransactionTestCase
):
    def test_private_sources_are_hidden_even_from_the_recorded_owner_and_platform_staff(self):
        with use_operator():
            get_user_model().objects.filter(pk=self.other.pk).update(is_staff=True, is_superuser=True)
        for actor in (self.owner, self.other):
            with self.subTest(actor=actor.pk), self.app_as(actor):
                self.assertFalse(CompanyLegacyOwnerSource.objects.exists())
                self.assertEqual(CompanyAppointment.objects.count(), 1)

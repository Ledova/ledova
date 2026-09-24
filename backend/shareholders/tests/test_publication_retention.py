import os
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase, override_settings

from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.constants import READ_AS_STAFF
from shareholders.models import (
    BallotChoice,
    Publication,
    PublicationEvent,
    PublicationRead,
    PublicationRecipient,
)
from shareholders.services.publications import (
    purge_publications,
    record_publication_read,
)
from shareholders.services.resolutions import cast_ballot, close_resolution
from shareholders.tasks.publications import purge_publications_past_the_clock
from shareholders.tests.fixtures import (
    a_company_with_members,
    a_resolution,
    published,
    voting_has_closed,
)

FLOOR = 2557


class PublicationRetentionTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("retention")
        self.publication = published(self.world)
        record_publication_read(self.world.staff, self.publication, None, READ_AS_STAFF)

    def stored(self):
        return os.path.isfile(os.path.join(settings.PRIVATE_MEDIA_ROOT, self.publication.file.name))

    def test_the_purge_keeps_a_publication_until_the_seven_year_clock_then_removes_it_with_its_roll(self):
        published_at = self.publication.created_at

        self.assertEqual(purge_publications(now=published_at + timedelta(days=FLOOR)), 0)
        self.assertTrue(Publication.objects.filter(pk=self.publication.pk).exists())
        self.assertTrue(self.stored())

        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(purge_publications(now=published_at + timedelta(days=FLOOR + 1)), 1)

        self.assertFalse(Publication.objects.exists())
        self.assertFalse(PublicationRecipient.objects.exists())
        self.assertFalse(PublicationRead.objects.exists())
        self.assertFalse(self.stored())

    def test_the_purge_removes_a_resolution_s_ballots_and_close_before_its_roll(self):
        resolution = a_resolution(self.world)
        cast_ballot(self.world.members[0].user, resolution.pk, BallotChoice.FOR)
        voting_has_closed(resolution)
        close_resolution(resolution)
        self.assertEqual(PublicationEvent.objects.count(), 2)

        with self.captureOnCommitCallbacks(execute=True):
            removed = purge_publications(now=resolution.created_at + timedelta(days=FLOOR + 1))

        self.assertEqual(removed, 2)
        self.assertFalse(PublicationEvent.objects.exists())
        self.assertFalse(PublicationRecipient.objects.exists())
        self.assertFalse(Publication.objects.exists())

    def test_the_daily_job_reports_what_it_removed(self):
        self.assertEqual(purge_publications_past_the_clock(), {"publications_removed": 0})

    @override_settings(FORMER_MEMBER_RETENTION_DAYS=FLOOR - 1)
    def test_a_retention_setting_below_the_register_floor_refuses_to_run_at_all(self):
        with self.assertRaises(ImproperlyConfigured):
            purge_publications()

        self.assertTrue(Publication.objects.filter(pk=self.publication.pk).exists())

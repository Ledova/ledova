from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyCapability
from companies.services.authority import DECLARATION_VERSION
from companies.services.team import revoke_company_appointment
from shared.db import atomic, use_operator
from shared.tests.core_fixtures import CoreFixtures
from tokens.models import ClassRightsRevision, RegisterPosition


class ClassRightsTest(CoreFixtures, APITransactionTestCase):
    def test_class_rights_descriptions_retain_revisions_without_changing_ownership_or_granting_authority(self):
        endpoint = f"/api/v1/tokens/{self.token.pk}/class-rights/"
        initial = self.client.get(endpoint)
        self.assertEqual(initial.status_code, 200, initial.content)
        self.assertIsNone(initial.json()["current"])
        self.assertEqual(initial.json()["results"], [])
        self.assertEqual(initial.json()["administrationAppointment"], str(self.appointment.pk))
        payload = {
            "appointment": str(self.appointment.pk),
            "idempotency_key": str(uuid4()),
            "previous_revision": 0,
            "summary": "One vote per share; other rights follow the company's constitution.",
            "document_reference": "Synthetic constitution, clause 4, 21 October 2026",
        }
        saved = self.client.post(endpoint, payload, format="json")
        self.assertEqual(saved.status_code, 201, saved.content)
        first = saved.json()
        self.assertEqual(first["revision"], 1)
        self.assertEqual(first["recordedBy"], self.owner.pk)
        self.assertEqual(first["recordedByName"], self.profile.full_name)
        self.assertEqual(first["idempotencyKey"], payload["idempotency_key"])
        replay = self.client.post(endpoint, payload, format="json")
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json(), first)
        changed = self.client.post(endpoint, {**payload, "summary": payload["summary"] + " "}, format="json")
        self.assertEqual(changed.status_code, 409, changed.content)
        stale = self.client.post(endpoint, {**payload, "idempotency_key": str(uuid4())}, format="json")
        self.assertEqual(stale.status_code, 409, stale.content)
        revised = self.client.post(
            endpoint,
            {
                **payload,
                "idempotency_key": str(uuid4()),
                "previous_revision": 1,
                "summary": "Company-supplied correction: two votes per share.",
            },
            format="json",
        )
        self.assertEqual(revised.status_code, 201, revised.content)
        self.assertEqual(revised.json()["revision"], 2)
        replay = self.client.post(endpoint, payload, format="json")
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json(), first)
        cleared = self.client.post(
            endpoint,
            {
                **payload,
                "idempotency_key": str(uuid4()),
                "previous_revision": 2,
                "summary": "",
                "document_reference": "",
            },
            format="json",
        )
        self.assertEqual(cleared.status_code, 201, cleared.content)
        history = self.client.get(endpoint, {"page_size": 1})
        self.assertEqual(history.status_code, 200, history.content)
        self.assertEqual(history.json()["current"]["revision"], 3)
        self.assertEqual(history.json()["current"]["summary"], "")
        self.assertEqual(history.json()["count"], 3)
        self.assertEqual(len(history.json()["results"]), 1)
        self.assertIsNotNone(history.json()["next"])
        with use_operator():
            self.assertEqual(ClassRightsRevision.objects.count(), 3)
            self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
            self.token.stored_register.refresh_from_db()
            self.assertEqual(self.token.stored_register.sequence, 1)
            self.assertEqual(int(self.token.stored_register.issued_supply), 100)
            with self.assertRaises(DatabaseError), atomic():
                ClassRightsRevision.objects.filter(pk=first["uuid"]).update(summary="Overwrite")
            with self.assertRaises(DatabaseError), atomic():
                ClassRightsRevision.objects.filter(pk=first["uuid"]).delete()
            with self.assertRaises(DatabaseError), atomic():
                ClassRightsRevision.objects.create(
                    token=self.token,
                    revision=4,
                    summary="Unbound SQL must fail",
                    document_reference="",
                    recorded_by=self.owner,
                    recorded_by_name=self.profile.full_name,
                    appointment=self.appointment,
                    idempotency_key=uuid4(),
                )
        invitation = self.client.post(
            "/api/v1/company-authority/invitations/",
            {
                "company": str(self.company.pk),
                "inviter_appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "capabilities": [CompanyCapability.READ_REGISTER],
                "delegatable_capabilities": [],
            },
            format="json",
        )
        self.assertEqual(invitation.status_code, 201, invitation.content)
        self.client.force_authenticate(self.foreign)
        accepted = self.client.post(
            "/api/v1/company-authority/invitations/accept/",
            {"code": invitation.json()["code"], "declaration_version": DECLARATION_VERSION, "accept_declaration": True},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        read_only = self.client.get(endpoint)
        self.assertEqual(read_only.status_code, 200, read_only.content)
        self.assertIsNone(read_only.json()["administrationAppointment"])
        refused = self.client.post(
            endpoint,
            {
                **payload,
                "idempotency_key": str(uuid4()),
                "appointment": accepted.json()["uuid"],
                "previous_revision": 3,
            },
            format="json",
        )
        self.assertEqual(refused.status_code, 404, refused.content)
        self.client.force_authenticate(self.owner)
        create_revision = ClassRightsRevision.objects.create

        def revoke_before_commit(**values):
            revision = create_revision(**values)
            revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
            return revision

        with patch("tokens.services.class_rights.ClassRightsRevision.objects.create", side_effect=revoke_before_commit):
            raced = self.client.post(
                endpoint,
                {**payload, "idempotency_key": str(uuid4()), "previous_revision": 3},
                format="json",
            )
        self.assertEqual(raced.status_code, 503, raced.content)
        with use_operator():
            self.assertEqual(ClassRightsRevision.objects.count(), 3)
        revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
        revoked_retry = self.client.post(endpoint, payload, format="json")
        self.assertEqual(revoked_retry.status_code, 404, revoked_retry.content)
        recovered = self.client.get(endpoint, {"idempotency_key": payload["idempotency_key"]})
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertIsNone(recovered.json()["administrationAppointment"])
        self.assertEqual(recovered.json()["results"], [first])
        self.assertEqual(recovered.json()["current"]["revision"], 3)

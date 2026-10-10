import tempfile
from uuid import uuid4

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from companies.models import CompanyAuthorityRequest
from companies.services.authority_requests import (
    _requester_principal,
    submit_authority_request,
)
from companies.tests.test_authority_requests import (
    STORAGES,
    authority_fixture,
    evidence,
)
from shared.db import atomic, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies

CAPABILITY_GUARD = "Request closed, canonical personal and delegation capability sets"
NULL_SETS = ([None], ["prepare", None])


class RetainedRequest:
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.user, self.profile, self.company = authority_fixture("capability-guard", "224466880")
        self.proposal, created = submit_authority_request(
            requester=self.user,
            company_id=self.company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["prepare"],
            delegatable_capabilities=["approve"],
        )
        self.assertTrue(created)

    def insert(self, requested, delegatable):
        values = {field.attname: getattr(self.proposal, field.attname) for field in self.proposal._meta.fields}
        request = uuid4()
        values.update(
            uuid=request,
            idempotency_key=uuid4(),
            file=f"companies/{self.company.pk}/authority-requests/{request}/{uuid4()}.bin",
            requested_capabilities=requested,
            delegatable_capabilities=delegatable,
        )
        with use_operator(), _requester_principal(self.user.pk), atomic():
            return CompanyAuthorityRequest.objects.create(**values).pk

    def assert_refused(self, requested, delegatable):
        with self.assertRaises(DatabaseError) as refused:
            self.insert(requested, delegatable)
        self.assertEqual(refused.exception.__cause__.sqlstate, "23514")
        self.assertIn(CAPABILITY_GUARD, str(refused.exception))

    def stored(self, pk):
        with use_operator():
            row = CompanyAuthorityRequest.objects.get(pk=pk)
        return row.requested_capabilities, row.delegatable_capabilities


class AuthorityRequestCapabilityGuardTest(StubUploadDependencies, RetainedRequest, TransactionTestCase):
    def test_direct_operator_inserts_with_null_capabilities_are_refused_in_each_field(self):
        for null in NULL_SETS:
            with self.subTest(field="requested_capabilities", value=null):
                self.assert_refused(null, ["approve"])
            with self.subTest(field="delegatable_capabilities", value=null):
                self.assert_refused(["prepare"], null)
        with use_operator():
            self.assertEqual(list(CompanyAuthorityRequest.objects.values_list("pk", flat=True)), [self.proposal.pk])

    def test_otherwise_identical_personal_only_and_delegation_only_inserts_pass(self):
        for requested, delegatable in ((["prepare"], []), ([], ["approve"])):
            with self.subTest(requested=requested, delegatable=delegatable):
                self.assertEqual(self.stored(self.insert(requested, delegatable)), (requested, delegatable))

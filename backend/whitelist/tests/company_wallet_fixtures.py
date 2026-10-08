from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import connections
from django.utils import timezone
from eth_account import Account
from eth_account.messages import encode_defunct

from companies.services.authority_requests import _requester_principal
from shared.db import current_alias, use_operator
from shared.tests.row_contention import RealRowContention
from shared.tests.upload_fixtures import StubUploadDependencies
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from wallets.models import Wallet, WalletPossessionProof
from wallets.services.verification import (
    complete_wallet_verification,
    start_wallet_verification,
)
from whitelist.exceptions import WhitelistChangeConflict
from whitelist.models import WhitelistChange
from whitelist.services import changes
from whitelist.services.company_wallet_instructions import (
    decide_wallet_instruction,
    prepare_wallet_instruction,
    preview_wallet_instruction_decision,
)
from whitelist.services.wallet_nominations import (
    nominate_wallet,
    preview_wallet_nomination,
)
from whitelist.tests.change_fixtures import WhitelistNode, admitted_signer

PARTICIPANT_KEY = "0x" + "22" * 32


class CompanyWalletCases(RealRowContention, CompanyEligibilityConsumptionCases, StubUploadDependencies):
    def setUp(self):
        super().setUp()
        self.request, self.eligibility_decision = self.accepted()
        with use_operator():
            self.wallet = Wallet.objects.create(
                user_account=self.account, address=Account.from_key(PARTICIPANT_KEY).address, chain="base"
            )
            admitted_signer()
        self.retained_changes = {}
        self.nomination = None
        self.node = WhitelistNode()
        for name in (
            "whitelist.services.changes.get_base_chain_client",
            "whitelist.services.whitelist.get_base_chain_client",
            "whitelist.services.company_wallet_instructions.get_base_chain_client",
            "whitelist.services.eligibility_invalidation.get_base_chain_client",
        ):
            self.enterContext(patch(name, return_value=self.node.client))

    @contextmanager
    def actual_operator(self):
        with use_operator():
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('role')")
                previous = cursor.fetchone()[0]
                cursor.execute(f"SET ROLE {connection.ops.quote_name(settings.RLS_ROLES['operator'])}")
            try:
                yield
            finally:
                with connection.cursor() as cursor:
                    if previous == "none":
                        cursor.execute("RESET ROLE")
                    else:
                        cursor.execute(f"SET ROLE {connection.ops.quote_name(previous)}")

    def prove_wallet(self):
        with _requester_principal(self.participant.pk):
            challenge = start_wallet_verification(self.participant, self.wallet.pk).verification_challenge
        signature = Account.sign_message(
            encode_defunct(text=challenge), private_key=PARTICIPANT_KEY
        ).signature.to_0x_hex()
        completed = complete_wallet_verification(self.participant, self.wallet.pk, signature)
        with use_operator():
            proof = WalletPossessionProof.objects.get(wallet_id=self.wallet.pk, completed_at=completed.verified_at)
        self.assertEqual(proof.challenge, challenge)
        self.assertEqual(proof.signature, signature)
        return proof

    def nominate(self):
        self.prove_wallet()
        preview = preview_wallet_nomination(actor=self.participant, request=self.request.pk, wallet=self.wallet.pk)
        self.assertEqual(preview["unmet_requirements"], [])
        nomination, created = nominate_wallet(
            actor=self.participant,
            operation_id=uuid4(),
            request=self.request.pk,
            wallet=self.wallet.pk,
            preview_digest=preview["preview_digest"],
            sharing_accepted=True,
        )
        self.assertTrue(created)
        return nomination

    def prepare_wallet(self, nomination=None, **changes):
        if nomination is None and changes.get("action", "add") == "add":
            nomination = self.nominate()
        values = dict(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.initial.pk,
            company=self.company.pk,
            action="add",
            nomination=getattr(nomination, "pk", nomination),
            expires_at=(timezone.now() + timedelta(days=30)).replace(microsecond=0),
        )
        values.update(changes)
        return prepare_wallet_instruction(**values)

    def wallet_decide(self, proposal, kind, **changes):
        actor = changes.pop("actor", self.owner)
        appointment = changes.pop("appointment", self.initial.pk)
        reason = changes.pop("reason", "")
        _, preview = preview_wallet_instruction_decision(
            actor=actor, instruction_id=proposal.pk, appointment=appointment, kind=kind, reason=reason
        )
        values = dict(
            actor=actor,
            instruction_id=proposal.pk,
            appointment=appointment,
            kind=kind,
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
            reason=reason,
        )
        values.update(changes)
        return decide_wallet_instruction(**values), values

    def applied_wallet(self):
        proposal = self.prepare_wallet()
        self.wallet_decide(proposal, "approve")
        return self.wallet_decide(proposal, "apply")

    def execute(self, proposal):
        with use_operator():
            return changes.recover(proposal.change_id)

    def admit_change(self, operation_id, action="add", *, expires_at=None, company=None):
        company = company or self.company
        previous = self.retained_changes.get(operation_id)
        if previous is not None:
            with use_operator():
                expected = previous.expires_at if action == "add" and expires_at is None else expires_at
                return prepare_wallet_instruction(
                    actor=self.owner,
                    operation_id=previous.pk,
                    appointment=previous.preparing_appointment_id,
                    company=company.pk,
                    action=action,
                    nomination=previous.nomination_id if action == "add" else None,
                    target_change=previous.target_change_id if action == "remove" else None,
                    expires_at=expected,
                )
        if action == "add":
            if self.nomination is None:
                self.nomination = self.nominate()
            proposal = self.prepare_wallet(
                self.nomination,
                operation_id=operation_id,
                company=company.pk,
                expires_at=expires_at or self.eligibility_decision.expires_at.replace(microsecond=0),
            )
        else:
            with use_operator():
                target = (
                    WhitelistChange.objects.filter(
                        company_id=company.pk, action="add", status__in=["confirmed", "unchanged"]
                    )
                    .order_by("created_at")
                    .last()
                )
            if target is None:
                raise WhitelistChangeConflict("A company REMOVE requires a genuinely retained successful ADD")
            proposal = self.prepare_wallet(
                operation_id=operation_id,
                company=company.pk,
                action="remove",
                nomination=None,
                target_change=target.pk,
                expires_at=expires_at,
            )
        self.wallet_decide(proposal, "approve")
        applied, _ = self.wallet_decide(proposal, "apply")
        self.retained_changes[operation_id] = applied
        self.retained_changes[applied.change_id] = applied
        return applied

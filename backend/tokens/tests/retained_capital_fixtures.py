from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model

from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import admitted_signer
from shared.db import atomic, use_migrate, use_operator
from shared.tests.retained_rows import retained_rows
from shared.tests.tenants import make_tenant
from tokens.exceptions import CapitalIncreaseConflict
from tokens.models import CapitalIncreaseExecution, CapitalIncreaseRequest
from tokens.services import capital_execution
from tokens.services.dilution import dilution_for
from tokens.tests.capital_fixtures import CapitalNode
from tokens.tests.retained_guards import CAPITAL_GUARDS


def install_retained_capital(test):
    with use_operator():
        test.tenant = make_tenant("retained-capital-" + uuid4().hex)
        test.token = test.tenant.deployed_token
        test.actor = get_user_model().objects.create_superuser(
            email=f"retained-capital-{uuid4().hex}@example.test", password="synthetic"
        )
        admitted_signer()
    test.node = CapitalNode()
    test.enterContext(patch("tokens.services.capital_execution.get_base_chain_client", return_value=test.node.client))


@contextmanager
def _original_signing_token(execution):
    from tokens.models import ShareToken

    token = ShareToken.objects.select_for_update().get(pk=execution.token_id)

    def validate(operation):
        if capital_execution._current_identity(token) != capital_execution._expected_identity(execution):
            raise CapitalIncreaseConflict("The original capital identity changed before signing.")

    yield validate


def retain_capital_execution(
    *, token, actor, client, additional_shares=100, new_authorized_total=1100, signed=True, superseded=False
):
    with use_migrate(), retained_rows(*CAPITAL_GUARDS):
        with use_operator():
            request = CapitalIncreaseRequest.objects.create(
                token=token,
                additional_shares=additional_shares,
                new_authorized_total=new_authorized_total,
                purpose="Retained original capital",
                board_resolution_reference="RETAINED-BOARD",
            )
            request.submit(token.company.owner, dilution_for(request))
            request.approve(actor, "Original predecessor review")
            with atomic(durable=True):
                execution = CapitalIncreaseExecution.objects.create(
                    pk=request.dispatch_id,
                    request_id=request.pk,
                    token_id=token.pk,
                    company_id=token.company_id,
                    executed_by_id=actor.pk,
                    intent=capital_execution._intent(request, token),
                )
                if superseded:
                    from django.utils import timezone

                    execution.projected_at = timezone.now()
                    execution.save(update_fields=["projected_at", "updated_at"])
                    request.mark_superseded("Original approved terms no longer raise the recorded cap")
                else:
                    request.mark_executing()
            if signed and not superseded:
                claim = capital_execution._claim(execution)
                prepared = outgoing.prepare_operation(claim, client)
                outgoing.sign_operation(
                    claim,
                    prepared,
                    settings.BLOCKCHAIN_OPERATOR_KEY,
                    signing_context=lambda: _original_signing_token(execution),
                    on_signed=lambda attempt: capital_execution._record_signed(execution.pk, attempt),
                )
    request.refresh_from_db()
    execution.refresh_from_db()
    return request, execution


def approve_retained_capital_request(request, submitter, reviewer, dilution_percentage, notes):
    with use_migrate(), retained_rows(*CAPITAL_GUARDS), use_operator():
        request.submit(submitter, dilution_percentage)
        request.approve(reviewer, notes)
    request.refresh_from_db()
    return request

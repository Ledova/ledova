from collections import Counter

from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from tokens.constants import SWAP_APPROVAL_RECOVERY_BATCH
from tokens.models import ApprovalSubmissionOutcome, SwapApprovalSubmission
from tokens.services.approval_submissions import attempt


@app.periodic(cron="*/5 * * * *")
@app.task
def recover_swap_approval_submissions(timestamp: int = 0):
    with use_operator():
        pending = list(
            SwapApprovalSubmission.objects.filter(outcome=ApprovalSubmissionOutcome.PENDING)
            .order_by("updated_at", "created_at", "pk")
            .values_list("pk", flat=True)[:SWAP_APPROVAL_RECOVERY_BATCH]
        )
        outcomes = Counter(attempt(submission_id) for submission_id in pending)
    return {"attempted": len(pending), "outcomes": dict(outcomes)}

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone

from authentication.services.email_codes import CODE_LIFETIME
from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from users.services.erasure import purge_abandoned_signups

SUCCEEDED_JOB_HOURS = 7 * 24
UNSUCCESSFUL_JOB_HOURS = 30 * 24


@app.periodic(cron="30 4 * * *")
@app.task
def remove_old_jobs(timestamp: int = 0):
    remove = async_to_sync(app.job_manager.delete_old_jobs)
    remove(nb_hours=SUCCEEDED_JOB_HOURS)
    remove(nb_hours=UNSUCCESSFUL_JOB_HOURS, include_failed=True, include_cancelled=True, include_aborted=True)
    with use_operator():
        call_command("flushexpiredtokens", verbosity=0)
        call_command("clearsessions", verbosity=0)
        expired_codes = (
            get_user_model()
            .objects.filter(email_verification_sent_at__lt=timezone.now() - CODE_LIFETIME)
            .update(email_verification_token=None, email_verification_sent_at=None, email_verification_attempts=0)
        )
        abandoned = purge_abandoned_signups()
    return {
        "succeeded_after_hours": SUCCEEDED_JOB_HOURS,
        "unsuccessful_after_hours": UNSUCCESSFUL_JOB_HOURS,
        "abandoned_signups": abandoned,
        "expired_email_codes": expired_codes,
    }

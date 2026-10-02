from asgiref.sync import async_to_sync

from ledova_backend.procrastinate_app import app

SUCCEEDED_JOB_HOURS = 7 * 24
UNSUCCESSFUL_JOB_HOURS = 30 * 24


@app.periodic(cron="30 4 * * *")
@app.task
def remove_old_jobs(timestamp: int = 0):
    remove = async_to_sync(app.job_manager.delete_old_jobs)
    remove(nb_hours=SUCCEEDED_JOB_HOURS)
    remove(nb_hours=UNSUCCESSFUL_JOB_HOURS, include_failed=True, include_cancelled=True, include_aborted=True)
    return {"succeeded_after_hours": SUCCEEDED_JOB_HOURS, "unsuccessful_after_hours": UNSUCCESSFUL_JOB_HOURS}

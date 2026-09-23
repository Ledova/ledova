from procrastinate import RetryStrategy

from ledova_backend.procrastinate_app import app
from shareholders.services.publications import purge_publications


@app.periodic(cron="50 3 * * *")
@app.task(retry=RetryStrategy(max_attempts=3, wait=600))
def purge_publications_past_the_clock(timestamp: int = 0):
    return {"publications_removed": purge_publications()}

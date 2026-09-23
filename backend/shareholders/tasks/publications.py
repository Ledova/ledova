from procrastinate import RetryStrategy

from ledova_backend.procrastinate_app import app
from shareholders.services.publications import notify_the_roll, purge_publications


@app.periodic(cron="50 3 * * *")
@app.task(retry=RetryStrategy(max_attempts=3, wait=600))
def purge_publications_past_the_clock(timestamp: int = 0):
    return {"publications_removed": purge_publications()}


@app.task(retry=RetryStrategy(max_attempts=4, wait=60))
def tell_the_members(publication_id: str):
    return {"members_told": notify_the_roll(publication_id)}

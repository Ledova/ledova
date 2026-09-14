from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from whitelist.services.changes import recover_changes


@app.periodic(cron="*/5 * * * *")
@app.task
def recover_whitelist_changes(timestamp: int = 0):
    with use_operator():
        return recover_changes()

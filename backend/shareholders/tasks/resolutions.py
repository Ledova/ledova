from ledova_backend.procrastinate_app import app
from shareholders.services.resolutions import close_due_resolutions


@app.periodic(cron="*/5 * * * *")
@app.task
def close_resolutions_past_their_window(timestamp: int = 0):
    return {"resolutions_closed": close_due_resolutions()}

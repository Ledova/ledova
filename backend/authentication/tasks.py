from authentication.services.password_reset import deliver_password_reset
from ledova_backend.procrastinate_app import app


@app.task
def send_password_reset_email(email: str):
    deliver_password_reset(email)

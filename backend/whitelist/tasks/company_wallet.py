from ledova_backend.procrastinate_app import app
from shared.db import use_operator
from whitelist.services.changes import recover


@app.task
def execute_company_wallet_change(change_id: str):
    with use_operator():
        return str(recover(change_id).pk)

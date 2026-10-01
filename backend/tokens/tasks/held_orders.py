import logging

from ledova_backend.procrastinate_app import app
from shared.db import acting_for
from tokens.services import held_orders

logger = logging.getLogger(__name__)


@app.periodic(cron="* * * * *")
@app.task
def place_held_orders(timestamp: int = 0):
    with acting_for(None):
        result = held_orders.place_held_orders()
    logger.info(
        "Held orders checked: %s, matched: %s, listed: %s, still held: %s, busy: %s",
        result["checked"],
        result["matched"],
        result["listed"],
        result["held"],
        result["busy"],
    )
    return result

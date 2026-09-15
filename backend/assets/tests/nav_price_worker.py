import json
import os
import sys
from pathlib import Path
from unittest.mock import Mock, patch

import django

from blockchain.tests.outgoing_worker import await_file


def run(directory):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["NAV_PRICE_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("NAV price locking requires PostgreSQL")
    settings.DATABASES = {
        "default": database,
        "operator": database | {"USER": settings.RLS_ROLES["operator"]},
    }
    settings.RLS_AMBIENT_ALIAS = "operator"
    django.setup()

    from django.db import connections

    from assets.services import sync
    from assets.tasks import sync_all_assets
    from shared.db import current_alias, select_operator

    select_operator()
    connection = connections[current_alias()]
    original = sync._current_prices

    def captured_prices():
        prices = original()
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_backend_pid(), current_user")
            process_id, role = cursor.fetchone()
        marker = directory / "captured.tmp"
        marker.write_text(json.dumps({"pid": process_id, "role": role, "alias": current_alias()}))
        marker.replace(directory / "captured")
        await_file(directory / "write")
        return prices

    provider = Mock()
    provider.fetch_prices_by_symbols.return_value = {}
    with (
        patch.object(sync, "_current_prices", side_effect=captured_prices),
        patch.object(sync, "CoinGeckoClient", return_value=provider),
    ):
        print(json.dumps(sync_all_assets(timestamp=0)), flush=True)


if __name__ == "__main__":
    run(Path(sys.argv[1]))

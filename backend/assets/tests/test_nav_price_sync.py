import json
import os
import subprocess
import sys
import tempfile
import time
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.db import connections
from django.test import TransactionTestCase

from assets.models import Asset, AssetSnapshot
from assets.services import sync as asset_sync
from blockchain.tests.outgoing_worker import await_file
from blockchain.tests.test_outgoing_processes import finish
from shared.db import atomic, current_alias
from tokens.models import YieldToken


class NavPriceProcessTest(TransactionTestCase):
    def test_delayed_sync_waits_for_nav_projection_and_reads_its_committed_value(self):
        self.race(False)

    def test_delayed_sync_waits_for_deactivation_and_preserves_the_previous_price(self):
        self.race(True)

    def race(self, deactivate):
        asset_sync.ensure_supported_assets()
        asset = Asset.objects.get(symbol="AUSG")
        snapshot = asset_sync.update_price(asset, Decimal("1.02"), source="nav_update")
        token = YieldToken.objects.create(
            symbol="AUSG", name="NAV", contract_address="0x" + "d" * 40, nav_per_token=Decimal("1.02")
        )
        connection = connections[current_alias()]
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        environment = os.environ.copy()
        environment["NAV_PRICE_TEST_DATABASE"] = json.dumps({key: connection.settings_dict[key] for key in fields})
        with tempfile.TemporaryDirectory(prefix="nav-price-race-") as temporary:
            directory = Path(temporary)
            process = subprocess.Popen(
                [sys.executable, "-m", "assets.tests.nav_price_worker", str(directory)],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                await_file(directory / "captured")
                worker = json.loads((directory / "captured").read_text())
                worker_pid = worker["pid"]
                self.assertEqual((worker["alias"], worker["role"]), ("operator", settings.RLS_ROLES["operator"]))
                with atomic():
                    current = YieldToken.objects.select_for_update().get(pk=token.pk)
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        parent_pid = cursor.fetchone()[0]
                    self.assertNotEqual(worker_pid, parent_pid)
                    (directory / "write").touch()
                    deadline = time.monotonic() + 10
                    blocked = False
                    while time.monotonic() < deadline:
                        with connection.cursor() as cursor:
                            cursor.execute("SELECT %s = ANY(pg_blocking_pids(%s))", [parent_pid, worker_pid])
                            blocked = cursor.fetchone()[0]
                        if blocked or process.poll() is not None:
                            break
                        time.sleep(0.01)
                    self.assertTrue(blocked, "NAV price sync must wait on the projection's token lock")
                    locked_asset = Asset.objects.select_for_update(nowait=True).get(pk=asset.pk)
                    if deactivate:
                        current.is_active = False
                        current.save(update_fields=["is_active"])
                    else:
                        current.nav_per_token = Decimal("2.25")
                        current.save(update_fields=["nav_per_token"])
                        asset_sync.update_price(locked_asset, Decimal("2.25"), source="nav_update")
                code, output, error = finish(process)
                self.assertEqual(code, 0, output + error)
                self.assertEqual(json.loads(output)["prices_updated"], 0 if deactivate else 1)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()
        asset.refresh_from_db()
        expected = Decimal("1.02") if deactivate else Decimal("2.25")
        self.assertEqual(asset.current_price, expected)
        retained = AssetSnapshot.objects.get(asset=asset)
        self.assertEqual((retained.pk, retained.price), (snapshot.pk, expected))

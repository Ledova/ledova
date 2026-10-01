from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone

from assets.models import Asset, AssetSnapshot, ExchangeRate
from assets.services.sync import ensure_supported_assets, update_price
from operators.models import Operator
from shared.db import atomic
from shared.models import Country
from shared.seeds.synthetic.clock import frozen
from shared.seeds.synthetic.identities import EMAIL_DOMAIN

COUNTRY_CODES = ("AU", "NZ", "GB", "SG", "US", "IN")
OPERATOR_IDENTITY = {
    "legal_name": "Ledova Demo Operator Pty Ltd",
    "abn": "00000000000",
    "contact_email": f"operations@{EMAIL_DOMAIN}",
}
SNAPSHOT_SOURCE = "manual"


def seed_reference(plan, seeded):
    with atomic(), frozen(plan.now):
        seeded.countries.update({code: Country.get_or_create_for_code(code) for code in COUNTRY_CODES})
        _operator_identity()
        ensure_supported_assets()
        seeded.assets.update(
            {asset.symbol: asset for asset in Asset.objects.filter(symbol__in=("BTC", "ETH", "USDC", "USDT"))}
        )
        ExchangeRate.objects.get_or_create(base_currency="USD", target_currency="AUD", defaults={"rate": plan.usd_aud})
        for symbol, series in plan.prices.items():
            _price_history(plan, seeded.assets[symbol], series)


def _operator_identity():
    operator = Operator.get()
    blank = {field: value for field, value in OPERATOR_IDENTITY.items() if not getattr(operator, field)}
    if not blank:
        return
    for field, value in blank.items():
        setattr(operator, field, value)
    operator.full_clean()
    operator.save()


def _price_history(plan, asset, series):
    today = plan.now.date()
    AssetSnapshot.objects.bulk_create(
        [
            AssetSnapshot(
                asset=asset,
                price=price,
                price_currency="USD",
                source_timestamp=datetime.combine(today - timedelta(days=days), time.min, dt_timezone.utc),
                data_source=SNAPSHOT_SOURCE,
            )
            for days, price in enumerate(series)
            if days > 0
        ],
        ignore_conflicts=True,
    )
    if asset.current_price is None:
        update_price(asset, series[0], source=SNAPSHOT_SOURCE)

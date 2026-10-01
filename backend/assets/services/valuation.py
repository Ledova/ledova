from decimal import Decimal
from typing import Optional

from assets.services.exchange_rate import ExchangeRateService
from assets.services.sync import SUPPORTED_ASSETS

CENT = Decimal("0.01")


def aud_value(asset, amount: Decimal, usd_price: Optional[Decimal]) -> Optional[Decimal]:
    meta = SUPPORTED_ASSETS.get(asset.symbol, {})
    if asset.is_verified and meta.get("par_currency") == "AUD":
        return (abs(amount) * meta["par_value"]).quantize(CENT)
    rate = ExchangeRateService.get_rate("USD", "AUD")
    if usd_price is None or rate is None or rate <= 0:
        return None
    return (abs(amount) * usd_price * rate).quantize(CENT)

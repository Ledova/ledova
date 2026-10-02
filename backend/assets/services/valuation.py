import logging
from datetime import datetime
from decimal import Decimal
from typing import Optional, Tuple

from assets.models import AssetSnapshot
from assets.services.exchange_rate import ExchangeRateService
from assets.services.sync import SUPPORTED_ASSETS

logger = logging.getLogger(__name__)

CENT = Decimal("0.01")


def aud_value(asset, amount: Decimal, usd_price: Optional[Decimal]) -> Optional[Decimal]:
    meta = SUPPORTED_ASSETS.get(asset.symbol, {})
    if asset.is_verified and meta.get("par_currency") == "AUD":
        return (abs(amount) * meta["par_value"]).quantize(CENT)
    rate = ExchangeRateService.get_rate("USD", "AUD")
    if usd_price is None or rate is None or rate <= 0:
        return None
    return (abs(amount) * usd_price * rate).quantize(CENT)


def transaction_values(asset, amount: Decimal, at: Optional[datetime]) -> Tuple[Optional[Decimal], Optional[Decimal]]:
    try:
        price = AssetSnapshot.objects.filter(asset=asset).get_price_at_timestamp(at) if at else None
        usd = (abs(amount) * price).quantize(CENT) if price is not None else None
        return usd, aud_value(asset, amount, price)
    except Exception as e:
        logger.warning(f"Failed to calculate market value for {asset.symbol}: {e}")
        return None, None

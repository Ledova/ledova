from decimal import ROUND_CEILING, Decimal, localcontext


def token_full_units(raw: int, decimals: int) -> Decimal:
    if type(raw) is not int or type(decimals) is not int or not 0 <= decimals <= 255:
        raise ValueError("Invalid token units")
    with localcontext() as context:
        context.prec = max(78, len(str(abs(raw))))
        return Decimal(raw) / (10**decimals)


def format_units(raw: int, decimals: int) -> str:
    return f"{token_full_units(raw, decimals):,.{decimals}f}"


def token_base_units(amount: Decimal, decimals: int) -> int:
    if not amount.is_finite() or amount <= 0 or not 0 <= decimals <= 255:
        raise ValueError("Invalid token amount")
    _, digits, exponent = amount.as_tuple()
    discarded_places = max(0, -exponent - decimals)
    if discarded_places and any(digits[-discarded_places:]):
        raise ValueError("Token amount exceeds deployment precision")
    if amount.adjusted() + decimals >= 78:
        raise ValueError("Token amount exceeds uint256")
    with localcontext() as context:
        context.prec = max(78, len(digits))
        scaled = amount.scaleb(decimals)
    units = int(scaled)
    if units >= 2**256:
        raise ValueError("Token amount exceeds uint256")
    return units


def token_base_units_ceiling(amount: Decimal, decimals: int) -> int:
    with localcontext() as context:
        context.prec = 78
        return int(amount.scaleb(decimals).to_integral_value(rounding=ROUND_CEILING))

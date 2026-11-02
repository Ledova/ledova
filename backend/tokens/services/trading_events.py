from uuid import UUID

from tokens.services.market_data_service import list_market_tokens


def _listed_for(user, token_uuid) -> bool:
    return list_market_tokens(user).filter(uuid=token_uuid).exists()


def streamable_token_uuid(user, raw_token_uuid):
    try:
        token_uuid = str(UUID(raw_token_uuid))
    except (AttributeError, TypeError, ValueError):
        return None

    if not _listed_for(user, token_uuid):
        return None

    return token_uuid

from django.db import connections

from authentication.services.terms import accept_terms
from shared.db import atomic, current_alias
from tokens.services.register_particulars import follow_profile

PARTICULARS = frozenset({"full_name", "residential_address"})


def _mark(actor_id):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT set_config('app.profile_save', %s, true)", [actor_id])


def save_profile(actor, serializer):
    with atomic():
        _mark(str(actor.pk))
        if serializer.validated_data.pop("terms_version", None) is not None:
            accept_terms(actor)
        profile = serializer.save()
        _mark("")
        if PARTICULARS & serializer.validated_data.keys():
            follow_profile(actor, profile)
    return profile

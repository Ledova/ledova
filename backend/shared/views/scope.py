from django.core.exceptions import ImproperlyConfigured

REASON_ENOUGH = 40

NO_MODEL = (
    "{view} names no scoped_model, so the base cannot choose its queryset and each request would "
    "reach the ORM on its own terms. Name the model the base should scope. If the view is scoped some "
    "other way, or answers without a queryset at all, say which in unscoped_by_the_base_because."
)
HOOK_WITHOUT_A_MODEL = (
    "{view} sets narrow() but names no scoped_model, so the base cannot tell "
    "which manager to query. Set scoped_model, or drop the hook."
)
REASON_AND_A_MODEL = (
    "{view} names a scoped_model and also claims unscoped_by_the_base_because. The base scopes it; "
    "the claim is false. Drop one."
)
BOTH = (
    "{view} names a scoped_model and also defines {hook}. The base owns the scoping call; put the "
    "product filtering in narrow(), which receives the queryset governed by database policies."
)
UNEXPLAINED_OPERATOR_ACTION = (
    "{view} routes {actions} to the operator connection and neither names them administrative nor "
    "says why they need it. An action on that connection is not scoped by any policy, so it must "
    "either be administrative - the set get_permissions turns into IsAdminUser - or state its reason "
    "in operator_actions_because. A statutory register an issuer is entitled to read is the second "
    "case: it needs the connection and must not need IsAdminUser."
)


class PolicyQuerysets:

    scoped_model = None
    unscoped_by_the_base_because = ""
    operator_actions_because = ""
    abstract = False

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if cls.__dict__.get("abstract"):
            return
        model = cls.scoped_model
        if model is None:
            if "narrow" in cls.__dict__:
                raise ImproperlyConfigured(HOOK_WITHOUT_A_MODEL.format(view=cls.__name__))
            if len(cls.__dict__.get("unscoped_by_the_base_because", "")) < REASON_ENOUGH:
                raise ImproperlyConfigured(NO_MODEL.format(view=cls.__name__))
            return
        if cls.__dict__.get("unscoped_by_the_base_because"):
            raise ImproperlyConfigured(REASON_AND_A_MODEL.format(view=cls.__name__))
        for hook in ("get_queryset", "get_object"):
            if hook in cls.__dict__:
                raise ImproperlyConfigured(BOTH.format(view=cls.__name__, hook=hook))
        wider = frozenset(getattr(cls, "operator_actions", ())) - frozenset(getattr(cls, "administrative_actions", ()))
        if wider and len(cls.__dict__.get("operator_actions_because", "")) < REASON_ENOUGH:
            raise ImproperlyConfigured(UNEXPLAINED_OPERATOR_ACTION.format(view=cls.__name__, actions=sorted(wider)))

    def get_queryset(self):
        return self.narrow(self.scoped_model._default_manager.all())

    def narrow(self, queryset):
        return queryset

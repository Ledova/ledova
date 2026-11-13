from shared.db import select_operator, set_principal


class SetsThePrincipalOnTheConnection:
    operator_actions: frozenset = frozenset()

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if getattr(self, "action", None) in self.operator_actions:
            select_operator()
            return
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            set_principal(user.pk)

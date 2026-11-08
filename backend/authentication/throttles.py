from rest_framework.throttling import SimpleRateThrottle

from authentication.email import EmailError, normalize_email
from authentication.services.password_reset import reset_account_id


class EmailRateThrottle(SimpleRateThrottle):

    scope = "auth_email"

    def allow_request(self, request, view):
        take_slot = getattr(self.cache, "take_rate_slot", None)
        if take_slot is None:
            return super().allow_request(request, view)
        key = self.get_cache_key(request, view)
        if self.rate is None or key is None:
            return True
        allowed, self.shared_wait = take_slot(key, self.num_requests, self.duration)
        return allowed

    def wait(self):
        if hasattr(self, "shared_wait"):
            return self.shared_wait
        return super().wait()

    def get_cache_key(self, request, view):
        email = request.data.get("email") if isinstance(request.data, dict) else None
        if not email and request.user.is_authenticated:
            email = request.user.email
        if not isinstance(email, str):
            return None
        try:
            email = normalize_email(email)
        except EmailError:
            email = email.strip().lower()[:254]
        return self.cache_format % {"scope": self.scope, "ident": email}


class PasswordResetEmailThrottle(EmailRateThrottle):
    scope = "password_reset_email"


class PasswordResetProofThrottle(EmailRateThrottle):
    scope = "password_reset_proof"

    def get_cache_key(self, request, view):
        uid = request.data.get("uid") if isinstance(request.data, dict) else None
        identifier = reset_account_id(uid) if isinstance(uid, str) and len(uid) <= 64 else None
        return self.cache_format % {"scope": self.scope, "ident": identifier or "invalid"}


class PasswordResetIPThrottle(EmailRateThrottle):
    scope = "password_reset_ip"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}

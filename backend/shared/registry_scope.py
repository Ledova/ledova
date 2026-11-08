from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

REGISTRY_ONLY = "Ledova records company share registers only."


def refuse_deferred_execution():
    raise PermissionDenied(REGISTRY_ONLY)


class RegistryReadOnly(BasePermission):
    message = REGISTRY_ONLY

    def has_permission(self, request, view):
        return request.method in SAFE_METHODS

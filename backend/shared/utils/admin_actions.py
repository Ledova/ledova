from django.core.exceptions import PermissionDenied
from django.shortcuts import get_object_or_404
from django.urls import path, re_path


def _require_change_permission(model_admin, request, instance=None):
    if not model_admin.has_change_permission(request, instance):
        raise PermissionDenied


def _admitted(model_admin, view):
    def admitted(request, **kwargs):
        _require_change_permission(model_admin, request)
        return view(request, **kwargs)

    return model_admin.admin_site.admin_view(admitted)


def _guarded(model_admin, view, rows):
    resolve = model_admin.get_queryset if rows is None else rows

    def guarded(request, uuid, **kwargs):
        instance = get_object_or_404(resolve(request), uuid=uuid)
        _require_change_permission(model_admin, request, instance)
        return view(request, instance, **kwargs)

    return _admitted(model_admin, guarded)


def admin_action_path(model_admin, route, name, view, rows=None):
    return path(route, _guarded(model_admin, view, rows), name=name)


def admin_action_re_path(model_admin, regex, name, view, rows=None):
    return re_path(regex, _guarded(model_admin, view, rows), name=name)


def admin_page_path(model_admin, route, name, view):
    return path(route, _admitted(model_admin, view), name=name)

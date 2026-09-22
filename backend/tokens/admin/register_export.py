from django.contrib import admin

from tokens.models import RegisterExport


@admin.register(RegisterExport)
class RegisterExportAdmin(admin.ModelAdmin):
    list_display = ["created_at", "token", "kind", "requested_by_id", "member_rows", "former_rows"]
    list_filter = ["kind", ("created_at", admin.DateFieldListFilter)]
    search_fields = ["token__symbol", "token__company__name"]
    list_select_related = ["token"]
    readonly_fields = [field.name for field in RegisterExport._meta.fields]
    actions = None

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

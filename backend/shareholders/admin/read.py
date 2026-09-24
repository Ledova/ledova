from django.contrib import admin

from shareholders.models import PublicationRead


@admin.register(PublicationRead)
class PublicationReadAdmin(admin.ModelAdmin):
    list_display = ["created_at", "actor_id", "publication_uuid", "recipient_uuid", "event_uuid", "kind"]
    list_filter = ["kind", "created_at"]
    search_fields = ["publication_uuid", "recipient_uuid", "event_uuid"]
    readonly_fields = [field.name for field in PublicationRead._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

from django.contrib import admin

from users.models.notification_preferences import NotificationPreferences


@admin.register(NotificationPreferences)
class NotificationPreferencesAdmin(admin.ModelAdmin):
    list_display = ("uuid", "user_profile", "transaction_alerts", "updated_at")
    list_filter = ("transaction_alerts", "created_at", "updated_at")
    search_fields = ("user_profile__user__email", "user_profile__full_name")
    readonly_fields = ("uuid", "created_at", "updated_at")
    list_select_related = ("user_profile", "user_profile__user")
    actions = ["enable_transaction_alerts", "disable_transaction_alerts"]

    @admin.action(description="Enable transaction alerts for selected users")
    def enable_transaction_alerts(self, request, queryset):
        count = queryset.update(transaction_alerts=True)
        self.message_user(request, f"Transaction alerts enabled for {count} user(s).")

    @admin.action(description="Disable transaction alerts for selected users")
    def disable_transaction_alerts(self, request, queryset):
        count = queryset.update(transaction_alerts=False)
        self.message_user(request, f"Transaction alerts disabled for {count} user(s).")

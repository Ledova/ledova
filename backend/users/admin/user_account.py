from django.contrib import admin

from users.models import UserAccount


@admin.register(UserAccount)
class UserAccountAdmin(admin.ModelAdmin):
    list_display = ("uuid", "account_number", "activation_date", "holder", "created_at")
    search_fields = ("account_number", "user_profile__user__email", "user_profile__full_name")
    list_filter = ("activation_date", "created_at")
    readonly_fields = ("uuid", "created_at", "updated_at")

    @admin.display(description="Holder")
    def holder(self, obj):
        return obj.user_profile

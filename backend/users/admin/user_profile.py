from django.contrib import admin

from users.models.financial_profile import FinancialProfile
from users.models.user_profile import UserProfile


class FinancialProfileInline(admin.StackedInline):
    model = FinancialProfile
    extra = 0
    readonly_fields = ("uuid", "created_at", "updated_at")
    can_delete = False


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = (
        "uuid",
        "user",
        "full_name",
        "email",
        "terms_and_conditions",
        "created_at",
    )
    search_fields = ("user__email", "full_name", "residential_address")
    list_filter = (
        "terms_and_conditions",
        "created_at",
        "is_signup_completed",
    )
    readonly_fields = ("uuid", "created_at", "updated_at")
    list_select_related = ("user",)
    inlines = [FinancialProfileInline]

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if obj is not None:
            readonly.append("user")
        return readonly

    @admin.display(description="Email", ordering="user__email")
    def email(self, obj):
        return obj.user.email

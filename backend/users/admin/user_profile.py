from django.contrib import admin

from users.models import UserAccount
from users.models.financial_profile import FinancialProfile
from users.models.user_profile import UserProfile
from users.services.company_eligibility import _configuration
from whitelist.models import WhitelistInvalidationCause
from whitelist.services.eligibility_invalidation import invalidation_writer_context
from whitelist.services.refresh import enqueue_for_account


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
        "full_phone_number",
        "email",
        "citizenship_country",
        "date_of_birth",
        "is_id_verified",
        "kyc_provider",
        "review_result",
        "terms_and_conditions",
        "created_at",
    )
    search_fields = ("user__email", "full_name", "phone_country_code", "phone_number", "residential_address")
    list_filter = (
        "is_id_verified",
        "kyc_provider",
        "review_result",
        "terms_and_conditions",
        "created_at",
        "is_signup_completed",
        "confirmed_over_18",
        "confirmed_australian_resident",
        "confirmed_individual_account",
    )
    readonly_fields = ("uuid", "created_at", "updated_at")
    list_select_related = ("user", "citizenship_country")
    inlines = [FinancialProfileInline]

    def save_model(self, request, obj, form, change):
        with invalidation_writer_context(request.user):
            account = (
                UserAccount.objects.select_for_update(no_key=True).filter(user_profile_id=obj.pk).first()
                if change
                else None
            )
            previous = UserProfile.objects.select_for_update(no_key=True).get(pk=obj.pk) if change else None
            if (
                previous is not None
                and previous.is_id_verified
                and not obj.is_id_verified
                and account is not None
                and _configuration().investor_kyc_required
            ):
                enqueue_for_account(
                    account.pk,
                    request.user,
                    cause=WhitelistInvalidationCause.IDENTITY_LOSS,
                    cause_fields=["is_id_verified"],
                )
            super().save_model(request, obj, form, change)

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if obj is not None:
            readonly.append("user")
        return readonly

    @admin.display(description="Email", ordering="user__email")
    def email(self, obj):
        return obj.user.email

    @admin.display(description="Full Phone Number")
    def full_phone_number(self, obj):
        if obj.phone_country_code and obj.phone_number:
            return f"{obj.phone_country_code} {obj.phone_number}"
        return obj.phone_number or "-"

from django.contrib import admin

from users.constants import ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_PENDING
from users.models import UserAccount
from users.models.user_account import AccountRole
from users.services.company_eligibility import _configuration
from whitelist.services.eligibility_invalidation import invalidation_writer_context
from whitelist.services.refresh import enqueue_for_account


@admin.register(UserAccount)
class UserAccountAdmin(admin.ModelAdmin):
    list_display = ("uuid", "account_number", "activation_date", "holder", "created_at")
    search_fields = ("account_number", "user_profile__user__email", "user_profile__full_name")
    list_filter = ("activation_date", "created_at")
    readonly_fields = ("uuid", "activation_date", "created_at", "updated_at")

    def save_model(self, request, obj, form, change):
        with invalidation_writer_context(request.user):
            previous = UserAccount.objects.select_for_update(no_key=True).get(pk=obj.pk) if change else None
            statuses = (
                (ACCOUNT_STATUS_ACTIVE,)
                if _configuration().investor_kyc_required
                else (ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_PENDING)
            )
            roles = (AccountRole.INVESTOR, AccountRole.BOTH)
            cause_fields = []
            if previous is not None:
                if previous.account_status in statuses and obj.account_status not in statuses:
                    cause_fields.append("account_status")
                if previous.role in roles and obj.role not in roles:
                    cause_fields.append("role")
            if cause_fields:
                enqueue_for_account(obj.pk, request.user, cause_fields=cause_fields)
            super().save_model(request, obj, form, change)

    @admin.display(description="Holder")
    def holder(self, obj):
        return obj.user_profile

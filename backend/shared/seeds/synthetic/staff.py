from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission

from shared.db import atomic
from shared.seeds.demo import DEMO_ADMIN_EMAIL

User = get_user_model()

PERMISSIONS = {
    "compliance": (
        "compliance.view_compliancealert",
        "compliance.add_compliancealert",
        "compliance.change_compliancealert",
        "compliance.view_customerriskassessment",
        "compliance.change_customerriskassessment",
        "compliance.view_transactionscreening",
        "compliance.view_monitoringrule",
        "compliance.view_alertproceduretemplate",
        "compliance.view_alertprocedurestep",
        "compliance.view_alertchecklistitem",
        "compliance.change_alertchecklistitem",
        "users.view_userprofile",
        "users.view_useraccount",
        "users.change_useraccount",
        "users.view_financialprofile",
        "wallets.view_wallet",
        "wallets.view_transaction",
        "wallets.view_holding",
        "whitelist.view_whitelistentry",
        "whitelist.view_whitelistapproval",
    ),
    "operations": (
        "companies.view_company",
        "companies.change_company",
        "tokens.view_sharetoken",
        "tokens.change_sharetoken",
        "tokens.view_shareissuancerequest",
        "tokens.change_shareissuancerequest",
        "tokens.view_capitalincreaserequest",
        "tokens.change_capitalincreaserequest",
        "tokens.view_registeropening",
        "tokens.view_registerimport",
        "tokens.view_registerinstruction",
        "tokens.change_registerinstruction",
        "tokens.view_registerwalletlink",
        "operators.view_operator",
        "operators.change_operator",
        "whitelist.view_whitelistentry",
        "whitelist.change_whitelistentry",
        "whitelist.view_whitelistapproval",
        "whitelist.change_whitelistapproval",
        "wallets.view_wallet",
        "users.view_useraccount",
        "users.view_userprofile",
        "assets.view_asset",
        "assets.change_asset",
        "tokens.view_mintrequest",
        "tokens.change_mintrequest",
        "tokens.view_transferorder",
        "tokens.view_swaporder",
        "tokens.view_ordersubmission",
    ),
    "former": ("companies.view_company",),
}


def permissions(names):
    found = []
    for name in names:
        app_label, codename = name.split(".")
        found.append(Permission.objects.get(content_type__app_label=app_label, codename=codename))
    return found


def seed_staff_member(member, seeded):
    with atomic():
        user = User.objects.create_user(
            email=member.email,
            password=None,
            is_staff=True,
            is_active=member.left_at is None,
            is_email_verified=True,
            date_joined=member.joined_at,
            last_login=member.last_login,
        )
        user.user_permissions.set(permissions(PERMISSIONS[member.key]))
    seeded.users[member.key] = user
    return user


def adopt_superuser(seeded, staff_joined):
    superuser = User.objects.get(email=DEMO_ADMIN_EMAIL)
    User.objects.filter(pk=superuser.pk).update(date_joined=staff_joined - timedelta(days=3))
    seeded.users["admin"] = superuser

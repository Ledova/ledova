from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission

from shared.db import atomic
from shared.seeds.demo import DEMO_ADMIN_EMAIL

User = get_user_model()

DOCUMENT_OPERATIONS = "Document operations"
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
        "users.view_investorclassification",
        "users.change_investorclassification",
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
    "documents": (
        "companies.view_company",
        "companies.view_companydocument",
        "companies.change_companydocument",
    ),
    "operations": (
        "companies.view_company",
        "companies.change_company",
        "companies.view_companydocument",
        "offerings.view_offering",
        "offerings.change_offering",
        "offerings.view_subscription",
        "offerings.change_subscription",
        "tokens.view_sharetoken",
        "tokens.change_sharetoken",
        "tokens.view_shareissuancerequest",
        "tokens.change_shareissuancerequest",
        "tokens.view_capitalincreaserequest",
        "tokens.change_capitalincreaserequest",
        "tokens.view_registeropening",
        "tokens.change_registeropening",
        "tokens.view_registerimport",
        "tokens.change_registerimport",
        "tokens.view_registerinstruction",
        "tokens.change_registerinstruction",
        "tokens.view_registerwalletlink",
        "tokens.change_registerwalletlink",
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
        "shareholders.view_publication",
        "shareholders.change_publication",
        "shareholders.view_publicationevent",
    ),
    "former": ("companies.view_company", "offerings.view_offering"),
}
GROUPS = {"compliance": (DOCUMENT_OPERATIONS,), "documents": (DOCUMENT_OPERATIONS,)}


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
        user.groups.set(Group.objects.filter(name__in=GROUPS.get(member.key, ())))
    seeded.users[member.key] = user
    return user


def adopt_superuser(seeded, staff_joined):
    superuser = User.objects.get(email=DEMO_ADMIN_EMAIL)
    User.objects.filter(pk=superuser.pk).update(date_joined=staff_joined - timedelta(days=3))
    seeded.users["admin"] = superuser

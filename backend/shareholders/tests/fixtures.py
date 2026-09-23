from datetime import date, timedelta
from types import SimpleNamespace
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections
from django.utils import timezone
from web3 import Web3

from companies.models import Company, CompanyType
from shared.constants import BLOCKCHAIN_BASE
from shared.db import atomic, current_alias, use_migrate
from shared.tests.upload_fixtures import pdf_bytes
from shareholders.models import PublicationKind, ResolutionKind
from shareholders.services.publications import publish_to_members
from tokens.models import RegisterMemberWallet, ShareToken, ShareTokenStatus
from tokens.services.register_events import create_member, open_register
from tokens.tests.instruction_fixtures import instruction_reviewer, verified_authority
from users.models import UserAccount, UserProfile
from wallets.models import Wallet
from whitelist.models import WhitelistEntry

User = get_user_model()

DAY = date(2026, 9, 20)
PASSWORD = "pw-12345678"
PUBLICATION_BYTES = pdf_bytes()
INSTRUCTION = "SYNTHETIC-PUBLICATION-INSTRUCTION-1"
TITLE = "Annual holding statement 2026"
QUESTION = "That the company adopt the synthetic constitution tabled with this notice."
REHASH = (
    "UPDATE shareholders_publicationevent "
    "SET entry_hash = shareholders_publication_event_hash(shareholders_publicationevent) WHERE uuid = %s"
)


def an_upload(name="statement.pdf", payload=PUBLICATION_BYTES):
    return SimpleUploadedFile(name, payload, content_type="application/pdf")


def unused_address():
    return Web3.to_checksum_address("0x" + uuid4().hex + uuid4().hex[:8])


def a_person(label, name, residence="1 Synthetic Street, Sydney NSW 2000"):
    user = User.objects.create_user(email=f"{label}-{uuid4().hex[:8]}@example.test", password=PASSWORD)
    profile = UserProfile.objects.create(user=user, full_name=name, residential_address=residence)
    return user, UserAccount.objects.create(user_profile=profile)


def a_listed_wallet(account, address=None):
    address = address or unused_address()
    WhitelistEntry.objects.create(wallet=Wallet.objects.create(user_account=account, address=address, chain="base"))
    return address


def a_treasury_address(label):
    address = unused_address()
    WhitelistEntry.objects.create(address=address, label=label)
    return address


def a_share_class(label, owner):
    company = Company.objects.create(
        owner=owner,
        name=f"{label} Pty Ltd",
        company_type=CompanyType.PROPRIETARY,
        acn=str(uuid4())[:8],
    )
    token = ShareToken.objects.create(
        company=company,
        name=f"{label} ordinary shares",
        symbol=label.upper()[:6],
        total_supply="1000",
        status=ShareTokenStatus.DEPLOYED,
        contract_address=unused_address(),
        chain=BLOCKCHAIN_BASE,
        deployment_tx_hash="0x" + uuid4().hex + uuid4().hex,
    )
    return company, token


def a_member(company, *addresses):
    member = create_member(company_id=company.pk, member_id=uuid4())
    for address in addresses:
        RegisterMemberWallet.objects.create(company=company, member=member, address=address)
    return member


def a_company_with_members(label, holdings=(100, 40)):
    owner = User.objects.create_user(email=f"{label}-owner-{uuid4().hex[:8]}@example.test", password=PASSWORD)
    company, token = a_share_class(label, owner)
    staff = instruction_reviewer()
    authority = verified_authority(company, staff)
    members = []
    changes = []
    for index, shares in enumerate(holdings, 1):
        user, account = a_person(f"{label}-member{index}", f"{label.title()} Member {index}")
        address = a_listed_wallet(account)
        member = a_member(company, address)
        members.append(SimpleNamespace(member=member, user=user, account=account, address=address, shares=shares))
        changes.append({"member": str(member.pk), "shares": str(shares)})
    register = open_register(
        token_id=token.pk, operation_id=uuid4(), changes=changes, effective_on=DAY, recorded_by=owner
    ).register
    return SimpleNamespace(
        label=label,
        owner=owner,
        company=company,
        token=token,
        staff=staff,
        authority=authority,
        register=register,
        members=members,
    )


def published(world, **changes):
    fields = {
        "kind": PublicationKind.HOLDING_STATEMENT,
        "title": TITLE,
        "record_date": DAY,
        "instruction": INSTRUCTION,
        "authority_document": world.authority.pk,
        "upload": an_upload(),
        **changes,
    }
    return publish_to_members(world.token, world.staff, **fields)


def a_resolution(world, resolution_kind=ResolutionKind.ORDINARY, **changes):
    now = timezone.now()
    fields = {
        "kind": PublicationKind.RESOLUTION,
        "title": "Resolution to adopt a constitution",
        "question": QUESTION,
        "resolution_kind": resolution_kind,
        "opens_at": now - timedelta(hours=1),
        "closes_at": now + timedelta(days=7),
        "upload": an_upload("resolution.pdf"),
        **changes,
    }
    return published(world, **fields)


def as_the_schema_owner(table, trigger, *statements):
    with use_migrate():
        with atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute(f"ALTER TABLE {table} DISABLE TRIGGER {trigger}")
            for statement, parameters in statements:
                cursor.execute(statement, parameters)
            cursor.execute(f"ALTER TABLE {table} ENABLE TRIGGER {trigger}")


def the_window_moves(publication, opens_at, closes_at):
    as_the_schema_owner(
        "shareholders_publication",
        "shareholders_publication_is_frozen",
        (
            "UPDATE shareholders_publication SET opens_at = %s, closes_at = %s WHERE uuid = %s",
            [opens_at, closes_at, publication.pk],
        ),
    )
    with use_migrate():
        publication.refresh_from_db()
    return publication


def voting_has_closed(publication):
    now = timezone.now()
    return the_window_moves(publication, now - timedelta(days=2), now - timedelta(days=1))


def voting_has_not_opened(publication):
    now = timezone.now()
    return the_window_moves(publication, now + timedelta(days=1), now + timedelta(days=2))


def the_chain_is_rewritten(*statements):
    as_the_schema_owner("shareholders_publicationevent", "shareholders_publication_event_chain", *statements)

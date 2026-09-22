import hashlib
from uuid import uuid4

import pymupdf
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from web3 import Web3

from companies.models import Company
from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from tokens.models import (
    IssuanceStatus,
    RegisterEntry,
    RegisterExport,
    RegisterMemberWallet,
    RegisterOutput,
    ShareIssuance,
    ShareToken,
)
from tokens.services.register_events import create_member, open_register, record_entry
from tokens.tests.test_register_events import DAY
from users.models import UserAccount, UserProfile
from wallets.models import Wallet
from whitelist.models import WhitelistEntry, WhitelistStatus

User = get_user_model()

LIGATURES_EXPANDED = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_PRESERVE_LIGATURES
SELLER_NAME = "Zoë O'Brien-Łukasz"
SELLER_ADDRESS = "1 Synthetic Street\nSydney NSW 2000"
BUYER_NAME = "Nguyễn Văn Tổng Hợp"
BUYER_ADDRESS = "<b>Level 3</b> & 7 Synthetic Lane\nSydney NSW 2000"
ALLOTTEE_NAME = "合成成员 <i>Holdings</i> & Co"
ALLOTTEE_ADDRESS = "8 Synthetic Road, Melbourne VIC 3000"
INSTRUCTION = "SYNTHETIC-INSTRUCTION-9"
BLANK = "_" * 22
EXECUTION = [
    "Execution",
    "Prepared unsigned on the company's written instruction, for the company to execute.",
    f"Signature {BLANK} Name {BLANK} Office held {BLANK}",
    f"Signature {BLANK} Name {BLANK} Office held {BLANK}",
    f"Date {BLANK}",
]


def unused_address():
    return Web3.to_checksum_address("0x" + uuid4().hex + uuid4().hex[:8])


def wallet_of(name, residence):
    address = unused_address()
    user = User.objects.create_user(email=f"{uuid4().hex}@example.test", password="pw-12345678")
    profile = UserProfile.objects.create(user=user, full_name=name, residential_address=residence)
    account = UserAccount.objects.create(user_profile=profile)
    WhitelistEntry.objects.create(
        wallet=Wallet.objects.create(user_account=account, address=address, chain="base"),
        status=WhitelistStatus.ACTIVE,
    )
    return address


def stamped_wallet(token, name, residence):
    address = unused_address()
    ShareIssuance.objects.create(
        token=token,
        recipient_address=address,
        recipient_name=name,
        recipient_residential_address=residence,
        identity_stamped_at=timezone.now(),
        amount="5",
        status=IssuanceStatus.COMPLETED,
        completed_at=timezone.now(),
    )
    return address


def member_of(company, *addresses):
    member = create_member(company_id=company.pk, member_id=uuid4())
    for address in addresses:
        RegisterMemberWallet.objects.create(company=company, member=member, address=address)
    return member


def opened(token, member, shares):
    return open_register(
        token_id=token.pk,
        operation_id=uuid4(),
        changes=[{"member": str(member.pk), "shares": str(shares)}],
        effective_on=DAY,
        recorded_by=token.company.owner,
    ).register


def entered(register, kind, *changes, **kwargs):
    return record_entry(
        register_id=register.pk,
        operation_id=uuid4(),
        kind=kind,
        changes=[{"member": str(member.pk), "shares": str(shares)} for member, shares in changes],
        effective_on=DAY,
        recorded_by=register.company.owner,
        **kwargs,
    )


def pages_of(content):
    with pymupdf.open(stream=content, filetype="pdf") as document:
        return [
            [" ".join(block[4].split()) for block in page.get_text("blocks", flags=LIGATURES_EXPANDED)]
            for page in document
        ]


def particulars(number, name, address, shares, holding, entry):
    return [
        "Share certificate",
        f"Certificate number: {number}",
        "Company: Synthetic Certificates Pty Ltd",
        "ACN: 123456789",
        "Share class: Synthetic ordinary shares (CERT)",
        f"Member: {name}",
        f"Residential address: {address}",
        f"Shares: {shares}",
        f"Holding in the class after entry {entry.sequence}: {holding}",
        f"Register entry: {entry.sequence}, dated 2026-09-20",
        f"Entry hash: {entry.entry_hash}",
        *EXECUTION,
    ]


@override_settings(STORAGES=ADMIN_STORAGES)
class CertificateTest(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="certificates-owner@example.test", password="pw-12345678")
        self.company = Company.objects.create(owner=self.owner, name="Synthetic Certificates Pty Ltd", acn="123456789")
        self.token = ShareToken.objects.create(
            company=self.company, name="Synthetic ordinary shares", symbol="CERT", total_supply="1000"
        )
        self.seller = member_of(self.company, wallet_of(SELLER_NAME, SELLER_ADDRESS))
        self.buyer = member_of(self.company, wallet_of(BUYER_NAME, BUYER_ADDRESS))
        self.allottee = member_of(self.company, wallet_of(ALLOTTEE_NAME, ALLOTTEE_ADDRESS))
        self.register = opened(self.token, self.seller, 100)
        entered(self.register, "issue", (self.allottee, 25))
        entered(self.register, "transfer", (self.seller, -40), (self.buyer, 40))
        entered(self.register, "transfer", (self.seller, -60), (self.buyer, 60))
        self.staff = grant(staff_user("certificates"), admin.site._registry[RegisterOutput], "change")
        self.client.force_login(self.staff)

    def page(self, token=None):
        return reverse("admin:tokens_registeroutput_certificate", args=[(token or self.token).pk])

    def prepare(self, sequence, token=None, instruction=INSTRUCTION):
        return self.client.post(self.page(token), {"sequence": sequence, "instruction": instruction})

    def entry(self, sequence, register=None):
        return RegisterEntry.objects.get(register=register or self.register, sequence=sequence)

    def test_a_transfer_certifies_the_transferee_and_the_transferors_balance_as_they_stood_after_the_entry(self):
        response = self.prepare(3)

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "application/pdf"))
        self.assertEqual(response["Content-Disposition"], 'attachment; filename="certificate-CERT-3.pdf"')
        entry = self.entry(3)
        self.assertEqual(
            pages_of(response.content),
            [
                particulars(
                    "3-1",
                    BUYER_NAME,
                    "<b>Level 3</b> & 7 Synthetic Lane Sydney NSW 2000",
                    "40, transferred to the member by entry 3",
                    40,
                    entry,
                ),
                particulars(
                    "3-2",
                    SELLER_NAME,
                    "1 Synthetic Street Sydney NSW 2000",
                    "60, the balance the member holds after the transfer in entry 3",
                    60,
                    entry,
                ),
            ],
        )
        record = RegisterExport.objects.get()
        self.assertEqual(record.digest, hashlib.sha256(response.content).hexdigest())
        self.assertEqual(
            (record.kind, record.token_id, record.requested_by_id, record.register_sequence, record.instruction),
            ("certificate", self.token.pk, self.staff.pk, 3, INSTRUCTION),
        )
        self.assertEqual(
            (record.member_rows, record.former_rows, record.recipient, record.requested_on, record.late),
            (2, 0, "", None, None),
        )

    def test_an_issue_certifies_its_allottee_with_the_name_and_address_printed_as_recorded(self):
        first = self.prepare(2)
        again = self.prepare(2)

        entry = self.entry(2)
        self.assertEqual(
            pages_of(first.content),
            [particulars("2-1", ALLOTTEE_NAME, ALLOTTEE_ADDRESS, "25, issued to the member by entry 2", 25, entry)],
        )
        self.assertEqual(again.content, first.content)
        self.assertEqual(
            list(RegisterExport.objects.values_list("digest", "member_rows")),
            [(hashlib.sha256(first.content).hexdigest(), 1)] * 2,
        )

    def test_a_transferor_who_keeps_no_shares_has_no_balance_certificate(self):
        response = self.prepare(4)

        self.assertEqual(
            pages_of(response.content),
            [
                particulars(
                    "4-1",
                    BUYER_NAME,
                    "<b>Level 3</b> & 7 Synthetic Lane Sydney NSW 2000",
                    "60, transferred to the member by entry 4",
                    100,
                    self.entry(4),
                )
            ],
        )
        self.assertEqual(RegisterExport.objects.get().member_rows, 1)

    def test_refusals_record_nothing_and_an_accepted_entry_records_exactly_one_certificate(self):
        unidentified = member_of(self.company, unused_address())
        ambiguous = member_of(self.company, wallet_of("Ann Synthetic", "2 Synthetic Street"), wallet_of("Bob", "3 St"))
        homeless = member_of(self.company, wallet_of("Una Synthetic", ""))
        nameless = member_of(self.company, stamped_wallet(self.token, "", "5 Synthetic Street"))
        entered(self.register, "issue", (unidentified, 5))
        entered(self.register, "issue", (ambiguous, 5))
        entered(self.register, "issue", (homeless, 5))
        entered(self.register, "issue", (nameless, 5))
        entered(self.register, "transfer", (unidentified, -2), (self.buyer, 2))
        mistaken = entered(self.register, "issue", (self.buyer, 1))
        entered(self.register, "correction", (self.buyer, -1), corrects_id=mistaken.pk)
        for sequence, instruction, refusal in (
            (1, INSTRUCTION, "Entry 1 is not an issue or a transfer, so it has no certificate."),
            (11, INSTRUCTION, "Entry 11 is not an issue or a transfer, so it has no certificate."),
            (12, INSTRUCTION, "This share class&#x27;s register has no entry 12."),
            (5, INSTRUCTION, f"Certificate 5-1 cannot be prepared: member {unidentified.pk} is not identified"),
            (6, INSTRUCTION, f"Certificate 6-1 cannot be prepared: member {ambiguous.pk}&#x27;s wallets resolve"),
            (7, INSTRUCTION, f"Certificate 7-1 cannot be prepared: member {homeless.pk} is not identified"),
            (8, INSTRUCTION, f"Certificate 8-1 cannot be prepared: member {nameless.pk} is not identified"),
            (9, INSTRUCTION, f"Certificate 9-2 cannot be prepared: member {unidentified.pk} is not identified"),
            (2, "   ", "This field is required."),
            (0, INSTRUCTION, "Ensure this value is greater than or equal to 1."),
        ):
            with self.subTest(sequence=sequence, refusal=refusal):
                response = self.prepare(sequence, instruction=instruction)

                self.assertContains(response, refusal)
                self.assertFalse(RegisterExport.objects.exists())

        accepted = self.prepare(2)

        self.assertEqual((accepted.status_code, accepted["Content-Type"]), (200, "application/pdf"))
        self.assertEqual(list(RegisterExport.objects.values_list("kind", "register_sequence")), [("certificate", 2)])

    def test_an_entry_is_refused_once_a_correction_has_reversed_it(self):
        accepted = self.prepare(2)

        self.assertEqual((accepted.status_code, accepted["Content-Type"]), (200, "application/pdf"))
        self.assertEqual(list(RegisterExport.objects.values_list("kind", "register_sequence")), [("certificate", 2)])

        entered(self.register, "correction", (self.allottee, -25), corrects_id=self.entry(2).pk)
        refused = self.prepare(2)

        self.assertContains(refused, "Entry 2 was reversed by correction entry 5, so it has no certificate.")
        self.assertEqual(list(RegisterExport.objects.values_list("kind", "register_sequence")), [("certificate", 2)])

    def test_an_entry_is_certified_only_from_its_own_share_class(self):
        preference = ShareToken.objects.create(
            company=self.company, name="Synthetic preference shares", symbol="PREF", total_supply="1000"
        )
        register = opened(preference, self.allottee, 10)
        for _ in range(4):
            entered(register, "issue", (self.buyer, 1))

        refused = self.prepare(5)

        self.assertContains(refused, "This share class&#x27;s register has no entry 5.")
        self.assertFalse(RegisterExport.objects.exists())

        accepted = self.prepare(5, token=preference)

        [page] = pages_of(accepted.content)
        self.assertEqual(
            (page[4], page[10]),
            ("Share class: Synthetic preference shares (PREF)", f"Entry hash: {self.entry(5, register).entry_hash}"),
        )
        self.assertEqual(
            list(RegisterExport.objects.values_list("token_id", "register_sequence")), [(preference.pk, 5)]
        )

    def test_only_the_register_outputs_permission_opens_the_certificate_page(self):
        share_tokens = admin.site._registry[ShareToken]
        self.client.force_login(
            grant(grant(staff_user("certificate-share-token-editor"), share_tokens, "view"), share_tokens, "change")
        )

        self.assertEqual(self.client.get(self.page()).status_code, 403)
        self.assertEqual(self.prepare(2).status_code, 403)
        self.assertFalse(RegisterExport.objects.exists())

        self.client.force_login(self.staff)

        self.assertContains(
            self.client.get(reverse("admin:tokens_registeroutput_change", args=[self.token.pk])), self.page()
        )
        self.assertContains(self.client.get(self.page()), "Number of the register entry")
        self.assertEqual(self.prepare(2).status_code, 200)
        self.assertEqual(RegisterExport.objects.count(), 1)

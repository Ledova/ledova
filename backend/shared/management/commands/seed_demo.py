import logging
import os
import secrets
import time

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from companies.models import Company, CompanyStatus, CompanyType
from operators.models import Operator
from shared.db import atomic
from shared.seeds.demo import (
    DEMO_ACN,
    DEMO_ADMIN_EMAIL,
    DEMO_AUTHORIZED_SHARES,
    DEMO_COMPANY_NAME,
    DEMO_INVESTOR_ADDRESS,
    DEMO_INVESTOR_EMAIL,
    DEMO_INVESTOR_NAME,
    DEMO_ISSUER_ADDRESS,
    DEMO_OPERATOR_ACCOUNT_NUMBER,
    DEMO_OPERATOR_BANK_ACCOUNT_NAME,
    DEMO_OPERATOR_BSB,
    DEMO_OPERATOR_REFERENCE_PREFIX,
    DEMO_OWNER_EMAIL,
    DEMO_OWNER_NAME,
    DEMO_PASSWORD_ENV_VAR,
    DEMO_TOKEN_NAME,
    DEMO_TOKEN_SYMBOL,
)
from shared.seeds.synthetic.chain import layer as chain_layer
from shared.seeds.synthetic.identities import EMAIL_DOMAIN
from shared.seeds.synthetic.layer import PARTIAL, PRESENT, seed_population, summary
from shared.seeds.synthetic.market import layer as market_layer
from shared.seeds.synthetic.plan import DEFAULT_INVESTORS, MINIMUM_INVESTORS
from shared.seeds.synthetic.story import STAFF
from tokens.models import RegisterCorrectionStatus, ShareToken
from tokens.models.choices import ShareTokenStatus
from users.constants import ACCOUNT_STATUS_ACTIVE
from users.models import (
    InvestorCategory,
    InvestorClassification,
    InvestorClassificationStatus,
    UserProfile,
)
from users.models.user_account import AccountRole
from users.services.setup import ensure_defaults
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet
from wallets.models.wallet import Blockchain
from whitelist.models import WhitelistApproval, WhitelistEntry

User = get_user_model()


class Command(BaseCommand):
    help = (
        "Seed a browser-ready local demo: the operator row, a superuser, an active company with a draft "
        "share class and a verified issuer wallet, and an eligible investor whose wallet has a whitelist entry. "
        "The first run also adds six months of synthetic history: staff, investors, companies, wallets, "
        "notifications and compliance work. When the local chain (31337) is configured, the first run on it "
        "also deploys share classes, approves wallets, mints and allots shares, opens the registers and "
        "seeds offerings, applications and requests, then mints AUDY deposits, settles trades, leaves an order "
        "book and publishes notices to members; without it, nothing is written to any chain."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default=None,
            help=(
                f"Password for every seeded account. Falls back to ${DEMO_PASSWORD_ENV_VAR}, "
                "then to a generated one that is printed below."
            ),
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Seed even when DEBUG is off. This creates accounts with a known password.",
        )
        parser.add_argument(
            "--investors",
            type=int,
            default=DEFAULT_INVESTORS,
            help=(
                f"How many synthetic investors the first run creates, at least {MINIMUM_INVESTORS}. "
                "Ignored once the synthetic population exists."
            ),
        )

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError(
                "Refusing to seed: DEBUG is off. This command creates accounts with a known password. "
                "Re-run with --force only against a throwaway database."
            )
        if options["investors"] < MINIMUM_INVESTORS:
            raise CommandError(f"Seed at least {MINIMUM_INVESTORS} investors so that every state is represented.")

        password = options["password"] or os.environ.get(DEMO_PASSWORD_ENV_VAR) or secrets.token_urlsafe(12)
        self.created = 0

        with atomic():
            company, token = self._seed_testers(password)

        started = time.monotonic()
        disabled = logging.root.manager.disable
        logging.disable(max(disabled, logging.INFO))
        try:
            outcome = seed_population(timezone.now(), options["investors"])
            elapsed = time.monotonic() - started
            chain = chain_layer.seed_issuance(timezone.now()) if outcome.state == PRESENT else None
            chain_elapsed = time.monotonic() - started - elapsed
            listed = chain is not None and chain.state == chain_layer.PRESENT
            market = market_layer.seed_market(timezone.now()) if listed else None
            market_elapsed = time.monotonic() - started - elapsed - chain_elapsed
        finally:
            logging.disable(disabled)
        User.objects.filter(email__endswith=f"@{EMAIL_DOMAIN}").update(password=make_password(password))

        if options["verbosity"] >= 1:
            self.stdout.write(self.style.SUCCESS(f"Seed complete: {self.created} created."))
            self._report_population(outcome, elapsed)
            self._report_chain(chain, chain_elapsed)
            self._report_market(market, market_elapsed)
            token.refresh_from_db()
            self._report(password, company, token)

    def _seed_testers(self, password):
        self._seed_operator()
        self._seed_user(DEMO_ADMIN_EMAIL, password, superuser=True)

        owner = self._seed_user(DEMO_OWNER_EMAIL, password)
        owner_account = self._prepare_account(owner, DEMO_OWNER_NAME, AccountRole.COMPANY)
        issuer_wallet = self._seed_wallet(owner_account, DEMO_ISSUER_ADDRESS)
        company = self._seed_company(owner, issuer_wallet)
        token = self._seed_share_token(company)

        investor = self._seed_user(DEMO_INVESTOR_EMAIL, password)
        investor_account = self._prepare_account(investor, DEMO_INVESTOR_NAME, AccountRole.INVESTOR)
        investor_wallet = self._seed_wallet(investor_account, DEMO_INVESTOR_ADDRESS)
        self._seed_classification(investor_account)
        self._seed_whitelist_entry(investor_wallet)
        return company, token

    def _track(self, created):
        if created:
            self.created += 1
        return created

    def _seed_operator(self):
        operator = Operator.get()
        if operator.bank_account_name or operator.bank_bsb or operator.bank_account_number:
            return operator

        operator.bank_account_name = DEMO_OPERATOR_BANK_ACCOUNT_NAME
        operator.bank_bsb = DEMO_OPERATOR_BSB
        operator.bank_account_number = DEMO_OPERATOR_ACCOUNT_NUMBER
        operator.payment_reference_prefix = DEMO_OPERATOR_REFERENCE_PREFIX
        operator.full_clean()
        operator.save()
        self._track(True)
        return operator

    def _seed_user(self, email, password, superuser=False):
        user = User.objects.filter(email=email).first()
        if user is None:
            factory = User.objects.create_superuser if superuser else User.objects.create_user
            user = factory(email=email, password=password, is_active=True, is_email_verified=True)
            self._track(True)
            return user

        user.set_password(password)
        user.is_active = True
        user.is_email_verified = True
        user.save(update_fields=["password", "is_active", "is_email_verified"])
        return user

    def _prepare_account(self, user, full_name, role):
        profile, account, _, _ = ensure_defaults(user)

        UserProfile.objects.filter(pk=profile.pk).update(
            full_name=full_name,
            is_signup_completed=True,
            is_id_verified=True,
            terms_and_conditions=True,
        )
        account.role = role
        account.account_status = ACCOUNT_STATUS_ACTIVE
        account.save(update_fields=["role", "account_status"])
        return account

    def _seed_wallet(self, account, address):
        wallet, created = Wallet.objects.filter_by_address(address, chain=Blockchain.BASE.value).get_or_create(
            user_account=account,
            defaults={
                "address": address,
                "chain": Blockchain.BASE.value,
                "verification_status": WALLET_VERIFICATION_STATUS_VERIFIED,
                "verified_at": timezone.now(),
            },
        )
        self._track(created)
        return wallet

    def _seed_company(self, owner, issuer_wallet):
        existing = Company.objects.filter(acn=DEMO_ACN).first()
        if existing is not None and existing.owner_id != owner.id:
            raise CommandError(
                f"ACN {DEMO_ACN} already belongs to '{existing.name}', owned by someone other than "
                f"{owner.email}. Change DEMO_ACN in shared/seeds/demo.py or remove that company."
            )

        company, created = Company.objects.get_or_create(
            acn=DEMO_ACN,
            defaults={
                "owner": owner,
                "name": DEMO_COMPANY_NAME,
                "company_type": CompanyType.PROPRIETARY,
                "status": CompanyStatus.ACTIVE,
                "operator_wallet": issuer_wallet,
                "is_open_to_investors": True,
            },
        )
        self._track(created)
        if not created:
            company.status = CompanyStatus.ACTIVE
            company.operator_wallet = issuer_wallet
            company.is_open_to_investors = True
            company.save(update_fields=["status", "operator_wallet", "is_open_to_investors"])
        return company

    def _seed_share_token(self, company):
        token, created = ShareToken.objects.get_or_create(
            company=company,
            symbol=DEMO_TOKEN_SYMBOL,
            defaults={
                "name": DEMO_TOKEN_NAME,
                "total_supply": DEMO_AUTHORIZED_SHARES,
                "status": ShareTokenStatus.DRAFT,
            },
        )
        self._track(created)
        return token

    def _seed_classification(self, account):
        classification, created = InvestorClassification.objects.get_or_create(
            user_account=account,
            category=InvestorCategory.PROFESSIONAL_INVESTOR,
            defaults={
                "status": InvestorClassificationStatus.VERIFIED,
                "declaration_accepted": True,
                "declared_basis": "Seeded demo classification.",
                "submitted_at": timezone.now(),
                "reviewed_at": timezone.now(),
            },
        )
        self._track(created)
        if not created:
            classification.status = InvestorClassificationStatus.VERIFIED
            classification.expires_at = None
            classification.save(update_fields=["status", "expires_at"])
        return classification

    def _seed_whitelist_entry(self, wallet):
        entry, created = WhitelistEntry.objects.get_or_create(
            wallet=wallet,
            defaults={"notes": "Seeded demo entry. The database row only; nothing was written to a chain."},
        )
        self._track(created)
        return entry

    def _report_population(self, outcome, elapsed):
        if outcome.state == PARTIAL:
            self.stdout.write(
                self.style.WARNING(
                    "A previous run stopped part-way through the synthetic population, so nothing was added. "
                    "Start over with make dev-clean, make dev-up and make dev-seed."
                )
            )
            return
        if outcome.plan is None:
            self.stdout.write(
                "Synthetic population already present; nothing added. "
                "To start over, run make dev-clean, then make dev-up and make dev-seed."
            )
            return
        counts = summary(outcome.plan)
        companies = ", ".join(f"{count} {status.replace('_', ' ')}" for status, count in counts["companies"].items())
        alerts = ", ".join(f"{count} {status}" for status, count in counts["alert_statuses"].items())
        lines = [
            f"Synthetic population added in {elapsed:.1f}s, six months of history:",
            f"  investors   {counts['investors']}: {counts['active']} verified and active, {counts['suspended']} "
            f"suspended, {counts['terminated']} terminated, {counts['rejected']} rejected, {counts['checking']} "
            f"in identity checks, {counts['unfinished']} not finished signing up",
            f"  companies   {sum(counts['companies'].values())} ({companies}), {counts['owners']} synthetic owners",
            f"  staff       {counts['staff']} (one deactivated); {counts['alerts']} compliance alerts ({alerts})",
            f"  activity    {counts['wallets']} wallets, {counts['transactions']} wallet transactions, "
            f"{counts['claims']} classification claims, {counts['notifications']} notifications",
        ]
        self.stdout.write("\n".join(lines))

    def _report_chain(self, outcome, elapsed):
        if outcome is None:
            return
        if outcome.state == chain_layer.SKIPPED:
            self.stdout.write(f"Chain layer skipped: {outcome.reason}")
            return
        if outcome.state == chain_layer.PARTIAL:
            self.stdout.write(
                self.style.WARNING(
                    "A previous run stopped part-way through the chain layer, so nothing was added to the chain. "
                    "Start over with make dev-clean, make dev-up and make dev-seed."
                )
            )
            return
        if outcome.plan is None:
            self.stdout.write("Chain layer already present; nothing added.")
            return
        counts = outcome.counts

        def listed(values):
            return ", ".join(f"{count} {status.replace('_', ' ')}" for status, count in sorted(values.items()))

        lines = [
            f"Chain layer added in {elapsed:.1f}s, {counts['transactions']} transactions on chain "
            f"{settings.BLOCKCHAIN_CHAIN_ID}:",
            f"  share classes  {sum(counts['classes'].values())} ({listed(counts['classes'])}), "
            f"{counts['approvals']} whitelist approvals",
            f"  registers      {counts['registers']} opened from the chain and imported, {counts['members']} "
            f"members, {counts['mints']} mints",
            f"  offerings      {sum(counts['offerings'].values())} ({listed(counts['offerings'])})",
            f"  applications   {sum(counts['subscriptions'].values())} ({listed(counts['subscriptions'])})",
            f"  requests       issuance: {listed(counts['requests'])}; capital: {listed(counts['raises'])}",
        ]
        self.stdout.write("\n".join(lines))

    def _report_market(self, outcome, elapsed):
        if outcome is None:
            return
        if outcome.state == market_layer.SKIPPED:
            self.stdout.write(f"Market layer skipped: {outcome.reason}")
            return
        if outcome.state == market_layer.PARTIAL:
            self.stdout.write(
                self.style.WARNING(
                    "A previous run stopped part-way through the market layer, so nothing was added to it. "
                    "Start over with make dev-clean, make dev-up and make dev-seed."
                )
            )
            return
        if outcome.plan is None:
            self.stdout.write("Market layer already present; nothing added.")
            return
        counts = outcome.counts

        def listed(values):
            return ", ".join(f"{count} {status.replace('_', ' ')}" for status, count in sorted(values.items()))

        prices = ", ".join(f"{label} {price}" for label, price in counts["prices"].items() if price)
        lines = [
            f"Market layer added in {elapsed:.1f}s, {counts['transactions']} operator and "
            f"{counts['approvals_signed']} investor transactions on chain {settings.BLOCKCHAIN_CHAIN_ID}:",
            f"  AUDY deposits  {sum(counts['deposits'].values())} ({listed(counts['deposits'])})",
            f"  orders         {sum(counts['orders'].values())} ({listed(counts['orders'])}); "
            f"matches {listed(counts['swaps'])}",
            f"  last prices    {prices}",
            *(
                f"  held back      {owner}'s {side} of {quantity} {label} at {price}, since its match lapsed"
                for owner, side, quantity, label, price in counts["held"]
            ),
            f"  notices        {sum(counts['notices'].values())} ({listed(counts['notices'])}); resolutions "
            f"{listed(counts['resolutions'])}; {counts['ballots']} ballots, {counts['payments']} dividend payments",
        ]
        self.stdout.write("\n".join(lines))

    def _approvals(self, email):
        companies = (
            WhitelistApproval.objects.filter(entry__wallet__user_account__user_profile__user__email=email)
            .values("company")
            .distinct()
            .count()
        )
        if not companies:
            return "with a whitelist entry"
        return f"approved on chain for {companies} {'company' if companies == 1 else 'companies'}"

    def _report(self, password, company, token):
        staff = ", ".join(
            f"{handle}@{EMAIL_DOMAIN} ({title.lower()})" for _, handle, title, _, left in STAFF if not left
        )
        lines = [
            "",
            "  Dashboard   http://localhost:5174",
            "  Admin       http://localhost:8000/admin",
            "",
            f"  superuser   {DEMO_ADMIN_EMAIL}",
            f"  company     {DEMO_OWNER_EMAIL}    owns {company.name} ({company.get_status_display()})",
            f"  investor    {DEMO_INVESTOR_EMAIL}  verified wholesale, {self._approvals(DEMO_INVESTOR_EMAIL)}",
            f"  staff       {staff}",
            f"  password    {password}",
            "  Every seeded account, the synthetic staff and people included, uses that password.",
            "",
            f"  issuer wallet    {DEMO_ISSUER_ADDRESS}  (development account #0)",
            f"  investor wallet  {DEMO_INVESTOR_ADDRESS}  (development account #1)",
            "",
        ]
        if token.status == ShareTokenStatus.DRAFT:
            lines += [
                f"  Share class {token.symbol} is {token.get_status_display().lower()}. Deploying it creates the",
                "  company's whitelist registry; approve the investor's entry for the company in the admin",
                "  before minting to them. Each of those steps signs and sends a real transaction on the",
                f"  configured chain ({settings.BLOCKCHAIN_CHAIN_ID}); `make dev-up` serves chain 31337 at",
                "  http://127.0.0.1:8545.",
            ]
        else:
            opened = token.register_openings.filter(status=RegisterCorrectionStatus.APPLIED).exists()
            register = ", with its register opened" if opened else ""
            lines += [
                f"  Share class {token.symbol} is {token.get_status_display().lower()} at {token.contract_address}",
                f"  on chain {settings.BLOCKCHAIN_CHAIN_ID}{register}. Every further deployment, approval, mint",
                "  and pause signs and sends a real transaction there.",
            ]
        self.stdout.write("\n".join(lines))

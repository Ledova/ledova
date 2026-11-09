import hashlib
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model

from compliance.constants import (
    ASSESSMENT_STATUS_COMPLETE,
    ASSESSMENT_STATUS_PENDING,
    PEP_TYPE_NONE,
)
from compliance.models import CustomerRiskAssessment
from compliance.services.risk_assessment import RiskAssessmentService
from integrations.kyc.pep import pep_data_from_labels
from integrations.sumsub.client import SumSubService
from portfolios.models import Portfolio
from shared.db import atomic, use_migrate
from shared.seeds.synthetic import keys
from shared.seeds.synthetic.clock import frozen
from users.models import (
    DeviceToken,
    FinancialProfile,
    Notification,
    UserAccount,
    UserPreferences,
    UserProfile,
)
from users.services.setup import ensure_defaults
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Holding, Transaction, Wallet
from wallets.services.registration import register_wallet

User = get_user_model()

COUNTRY_CODE = "+61"


def create_identity(person, seeded):
    user = User.objects.filter(email=person.email).first()
    if user is not None:
        return _adopt_identity(person, user, seeded)
    with atomic(), frozen(person.joined_at):
        user = User.objects.create_user(
            email=person.email,
            password=None,
            is_active=True,
            is_email_verified=person.email_verified_at is not None,
            email_verification_sent_at=person.joined_at + timedelta(seconds=6),
            date_joined=person.joined_at,
        )
        if person.email_verified_at is None:
            code = int.from_bytes(keys.secret("email-code", person.key)[:4], "big") % 1_000_000
            user.email_verification_token = hashlib.sha256(f"{user.pk}:{code:06d}".encode()).hexdigest()
            user.email_verification_attempts = 1
            user.save(update_fields=["email_verification_token", "email_verification_attempts"])
        _, account, _, _ = ensure_defaults(user)
    seeded.users[person.key] = user
    seeded.accounts[person.key] = account
    return user


def _adopt_identity(person, user, seeded):
    with atomic():
        User.objects.filter(pk=user.pk).update(
            date_joined=person.joined_at, email_verification_sent_at=person.joined_at + timedelta(seconds=6)
        )
        profile, account, portfolio, preferences = ensure_defaults(user)
        UserProfile.objects.filter(pk=profile.pk).update(created_at=person.joined_at)
        UserAccount.objects.filter(pk=account.pk).update(created_at=person.joined_at)
        Portfolio.objects.filter(pk=portfolio.pk).update(created_at=person.joined_at)
        UserPreferences.objects.filter(pk=preferences.pk).update(created_at=person.joined_at)
        CustomerRiskAssessment.objects.filter(user_account=account, assessment_status=ASSESSMENT_STATUS_PENDING).update(
            created_at=person.joined_at
        )
    seeded.users[person.key] = user
    seeded.accounts[person.key] = account
    return user


def apply_person(person, seeded):
    user = seeded.users[person.key]
    with use_migrate(), atomic():
        profile = UserProfile.objects.get(user=user)
        account = profile.user_account
        _sign_up(person, user, profile, account, seeded)
        _financial_profile(person, profile)
        _identity_check(person, profile, account)
        UserPreferences.objects.filter(user_profile=profile).update(transaction_alerts=person.alerts_enabled)
        for plan in person.wallets:
            _wallet(plan, account, seeded)
        for device in person.devices:
            _device(device, user)
        if person.last_login:
            User.objects.filter(pk=user.pk).update(last_login=person.last_login)
        if person.status_changed_at:
            with frozen(person.status_changed_at):
                account.account_status = person.account_status
                account.save(update_fields=["account_status", "updated_at"])


def apply_notifications(person, seeded):
    user = seeded.users[person.key]
    with atomic():
        for note in person.notes:
            with frozen(note.at):
                notification = Notification.objects.create(
                    user=user,
                    title=note.title,
                    body=note.body,
                    notification_type=note.kind,
                    data=seeded.resolve(note.data),
                    is_read=note.read_at is not None,
                    read_at=note.read_at,
                    is_archived=note.archived,
                )
            if note.read_at:
                Notification.objects.filter(pk=notification.pk).update(updated_at=note.read_at)


def _sign_up(person, user, profile, account, seeded):
    if person.email_verified_at is None:
        return
    if person.signup_step != "account-type":
        with frozen(person.email_verified_at + timedelta(minutes=2)):
            account.role = person.role
            account.save(update_fields=["role", "updated_at"])
    if person.profiled:
        profile.full_name = person.full_name
        profile.phone_country_code = COUNTRY_CODE
        profile.phone_number = person.phone
        profile.date_of_birth = person.birth_date
        profile.residential_address = person.address
        profile.citizenship_country = seeded.countries[person.citizenship]
        profile.residence_country = seeded.countries["AU"]
    if person.signup_completed_at:
        profile.terms_and_conditions = True
        profile.is_signup_completed = True
    with frozen(person.signup_completed_at or person.email_verified_at + timedelta(minutes=6)):
        profile.save()


def _financial_profile(person, profile):
    financial = person.financial
    if financial is None:
        return
    with frozen(financial.at):
        FinancialProfile.objects.update_or_create(
            user_profile=profile,
            defaults={
                "occupation": financial.occupation,
                "source_of_funds": list(financial.source_of_funds),
                "source_of_funds_other_text": financial.source_other or None,
                "intended_use": financial.intended_use,
                "intended_use_other_text": financial.intended_other or None,
            },
        )


def _identity_check(person, profile, account):
    kyc = person.kyc
    if kyc is None:
        return
    with frozen(kyc.decided_at):
        profile.kyc_provider = kyc.provider
        profile.verification_status = kyc.status
        profile.review_result = kyc.result
        profile.rejection_labels = list(kyc.labels) or None
        profile.id_document_type = kyc.document_type
        profile.id_document_country = kyc.document_country
        if kyc.provider == "sumsub":
            profile.sumsub_verification_status = kyc.status
        if kyc.result == "GREEN":
            profile.is_id_verified = True
            profile.verified_at = kyc.decided_at
        profile.save()
        if kyc.result != "GREEN":
            return
        account.account_status = "rejected" if person.rejection_reason else "active"
        account.rejection_reason = person.rejection_reason
        if not person.rejection_reason:
            account.activation_date = kyc.decided_at
        account.save(update_fields=["account_status", "rejection_reason", "activation_date", "updated_at"])
        complete = CustomerRiskAssessment.objects.filter(
            user_account=account, assessment_status=ASSESSMENT_STATUS_COMPLETE
        ).exists()
        if not person.rejection_reason and not complete:
            evidence = [f"{kyc.pep_type}_pep"] if kyc.pep_type != PEP_TYPE_NONE else []
            pep_data = pep_data_from_labels(evidence)
            if kyc.provider == "sumsub" and kyc.pep_type != PEP_TYPE_NONE:
                pep_data = (
                    SumSubService()
                    .normalize_webhook(
                        {
                            "reviewStatus": "completed",
                            "reviewResult": {"reviewAnswer": "GREEN"},
                            "amlCase": {
                                "hits": [
                                    {
                                        "id": "synthetic-pep",
                                        "review": {"matchStatus": "true_positive"},
                                        "riskLabels": ["pep"],
                                    }
                                ]
                            },
                        }
                    )
                    .pep_data
                )
            RiskAssessmentService.calculate_and_create(user_account=account, pep_data=pep_data)


def _wallet(plan, account, seeded):
    derivation = plan.derivation
    fields = {
        "name": plan.name,
        "signing_preference": plan.signing,
        "derivation_path": derivation.path if derivation else None,
        "master_fingerprint": derivation.fingerprint if derivation else None,
        "address_index": derivation.index if derivation else None,
        "parent_public_key": derivation.parent_public_key if derivation else None,
        "parent_chain_code": derivation.parent_chain_code if derivation else None,
        "parent_derivation_path": derivation.parent_path if derivation else None,
    }
    wallet = Wallet.objects.filter_by_address(plan.address, chain=plan.chain).filter(user_account=account).first()
    if wallet is not None:
        Wallet.objects.filter(pk=wallet.pk).update(created_at=plan.registered_at, **fields)
        account.portfolios.order_by("created_at", "uuid").first().wallets.add(wallet)
        wallet.refresh_from_db()
    else:
        with frozen(plan.registered_at):
            wallet = register_wallet(user_account=account, address=plan.address, chain=plan.chain, **fields)
    if plan.verified_at:
        issued = plan.verified_at - keys.CHALLENGE_LEAD
        wallet.verification_status = WALLET_VERIFICATION_STATUS_VERIFIED
        wallet.verification_signature = keys.sign(plan.chain, plan.key, keys.challenge(plan.address, issued))
        wallet.verified_at = plan.verified_at
        wallet.verification_challenge = None
        wallet.verification_challenge_issued_at = None
        wallet.save(
            update_fields=[
                "verification_status",
                "verification_signature",
                "verified_at",
                "verification_challenge",
                "verification_challenge_issued_at",
            ]
        )
    elif plan.challenged_at:
        wallet.verification_challenge_issued_at = plan.challenged_at
        wallet.verification_challenge = keys.challenge(plan.address, plan.challenged_at)
        wallet.save(update_fields=["verification_challenge", "verification_challenge_issued_at"])
    if plan.synced_at:
        Wallet.objects.filter(pk=wallet.pk).update(last_synced_at=plan.synced_at)
    for transfer in plan.transfers:
        seeded.transactions[transfer.tx_hash] = _transaction(transfer, wallet, seeded)
    first = min((transfer.at for transfer in plan.transfers), default=None)
    for symbol, quantity in plan.holdings:
        with frozen(first + timedelta(minutes=40)):
            holding, _ = Holding.objects.update_or_create(
                wallet=wallet,
                asset=seeded.assets[symbol],
                defaults={"quantity": quantity, "last_synced_at": plan.synced_at},
            )
        Holding.objects.filter(pk=holding.pk).update(updated_at=plan.synced_at)
    return wallet


def _transaction(transfer, wallet, seeded):
    app_sent = transfer.app_sent
    sender, receiver = (
        (transfer.counterparty, wallet.address) if transfer.incoming else (wallet.address, transfer.counterparty)
    )
    with frozen(transfer.recorded_at):
        record = Transaction.objects.create(
            tx_hash=transfer.tx_hash,
            chain=transfer.chain,
            from_address=sender,
            to_address=receiver,
            asset=seeded.assets[transfer.symbol],
            amount=transfer.amount,
            market_value=transfer.market_value,
            market_value_aud=transfer.market_value_aud,
            block_timestamp=transfer.at,
            block_number=transfer.block_number,
            block_hash=transfer.block_hash,
            nonce=transfer.nonce if app_sent else None,
            status=transfer.status,
            imported_from_history=not app_sent,
            monitoring_completed_at=transfer.monitored_at,
            transaction_fee_estimated=(transfer.fee * Decimal("1.15")).quantize(transfer.fee) if app_sent else None,
            transaction_fee=transfer.fee,
            deducted_amount=Decimal(0) if app_sent else None,
            deducted_fee=Decimal(0) if app_sent else None,
            wallet=wallet,
        )
    if transfer.settled_at != transfer.recorded_at:
        Transaction.objects.filter(pk=record.pk).update(updated_at=transfer.settled_at)
    return record


def _device(device, user):
    with frozen(device.registered_at):
        token = DeviceToken.objects.create(
            user=user, push_token=device.token, device_type=device.device_type, is_active=False
        )
    DeviceToken.objects.filter(pk=token.pk).update(last_used_at=device.last_used_at)

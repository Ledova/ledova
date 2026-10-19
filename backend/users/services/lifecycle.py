import logging
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from django.utils import timezone
from rest_framework import serializers

from authentication.email import normalize_email
from authentication.managers.user import EmailLookupState
from authentication.services import TokenService
from authentication.services.sessions import resolve_signup_email
from companies.models import CompanyAppointment, CompanyAuthorityRequest
from portfolios.models import Portfolio
from shared.utils.token_amounts import plain_amount
from users.models import FinancialProfile, UserAccount, UserProfile
from users.models.user_account import AccountRole
from wallets.models import Transaction, Wallet
from whitelist.services.eligibility_invalidation import invalidation_writer_context
from whitelist.services.refresh import enqueue_for_account

logger = logging.getLogger(__name__)


def delete_account(user):
    with invalidation_writer_context(user):
        logger.info("Account deletion requested")

        account = UserAccount.objects.select_for_update(no_key=True).filter(user_profile__user_id=user.pk).first()
        user.refresh_from_db(from_queryset=user.__class__.objects.select_for_update(no_key=True))
        cause_fields = [field for field in ("is_active", "is_email_verified") if getattr(user, field)]

        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        tombstone = normalize_email(f"deleted_{user.id}_{timestamp}_{uuid4().hex}@deleted.invalid")
        if user.__class__.objects.resolve_email(tombstone).state is not EmailLookupState.ABSENT:
            raise serializers.ValidationError({"error": ["Account deletion could not be completed."]})
        user.email = tombstone
        user.is_active = False
        user.is_email_verified = False
        if cause_fields and account is not None:
            enqueue_for_account(account.pk, user, cause_fields=cause_fields)
        user.save(update_fields=["email", "is_active", "is_email_verified"])

        TokenService.revoke_all(user)

        try:
            profile = UserProfile.objects.get(user=user)
            profile.full_name = "Deleted User"
            profile.phone_country_code = None
            profile.phone_number = None
            profile.residential_address = None
            profile.date_of_birth = None
            profile.save()
        except UserProfile.DoesNotExist:
            pass

        logger.info("Account successfully deleted")


SIGNUP_ANSWERS = {
    "full_name": None,
    "phone_country_code": None,
    "phone_number": None,
    "date_of_birth": None,
    "residential_address": None,
    "citizenship_country": None,
    "residence_country": None,
    "confirmed_over_18": False,
    "confirmed_australian_resident": False,
    "confirmed_individual_account": False,
}


def restart_signup(user, email, current_password):
    with invalidation_writer_context(user):
        user.refresh_from_db(from_queryset=user.__class__.objects.select_for_update(no_key=True))
        if not user.check_password(current_password):
            raise serializers.ValidationError({"current_password": ["Current password is incorrect."]})
        profile = UserProfile.objects.select_for_update(no_key=True).get(user=user)
        if profile.is_signup_completed:
            raise serializers.ValidationError(
                {"email": ["Signup is complete, so this email can no longer be changed here."]}
            )
        if (
            CompanyAuthorityRequest.objects.filter(requester=user).exists()
            or CompanyAppointment.objects.filter(appointee=user).exists()
        ):
            raise serializers.ValidationError(
                {"email": ["Company setup has been submitted, so this email can no longer be changed."]}
            )
        destination, lookup = resolve_signup_email(email)
        if lookup.user is not None and lookup.user.pk == user.pk:
            raise serializers.ValidationError({"email": ["This is already your email address."]})
        if lookup.state is not EmailLookupState.ABSENT:
            raise serializers.ValidationError({"email": ["Email already registered"]})
        account = UserAccount.objects.select_for_update(no_key=True).filter(user_profile=profile).first()
        if user.is_email_verified and account is not None:
            enqueue_for_account(account.pk, user, cause_fields=["is_email_verified"])
        user.email = destination
        user.is_email_verified = False
        user.email_verification_token = None
        user.email_verification_attempts = 0
        user.save(
            update_fields=["email", "is_email_verified", "email_verification_token", "email_verification_attempts"]
        )
        for field, value in SIGNUP_ANSWERS.items():
            setattr(profile, field, value)
        profile.save(update_fields=[*SIGNUP_ANSWERS, "updated_at"])
        if account is not None and account.role != AccountRole.INVESTOR:
            account.role = AccountRole.INVESTOR
            account.save(update_fields=["role", "updated_at"])
        FinancialProfile.objects.filter(user_profile=profile).delete()
        TokenService.revoke_all(user)
    logger.info("Signup restarted with a new email")
    return user


def export_account_data(user):
    logger.info("Data export requested")

    data = {
        "exported_at": timezone.now(),
        "user": {
            "email": user.email,
            "date_joined": user.date_joined,
            "is_email_verified": user.is_email_verified,
        },
        "profile": None,
        "financial_profile": None,
        "account": None,
        "wallets": [],
        "transactions": [],
        "portfolios": [],
    }

    profile = getattr(user, "userprofile", None)
    if profile is None:
        return data

    data["profile"] = {
        "full_name": profile.full_name,
        "date_of_birth": profile.date_of_birth,
        "phone_country_code": profile.phone_country_code,
        "phone_number": profile.phone_number,
        "residential_address": profile.residential_address,
        "citizenship_country": profile.citizenship_country.name if profile.citizenship_country else None,
        "is_id_verified": profile.is_id_verified,
        "created_at": profile.created_at,
    }

    account = UserAccount.objects.filter(user_profile=profile).first()

    data["financial_profile"] = (
        FinancialProfile.objects.filter(user_profile=profile)
        .values(
            "occupation", "source_of_funds", "source_of_funds_other_text", "intended_use", "intended_use_other_text"
        )
        .first()
    )
    data["account"] = (
        UserAccount.objects.filter(pk=account.pk)
        .values("uuid", "account_number", "account_type", "activation_date", "created_at")
        .first()
        if account
        else None
    )
    data["wallets"] = [
        {
            "uuid": wallet.uuid,
            "name": wallet.name,
            "chain": wallet.chain,
            "address": wallet.address,
            "native_balance": str(wallet.annotated_native_balance),
            "market_value": str(wallet.annotated_market_value),
            "is_verified": wallet.is_verified,
            "created_at": wallet.created_at,
        }
        for wallet in Wallet.objects.filter(user_account=account).with_market_value()
    ]
    transactions = (
        Transaction.objects.filter(wallet__user_account=account)
        .select_related("asset", "chain_watch__latest_observation")
        .order_by("-block_timestamp")
    )
    data["transactions"] = [_exported_transaction(tx) for tx in transactions.iterator()]
    data["portfolios"] = list(
        Portfolio.objects.filter(user_account=account).values("uuid", "name", "is_active", "created_at")
    )

    logger.info("Data export completed")
    return data


def _exact_integer(value):
    return None if value is None else str(value)


def _exported_transaction(tx):
    return {
        "uuid": tx.uuid,
        "tx_hash": tx.tx_hash,
        "chain": tx.chain,
        "status": tx.status,
        "asset": tx.asset.symbol if tx.asset else None,
        "amount": plain_amount(tx.amount or Decimal(0)),
        "transaction_fee": None if tx.transaction_fee is None else plain_amount(tx.transaction_fee),
        "from_address": tx.from_address,
        "to_address": tx.to_address,
        "block_timestamp": tx.block_timestamp,
        "block_number": _exact_integer(tx.block_number),
        "block_hash": tx.block_hash,
        "nonce": _exact_integer(tx.nonce),
        "imported_from_history": tx.imported_from_history,
        "chain_observation": _latest_chain_observation(tx),
        "created_at": tx.created_at,
    }


def _latest_chain_observation(tx):
    watch = getattr(tx, "chain_watch", None)
    observation = watch.latest_observation if watch is not None else None
    if observation is None:
        return None
    return {
        "network": watch.network,
        "result": observation.result,
        "finality": observation.finality,
        "policy": observation.policy,
    }

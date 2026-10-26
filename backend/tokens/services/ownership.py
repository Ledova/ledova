from contextlib import contextmanager

from django.contrib.auth import get_user_model
from django.db.models import Count, OuterRef, Q, Subquery, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from companies.models import Company
from companies.services.administration import company_operation
from operators.models import Operator
from shared.api.search import every_word
from tokens.exceptions import RegisterChangeConflict
from tokens.models import RegisterEntry, RegisterPosition, ShareRegister, ShareToken
from tokens.services.register import _snapshot
from tokens.services.register_authority import (
    current_register_reader,
    readable_token_company_id,
)
from users.models import UserProfile


@contextmanager
def _company_snapshot(actor, company_id):
    with company_operation(actor, company_id, "register_ownership_read"), _snapshot():
        current_actor = get_object_or_404(get_user_model().objects, pk=actor.pk, is_active=True, is_email_verified=True)
        company = get_object_or_404(Company.objects, pk=company_id)
        profile = UserProfile.objects.filter(user=current_actor).first()
        if company.owner_id != current_actor.pk:
            current_register_reader(company, current_actor, profile, Operator.objects.get(pk=1))
        yield company


def _registers(tokens):
    return {
        register.token_id: register
        for register in ShareRegister.objects.filter(token__in=tokens).annotate(
            recorded_at=Subquery(
                RegisterEntry.objects.filter(register_id=OuterRef("pk"), sequence=OuterRef("sequence")).values(
                    "created_at"
                )[:1]
            )
        )
    }


def company_ownership(*, actor, company_id):
    with _company_snapshot(actor, company_id) as company:
        tokens = list(ShareToken.objects.filter(company=company).order_by("name", "uuid"))
        registers = _registers(tokens)
        positions = RegisterPosition.objects.filter(register__token__in=tokens, shares__gt=0)
        quantities = {
            row["register_id"]: row
            for row in positions.values("register_id").annotate(
                total=Sum("shares"),
                holders=Count("member_id"),
                foreign_holders=Count("pk", filter=~Q(member__company_id=company.pk)),
            )
        }
        classes = []
        complete = True
        for token in tokens:
            register = registers.get(token.pk)
            initialized = register is not None and register.sequence > 0
            quantity = quantities.get(register.pk, {}) if register else {}
            valid = (
                initialized
                and register.company_id == company.pk
                and register.recorded_at is not None
                and int(register.issued_supply) == int(quantity.get("total", 0))
                and quantity.get("foreign_holders", 0) == 0
            )
            complete = complete and valid
            classes.append(
                {
                    "uuid": token.pk,
                    "name": token.name,
                    "symbol": token.symbol,
                    "token_type": token.token_type,
                    "initialized": initialized,
                    "issued_supply": str(int(register.issued_supply)) if valid else None,
                    "total_holders": quantity.get("holders", 0) if valid else None,
                    "sequence": register.sequence if initialized else None,
                    "recorded_at": register.recorded_at if initialized else None,
                }
            )
        return {
            "company": company.pk,
            "company_name": company.name,
            "as_at": timezone.now(),
            "complete": complete,
            "issued_supply": str(sum(int(row["issued_supply"]) for row in classes)) if complete else None,
            "total_holders": positions.values("member_id").distinct().count() if complete else None,
            "classes": classes,
        }


def class_ownership_holders(*, actor, token_id, sequence, search, paginate):
    company_id = readable_token_company_id(actor, token_id)
    with _company_snapshot(actor, company_id) as company:
        token = get_object_or_404(ShareToken.objects, pk=token_id, company=company)
        register = ShareRegister.objects.filter(token=token, company=company).first()
        if register is None or register.sequence != sequence:
            raise RegisterChangeConflict()
        positions = RegisterPosition.objects.filter(register=register, shares__gt=0)
        quantity = positions.aggregate(
            total=Sum("shares"), foreign_holders=Count("pk", filter=~Q(member__company_id=company.pk))
        )
        issued = int(register.issued_supply)
        if int(quantity["total"] or 0) != issued or quantity["foreign_holders"]:
            raise ValidationError("Ownership totals are unavailable until the register is consistent.")
        matching = every_word(positions, search, "member__particulars__name").order_by("-shares", "member_id")
        page = paginate(matching.values("member_id", "shares", "member__particulars__name"))
        rows = []
        for position in page:
            shares = int(position["shares"])
            hundredths = (shares * 20000 + issued) // (issued * 2)
            rows.append(
                {
                    "member": position["member_id"],
                    "name": position["member__particulars__name"] or None,
                    "balance": str(shares),
                    "percentage": f"{hundredths // 100}.{hundredths % 100:02d}",
                }
            )
        return {
            "results": rows,
            "token": token.pk,
            "sequence": register.sequence,
            "issued_supply": str(issued),
            "as_at": timezone.now(),
        }

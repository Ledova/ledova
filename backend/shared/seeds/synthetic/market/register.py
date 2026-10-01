from collections import defaultdict
from decimal import Decimal
from uuid import uuid4

from django.db.models.functions import Lower
from web3 import Web3

from assets.models import Asset
from integrations.base_chain import get_base_chain_client
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.records import member_id
from shared.seeds.synthetic.chain.registers import authority, reference_prefix
from shared.seeds.synthetic.chain.settlement import WEI
from shared.seeds.synthetic.chain.story import CHAIRS
from shared.seeds.synthetic.market import trading
from shared.seeds.synthetic.market.population import share_holdings
from tokens.models import (
    RegisterMemberWallet,
    RegisterReconciliationStatus,
    SwapOrder,
)
from tokens.services.former_holders import fold_former_holders
from tokens.services.register_inclusions import waiting_effects
from tokens.services.register_instructions import (
    decide_instruction,
    prepare_instruction_review,
    submit_instruction,
)
from tokens.services.register_openings import (
    decide_link,
    prepare_link_review,
    submit_link,
)
from tokens.services.register_reconciliation import reconcile_register
from wallets.models import Holding
from wallets.services.holdings import sync_holding

UNMATCHED = "The {symbol} register is {status} with the chain after the trades: {detail}"
STILL_WAITING = "{count} trades of {symbol} are still waiting to be entered in its register."
NOT_APPLIED = "The {kind} for {name} ended {status}."
UNSYNCED = "The {symbol} holding of {address} could not be read from the chain."


def _prefix(company):
    return "".join(word[0] for word in (company.trading_name or company.name).split()).upper()


def _company_key(market, company_id):
    return next(key for key, company in market.companies.items() if company.pk == company_id)


def _party(swap, side):
    wallet = swap.seller_wallet if side == "seller" else swap.buyer_wallet
    return wallet.user_account.user_profile.user.email, wallet.address


def _unlinked(market, swaps):
    wanted = defaultdict(dict)
    for swap in swaps:
        company = _company_key(market, swap.share_token.company_id)
        for side in ("seller", "buyer"):
            investor, address = _party(swap, side)
            wanted[company].setdefault(address.lower(), (address, investor))
    missing = {}
    for company, addresses in wanted.items():
        linked = set(
            RegisterMemberWallet.objects.filter(company=market.companies[company])
            .annotate(lowered=Lower("address"))
            .values_list("lowered", flat=True)
        )
        rows = sorted(value for key, value in addresses.items() if key not in linked)
        if rows:
            missing[company] = rows
    return missing


def link_buyers(market, swaps):
    applied = []
    for company_key, rows in sorted(_unlinked(market, swaps).items()):
        company = market.companies[company_key]
        document = authority(
            company_key,
            "wallet-links",
            "the wallets of members who bought on the platform",
            [
                "The directors resolved to enter in the register the wallets below, each as the member who owns it,",
                "so that the transfers they settled on the platform can be recorded.",
            ],
            market,
        )
        mapping = [{"address": address, "member": str(member_id(company_key, investor))} for address, investor in rows]
        proposal = submit_link(
            actor=company.owner,
            operation_id=uuid4(),
            company_id=company.pk,
            document_id=document.pk,
            mapping=mapping,
            authority="director_resolution",
            approving_director=CHAIRS[company_key],
            authority_reference=f"{_prefix(company)}-LNK-{len(rows):02d}",
            reason="Enter the buyers' wallets as members before their transfers are recorded.",
        )
        _, confirmation = prepare_link_review(proposal_id=proposal.pk, reviewer=market.operations)
        decided = decide_link(
            proposal_id=proposal.pk, reviewer=market.operations, confirmation=confirmation, decision="apply"
        )
        if decided.status != "applied":
            raise ChainStepFailed(NOT_APPLIED.format(kind="wallet link", name=company.name, status=decided.status))
        applied.append(decided)
    return applied


def instruct_transfers(market, swaps):
    by_token = defaultdict(list)
    for swap in swaps:
        by_token[swap.share_token_id].append(swap)
    applied = []
    for token_id, settled in by_token.items():
        token = market.tokens_by_id[token_id]
        company_key = _company_key(market, token.company_id)
        items = [
            {
                "settlement": str(swap.pk),
                "seller": Web3.to_checksum_address(swap.seller_address),
                "buyer": Web3.to_checksum_address(swap.buyer_address),
                "amount": str(swap.share_amount),
            }
            for swap in settled
        ]
        total = sum(swap.share_amount for swap in settled)
        document = authority(
            company_key,
            f"transfers-{token.symbol.lower()}",
            f"transfers of {token.name} settled on the platform",
            [
                f"The directors resolved to register the {len(settled)} transfers of {token.name} settled on the",
                f"platform today, {total:,} shares in all, each from the seller's wallet to the buyer's.",
            ],
            market,
        )
        proposal = submit_instruction(
            actor=token.company.owner,
            operation_id=uuid4(),
            token_id=token.pk,
            document_id=document.pk,
            kind="transfer",
            items=items,
            approving_director=CHAIRS[company_key],
            authority_reference=f"{reference_prefix(token)}-TRF-{token.symbol}",
            reason=f"Register the {token.symbol} transfers settled on the platform.",
        )
        _, _, confirmation = prepare_instruction_review(proposal_id=proposal.pk, reviewer=market.operations)
        decided = decide_instruction(
            proposal_id=proposal.pk, reviewer=market.operations, confirmation=confirmation, decision="apply"
        )
        if decided.status != "applied":
            raise ChainStepFailed(
                NOT_APPLIED.format(kind="transfer instruction", name=token.symbol, status=decided.status)
            )
        applied.append(decided)
    return applied


def reconcile(market):
    records = []
    for token in market.tokens.values():
        fold_former_holders(token)
        record = reconcile_register(token.pk)
        if record is None or record.status != RegisterReconciliationStatus.MATCHED:
            detail = (record.discrepancies or record.failure) if record else "no applied opening"
            raise ChainStepFailed(
                UNMATCHED.format(symbol=token.symbol, status=record.status if record else "unopened", detail=detail)
            )
        waiting = waiting_effects(token.pk)
        if waiting:
            raise ChainStepFailed(STILL_WAITING.format(count=waiting, symbol=token.symbol))
        records.append(record)
    return records


def sync_parties(market, swaps):
    touched = set()
    for swap in swaps:
        for wallet in (swap.seller_wallet, swap.buyer_wallet):
            touched.add((wallet.pk, swap.share_token_id))
    synced = []
    for wallet_id, token_id in sorted(touched, key=str):
        token = market.tokens_by_id[token_id]
        holding = share_holdings(token).filter(wallet_id=wallet_id).first()
        asset = holding.asset if holding else _share_asset(token)
        wallet = next(
            item for swap in swaps for item in (swap.seller_wallet, swap.buyer_wallet) if item.pk == wallet_id
        )
        if sync_holding(wallet, asset) is None:
            raise ChainStepFailed(UNSYNCED.format(symbol=token.symbol, address=wallet.address))
        synced.append((wallet.address, token.symbol))
    return synced


def _share_asset(token):
    return Asset.objects.get(
        chain_deployments__chain="base", chain_deployments__contract_address__iexact=token.contract_address
    )


def sync_settlement(market, wallets):
    synced = []
    for wallet in sorted(wallets, key=lambda item: item.address.lower()):
        if sync_holding(wallet, market.audy) is None:
            raise ChainStepFailed(UNSYNCED.format(symbol=market.audy.symbol, address=wallet.address))
        synced.append(wallet.address)
    return synced


def seeded_ether(address):
    holding = (
        Holding.objects.filter(wallet__address__iexact=address, wallet__chain="base", asset__symbol="ETH")
        .order_by("-quantity")
        .first()
    )
    return holding.quantity if holding else Decimal(0)


def restore_ether(market):
    provider = get_base_chain_client().w3.provider
    trading.fund(market.signers, lambda address: int(seeded_ether(address) * WEI), provider)
    return len(market.signers)


def completed(market):
    return list(
        SwapOrder.objects.filter(pk__in=market.swaps).select_related(
            "seller_wallet__user_account__user_profile__user",
            "buyer_wallet__user_account__user_profile__user",
            "share_token",
        )
    )

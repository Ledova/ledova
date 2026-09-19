from unittest.mock import Mock, patch

from shared.db import use_operator
from wallets.models import WalletSubmission
from wallets.services.chain_observations import observe_wallet_chain
from wallets.services.transaction_confirmation import settle_observed_transaction


def settle_evm_transfer(wallet, tx_hash, *, succeeded=True):
    with use_operator():
        journal = WalletSubmission.objects.get(wallet=wallet, tx_hash=tx_hash)
    block_hash = "0x" + "22" * 32
    client = Mock(spec=["assert_expected_chain", "get_transaction_receipt", "w3"])
    client.assert_expected_chain.return_value = journal.chain_id
    client.get_transaction_receipt.return_value = {
        "transactionHash": tx_hash,
        "blockHash": block_hash,
        "blockNumber": 100,
        "status": int(succeeded),
        "gasUsed": 21000,
        "effectiveGasPrice": 10**9,
    }
    client.w3.eth.get_block.return_value = {"number": 100, "hash": block_hash, "timestamp": 1700000000}
    with patch("wallets.services.chain_observations.get_blockchain_client", return_value=client):
        observe_wallet_chain(journal.transaction_id)
    return settle_observed_transaction(tx_hash, wallet=wallet)

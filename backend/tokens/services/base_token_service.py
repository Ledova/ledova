from typing import Optional

from django.conf import settings
from web3 import Web3

from blockchain.models import BlockchainTransaction, TransactionStatus
from integrations.base_chain import get_base_chain_client


class BaseTokenService:

    contract_name: str = ""
    not_configured_exception: type[Exception] = Exception

    def __init__(
        self,
        contract_address: Optional[str] = None,
        signer_key: Optional[str] = None,
    ):
        self.chain_client = get_base_chain_client()
        self.contract_address = contract_address
        self.signer_key = signer_key or getattr(settings, "BLOCKCHAIN_OPERATOR_KEY", None)
        self._contract = None

    @property
    def contract(self):
        if self._contract is None:
            if not self.contract_address:
                raise self.not_configured_exception(f"{self.contract_name} contract address not configured.")
            self._contract = self.chain_client.load_contract(self.contract_name, self.contract_address)
        return self._contract

    @property
    def signer_address(self) -> str:
        if not self.signer_key:
            raise self.not_configured_exception(
                "Blockchain operator key not configured. Set BLOCKCHAIN_OPERATOR_KEY in environment."
            )
        account = self.chain_client.account_from_key(self.signer_key)
        return account.address

    def is_minter(self, address: str) -> bool:
        checksum_address = self.chain_client.to_checksum_address(address)
        return self.contract.functions.minters(checksum_address).call()

    def get_balance(self, address: str) -> int:
        checksum_address = self.chain_client.to_checksum_address(address)
        return self.contract.functions.balanceOf(checksum_address).call()

    def get_total_supply(self) -> int:
        return self.contract.functions.totalSupply().call()

    def get_decimals(self) -> int:
        return self.contract.functions.decimals().call()

    def _send_and_confirm(
        self,
        contract_function,
        tx_type: str,
        function_name: str,
        function_args: dict,
        related_model: Optional[str] = None,
        related_uuid: Optional[str] = None,
        wait_for_receipt: bool = True,
    ) -> tuple[str, BlockchainTransaction]:
        tx_record = BlockchainTransaction.objects.create(
            tx_type=tx_type,
            status=TransactionStatus.PENDING,
            from_address=self.signer_address,
            to_address=self.contract_address,
            function_name=function_name,
            function_args=function_args,
            related_model=related_model,
            related_uuid=related_uuid,
        )

        tx_hash, receipt = self.chain_client.send_transaction(
            contract_function,
            self.signer_key,
            wait_for_receipt=wait_for_receipt,
        )

        tx_record.mark_submitted(tx_hash)
        if receipt:
            tx_record.mark_confirmed(
                block_number=receipt["blockNumber"],
                block_hash=Web3.to_hex(receipt["blockHash"]),
                gas_used=receipt["gasUsed"],
            )

        return tx_hash, tx_record

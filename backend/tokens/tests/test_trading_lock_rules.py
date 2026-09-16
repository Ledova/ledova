import ast
from pathlib import Path
from unittest import TestCase

import tokens

TOKENS = Path(tokens.__file__).parent
NO_KEY_WALLET_LOCKS = {
    ("services/swap_execution.py", "_lock_authority"),
    ("services/token_transfer_service.py", "create_order_and_match"),
    ("services/trading_order_create.py", "_lock_authorized_wallet"),
}
SINGLE_ROW_ORDER_LOCKS = {("services/order_actions.py", "_authorized_order")}
QUERYSET_LOCKS = {("services/pause_changes.py", "_actor"), ("services/trading_locks.py", "lock_orders")}


def _root(node):
    called = False
    while not isinstance(node, ast.Name):
        if isinstance(node, ast.Call):
            node, called = node.func, True
        elif isinstance(node, ast.Attribute):
            node, called = node.value, False
        else:
            return None
    return "queryset" if node.id[0].islower() and not called else node.id


def _locks(node, function=None):
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.FunctionDef):
            yield from _locks(child, child.name)
        else:
            if isinstance(child, ast.Call) and getattr(child.func, "attr", None) == "select_for_update":
                yield function, child
            yield from _locks(child, function)


def _sites():
    for path in sorted(TOKENS.rglob("*.py")):
        for function, call in _locks(ast.parse(path.read_text())):
            yield str(path.relative_to(TOKENS)), function, _root(call.func.value), call


def _no_key(call):
    return any(keyword.arg == "no_key" and getattr(keyword.value, "value", None) is True for keyword in call.keywords)


class TradingLockRulesTest(TestCase):
    def test_trading_journeys_lock_wallets_for_no_key_update_only(self):
        wallet_locks = {(path, function): call for path, function, root, call in _sites() if root == "Wallet"}
        self.assertEqual(set(wallet_locks), NO_KEY_WALLET_LOCKS)
        self.assertEqual([site for site, call in wallet_locks.items() if not _no_key(call)], [])

    def test_multi_row_order_locks_go_through_lock_orders(self):
        sites = [(path, function, root) for path, function, root, _ in _sites() if path.startswith("services/")]
        self.assertEqual({site[:2] for site in sites if site[2] == "TransferOrder"}, SINGLE_ROW_ORDER_LOCKS)
        self.assertEqual({site[:2] for site in sites if site[2] == "queryset"}, QUERYSET_LOCKS)

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
ORDER_LOCK_PROBES = {
    (
        "tests/test_swap_process_concurrency.py",
        "test_order_locks_use_primary_key_order_while_selection_keeps_best_price",
    )
}
QUERYSET_LOCKS = {("services/pause_changes.py", "_actor"), ("services/trading_locks.py", "lock_orders")}
BEYOND_THE_RULE = "Raw SQL locks and saved select_for_update references are beyond this AST rule."


def _bindings(tree):
    names = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                names[alias.asname or alias.name] = alias.name
        elif isinstance(node, ast.Import):
            for alias in node.names:
                names[alias.asname or alias.name.split(".")[0]] = alias.name
    return names


def _root(node, names):
    parts, called = [], False
    while not isinstance(node, ast.Name):
        if isinstance(node, ast.Call):
            node, called = node.func, True
        elif isinstance(node, ast.Attribute):
            parts.append(node.attr)
            node, called = node.value, False
        else:
            return None
    chain = names.get(node.id, node.id).split(".") + parts[::-1]
    return next((part for part in chain if part[:1].isupper()), node.id if called else "queryset")


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
        tree = ast.parse(path.read_text())
        names = _bindings(tree)
        for function, call in _locks(tree):
            yield str(path.relative_to(TOKENS)), function, _root(call.func.value, names), call


def _no_key(call):
    return any(keyword.arg == "no_key" and getattr(keyword.value, "value", None) is True for keyword in call.keywords)


class TradingLockRulesTest(TestCase):
    def test_trading_journeys_lock_wallets_for_no_key_update_only(self):
        found = [(path, function, call) for path, function, root, call in _sites() if root == "Wallet"]
        self.assertEqual({site[:2] for site in found}, NO_KEY_WALLET_LOCKS, BEYOND_THE_RULE)
        self.assertEqual([site[:2] for site in found if not _no_key(site[2])], [], BEYOND_THE_RULE)

    def test_multi_row_order_locks_go_through_lock_orders(self):
        sites = {(path, function, root) for path, function, root, _ in _sites()}
        self.assertEqual(
            {site[:2] for site in sites if site[2] == "TransferOrder"},
            SINGLE_ROW_ORDER_LOCKS | ORDER_LOCK_PROBES,
        )
        self.assertEqual({site[:2] for site in sites if site[2] == "queryset"}, QUERYSET_LOCKS)

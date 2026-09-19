import ast
from collections import Counter
from pathlib import Path
from unittest import TestCase

import tokens

TOKENS = Path(tokens.__file__).parent
NO_KEY_AUTHORITY_LOCKS = {
    ("services/swap_execution.py", "_lock_authority"),
    ("services/token_transfer_service.py", "create_order_and_match"),
    ("services/trading_order_create.py", "_lock_authorized_wallet"),
}
FOREIGN_AUTHORITY_LOCK = ("services/token_transfer_service.py", "_lock_foreign_matching_authority")
SINGLE_ROW_ORDER_LOCKS = {("services/order_actions.py", "_authorized_order"): 1}
QUERYSET_LOCKS = {("services/pause_changes.py", "_actor"): 1, ("services/trading_locks.py", "lock_orders"): 1}
BEYOND_THE_RULE = (
    "Raw SQL locks, saved select_for_update references and models rebound to another "
    "capitalised name are beyond this AST rule."
)


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
    def test_trading_journeys_lock_wallets_and_accounts_for_no_key_update_only(self):
        for model in ("Wallet", "UserAccount"):
            with self.subTest(model=model):
                found = [(path, function, call) for path, function, root, call in _sites() if root == model]
                expected = NO_KEY_AUTHORITY_LOCKS | ({FOREIGN_AUTHORITY_LOCK} if model == "Wallet" else set())
                self.assertEqual({site[:2] for site in found}, expected, BEYOND_THE_RULE)
                self.assertEqual([site[:2] for site in found if not _no_key(site[2])], [], BEYOND_THE_RULE)

    def test_foreign_authority_locks_never_wait_behind_the_incoming_authority(self):
        calls = [call for path, function, root, call in _sites() if (path, function) == FOREIGN_AUTHORITY_LOCK]
        self.assertEqual(len(calls), 1)
        self.assertTrue(
            any(
                keyword.arg == "nowait" and getattr(keyword.value, "value", None) is True
                for keyword in calls[0].keywords
            )
        )
        self.assertEqual(
            next(ast.literal_eval(keyword.value) for keyword in calls[0].keywords if keyword.arg == "of"),
            ("self", "user_account", "user_account__user_profile", "user_account__user_profile__user"),
        )

    def test_multi_row_order_locks_go_through_lock_orders(self):
        sites = [(path, function, root) for path, function, root, _ in _sites()]
        orders = Counter(site[:2] for site in sites if site[2] == "TransferOrder")
        self.assertEqual(dict(orders), SINGLE_ROW_ORDER_LOCKS)
        self.assertEqual(dict(Counter(site[:2] for site in sites if site[2] == "queryset")), QUERYSET_LOCKS)

    def test_candidate_order_locks_never_wait(self):
        tree = ast.parse((TOKENS / "services/token_transfer_service.py").read_text())
        candidate = next(
            node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == "_match_candidate"
        )
        calls = [
            node
            for node in ast.walk(candidate)
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "lock_orders"
        ]
        self.assertEqual(len(calls), 1)
        self.assertTrue(
            any(
                keyword.arg == "nowait" and getattr(keyword.value, "value", None) is True
                for keyword in calls[0].keywords
            )
        )

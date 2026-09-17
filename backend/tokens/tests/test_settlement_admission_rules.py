import ast
from pathlib import Path
from unittest import TestCase

import tokens

TOKENS = Path(tokens.__file__).parent
TRADING_VIEW = TOKENS / "views" / "trading_order.py"
RESOLVE = "resolve_exact_swap_context"
RECHECK = "require_pending_settlement"
AUTHORITY = "_lock_authority"
SERVICE_LEGS = {
    "swap_execution": {
        "submit_signature": ("services/swap_execution.py", ("_lock_authority", "assert_current_settlement"))
    },
    "atomic_swap_service": {"broadcast_settlement_approval": ("services/atomic_swap_service.py", (RECHECK,))},
    "approval_submissions": {"record": ("services/approval_submissions.py", (RECHECK,))},
}
SETTLE_EXEMPTION = (
    "settle() deliberately performs no actor authorization: finality is not an actor's action. "
    "Drift and evidence re-verification are not authorization, and the recorded actor is "
    "re-authorized by the delivery and recovery paths, never by finality. Revise the settlement "
    "admission matrix and this exemption together, never silently."
)
BEYOND_THE_RULE = (
    "This rule follows authored call sites, lambda bodies included, through same-module helpers; "
    "calls reached only through another module's internals, dynamic dispatch or a name rebound at "
    "runtime are beyond it. The settle exemption reads settle's own call sites, not the bodies of "
    "helpers it calls: _lock_command's opt-in authority branch belongs to the delivery and recovery "
    "paths. A new swap/* route or a moved re-check must be added to the declared tables consciously."
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


def _authored_calls(function):
    def walk(node):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if isinstance(child, ast.Lambda):
                yield from walk(child)
                continue
            if isinstance(child, ast.Call):
                yield child
            yield from walk(child)

    yield from walk(function)


def _module_functions(tree):
    return {node.name: node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}


def _swap_actions(tree):
    for cls in (node for node in tree.body if isinstance(node, ast.ClassDef)):
        methods = {node.name: node for node in cls.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        for method in methods.values():
            for decorator in method.decorator_list:
                if not (isinstance(decorator, ast.Call) and getattr(decorator.func, "id", None) == "action"):
                    continue
                url_path = next((kw.value for kw in decorator.keywords if kw.arg == "url_path"), None)
                if (
                    isinstance(url_path, ast.Constant)
                    and isinstance(url_path.value, str)
                    and url_path.value.startswith("swap")
                ):
                    yield url_path.value, methods, method


def _target(call, bindings, methods, functions):
    func = call.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) and func.value.id == "self":
        return ("method", func.attr)
    if isinstance(func, ast.Name):
        if func.id in bindings:
            return ("import", bindings[func.id].split(".")[-1])
        return ("local", func.id) if func.id in functions else None
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        return ("module", bindings.get(func.value.id, func.value.id).split(".")[-1], func.attr)
    return None


def _reaches(action, methods, bindings, functions):
    imports, module_calls, frontier, seen = set(), set(), [("method", action.name)], {("method", action.name)}
    while frontier:
        kind, name = frontier.pop()
        node = methods.get(name) if kind == "method" else functions.get(name)
        if node is None:
            continue
        for call in _authored_calls(node):
            target = _target(call, bindings, methods, functions)
            if target is None:
                continue
            if target[0] in ("method", "local"):
                if target not in seen:
                    seen.add(target)
                    frontier.append(target)
            elif target[0] == "import":
                imports.add(target[1])
            else:
                module_calls.add(target[1:])
    return imports, module_calls


def _view_reach():
    tree = ast.parse(TRADING_VIEW.read_text())
    bindings = _bindings(tree)
    functions = _module_functions(tree)
    for url_path, methods, action in _swap_actions(tree):
        imports, module_calls = _reaches(action, methods, bindings, functions)
        yield url_path, action.name, imports, module_calls


class SettlementAdmissionRulesTest(TestCase):
    def test_every_swap_action_resolves_the_exact_context(self):
        missing = [f"{url_path} ({action})" for url_path, action, imports, _ in _view_reach() if RESOLVE not in imports]
        self.assertEqual(missing, [], BEYOND_THE_RULE)

    def test_every_swap_action_rechecks_before_it_answers(self):
        legs = {(module, function) for module, functions in SERVICE_LEGS.items() for function in functions}
        missing = [
            f"{url_path} ({action})"
            for url_path, action, imports, module_calls in _view_reach()
            if RECHECK not in imports and not (module_calls & legs)
        ]
        self.assertEqual(missing, [], BEYOND_THE_RULE)

    def test_the_declared_service_legs_recheck_under_their_locks(self):
        for module, functions in sorted(SERVICE_LEGS.items()):
            for function, (relative, primitives) in sorted(functions.items()):
                with self.subTest(leg=f"{module}.{function}"):
                    tree = ast.parse((TOKENS / relative).read_text())
                    bindings = _bindings(tree)
                    module_functions = _module_functions(tree)
                    self.assertIn(function, module_functions, BEYOND_THE_RULE)
                    authored = {
                        _target(call, bindings, {}, module_functions)
                        for call in _authored_calls(module_functions[function])
                    }
                    names = {target[1] if target[0] != "module" else target[2] for target in authored if target}
                    self.assertTrue(set(primitives) <= names, BEYOND_THE_RULE)

    def test_settle_performs_no_actor_authorization(self):
        tree = ast.parse((TOKENS / "services/swap_execution.py").read_text())
        bindings = _bindings(tree)
        functions = _module_functions(tree)
        settle = functions["settle"]
        forbidden = {RESOLVE, RECHECK, AUTHORITY}
        reached = set()
        for call in _authored_calls(settle):
            target = _target(call, bindings, {}, functions)
            if target:
                reached.add(target[1] if target[0] != "module" else target[2])
            for keyword in call.keywords:
                if keyword.arg == "authority" and getattr(keyword.value, "value", None) is True:
                    reached.add("authority=True")
        self.assertEqual(reached & (forbidden | {"authority=True"}), set(), SETTLE_EXEMPTION)

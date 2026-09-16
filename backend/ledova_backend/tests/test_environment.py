import sys
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from ledova_backend.chain_safety import (
    APPROVED_FINALITY_POLICIES,
    BITCOIN_TEST_GENESIS,
    local_finality_policies,
    parse_bitcoin_network,
    parse_evm_chain_id,
)
from ledova_backend.environment import (
    assert_requests_are_served_on_the_scoped_connection,
    read_bool,
    read_choice,
    resolve_storage_backend,
)
from wallets.services.bitcoin_intent import GENESIS_HASHES


class EnvironmentParsingTests(SimpleTestCase):
    def test_boolean_values_are_explicit(self):
        with patch.dict("os.environ", {"FEATURE": "true"}):
            self.assertTrue(read_bool("FEATURE", default=False))
        with patch.dict("os.environ", {"FEATURE": "false"}):
            self.assertFalse(read_bool("FEATURE", default=True))
        with patch.dict("os.environ", {"FEATURE": "1"}):
            with self.assertRaises(ImproperlyConfigured):
                read_bool("FEATURE", default=False)

    def test_choices_reject_unknown_values(self):
        with patch.dict("os.environ", {"STORAGE_BACKEND": "ftp"}):
            with self.assertRaises(ImproperlyConfigured):
                read_choice("STORAGE_BACKEND", choices=("local", "s3"), default="local")

    def test_local_storage_resolves_without_debug(self):
        with patch.dict("os.environ", {"STORAGE_BACKEND": "local"}):
            self.assertEqual(resolve_storage_backend(debug=False), "local")

    def test_evm_mainnets_are_rejected(self):
        for chain_id in ("1", "8453"):
            with self.subTest(chain_id=chain_id), self.assertRaises(ImproperlyConfigured):
                parse_evm_chain_id(chain_id, "CHAIN_ID")

    def test_supported_evm_testnets_and_local_chains_are_accepted(self):
        for chain_id in (1337, 31337, 84532, 11155111):
            with self.subTest(chain_id=chain_id):
                self.assertEqual(parse_evm_chain_id(str(chain_id), "CHAIN_ID"), chain_id)

    def test_bitcoin_mainnet_is_rejected(self):
        with self.assertRaises(ImproperlyConfigured):
            parse_bitcoin_network("main")
        self.assertEqual(parse_bitcoin_network("test"), "test")
        self.assertEqual(parse_bitcoin_network("regtest"), "regtest")

    def test_the_approved_finality_policies_name_only_the_admitted_public_networks(self):
        self.assertEqual(BITCOIN_TEST_GENESIS, GENESIS_HASHES["test"])
        self.assertEqual(
            APPROVED_FINALITY_POLICIES,
            {
                "evm:84532": {"mode": "finalized"},
                "evm:11155111": {"mode": "finalized"},
                f"bitcoin:{GENESIS_HASHES['test']}": {"mode": "depth", "depth": 6},
            },
        )
        for synthetic in (f"bitcoin:{GENESIS_HASHES['regtest']}", "evm:1337", "evm:31337"):
            with self.subTest(network=synthetic):
                self.assertNotIn(synthetic, APPROVED_FINALITY_POLICIES)
        self.assertEqual(settings.WALLET_CHAIN_FINALITY_POLICIES, APPROVED_FINALITY_POLICIES)

    def test_the_local_finality_depth_override_reaches_only_a_local_chain(self):
        self.assertEqual(local_finality_policies("", 31337), {})
        self.assertEqual(local_finality_policies("3", 31337), {"evm:31337": {"mode": "depth", "depth": 3}})
        self.assertEqual(local_finality_policies("1", 1337), {"evm:1337": {"mode": "depth", "depth": 1}})
        for value, chain_id in (("3", 84532), ("3", 11155111), ("0", 31337), ("-1", 31337), ("three", 31337)):
            with self.subTest(value=value, chain_id=chain_id), self.assertRaises(ImproperlyConfigured):
                local_finality_policies(value, chain_id)


class AuthorizationConfigurationTests(SimpleTestCase):
    def test_authentication_uses_django_model_backend(self):
        self.assertEqual(settings.AUTHENTICATION_BACKENDS, ("django.contrib.auth.backends.ModelBackend",))

    def test_default_api_permission_requires_authentication(self):
        self.assertEqual(
            settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"],
            ("rest_framework.permissions.IsAuthenticated",),
        )


class V2WithdrawalTests(SimpleTestCase):
    def test_trusted_proxy_and_log_filter_settings_are_gone(self):
        self.assertFalse(hasattr(settings, "V2_TRUSTED_PROXY_CIDRS"))
        self.assertNotIn("filters", settings.LOGGING)
        self.assertNotIn("filters", settings.LOGGING["handlers"]["procrastinate_console"])
        self.assertNotIn("ledova_backend.logging_filters", sys.modules)

    def test_challenge_models_and_delivery_task_are_gone(self):
        from django.apps import apps

        from ledova_backend.procrastinate_app import app

        names = {model.__name__ for model in apps.get_app_config("authentication").get_models()}
        self.assertEqual(names, {"CustomUser"})
        self.assertNotIn("authentication.deliver_v2_challenge", app.tasks)

    def test_session_core_modules_and_key_material_are_gone(self):
        self.assertIsNotNone(find_spec("authentication.email"))
        for module in ("authentication.services.v2_sessions", "authentication.services.v2_access"):
            with self.subTest(module=module):
                self.assertIsNone(find_spec(module))
        env_example = (Path(settings.BASE_DIR) / ".env.example").read_text()
        self.assertNotIn("V2_ACCESS_SIGNING_KEY_B64", env_example)
        self.assertNotIn("V2_REFRESH_HMAC_KEY_B64", env_example)


class LoggingTests(SimpleTestCase):
    def test_modules_log_under_their_own_name_to_the_root_console_handler(self):
        self.assertEqual(settings.LOGGING["root"], {"handlers": ["console"], "level": "INFO"})
        self.assertNotIn("ledova_backend", settings.LOGGING["loggers"])
        self.assertIn("{name}", settings.LOGGING["formatters"]["verbose"]["format"])
        self.assertIsNone(find_spec("shared.utils.logging_utils"))


class ARequestServingProcessRefusesTheUnscopedConnectionTest(SimpleTestCase):

    def test_the_scoped_alias_is_accepted(self):
        assert_requests_are_served_on_the_scoped_connection(ambient_alias="app", scoped_alias="app")

    def test_an_operator_environment_inherited_by_a_server_is_refused(self):
        with self.assertRaises(ImproperlyConfigured) as caught:
            assert_requests_are_served_on_the_scoped_connection(ambient_alias="operator", scoped_alias="app")

        self.assertIn("row-level security bypassed", str(caught.exception))

    def test_both_entrypoints_run_the_guard(self):
        for module in ("asgi.py", "wsgi.py"):
            with self.subTest(entrypoint=module):
                source = (settings.BASE_DIR / "ledova_backend" / module).read_text()
                self.assertIn("assert_requests_are_served_on_the_scoped_connection(", source)

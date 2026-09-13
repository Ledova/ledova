from importlib import import_module

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from shared.db.policies import (
    OPERATOR_ONLY,
    POLICIES,
    READS_WIDER_THAN_OWNERSHIP,
    UNSCOPED,
)
from shared.views.scope import PolicyQuerysets
from users.models import Notification


class ScopingRefusalsHappenAtImportTest(SimpleTestCase):

    def test_a_view_cannot_name_a_model_and_keep_its_own_get_queryset(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "put the product filtering in narrow()"):

            class Both(PolicyQuerysets):
                scoped_model = Notification

                def get_queryset(self):
                    return Notification.objects.all()

    def test_a_view_cannot_name_a_model_and_keep_its_own_get_object(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "get_object"):

            class Both(PolicyQuerysets):
                scoped_model = Notification

                def get_object(self):
                    return None

    def test_a_hook_without_a_model_is_refused(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "names no scoped_model"):

            class NoModel(PolicyQuerysets):
                def narrow(self, queryset):
                    return queryset

    def test_a_view_that_names_no_model_at_all_is_refused(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "names no scoped_model"):

            class Untouched(PolicyQuerysets):
                pass

    def test_a_reason_too_short_to_say_anything_does_not_buy_the_exemption(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "names no scoped_model"):

            class Terse(PolicyQuerysets):
                unscoped_by_the_base_because = "reasons"

    def test_a_view_that_says_what_scopes_it_instead_is_admitted(self):
        class Explained(PolicyQuerysets):
            unscoped_by_the_base_because = "it serves no queryset: every action is detail=False and reads the chain."

        self.assertIsNone(Explained.scoped_model)

    def test_the_exemption_does_not_descend_to_a_subclass(self):
        class Explained(PolicyQuerysets):
            unscoped_by_the_base_because = "it serves no queryset: every action is detail=False and reads the chain."

        with self.assertRaisesMessage(ImproperlyConfigured, "names no scoped_model"):

            class Heir(Explained):
                pass

    def test_a_view_cannot_both_name_a_model_and_claim_the_exemption(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "the claim is false"):

            class Contradictory(PolicyQuerysets):
                scoped_model = Notification
                unscoped_by_the_base_because = (
                    "it serves no queryset: every action is detail=False and reads the chain."
                )

    def test_an_abstract_base_is_exempt_but_its_concrete_subclass_is_not(self):
        class Base(PolicyQuerysets):
            abstract = True

        with self.assertRaisesMessage(ImproperlyConfigured, "names no scoped_model"):

            class Concrete(Base):
                pass


class OperatorActionsRequireAnExplanationTest(SimpleTestCase):

    def test_an_operator_action_that_is_neither_administrative_nor_explained_is_refused(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "says why they need it"):

            class Wider(PolicyQuerysets):
                scoped_model = Notification
                operator_actions = frozenset({"a_market_read"})
                administrative_actions = frozenset()

    def test_an_operator_action_may_say_why_it_needs_the_connection_instead(self):
        class Explained(PolicyQuerysets):
            scoped_model = Notification
            operator_actions = frozenset({"a_statutory_register"})
            administrative_actions = frozenset()
            operator_actions_because = (
                "a members' register carries the investors' own names and addresses, which no policy "
                "admits to the issuer reading it, and the issuer is entitled to it without being staff."
            )

        self.assertEqual(Explained.operator_actions, frozenset({"a_statutory_register"}))

    def test_a_reason_too_short_to_say_anything_does_not_buy_the_connection(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "says why they need it"):

            class Terse(PolicyQuerysets):
                scoped_model = Notification
                operator_actions = frozenset({"a_market_read"})
                administrative_actions = frozenset()
                operator_actions_because = "reasons"


def every_view_under(base):
    for view in base.__subclasses__():
        yield from every_view_under(view)
        if not view.__dict__.get("abstract"):
            yield view


class TheExemptionsAreTheOnesOnRecordTest(SimpleTestCase):

    EXEMPT = {
        "DirectoryTokenViewSet": "ShareToken.in_directory",
        "TradingTokenViewSet": "ShareToken.deployed_with_contract",
        "TradingTransferViewSet": None,
        "TradingWalletViewSet": None,
    }

    def views(self):
        import_module(settings.ROOT_URLCONF)
        return [view for view in every_view_under(PolicyQuerysets) if not view.__module__.startswith("shared.tests")]

    def test_the_views_that_take_the_exemption_are_the_ones_on_record(self):
        taken = {view.__name__ for view in self.views() if view.scoped_model is None}

        self.assertEqual(taken, set(self.EXEMPT))

    def test_every_other_view_names_a_model_classified_in_the_rls_catalogue(self):
        scoped = [view for view in self.views() if view.scoped_model is not None]

        self.assertGreater(len(scoped), len(self.EXEMPT))
        self.assertEqual(
            [
                view.__name__
                for view in scoped
                if view.scoped_model._meta.db_table not in set(POLICIES) | set(UNSCOPED) | set(OPERATOR_ONLY)
            ],
            [],
        )

    def test_a_view_scoped_by_something_other_than_a_queryset_names_where_that_is_recorded(self):
        by_name = {view.__name__: view for view in self.views()}

        self.assertEqual(
            [
                name
                for name, key in self.EXEMPT.items()
                if key is not None and key not in by_name[name].unscoped_by_the_base_because
            ],
            [],
        )

    def test_the_keys_those_reasons_cite_are_real_entries_in_the_catalogue(self):
        self.assertEqual(
            [key for key in self.EXEMPT.values() if key is not None and key not in READS_WIDER_THAN_OWNERSHIP], []
        )

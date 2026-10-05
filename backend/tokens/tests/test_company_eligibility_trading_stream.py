import asyncio
import json
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from asgiref.sync import async_to_sync, sync_to_async
from django.conf import settings
from django.db import connections
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APITransactionTestCase
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import AccessToken

from authentication.services.tokens import TokenService
from shared.db import current_alias, principal_of, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from tokens.services.trading_events import streamable_token_uuid
from tokens.tests.test_trading_events_authorization import _FakePubSub, _FakeRedis
from tokens.views.trading_events import (
    _authenticate_sync,
    _event_stream,
    _stream_is_current_sync,
)
from users.models import InvestorCategory, UserAccount, UserProfile
from users.tests.test_company_eligibility_read_consumers import (
    CompanyEligibilityReadCases,
)
from users.tests.test_company_eligibility_requests import REQUESTS, SOURCES


class CompanyEligibilityTradingStreamTest(CompanyEligibilityReadCases, StubUploadDependencies, APITransactionTestCase):
    def stream_request(self, actor=None, *, cookie=False, lifetime=None):
        actor = actor or self.participant
        if lifetime is None:
            access, refresh = TokenService.issue(actor)
        else:
            with patch.object(AccessToken, "lifetime", lifetime):
                access, refresh = TokenService.issue(actor)
        headers = {} if cookie else {"HTTP_AUTHORIZATION": f"Bearer {access}"}
        request = RequestFactory().get("/api/v1/trading/events/stream/", {"token": str(self.first.token_id)}, **headers)
        if cookie:
            request.COOKIES[settings.AUTH_COOKIE["access"]] = access
        return request, refresh

    def redis_event(self, *, token=None, **data):
        return {
            "type": "message",
            "data": json.dumps({"event": "order_created", "token": str(token or self.first.token_id), **data}),
        }

    def assert_closed(self, pubsub, client):
        self.assertEqual(pubsub.unsubscribed_from, pubsub.subscribed_to)
        self.assertTrue(pubsub.closed)
        self.assertTrue(client.closed)

    def test_actual_company_access_selects_exact_deployed_token_with_principal_restoration(self):
        self.accepted()
        with self.reader():
            before = principal_of()
            self.assertEqual(
                streamable_token_uuid(self.participant, str(self.first.token_id)), str(self.first.token_id)
            )
            self.assertIsNone(streamable_token_uuid(self.participant, str(uuid4())))
            self.assertIsNone(streamable_token_uuid(self.participant, "invalid"))
            self.assertEqual(principal_of(), before)
        with self.reader(self.other):
            self.assertIsNone(streamable_token_uuid(self.participant, str(self.first.token_id)))
            self.assertIsNone(streamable_token_uuid(self.other, str(self.first.token_id)))

    def test_associated_and_product_decisions_cannot_open_a_secondary_stream(self):
        for category in (InvestorCategory.ASSOCIATED_PERSON, InvestorCategory.PRODUCT_VALUE):
            with self.subTest(category=category):
                changes = {"company": str(self.company.pk)} if category == InvestorCategory.ASSOCIATED_PERSON else {}
                self.replace_source(category=category, **changes)
                terms = (
                    {"offering": str(self.first.pk), "quantity": 1}
                    if category == InvestorCategory.PRODUCT_VALUE
                    else {}
                )
                self.accepted(**terms)
                request, _ = self.stream_request()
                self.assertFalse(_stream_is_current_sync(request, self.participant.pk, str(self.first.token_id)))

    def test_live_matching_event_is_sanitized_and_foreign_events_are_not_disclosed(self):
        self.accepted()
        request, _ = self.stream_request()
        private_order = str(uuid4())
        pubsub = _FakePubSub(
            [
                self.redis_event(token=uuid4()),
                self.redis_event(data={"order_uuid": private_order}),
            ]
        )
        client = _FakeRedis(pubsub)

        async def scenario():
            with patch("tokens.views.trading_events.aioredis.from_url", return_value=client):
                stream = _event_stream(request, self.participant.pk, str(self.first.token_id))
                connected = await anext(stream)
                matched = await anext(stream)
                await stream.aclose()
            self.assertEqual(connected, 'event: connected\ndata: {"status": "ok"}\n\n')
            self.assertEqual(matched, "event: order_created\ndata: {}\n\n")
            self.assertNotIn(private_order, matched)

        async_to_sync(scenario)()
        self.assert_closed(pubsub, client)

    def test_revocation_before_connected_closes_without_emitting_a_connection_event(self):
        accepted, _ = self.accepted()
        request, _ = self.stream_request()
        self.revoke(accepted)
        pubsub = _FakePubSub([])
        client = _FakeRedis(pubsub)

        async def scenario():
            with patch("tokens.views.trading_events.aioredis.from_url", return_value=client):
                stream = _event_stream(request, self.participant.pk, str(self.first.token_id))
                with self.assertRaises(StopAsyncIteration):
                    await anext(stream)

        async_to_sync(scenario)()
        self.assert_closed(pubsub, client)

    def test_actual_revocation_after_connected_prevents_the_next_matching_event(self):
        accepted, _ = self.accepted()
        request, _ = self.stream_request()
        pubsub = _FakePubSub([self.redis_event(), self.redis_event()])
        client = _FakeRedis(pubsub)

        async def scenario():
            with patch("tokens.views.trading_events.aioredis.from_url", return_value=client):
                stream = _event_stream(request, self.participant.pk, str(self.first.token_id))
                self.assertIn("event: connected", await anext(stream))
                self.assertEqual(await anext(stream), "event: order_created\ndata: {}\n\n")
                await sync_to_async(self.revoke, thread_sensitive=True)(accepted)
                with self.assertRaises(StopAsyncIteration):
                    await anext(stream)

        async_to_sync(scenario)()
        self.assert_closed(pubsub, client)

    def test_real_request_and_source_withdrawals_stop_an_already_connected_stream(self):
        def withdraw(accepted, kind):
            self.client.force_authenticate(self.participant)
            if kind == "request":
                response = self.client.post(
                    f"{REQUESTS}{accepted.pk}/withdraw/", {"idempotency_key": str(uuid4())}, format="json"
                )
                self.assertEqual(response.status_code, 200, response.content)
            else:
                response = self.client.delete(f"{SOURCES}{self.source.pk}/")
                self.assertEqual(response.status_code, 204, response.content)

        async def scenario(accepted, kind, request, client):
            with patch("tokens.views.trading_events.aioredis.from_url", return_value=client):
                stream = _event_stream(request, self.participant.pk, str(self.first.token_id))
                self.assertIn("event: connected", await anext(stream))
                await sync_to_async(withdraw, thread_sensitive=True)(accepted, kind)
                with self.assertRaises(StopAsyncIteration):
                    await anext(stream)

        for kind in ("request", "source"):
            with self.subTest(kind=kind):
                accepted, _ = self.accepted()
                request, _ = self.stream_request()
                pubsub = _FakePubSub([self.redis_event()])
                client = _FakeRedis(pubsub)
                async_to_sync(scenario)(accepted, kind, request, client)
                self.assert_closed(pubsub, client)

    def test_actual_standing_and_identity_loss_stop_idle_heartbeats(self):
        self.accepted()
        request, _ = self.stream_request()

        def change_current_identity(field):
            with use_operator():
                if field == "account":
                    UserAccount.objects.filter(pk=self.account.pk).update(account_status="suspended")
                else:
                    UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=False)

        def restore_identity():
            with use_operator():
                UserAccount.objects.filter(pk=self.account.pk).update(account_status="active")
                UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=True)

        async def scenario(field, client):
            with patch("tokens.views.trading_events.aioredis.from_url", return_value=client), patch(
                "tokens.views.trading_events.HEARTBEAT_INTERVAL", 0
            ):
                stream = _event_stream(request, self.participant.pk, str(self.first.token_id))
                self.assertIn("event: connected", await anext(stream))
                await sync_to_async(change_current_identity, thread_sensitive=True)(field)
                with self.assertRaises(StopAsyncIteration):
                    await anext(stream)

        for field in ("account", "profile"):
            with self.subTest(field=field):
                pubsub = _FakePubSub([])
                client = _FakeRedis(pubsub)
                async_to_sync(scenario)(field, client)
                self.assert_closed(pubsub, client)
                restore_identity()

    def test_changed_actual_evidence_bytes_stop_an_open_stream(self):
        self.accepted()
        request, _ = self.stream_request()
        pubsub = _FakePubSub([self.redis_event()])
        client = _FakeRedis(pubsub)

        def alter_file():
            with self.source.evidence_file.storage.open(self.source.evidence_file.name, "wb") as evidence:
                evidence.write(pdf_bytes(width=651))

        async def scenario():
            with patch("tokens.views.trading_events.aioredis.from_url", return_value=client):
                stream = _event_stream(request, self.participant.pk, str(self.first.token_id))
                self.assertIn("event: connected", await anext(stream))
                await sync_to_async(alter_file, thread_sensitive=True)()
                with self.assertRaises(StopAsyncIteration):
                    await anext(stream)

        async_to_sync(scenario)()
        self.assert_closed(pubsub, client)

    def test_real_expiry_stops_a_heartbeat_without_a_patched_clock(self):
        self.requested_expiry = timezone.now() + timedelta(seconds=5)
        _, decision = self.accepted()
        request, _ = self.stream_request()
        pubsub = _FakePubSub([])
        client = _FakeRedis(pubsub)

        def wait_for_expiry():
            with use_operator(), connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM %s::timestamptz - clock_timestamp())) + 0.02)",
                    [decision.expires_at],
                )

        async def scenario():
            with patch("tokens.views.trading_events.aioredis.from_url", return_value=client), patch(
                "tokens.views.trading_events.HEARTBEAT_INTERVAL", 0
            ):
                stream = _event_stream(request, self.participant.pk, str(self.first.token_id))
                self.assertIn("event: connected", await anext(stream))
                await sync_to_async(wait_for_expiry, thread_sensitive=True)()
                with self.assertRaises(StopAsyncIteration):
                    await anext(stream)

        async_to_sync(scenario)()
        self.assert_closed(pubsub, client)

    def test_revoked_actual_jwt_session_stops_an_open_stream(self):
        self.accepted()

        async def scenario(request, refresh, delivery, client):
            with patch("tokens.views.trading_events.aioredis.from_url", return_value=client), patch(
                "tokens.views.trading_events.HEARTBEAT_INTERVAL", 0
            ):
                stream = _event_stream(request, self.participant.pk, str(self.first.token_id))
                self.assertIn("event: connected", await anext(stream))
                live = await anext(stream)
                self.assertEqual(
                    live, "event: order_created\ndata: {}\n\n" if delivery == "event" else ": heartbeat\n\n"
                )
                await sync_to_async(TokenService.revoke, thread_sensitive=True)(refresh)
                with self.assertRaises(StopAsyncIteration):
                    await anext(stream)

        for delivery in ("event", "heartbeat"):
            with self.subTest(delivery=delivery):
                request, refresh = self.stream_request(cookie=delivery == "heartbeat")
                pubsub = _FakePubSub([self.redis_event(), self.redis_event()] if delivery == "event" else [])
                client = _FakeRedis(pubsub)
                async_to_sync(scenario)(request, refresh, delivery, client)
                self.assert_closed(pubsub, client)

    def test_cached_real_django_session_user_without_jwt_cannot_authorize_a_stream(self):
        self.accepted()
        self.client.force_authenticate(user=None)
        self.client.force_login(self.participant)
        session = self.client.session
        session_key = session.session_key
        self.assertIsNotNone(session_key)
        self.assertTrue(session.exists(session_key))
        response = self.client.get("/api/v1/trading/events/stream/", {"token": str(self.first.token_id)})
        cached_request = response.wsgi_request
        self.assertTrue(cached_request.user.is_authenticated)
        self.assertEqual(cached_request.user.pk, self.participant.pk)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.content, b"Unauthorized")
        self.assertIsNone(_authenticate_sync(cached_request))
        self.client.logout()
        self.assertFalse(session.exists(session_key))
        self.assertTrue(cached_request.user.is_authenticated)
        self.assertIsNone(_authenticate_sync(cached_request))
        self.assertFalse(_stream_is_current_sync(cached_request, self.participant.pk, str(self.first.token_id)))

    def test_cookie_jwt_refresh_session_revocation_prevents_the_connection_event(self):
        self.accepted()
        request, refresh = self.stream_request(cookie=True)
        self.assertEqual(_authenticate_sync(request).pk, self.participant.pk)
        self.assertTrue(_stream_is_current_sync(request, self.participant.pk, str(self.first.token_id)))
        TokenService.revoke(refresh)
        self.assertIsNone(_authenticate_sync(request))
        pubsub = _FakePubSub([])
        client = _FakeRedis(pubsub)

        async def scenario():
            with patch("tokens.views.trading_events.aioredis.from_url", return_value=client):
                stream = _event_stream(request, self.participant.pk, str(self.first.token_id))
                with self.assertRaises(StopAsyncIteration):
                    await anext(stream)

        async_to_sync(scenario)()
        self.assert_closed(pubsub, client)

    def test_actual_issued_jwt_expiry_stops_events_and_heartbeats_while_refresh_session_is_live(self):
        self.accepted()

        async def scenario(request, expires, delivery, client):
            with patch("tokens.views.trading_events.aioredis.from_url", return_value=client), patch(
                "tokens.views.trading_events.HEARTBEAT_INTERVAL", 0
            ):
                stream = _event_stream(request, self.participant.pk, str(self.first.token_id))
                self.assertIn("event: connected", await anext(stream))
                live = await anext(stream)
                self.assertEqual(
                    live, "event: order_created\ndata: {}\n\n" if delivery == "event" else ": heartbeat\n\n"
                )
                leeway = api_settings.LEEWAY
                leeway_seconds = leeway.total_seconds() if isinstance(leeway, timedelta) else leeway
                await asyncio.sleep(max(0, expires + leeway_seconds - timezone.now().timestamp()) + 0.02)
                with self.assertRaises(StopAsyncIteration):
                    await anext(stream)

        for delivery in ("event", "heartbeat"):
            with self.subTest(delivery=delivery):
                cookie = delivery == "heartbeat"
                request, _ = self.stream_request(cookie=cookie, lifetime=timedelta(seconds=5))
                if cookie:
                    raw_access = request.COOKIES[settings.AUTH_COOKIE["access"]]
                else:
                    raw_access = request.META["HTTP_AUTHORIZATION"].split()[1]
                access = AccessToken(raw_access)
                with use_operator():
                    self.assertTrue(TokenService.is_session_live(access["rjti"]))
                pubsub = _FakePubSub([self.redis_event(), self.redis_event()] if delivery == "event" else [])
                client = _FakeRedis(pubsub)
                async_to_sync(scenario)(request, access["exp"], delivery, client)
                self.assert_closed(pubsub, client)
                self.assertIsNone(_authenticate_sync(request))
                with use_operator():
                    self.assertTrue(TokenService.is_session_live(access["rjti"]))
                with self.reader():
                    self.assertEqual(
                        streamable_token_uuid(self.participant, str(self.first.token_id)), str(self.first.token_id)
                    )

    def test_authenticated_actor_binding_and_every_sync_check_restore_actual_principals(self):
        self.accepted()
        participant_request, _ = self.stream_request()
        other_request, _ = self.stream_request(self.other)
        with use_operator():
            operator_before = principal_of()
        with self.reader(self.other):
            previous = principal_of()
            self.assertTrue(_stream_is_current_sync(participant_request, self.participant.pk, str(self.first.token_id)))
            self.assertEqual(principal_of(), previous)
            self.assertFalse(_stream_is_current_sync(other_request, self.participant.pk, str(self.first.token_id)))
            self.assertEqual(principal_of(), previous)
        with use_operator():
            self.assertEqual(principal_of(), operator_before)

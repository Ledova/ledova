# Auth model

[Architecture](README.md) · [Documentation](../README.md)

How sessions are authenticated, transported, revoked and reflected in client queries.

- One authentication class, `authentication.classes.HybridJWTAuthentication`, is
  the DRF default; `IsAuthenticated` is the default permission.
- Sessions are simplejwt refresh tokens with the `token_blacklist` app. A
  refresh rotates and blacklists the token presented; `signout` revokes one
  session, `signout-all` every session. The access token carries its refresh's
  jti (`rjti`) and every request checks that session is live, so revocation
  takes effect on the next request. An admin email change
  (`authentication/admin/user.py`) and an account deletion
  (`users/services/lifecycle.py`) revoke every session; a password change
  (`authentication/views/user.py`) revokes every *other*, passing its own `rjti`
  as `keep_jti`. Both tokens default to seven days.
- `X-Auth-Transport: bearer` returns the tokens in the response body and sets no
  cookie; without the header the access and refresh cookies are set (`httponly`,
  flags from `settings.AUTH_COOKIE`). The dashboard uses cookies, mobile sends
  the header.
- CSRF applies to the cookie transport only. A cookie-sourced POST, PUT, PATCH
  or DELETE runs DRF's `CSRFCheck`; invalid CSRF receives `403 CSRF Failed`. A Bearer
  request wins over an `access` cookie replayed beside it. The readable
  `csrftoken` cookie is issued by `auth/verify`, sign-in and email verification;
  the dashboard's axios client echoes it as `X-CSRFToken`.
- Sign-up requires an emailed six-digit code, hashed at rest, expiring after ten
  minutes and capped at five attempts; sign-in, sign-up, verification and resend
  are throttled per address.
- The Django admin uses ordinary Django sessions, not the JWT stack above.

## Client session queries

`packages/shared/src/hooks/useAuth.ts` owns the authentication query and exports
`AUTH_QUERY_KEY`. `ApiClientProvider` supplies each client's API instance, and
that client's `QueryClient` sets focus and reconnect behavior: the dashboard
revalidates on both, mobile only on reconnect. Authentication does not
automatically retry a failed request, but a later mount may recheck a previous
failure, now that the dashboard's `retryOnMount: false` is gone.

The hook exposes fetching separately from the first session check, so a retry
after a completed failure does not restore initial loading; public forms keep
their nested auth consumers mounted, so another failure cannot create a remount
loop. The dashboard's protected route keeps protected content hidden while a
cached negative is rechecked, and redirects after a negative answer or failure.
Signup completion still awaits its explicit auth refresh before navigating.
`packages/shared/tests/hooks/useAuth.test.tsx` and the dashboard's
`ProtectedRoute.test.tsx` cover these policies.

Both clients use the shared `useUserPreferences` and `useCurrency` hooks.
Preferences and exchange-rate queries start only after authentication; cached
preferences are hidden again when authentication is lost. Currency display keeps
the AUD fallback, USD identity conversion and an unavailable marker when a
required rate cannot be read.

Next: [auth configuration](../operations/configuration.md#auth-cookies-and-tokens) and [mobile security](mobile-security.md).

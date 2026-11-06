import { useContext, useState } from 'react';
import {
  INVITATION_CODE_PROBLEM,
  DESTINATIONS,
  failureSentence,
  failureStatus,
  formatDate,
  invitationCodeFrom,
  isInvitationCode,
  type UserFriendlyError,
} from '@ledova/shared';
import { AuthHeader, AuthLayout } from '@components/auth';
import { Field, TextInput } from '@components/Field';
import { InSignedInFrame } from '@components/InSignedInFrame';
import { Loading, LoadError, Row, Rows, Section, Failure } from '@components/Ledger';
import { FormActions, Page, PageAction, PageLink } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { clearMemberInvitation } from '@utils/memberInvitation';
import { ROOT_PATH, SIGNIN_PATH, SIGNUP_PATH } from '@utils/paths';
import { useMemberInvitation } from './useMemberInvitation';

export default function MemberInvitationPage() {
  const inFrame = useContext(InSignedInFrame);
  const [typed, setTyped] = useState('');
  const {
    hasLink,
    hasCode,
    auth,
    preferences,
    profile,
    setupRequired,
    ready,
    accepted,
    company,
    preview,
    shown,
    failure,
    busy,
    accept,
  } = useMemberInvitation(typed);
  const contents = (
    <Section title="Access to your shares">
      {!hasLink && (
        <>
          <p className="text-sm text-text-muted">
            Open the invitation link from your company’s email, or paste the link or its code here.
          </p>
          <Field
            label="Link or code from the email"
            error={typed && !isInvitationCode(typed) ? INVITATION_CODE_PROBLEM : null}
          >
            <TextInput
              value={typed}
              autoComplete="off"
              disabled={busy || accepted}
              onChange={(event) => setTyped(invitationCodeFrom(event.target.value))}
              onPaste={(event) => {
                event.preventDefault();
                setTyped(invitationCodeFrom(event.clipboardData.getData('text')));
              }}
            />
          </Field>
        </>
      )}
      {!hasCode ? null : auth.isLoading ? (
        <Loading>Checking your invitation…</Loading>
      ) : auth.isUnavailable ? (
        <LoadError retry={() => void auth.refetch()} busy={auth.isFetching}>
          Your session could not be checked.
        </LoadError>
      ) : !auth.isAuthenticated ? (
        <>
          <p className="text-sm text-text-muted">Sign in using the email address that received the invitation.</p>
        </>
      ) : preferences.isError ? (
        <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
          Your signed-in account could not be checked.
        </LoadError>
      ) : profile.profile.isError ||
        (!profile.profile.isLoading && !profile.profile.isFetching && !profile.userProfile) ? (
        <LoadError retry={() => profile.profile.refetch()} busy={profile.profile.isFetching}>
          Your account setup could not be checked.
        </LoadError>
      ) : setupRequired && !preferences.isLoading && !preferences.isFetching ? (
        <>
          <p className="text-sm text-text-muted">Complete your account setup to review this invitation.</p>
        </>
      ) : !ready ? (
        <Loading>Checking your signed-in account…</Loading>
      ) : accepted ? (
        <>
          <p role="status" className="text-sm text-text-primary">
            Invitation accepted. Your company records are available.
          </p>
        </>
      ) : preview.isError ? (
        <LoadError retry={() => preview.refetch()} busy={preview.isFetching}>
          {failureStatus((preview.error as UserFriendlyError).originalError ?? preview.error) === 404
            ? 'No invitation matches this code. Check it against the email.'
            : failureSentence(preview.error, 'Your invitation could not be checked. Reopen the invitation email.')}
        </LoadError>
      ) : shown ? (
        <>
          <Rows>
            <Row label="Company">{shown.company.name}</Row>
            <Row label="Shareholder">{shown.member.name}</Row>
            <Row label="Email">{shown.intendedEmail}</Row>
            <Row label="Accept by">{formatDate(shown.acceptanceDeadline)}</Row>
          </Rows>
          <Failure>{failure}</Failure>
          {shown.status === 'accepted' ? (
            <>
              <p role="status" className="text-sm text-text-primary">
                This invitation has already been accepted.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-text-muted">
                Accept access to your own shares and employee awards with this company.
              </p>
            </>
          )}
        </>
      ) : (
        <Loading>Loading your invitation…</Loading>
      )}
      <FormActions>
        {!(ready && (accepted || shown?.status === 'accepted')) && (
          <PageLink to={ROOT_PATH} label="Not now" onClick={clearMemberInvitation} />
        )}
        {hasCode && !auth.isLoading && !auth.isUnavailable && !auth.isAuthenticated && (
          <>
            <PageLink to={SIGNUP_PATH} label="Create account" />
            <PageLink to={SIGNIN_PATH} label="Sign in" primary />
          </>
        )}
        {hasCode &&
          auth.isAuthenticated &&
          setupRequired &&
          !preferences.isLoading &&
          !preferences.isFetching &&
          !preferences.isError &&
          !profile.profile.isError && <PageLink to={ROOT_PATH} label="Continue setup" primary />}
        {ready && company && (accepted || shown?.status === 'accepted') && (
          <PageLink
            to={`${DESTINATIONS.home.path}?${new URLSearchParams({ company })}`}
            label="View my shares"
            onClick={clearMemberInvitation}
            primary
          />
        )}
        {shown?.status === 'pending' && !accepted && (
          <PageAction
            label="Accept invitation"
            primary
            busy={busy}
            busyLabel="Accepting…"
            onClick={() => void accept()}
          />
        )}
      </FormActions>
    </Section>
  );
  return inFrame ? (
    <PageTitle.Provider value="Member invitation">
      <Page>{contents}</Page>
    </PageTitle.Provider>
  ) : (
    <AuthLayout>
      <AuthHeader title="Member invitation" />
      {contents}
    </AuthLayout>
  );
}

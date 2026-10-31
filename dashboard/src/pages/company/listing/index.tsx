import { useCompanyContext } from '@hooks/useCompanyContext';
import { useEffect, useRef, useState } from 'react';
import {
  DESTINATIONS,
  awaitsActivation,
  companyActivationOutcome,
  useCompanyActivation,
  useCompanySelection,
} from '@ledova/shared';
import { FormActions, Page, PageAction } from '@components/Page';
import { ShowMore, LinkRow, Row, Rows, Section, Timeline, type TimelineEvent, Failure } from '@components/Ledger';
import { CheckboxField } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { CompanyReadNotice, CompanyStatusMark } from '@components/CompanyState';
import { CompanyContextNotice } from '@components/CompanyContextNotice';

export default function ListingPage() {
  const context = useCompanyContext();
  const read = useCompanySelection({
    personalOnly: true,
    selectedUuid: context ? (context.companyUuid ?? '') : undefined,
  });
  return <CompanyActivation key={`${read.scopeKey}/${read.companyUuid ?? ''}`} read={read} />;
}

function CompanyActivation({ read }: { read: ReturnType<typeof useCompanySelection> }) {
  const context = useCompanyContext();
  const action = useCompanyActivation(read, () => crypto.randomUUID());
  const { company } = read;
  const opener = useRef<HTMLButtonElement>(null);
  const reviewing = useRef(false);
  useEffect(() => {
    if (action.preview) reviewing.current = true;
    else if (reviewing.current) {
      reviewing.current = false;
      opener.current?.focus();
    }
  }, [action.preview]);
  const events: TimelineEvent[] = company
    ? [
        ['Submitted', company.submittedAt],
        ['Review started', company.reviewStartedAt],
        ['Information requested', company.infoRequestedAt],
        ['Approved', company.approvedAt],
        ['Activated', company.activatedAt],
        ['Rejected', company.rejectionAt],
        ['Withdrawn', company.withdrawnAt],
      ]
        .flatMap(([label, at]) => (at ? [{ label: label!, at }] : []))
        .sort((a, b) => a.at.localeCompare(b.at))
    : [];
  return (
    <Page loading={read.isLoading}>
      <div hidden={!!action.preview} className="space-y-5">
        {action.busy && (
          <p role="status" className="text-sm text-text-muted">
            Checking activation…
          </p>
        )}
        {read.error ? (
          <CompanyReadNotice read={read} />
        ) : !company ? (
          <CompanyContextNotice />
        ) : (
          <>
            <Section title="Activation status">
              <p className="text-sm text-text-muted">
                Company information is provided by the company. Activation records your declaration and the configured
                identity and ABR checks. It does not issue shares or approve a wallet.
              </p>
              <Rows>
                <Row label="Status">
                  <CompanyStatusMark status={company.status} label={company.statusDisplay} />
                </Row>
              </Rows>
              {action.latestAttempt && (
                <div className="space-y-2 text-sm text-text-muted">
                  <p>{companyActivationOutcome(action.latestAttempt)}</p>
                  <p>This attempt was recorded from your administrator appointment.</p>
                </div>
              )}
              {events.length > 0 && (
                <ShowMore show="Show the historical record" hide="Hide the historical record">
                  <Timeline events={events} />
                  {company.rejectionReason && (
                    <p className="text-sm text-text-muted">Rejection reason: {company.rejectionReason}</p>
                  )}
                  {company.withdrawalReason && (
                    <p className="text-sm text-text-muted">Withdrawal reason: {company.withdrawalReason}</p>
                  )}
                  {company.infoRequestReason && (
                    <p className="text-sm text-text-muted">Information requested: {company.infoRequestReason}</p>
                  )}
                  {company.additionalInfoResponse && (
                    <p className="text-sm text-text-muted">Previous response: {company.additionalInfoResponse}</p>
                  )}
                </ShowMore>
              )}
              {action.canActivate && (
                <FormActions>
                  <PageAction
                    ref={opener}
                    primary
                    label={action.latestAttempt ? 'Try activation again' : 'Review activation'}
                    onClick={() => void action.open()}
                    disabled={action.busy || read.isRefreshing}
                  />
                </FormActions>
              )}
            </Section>
          </>
        )}
        {(!company || awaitsActivation(company)) && (
          <Section title="Your identity">
            <p className="text-sm text-text-muted">
              Use your own profile to complete the configured identity verification before activation.
            </p>
            <LinkRow
              to={context?.companyPath(DESTINATIONS.userProfile.path) ?? DESTINATIONS.userProfile.path}
              label={DESTINATIONS.userProfile.title}
            />
          </Section>
        )}
      </div>
      {action.preview && <ActivationConfirmation action={action} />}
      <Failure>{action.error}</Failure>
    </Page>
  );
}

function ActivationConfirmation({ action }: { action: ReturnType<typeof useCompanyActivation> }) {
  const target = action.preview!;
  const [acceptance, setAcceptance] = useState<typeof action.preview>(null);
  const accepted = acceptance === target;
  const declaration = useErrorSummary({ accepted: !accepted && 'Accept the declaration for this company.' });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div role="region" aria-label="Review company activation" className="space-y-5">
      <h2 ref={heading} tabIndex={-1} className="font-display text-xl text-text-primary focus:outline-none">
        Review activation
      </h2>
      <form
        aria-label="Activate company"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!action.busy && declaration.check()) void action.confirm(target);
        }}
      >
        <Section title={target.name}>
          <ErrorSummary {...declaration.summary} />
          <p className="whitespace-pre-wrap text-sm text-text-primary">{target.text}</p>
          <CheckboxField
            {...declaration.field('accepted')}
            label="I accept this declaration for this company."
            checked={accepted}
            disabled={action.busy}
            onChange={(event) => setAcceptance(event.target.checked ? target : null)}
          />
          <p className="text-sm text-text-muted">
            The configured ABR lookup must match before activation can be applied. A failed or unavailable check remains
            in the record.
          </p>
        </Section>
        <FormActions>
          <PageAction label="Cancel" disabled={action.busy} onClick={action.cancel} />
          <PageAction type="submit" label="Confirm activation" primary busy={action.busy} busyLabel="Activating…" />
        </FormActions>
      </form>
    </div>
  );
}

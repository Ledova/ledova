import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DESTINATIONS, companyActivationOutcome, useCompanyActivation } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { LinkRow, Row, Rows, Section, Timeline, type TimelineEvent } from '@components/Ledger';
import { Modal } from '@components/Modal';
import apiClient from '@services/apiClient';
import { useCompany } from '../hooks/useCompany';
import { CompanyReadNotice, CompanyStatusMark } from '../CompanyState';
import { CompanySelection } from '../CompanySelection';

export default function ListingPage() {
  const read = useCompany({ personalOnly: true });
  return <CompanyActivation key={`${read.scopeKey}/${read.companyUuid ?? ''}`} read={read} />;
}

function CompanyActivation({ read }: { read: ReturnType<typeof useCompany> }) {
  const navigate = useNavigate();
  const action = useCompanyActivation(apiClient, read, () => crypto.randomUUID());
  const { company } = read;
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
    <>
      <Page
        loading={read.isLoading}
        actions={<PageAction label="Back to Company" onClick={() => navigate(DESTINATIONS.company.path)} />}
      >
        <CompanySelection read={read} />
        {action.busy && (
          <p role="status" className="text-sm text-text-muted">
            Checking activation…
          </p>
        )}
        {read.error ? (
          <CompanyReadNotice read={read} />
        ) : !company ? (
          <p className="text-sm text-text-muted">
            {read.companies.length
              ? 'Choose a company above.'
              : 'A current personal administrator appointment is required to activate a company.'}
          </p>
        ) : (
          <>
            <Section title="Company activation">
              <p className="break-words text-sm text-text-primary">{company.name}</p>
              <p className="text-sm text-text-muted">
                Company information is provided by the company. Activation records your declaration and the configured
                identity and ABR checks. It does not approve an offering, issue shares or approve a wallet.
              </p>
              <Rows>
                <Row label="Status">
                  <CompanyStatusMark status={company.status} label={company.statusDisplay} />
                </Row>
              </Rows>
              {company.status === 'active' && <p className="text-sm text-text-muted">This company is active.</p>}
              {action.latestAttempt && (
                <div className="space-y-2 text-sm text-text-muted">
                  <p>{companyActivationOutcome(action.latestAttempt)}</p>
                  <p>This attempt was recorded from your administrator appointment.</p>
                </div>
              )}
              {action.canActivate && (
                <PageAction
                  label={action.latestAttempt ? 'Try activation again' : 'Review activation'}
                  onClick={() => void action.open()}
                  disabled={action.busy || read.isRefreshing}
                />
              )}
            </Section>
            {events.length > 0 && (
              <Section title="Historical record">
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
              </Section>
            )}
            <LinkRow to={DESTINATIONS.company.path} label="Company information and retained documents" />
          </>
        )}
        {action.error && (
          <p role="alert" className="text-sm text-error-light">
            {action.error}
          </p>
        )}
        <Section title={action.identityRequired ? 'Identity verification required' : 'Your identity'}>
          <p className="text-sm text-text-muted">
            Use your own profile to complete the configured identity verification before activation.
          </p>
          <LinkRow to={DESTINATIONS.userProfile.path} label="Open your profile" />
        </Section>
      </Page>
      {action.preview && <ActivationConfirmation action={action} />}
    </>
  );
}

function ActivationConfirmation({ action }: { action: ReturnType<typeof useCompanyActivation> }) {
  const target = action.preview!;
  const [acceptance, setAcceptance] = useState<typeof action.preview>(null);
  const accepted = acceptance === target;
  return (
    <Modal
      isOpen
      title="Activate company"
      showFooter
      confirmLabel="Confirm activation"
      confirmLoading={action.busy}
      confirmDisabled={!accepted}
      onClose={action.cancel}
      onConfirm={() => {
        if (accepted) void action.confirm(target);
      }}
    >
      <p className="text-sm text-text-primary">{target.name}</p>
      <p className="whitespace-pre-wrap text-sm text-text-primary">{target.text}</p>
      <label className="flex items-start gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          checked={accepted}
          disabled={action.busy}
          onChange={(event) => setAcceptance(event.target.checked ? target : null)}
        />
        I accept this declaration for this company.
      </label>
      <p className="text-sm text-text-muted">
        The configured ABR lookup must match before activation can be applied. A failed or unavailable check remains in
        the record.
      </p>
    </Modal>
  );
}

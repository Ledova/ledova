import { SelectField } from '@components/SelectField';
import { useRunningAction } from '@hooks/useRunningAction';
import { useEntryReads } from '@hooks/useEntryReads';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  DESTINATIONS,
  ELIGIBILITY_RECORDS_NOTICE,
  formatDate,
  isUuid,
  useParticipantEligibilityRecords,
  shortReference,
} from '@ledova/shared';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useCompanyNames } from '@hooks/useCompanyNames';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { clearRequestLink, linkedCompany as linkedFrom } from '@utils/requestLink';
import { LinkRow, Section, LoadError } from '@components/Ledger';
import { FormActions, Page, PageAction } from '@components/Page';
import { ActionConfirmation, EligibilityHistory, RecordsList } from '@components/eligibility';
import { Field, TextInput } from '@components/Field';
import { WalletNomination } from './WalletNomination';

export default function ParticipantEligibilityPage() {
  const [actionOpener, setActionOpener] = useState<HTMLElement | null>(null);
  const [walletHeld, setWalletHeld] = useState<{ scope: string; held: boolean } | null>(null);
  const read = useParticipantEligibilityRecords(() => crypto.randomUUID(), undefined, {
    coordinatedReads: true,
    pausedScope: walletHeld?.held ? walletHeld.scope : undefined,
  });
  const onWalletHeld = useCallback(
    (held: boolean) => {
      setWalletHeld((prior) =>
        prior?.scope === read.scopeKey && prior.held === held ? prior : { scope: read.scopeKey, held },
      );
    },
    [read.scopeKey],
  );
  useEntryReads({ scope: read.owner ? read.scopeKey : null, paused: read.readingPaused, refresh: read.refresh });
  const { running, track } = useRunningAction();
  const source = read.sources.find((item) => item.uuid === read.draft.source);
  const companyName = useCompanyNames();
  const known = useCompanyContext()?.directory.companies ?? [];
  const linkedCompany = linkedFrom(useLocation().search);
  const company = read.draft.company || linkedCompany;
  useEffect(() => {
    if (linkedCompany) clearRequestLink();
  }, [linkedCompany]);
  const request = useErrorSummary({
    source: !source && 'Choose your evidence source.',
    company: !isUuid(company) && 'Choose the company.',
    requestedExpiresAt:
      !Number.isFinite(Date.parse(read.draft.requestedExpiresAt)) && 'Enter the requested expiry date and time.',
  });
  return (
    <Page loading={read.loading} lede={ELIGIBILITY_RECORDS_NOTICE}>
      {!read.owner ? (
        <p>Your signed-in account must be checked before opening these records.</p>
      ) : (
        <>
          {read.readFailed && (
            <LoadError retry={() => read.refresh()} busy={read.refreshing || read.busy}>
              Your company eligibility requests could not be loaded.
            </LoadError>
          )}
          {(read.readFailed ? read.failure : read.error) && (
            <p role="alert" className="text-sm text-error-light">
              {read.readFailed ? read.failure : read.error}
            </p>
          )}
          <div hidden={!!read.action} className="flex flex-col gap-5">
            <Section title="Prepare a request for one company">
              <ErrorSummary {...request.summary} />
              <LinkRow to={DESTINATIONS.investorEligibility.path} label={DESTINATIONS.investorEligibility.title} />
              <p className="text-sm text-text-muted">
                Choose your evidence and one of your companies, or open the request link a company sent you. You see the
                company&apos;s name before anything is sent.
              </p>
              <SelectField
                {...request.field('source')}
                label="Your evidence source"
                options={[
                  { value: '', label: 'Select a source' },
                  ...read.sources.map((item) => ({
                    value: item.uuid,
                    label: `${item.categoryDisplay} · ${item.statusDisplay} · ${formatDate(item.createdAt)}`,
                    reference: shortReference(item.uuid),
                  })),
                ]}
                value={read.draft.source}
                onChange={(source) => {
                  request.reset();
                  read.updateDraft({ source });
                }}
              />
              <SelectField
                {...request.field('company')}
                label="Company"
                options={[
                  { value: '', label: 'Select a company' },
                  ...known.map((item) => ({ value: item.uuid, label: item.name })),
                  ...(linkedCompany && !known.some((item) => item.uuid === linkedCompany)
                    ? [{ value: linkedCompany, label: 'The company that sent you this link' }]
                    : []),
                ]}
                value={company}
                onChange={(company) => read.updateDraft({ company })}
              />
              <Field {...request.field('requestedExpiresAt')} label="Requested expiry (local date and time)">
                <TextInput
                  type="datetime-local"
                  value={read.draft.requestedExpiresAt}
                  onChange={(event) => read.updateDraft({ requestedExpiresAt: event.target.value })}
                />
              </Field>
              <FormActions>
                <PageAction
                  label="Preview company eligibility request"
                  busy={running === 'request'}
                  busyLabel="Previewing…"
                  disabled={read.busy || read.refreshing}
                  onClick={() => {
                    if (request.check()) {
                      if (!read.draft.company) read.updateDraft({ company });
                      setActionOpener(document.activeElement as HTMLElement | null);
                      track('request', read.previewRequest());
                    }
                  }}
                />
              </FormActions>
            </Section>
          </div>
          {read.action && (
            <ActionConfirmation
              action={read.action}
              busy={read.busy}
              confirm={read.confirm}
              cancel={read.cancel}
              opener={actionOpener}
            />
          )}
          <div hidden={!!read.action} className="flex flex-col gap-5">
            {!read.readFailed && (
              <Section title="Your company requests">
                <RecordsList
                  records={read.records}
                  select={read.selectRecord}
                  selected={read.selectedRecord?.uuid}
                  companyName={companyName}
                />
              </Section>
            )}
            {read.selectedRecord && (
              <>
                <EligibilityHistory record={read.selectedRecord} />
                {['pending', 'accepted'].includes(read.selectedRecord.outcome) && (
                  <FormActions>
                    <PageAction
                      label="Prepare request withdrawal"
                      busy={running === 'withdrawal'}
                      busyLabel="Preparing…"
                      disabled={read.busy || read.refreshing}
                      onClick={() => {
                        setActionOpener(document.activeElement as HTMLElement | null);
                        track('withdrawal', read.prepareWithdrawal(read.selectedRecord!));
                      }}
                    />
                  </FormActions>
                )}
              </>
            )}
          </div>
        </>
      )}
      {read.selectedRequestUuid && (
        <div hidden={!!read.action}>
          <WalletNomination
            key={`${read.scopeKey}/${read.selectedRequestUuid}`}
            requestUuid={read.selectedRequestUuid}
            guardRequest={() => read.guardOwnRequest(read.selectedRequestUuid)}
            onHeldChange={onWalletHeld}
            active={!read.action}
          />
        </div>
      )}
    </Page>
  );
}

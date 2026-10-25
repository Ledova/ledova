import { SelectField } from '@components/SelectField';
import { useRunningAction } from '@hooks/useRunningAction';
import { useAutomaticReads } from '@hooks/useAutomaticReads';
import { useCallback, useState } from 'react';
import {
  FIELD_LIMITS,
  DESTINATIONS,
  ELIGIBILITY_RECORDS_NOTICE,
  formatDate,
  isUuid,
  useParticipantEligibilityRecords,
  shortReference,
} from '@ledova/shared';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useDirectoryNames } from '@hooks/useDirectoryNames';
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
  useAutomaticReads({ scope: read.owner ? read.scopeKey : null, paused: read.readingPaused, refresh: read.refresh });
  const { running, track } = useRunningAction();
  const source = read.sources.find((item) => item.uuid === read.draft.source);
  const directory = useDirectoryNames();
  const productValue = source?.category === 'product_value';
  const quantity = read.draft.quantity;
  const request = useErrorSummary({
    source: !source && 'Choose your evidence source.',
    offering: productValue && !isUuid(read.draft.offering) && 'Enter the approved offering UUID.',
    quantity:
      productValue &&
      (!/^[1-9]\d*$/.test(quantity) || !Number.isSafeInteger(Number(quantity))) &&
      'Enter a positive whole-share quantity.',
    company: !productValue && !isUuid(read.draft.company) && 'Enter the exact company UUID supplied by the company.',
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
                Select your own submitted evidence or retained historical evidence. Enter the exact company UUID
                supplied by the company, or an approved offering UUID for a product-value claim. The server confirms the
                target and terms.
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
                  read.updateDraft({ source, company: '', offering: '', quantity: '' });
                }}
              />
              {productValue ? (
                <>
                  <Field
                    {...request.field('offering')}
                    label="Approved offering UUID"
                    hint={directory.offering(read.draft.offering)}
                  >
                    <TextInput
                      value={read.draft.offering}
                      onChange={(event) => read.updateDraft({ offering: event.target.value })}
                    />
                  </Field>
                  <Field {...request.field('quantity')} label="Whole-share quantity">
                    <TextInput
                      inputMode="numeric"
                      maxLength={FIELD_LIMITS.WHOLE_SHARES}
                      value={read.draft.quantity}
                      onChange={(event) => read.updateDraft({ quantity: event.target.value })}
                    />
                  </Field>
                </>
              ) : (
                <Field
                  {...request.field('company')}
                  label="Exact company UUID"
                  hint={directory.company(read.draft.company)}
                >
                  <TextInput
                    value={read.draft.company}
                    onChange={(event) => read.updateDraft({ company: event.target.value })}
                  />
                </Field>
              )}
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
                  companyName={(uuid) => directory.companies.get(uuid)}
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

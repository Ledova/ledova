import { SelectField } from '@components/SelectField';
import { useRunningAction } from '@hooks/useRunningAction';
import {
  FIELD_LIMITS,
  DESTINATIONS,
  ELIGIBILITY_RECORDS_NOTICE,
  formatDate,
  isUuid,
  useParticipantEligibilityRecords,
} from '@ledova/shared';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { LinkRow, Section, LoadError } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { ActionConfirmation, EligibilityHistory, RecordsList } from '@components/eligibility';
import { Field, TextInput } from '@components/Field';
import { WalletNomination } from './WalletNomination';

export default function ParticipantEligibilityPage() {
  const read = useParticipantEligibilityRecords(() => crypto.randomUUID());
  const { running, track } = useRunningAction();
  const source = read.sources.find((item) => item.uuid === read.draft.source);
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
    <Page
      narrow
      loading={read.loading}
      lede={ELIGIBILITY_RECORDS_NOTICE}
      actions={
        <PageAction
          label="Refresh records"
          busy={read.refreshing}
          busyLabel="Refreshing…"
          disabled={read.busy}
          onClick={() => void read.refresh()}
        />
      }
    >
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
          <Section title="Prepare a request for one company">
            <ErrorSummary {...request.summary} />
            <LinkRow to={DESTINATIONS.investorEligibility.path} label={DESTINATIONS.investorEligibility.title} />
            <p className="text-sm text-text-muted">
              Select your own submitted evidence or retained historical evidence. Enter the exact company UUID supplied
              by the company, or an approved offering UUID for a product-value claim. The server confirms the target and
              terms.
            </p>
            <SelectField
              {...request.field('source')}
              label="Your evidence source"
              options={[
                { value: '', label: 'Select a source' },
                ...read.sources.map((item) => ({
                  value: item.uuid,
                  label: `${item.categoryDisplay} · ${item.statusDisplay} · ${formatDate(item.createdAt)}`,
                  reference: item.uuid.slice(0, 8),
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
                <Field {...request.field('offering')} label="Approved offering UUID">
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
              <Field {...request.field('company')} label="Exact company UUID">
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
            <PageAction
              label="Preview company eligibility request"
              busy={running === 'request'}
              busyLabel="Previewing…"
              disabled={read.busy || read.refreshing}
              onClick={() => {
                if (request.check()) track('request', read.previewRequest());
              }}
            />
          </Section>
          {read.action && (
            <ActionConfirmation action={read.action} busy={read.busy} confirm={read.confirm} cancel={read.cancel} />
          )}
          {!read.readFailed && (
            <Section title="Your company requests">
              <RecordsList records={read.records} select={read.selectRecord} selected={read.selectedRecord?.uuid} />
            </Section>
          )}
          {read.selectedRecord && (
            <>
              <EligibilityHistory record={read.selectedRecord} />
              {['pending', 'accepted'].includes(read.selectedRecord.outcome) && (
                <PageAction
                  label="Prepare request withdrawal"
                  busy={running === 'withdrawal'}
                  busyLabel="Preparing…"
                  disabled={read.busy || read.refreshing}
                  onClick={() => track('withdrawal', read.prepareWithdrawal(read.selectedRecord!))}
                />
              )}
            </>
          )}
        </>
      )}
      {read.selectedRequestUuid && (
        <WalletNomination
          key={read.selectedRequestUuid}
          requestUuid={read.selectedRequestUuid}
          guardRequest={() => read.guardOwnRequest(read.selectedRequestUuid)}
        />
      )}
    </Page>
  );
}

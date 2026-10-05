import { DESTINATIONS, ELIGIBILITY_RECORDS_NOTICE, useParticipantEligibilityRecords } from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';
import { LinkRow, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { ActionConfirmation, EligibilityHistory, Field, RecordsList, TextField } from './components';

export default function ParticipantEligibilityPage() {
  const read = useParticipantEligibilityRecords(apiClient, () => crypto.randomUUID());
  const source = read.sources.find((item) => item.uuid === read.draft.source);
  return (
    <Page
      loading={read.loading}
      lede={ELIGIBILITY_RECORDS_NOTICE}
      actions={
        <PageAction
          label="Refresh records"
          disabled={read.busy || read.refreshing}
          onClick={() => void read.refresh()}
        />
      }
    >
      {!read.owner ? (
        <p>Your signed-in account must be checked before opening these records.</p>
      ) : (
        <>
          {read.error && (
            <p role="alert" className="text-sm text-error-light">
              {read.error}
            </p>
          )}
          <Section title="Prepare a request for one company">
            <LinkRow to={DESTINATIONS.investorEligibility.path} label="Upload or inspect your private evidence" />
            <p className="text-sm text-text-muted">
              Select your own submitted evidence or retained historical evidence. Enter the exact company UUID supplied
              by the company, or an approved offering UUID for a product-value claim. The server confirms the target and
              terms.
            </p>
            <Field label="Your evidence source">
              <select
                className={FIELD_CLASS}
                value={read.draft.source}
                onChange={(event) =>
                  read.updateDraft({ source: event.target.value, company: '', offering: '', quantity: '' })
                }
              >
                <option value="">Select a source</option>
                {read.sources.map((item) => (
                  <option key={item.uuid} value={item.uuid}>
                    {item.categoryDisplay} · {item.statusDisplay} · {item.uuid}
                  </option>
                ))}
              </select>
            </Field>
            {source?.category === 'product_value' ? (
              <>
                <TextField
                  label="Approved offering UUID"
                  value={read.draft.offering}
                  onChange={(offering) => read.updateDraft({ offering })}
                />
                <TextField
                  label="Whole-share quantity"
                  value={read.draft.quantity}
                  onChange={(quantity) => read.updateDraft({ quantity })}
                />
              </>
            ) : (
              <TextField
                label="Exact company UUID"
                value={read.draft.company}
                onChange={(company) => read.updateDraft({ company })}
              />
            )}
            <TextField
              label="Requested expiry (local date and time)"
              type="datetime-local"
              value={read.draft.requestedExpiresAt}
              onChange={(requestedExpiresAt) => read.updateDraft({ requestedExpiresAt })}
            />
            <PageAction
              label="Preview company eligibility request"
              disabled={read.busy || read.refreshing}
              onClick={() => void read.previewRequest()}
            />
          </Section>
          {read.action && (
            <ActionConfirmation action={read.action} busy={read.busy} confirm={read.confirm} cancel={read.cancel} />
          )}
          <Section title="Your company requests">
            <RecordsList records={read.records} select={read.selectRecord} selected={read.selectedRecord?.uuid} />
          </Section>
          {read.selectedRecord && (
            <>
              <EligibilityHistory record={read.selectedRecord} />
              {['pending', 'accepted'].includes(read.selectedRecord.outcome) && (
                <PageAction
                  label="Prepare request withdrawal"
                  disabled={read.busy || read.refreshing}
                  onClick={() => void read.prepareWithdrawal(read.selectedRecord!)}
                />
              )}
            </>
          )}
        </>
      )}
    </Page>
  );
}

import { SelectField } from '@components/SelectField';
import { useRunningAction } from '@hooks/useRunningAction';
import { DESTINATIONS, ELIGIBILITY_RECORDS_NOTICE, formatDate, useParticipantEligibilityRecords } from '@ledova/shared';
import { LinkRow, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { ActionConfirmation, EligibilityHistory, RecordsList, TextField } from '@components/eligibility';
import { WalletNomination } from './WalletNomination';

export default function ParticipantEligibilityPage() {
  const read = useParticipantEligibilityRecords(() => crypto.randomUUID());
  const { running, track } = useRunningAction();
  const source = read.sources.find((item) => item.uuid === read.draft.source);
  return (
    <Page
      narrow
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
            <SelectField
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
              onChange={(source) => read.updateDraft({ source, company: '', offering: '', quantity: '' })}
            />
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
              busy={running === 'request'}
              busyLabel="Previewing…"
              disabled={read.busy || read.refreshing}
              onClick={() => track('request', read.previewRequest())}
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

import { REGISTER_IMPORT_COPY, formatShareCount } from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import { saveFile } from '../useCompanyRegister';
import { MemberFields } from './MemberFields';
import { registerCsvTemplate } from './csv';
import { blankMember, blankFormer, type PreparationDraft, type MemberDraft, type FormerDraft } from './preparation';

const LABEL = 'block space-y-1 text-sm text-text-primary';
const EVIDENCE = 'application/pdf,image/png,image/jpeg';

export function BringRecords({
  draft,
  today,
  correction,
  busy,
  differs,
  imported,
  update,
  setMember,
  setFormer,
  importCsv,
}: {
  draft: PreparationDraft;
  today: string;
  correction: boolean;
  busy: boolean;
  differs: boolean;
  imported: { total: string; count: number };
  update: (apply: (current: PreparationDraft) => PreparationDraft) => void;
  setMember: (index: number, patch: Partial<MemberDraft>) => void;
  setFormer: (index: number, patch: Partial<FormerDraft>) => void;
  importCsv: (file: File | null) => Promise<void>;
}) {
  return (
    <>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-text-primary">Source records</legend>
        <label className={LABEL}>
          Record date
          <input
            type="date"
            max={today}
            value={draft.asAt}
            className={FIELD_CLASS}
            onChange={(event) => update((current) => ({ ...current, asAt: event.target.value }))}
          />
        </label>
        <label className={LABEL}>
          Source record reference
          <input
            value={draft.reference}
            maxLength={255}
            placeholder="Company register held by our accountant, version 14 October"
            className={FIELD_CLASS}
            onChange={(event) => update((current) => ({ ...current, reference: event.target.value }))}
          />
        </label>
        {correction && (
          <label className={LABEL}>
            {correction ? 'Reason for correcting the mirror' : 'Reason'}
            <textarea
              rows={2}
              value={draft.reason}
              maxLength={1000}
              className={FIELD_CLASS}
              onChange={(event) => update((current) => ({ ...current, reason: event.target.value }))}
            />
          </label>
        )}
        {correction && (
          <p className="text-sm text-text-muted">
            This corrects a copied opening. The earlier snapshot and evidence remain in history. It does not change the
            company’s legal records.
          </p>
        )}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-text-primary">Current shareholders</legend>
        <div className="flex flex-wrap items-center gap-3">
          <PageAction
            label="Download CSV template"
            onClick={() =>
              saveFile(
                new Blob([registerCsvTemplate(correction ? draft.members : [])], { type: 'text/csv;charset=utf-8' }),
                'share-register-template.csv',
              )
            }
          />
          <label className={LABEL}>
            Bring a CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className={FIELD_CLASS}
              onChange={(event) => void importCsv(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <p className="text-xs text-text-muted">
          One row per allotment. Repeat the shareholder reference for multiple allotments. UTF-8 CSV, at most 1 MB and
          500 rows. Importing replaces the draft rows below.
        </p>
        {draft.members.map((row, index) => (
          <MemberFields
            key={row.member}
            row={row}
            index={index}
            asAt={draft.asAt}
            update={(patch) => setMember(index, patch)}
            remove={
              draft.members.length > 1
                ? () => update((current) => ({ ...current, members: current.members.filter((_, at) => at !== index) }))
                : undefined
            }
          />
        ))}
        <PageAction
          label="Add a shareholder"
          disabled={busy}
          onClick={() => update((current) => ({ ...current, members: [...current.members, blankMember()] }))}
        />
      </fieldset>
      <details className="space-y-4 rounded-lg border border-border-subtle p-4">
        <summary className="cursor-pointer text-sm font-medium text-text-primary">
          Optional source copies and former records
        </summary>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Supporting copies (optional)</legend>
          <label className={LABEL}>
            Current share register (optional)
            {draft.registerEvidence && (
              <span className="block text-xs text-text-muted">
                The retained source copy will be reused unless you choose another file.
              </span>
            )}
            <input
              type="file"
              accept={EVIDENCE}
              className={FIELD_CLASS}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                update((current) => ({ ...current, registerFile: file }));
              }}
            />
          </label>
          <label className={LABEL}>
            ASIC extract (optional)
            {draft.asicEvidence && (
              <span className="block text-xs text-text-muted">
                The retained ASIC copy and figures will be reused unless you change them.
              </span>
            )}
            <input
              type="file"
              accept={EVIDENCE}
              className={FIELD_CLASS}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                update((current) => ({ ...current, asicFile: file }));
              }}
            />
          </label>
          <p className="text-sm text-text-muted">PDF or image, max 10 MB. Ledova does not verify either document.</p>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Former members</legend>
          <p className="text-sm text-text-muted">
            Copy former shareholders only if useful. The company continues to retain its legal historical records
            elsewhere.
          </p>
          {draft.former.map((row, index) => (
            <fieldset key={row.id} className="space-y-2 border-t border-border-subtle pt-3">
              <legend className="text-sm text-text-primary">Former member {index + 1}</legend>
              <label className={LABEL}>
                Name
                <input
                  value={row.name}
                  maxLength={255}
                  className={FIELD_CLASS}
                  onChange={(event) => setFormer(index, { name: event.target.value })}
                />
              </label>
              <label className={LABEL}>
                Residential address
                <input
                  value={row.residentialAddress}
                  maxLength={1000}
                  className={FIELD_CLASS}
                  onChange={(event) => setFormer(index, { residentialAddress: event.target.value })}
                />
              </label>
              <label className={LABEL}>
                Shares
                <input
                  inputMode="numeric"
                  value={row.shares}
                  className={FIELD_CLASS}
                  onChange={(event) => setFormer(index, { shares: event.target.value })}
                />
              </label>
              <label className={LABEL}>
                Date ceased
                <input
                  type="date"
                  max={draft.asAt}
                  value={row.ceasedOn}
                  className={FIELD_CLASS}
                  onChange={(event) => setFormer(index, { ceasedOn: event.target.value })}
                />
              </label>
              <PageAction
                label={`Remove former member ${index + 1}`}
                disabled={busy}
                onClick={() =>
                  update((current) => ({ ...current, former: current.former.filter((_, at) => at !== index) }))
                }
              />
            </fieldset>
          ))}
          <PageAction
            label="Add a former member"
            disabled={busy}
            onClick={() => update((current) => ({ ...current, former: [...current.former, blankFormer()] }))}
          />
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Comparison figures (optional)</legend>
          <p className="text-sm text-text-muted">
            An ASIC extract may list only some shareholders. Its listed count is a cross-check, not the source for the
            full ownership record.
          </p>
          <label className={LABEL}>
            Issued shares in the comparison source (optional)
            <input
              inputMode="numeric"
              value={draft.statedTotal}
              className={FIELD_CLASS}
              onChange={(event) => {
                const statedTotal = event.target.value;
                update((current) => ({ ...current, statedTotal }));
              }}
            />
          </label>
          <label className={LABEL}>
            Shareholders listed in the comparison source (optional)
            <input
              inputMode="numeric"
              value={draft.statedCount}
              className={FIELD_CLASS}
              onChange={(event) => {
                const statedCount = event.target.value;
                update((current) => ({ ...current, statedCount }));
              }}
            />
          </label>
          <p className="text-sm text-text-primary">
            {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(imported.total), imported.count)}
          </p>
          {differs && (
            <p role="alert" className="text-sm text-error-light">
              The comparison figures differ from the copied rows. Check both against the source before continuing.
            </p>
          )}
        </fieldset>
      </details>
    </>
  );
}

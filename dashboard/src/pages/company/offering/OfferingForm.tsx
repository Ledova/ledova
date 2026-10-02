import { useState } from 'react';
import { PageAction } from '@components/Page';
import { OFFER_DOCUMENT_COPY, OFFERING_EXEMPTION_LABELS, attachableDocuments, requestShares } from '@ledova/shared';
import type {
  CompanyDocument,
  CompanyShareTokenListItem,
  Offering,
  OfferingExemption,
  OfferingInput,
  OperatorSettlementAsset,
} from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';
import { DocumentChoices } from './DocumentChoices';

const EXEMPTIONS = Object.entries(OFFERING_EXEMPTION_LABELS) as [OfferingExemption, string][];

interface OfferingFormProps {
  tokens: Pick<CompanyShareTokenListItem, 'uuid' | 'name' | 'symbol'>[];
  busy: boolean;
  blocked?: boolean;
  settlementAssets: OperatorSettlementAsset[];
  documents?: CompanyDocument[];
  operatorName: string;
  onCreate: (input: OfferingInput) => void;
  editing?: Offering;
  onUpdate?: (input: OfferingInput) => void;
  onCancelEdit?: () => void;
}

function localInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-text-primary">{label}</span>
      {children}
    </label>
  );
}

export function OfferingForm({
  tokens,
  busy,
  blocked = false,
  settlementAssets,
  documents = [],
  operatorName,
  onCreate,
  editing,
  onUpdate,
  onCancelEdit,
}: OfferingFormProps) {
  const [token, setToken] = useState(editing?.tokenUuid ?? tokens[0]?.uuid ?? '');
  const [exemption, setExemption] = useState<OfferingExemption>(editing?.exemption ?? 's708_11_professional');
  const [pricePerShare, setPricePerShare] = useState(editing?.pricePerShare ?? '');
  const [minimumShares, setMinimumShares] = useState(editing ? String(editing.minimumShares) : '');
  const [targetShares, setTargetShares] = useState(editing ? String(editing.targetShares) : '');
  const [capShares, setCapShares] = useState(editing ? String(editing.capShares) : '');
  const [opensAt, setOpensAt] = useState(localInput(editing?.opensAt));
  const [closesAt, setClosesAt] = useState(localInput(editing?.closesAt));
  const [summary, setSummary] = useState(editing?.summary ?? '');
  const [useOfProceeds, setUseOfProceeds] = useState(editing?.useOfProceeds ?? '');
  const [acceptsBankTransfer, setAcceptsBankTransfer] = useState(editing?.acceptsBankTransfer ?? true);
  const [chosenAssets, setChosenAssets] = useState<string[]>(editing?.settlementAssets ?? []);
  const [chosenDocuments, setChosenDocuments] = useState<string[]>(editing?.documents ?? []);
  const attachable = attachableDocuments(documents, editing?.documents ?? []);

  const chosenToken = token;
  const hasARail = acceptsBankTransfer || chosenAssets.length > 0;
  const minimum = requestShares(minimumShares);
  const target = requestShares(targetShares);
  const cap = requestShares(capShares);
  const quantitiesValid = minimum !== null && target !== null && cap !== null && minimum <= target && target <= cap;
  const priceValid =
    /^\d+(?:\.\d{1,2})?$/.test(pricePerShare) &&
    BigInt(pricePerShare.split('.')[0]) <= 9_999_999_999_999_999n &&
    BigInt(pricePerShare.replace('.', '')) > 0n;
  const opens = new Date(opensAt).getTime();
  const closes = closesAt ? new Date(closesAt).getTime() : null;
  const datesValid = Number.isFinite(opens) && (closes === null || (Number.isFinite(closes) && closes > opens));
  const unavailableAssets = chosenAssets.filter((uuid) => !settlementAssets.some((asset) => asset.uuid === uuid));
  const isComplete =
    tokens.some((each) => each.uuid === chosenToken) &&
    quantitiesValid &&
    priceValid &&
    datesValid &&
    hasARail &&
    unavailableAssets.length === 0;

  const toggleAsset = (uuid: string) =>
    setChosenAssets((chosen) => (chosen.includes(uuid) ? chosen.filter((each) => each !== uuid) : [...chosen, uuid]));
  const toggleDocument = (uuid: string) =>
    setChosenDocuments((chosen) =>
      chosen.includes(uuid) ? chosen.filter((each) => each !== uuid) : [...chosen, uuid],
    );

  const handleSubmit = () => {
    if (!isComplete || busy || blocked) return;
    const input: OfferingInput = {
      token: chosenToken,
      exemption,
      pricePerShare,
      acceptsBankTransfer,
      settlementAssets: chosenAssets,
      minimumShares: minimum!,
      targetShares: target!,
      capShares: cap!,
      opensAt: new Date(opensAt).toISOString(),
      closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      summary,
      useOfProceeds,
      documents: chosenDocuments.filter((uuid) => documents.some((document) => document.uuid === uuid)),
    };
    if (editing && onUpdate) {
      onUpdate(input);
      return;
    }
    onCreate(input);
  };

  return (
    <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      <Field label="Share class">
        <select
          disabled={!!editing}
          value={chosenToken}
          onChange={(e) => setToken(e.target.value)}
          className={FIELD_CLASS}
        >
          {tokens.map((item) => (
            <option key={item.uuid} value={item.uuid}>
              {item.name} ({item.symbol})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Exemption relied on">
        <select
          value={exemption}
          onChange={(e) => setExemption(e.target.value as OfferingExemption)}
          className={FIELD_CLASS}
        >
          {EXEMPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Price per share (AUD)">
        <input
          value={pricePerShare}
          onChange={(e) => setPricePerShare(e.target.value)}
          inputMode="decimal"
          placeholder="2.50"
          className={FIELD_CLASS}
        />
      </Field>

      <Field label="Minimum shares">
        <input
          value={minimumShares}
          onChange={(e) => setMinimumShares(e.target.value)}
          inputMode="numeric"
          placeholder="1000"
          className={FIELD_CLASS}
        />
      </Field>

      <Field label="Target shares">
        <input
          value={targetShares}
          onChange={(e) => setTargetShares(e.target.value)}
          inputMode="numeric"
          placeholder="50000"
          className={FIELD_CLASS}
        />
      </Field>

      <Field label="Cap shares">
        <input
          value={capShares}
          onChange={(e) => setCapShares(e.target.value)}
          inputMode="numeric"
          placeholder="100000"
          className={FIELD_CLASS}
        />
      </Field>

      <Field label="Opens at">
        <input
          type="datetime-local"
          value={opensAt}
          onChange={(e) => setOpensAt(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      <Field label="Closes at (optional)">
        <input
          type="datetime-local"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      <div className="sm:col-span-2">
        <Field label="Summary">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            placeholder="What eligible investors are being offered"
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field label="Use of proceeds">
          <textarea
            value={useOfProceeds}
            onChange={(e) => setUseOfProceeds(e.target.value)}
            rows={3}
            placeholder="What the money raised will be spent on"
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <div className="sm:col-span-2 space-y-2">
        <span className="text-sm font-medium text-text-primary">How investors may pay</span>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={acceptsBankTransfer}
            onChange={(e) => setAcceptsBankTransfer(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm text-text-primary">Accept bank transfer</span>
        </label>

        {settlementAssets.length === 0 ? (
          <p className="text-sm text-text-muted">
            This offering can take bank transfer only: {operatorName} has not configured a settlement asset.
          </p>
        ) : (
          settlementAssets.map((asset) => (
            <label key={asset.uuid} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={chosenAssets.includes(asset.uuid)}
                onChange={() => toggleAsset(asset.uuid)}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-sm text-text-primary">{asset.symbol}</span>
            </label>
          ))
        )}

        {!hasARail && (
          <p className="text-sm text-error-light">
            Choose at least one way to be paid. An offering nobody can pay for cannot be submitted.
          </p>
        )}
      </div>

      <div className="sm:col-span-2 space-y-2">
        <span className="text-sm font-medium text-text-primary">{OFFER_DOCUMENT_COPY.ATTACH_HEADING}</span>
        <p className="text-sm text-text-muted">{OFFER_DOCUMENT_COPY.ATTACH_HELP}</p>
        {attachable.length === 0 ? (
          <p className="text-sm text-text-muted">{OFFER_DOCUMENT_COPY.ATTACH_NONE}</p>
        ) : (
          <DocumentChoices documents={attachable} chosen={chosenDocuments} onToggle={toggleDocument} />
        )}
      </div>

      {unavailableAssets.length > 0 && (
        <div role="alert" className="sm:col-span-2 space-y-2 text-sm text-text-muted">
          <p>A previously selected settlement asset is no longer available. Remove it before saving.</p>
          <PageAction
            label="Remove unavailable settlement assets"
            onClick={() => setChosenAssets(chosenAssets.filter((uuid) => !unavailableAssets.includes(uuid)))}
            disabled={busy}
          />
        </div>
      )}
      {!quantitiesValid && (minimumShares || targetShares || capShares) && (
        <p role="alert" className="sm:col-span-2 text-sm text-error-light">
          Enter whole share quantities from 1 to 2,147,483,647, with minimum ≤ target ≤ cap.
        </p>
      )}
      {pricePerShare && !priceValid && (
        <p role="alert" className="sm:col-span-2 text-sm text-error-light">
          Enter a positive AUD price with at most 16 digits before the decimal point and two after it.
        </p>
      )}
      {closesAt && !datesValid && (
        <p role="alert" className="sm:col-span-2 text-sm text-error-light">
          The closing time must be after the opening time.
        </p>
      )}
      <div className="sm:col-span-2 flex flex-wrap items-center justify-end gap-4">
        {editing && (
          <>
            <p className="mr-auto text-sm text-text-muted">
              {editing.status === 'rejected'
                ? 'Rejected offerings are editable. Submitting it again sends it back for review.'
                : 'Draft offerings are editable. Submitting it for review locks it.'}
            </p>
          </>
        )}
        <PageAction label="Cancel" onClick={() => onCancelEdit?.()} disabled={busy} />
        <PageAction
          label={editing ? 'Save changes' : 'Create draft offering'}
          primary
          onClick={handleSubmit}
          disabled={!isComplete || busy || blocked}
        />
      </div>
    </fieldset>
  );
}

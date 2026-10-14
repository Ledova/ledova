import { FIELD_CLASS } from '@components/fieldClass';
import { PageAction } from '@components/Page';
import { blankAllotment, type AllotmentDraft, type MemberDraft } from './preparation';

const LABEL = 'block space-y-1 text-sm text-text-primary';

export function MemberFields({
  row,
  index,
  asAt,
  update,
  remove,
}: {
  row: MemberDraft;
  index: number;
  asAt: string;
  update: (patch: Partial<MemberDraft>) => void;
  remove?: () => void;
}) {
  const setAllotment = (at: number, patch: Partial<AllotmentDraft>) =>
    update({
      allotments: row.allotments.map((allotment, current) => (current === at ? { ...allotment, ...patch } : allotment)),
    });
  return (
    <fieldset className="space-y-4 rounded-lg border border-border-subtle p-4">
      <legend className="px-1 text-sm font-medium text-text-primary">Shareholder {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Name
          <input
            value={row.name}
            maxLength={255}
            className={FIELD_CLASS}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label className={LABEL}>
          Address
          <input
            value={row.residentialAddress}
            maxLength={1000}
            className={FIELD_CLASS}
            onChange={(event) => update({ residentialAddress: event.target.value })}
          />
        </label>
        <label className={LABEL}>
          Original membership date
          <input
            type="date"
            max={asAt}
            value={row.enteredOn}
            className={FIELD_CLASS}
            onChange={(event) => update({ enteredOn: event.target.value })}
          />
        </label>
        <label className={LABEL}>
          Current holding (shares)
          <input
            inputMode="numeric"
            value={row.shares}
            className={FIELD_CLASS}
            onChange={(event) => update({ shares: event.target.value })}
          />
        </label>
      </div>
      <p className="text-xs text-text-muted">
        Copy the allotments underlying this holding from the existing records. Their shares must add up to the current
        holding.
      </p>
      {row.allotments.map((allotment, at) => (
        <fieldset key={allotment.id} className="space-y-3 border-t border-border-subtle pt-3">
          <legend className="text-sm text-text-primary">Allotment {at + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              Allotment date
              <input
                type="date"
                max={asAt}
                value={allotment.allottedOn}
                className={FIELD_CLASS}
                onChange={(event) => setAllotment(at, { allottedOn: event.target.value })}
              />
            </label>
            <label className={LABEL}>
              Allotted shares in this holding
              <input
                inputMode="numeric"
                value={allotment.shares}
                className={FIELD_CLASS}
                onChange={(event) => setAllotment(at, { shares: event.target.value })}
              />
            </label>
            <label className={LABEL}>
              Amount paid
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={allotment.amountPaid}
                className={FIELD_CLASS}
                onChange={(event) => setAllotment(at, { amountPaid: event.target.value })}
              />
            </label>
            <label className={LABEL}>
              Amount unpaid
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={allotment.amountUnpaid}
                className={FIELD_CLASS}
                onChange={(event) => setAllotment(at, { amountUnpaid: event.target.value })}
              />
            </label>
            <label className={LABEL}>
              Payment status
              <select
                value={allotment.fullyPaid ? 'fully' : 'partly'}
                className={FIELD_CLASS}
                onChange={(event) => setAllotment(at, { fullyPaid: event.target.value === 'fully' })}
              >
                <option value="fully">Fully paid</option>
                <option value="partly">Not fully paid</option>
              </select>
            </label>
            <label className={LABEL}>
              Held beneficially
              <select
                value={allotment.beneficiallyHeld ? 'yes' : 'no'}
                className={FIELD_CLASS}
                onChange={(event) => setAllotment(at, { beneficiallyHeld: event.target.value === 'yes' })}
              >
                <option value="yes">Yes, for this shareholder</option>
                <option value="no">No, held for someone else</option>
              </select>
            </label>
            <label className={LABEL}>
              Share numbers or reference (if present)
              <input
                maxLength={255}
                value={allotment.shareReference}
                className={FIELD_CLASS}
                onChange={(event) => setAllotment(at, { shareReference: event.target.value })}
              />
            </label>
            <label className={LABEL}>
              Certificate reference (if present)
              <input
                maxLength={255}
                value={allotment.certificateReference}
                className={FIELD_CLASS}
                onChange={(event) => setAllotment(at, { certificateReference: event.target.value })}
              />
            </label>
          </div>
          {row.allotments.length > 1 && (
            <PageAction
              label={`Remove allotment ${at + 1} for shareholder ${index + 1}`}
              onClick={() => update({ allotments: row.allotments.filter((_, current) => current !== at) })}
            />
          )}
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        <PageAction
          label={`Add allotment for shareholder ${index + 1}`}
          onClick={() => update({ allotments: [...row.allotments, blankAllotment()] })}
        />
        {remove && <PageAction label={`Remove shareholder ${index + 1}`} onClick={remove} />}
      </div>
    </fieldset>
  );
}

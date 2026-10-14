import { registerImportMoney, type RegisterTransferMember } from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';
import { PageAction } from '@components/Page';
import { blankAllotment, type AllotmentDraft, type MemberDraft } from './preparation';

const LABEL = 'block space-y-1 text-sm text-text-primary';

export function MemberFields({
  row,
  index,
  asAt,
  update,
  companyMembers,
  preserveParticulars,
  usedMembers,
}: {
  row: MemberDraft;
  index: number;
  asAt: string;
  update: (patch: Partial<MemberDraft>) => void;
  companyMembers: RegisterTransferMember[];
  preserveParticulars: boolean;
  usedMembers: string[];
}) {
  const known = companyMembers.find((member) => member.member === row.member);
  const setAllotment = (at: number, patch: Partial<AllotmentDraft>) =>
    update({
      allotments: row.allotments.map((allotment, current) => (current === at ? { ...allotment, ...patch } : allotment)),
    });
  return (
    <fieldset className="space-y-5">
      <legend className="sr-only">Shareholder details</legend>
      {companyMembers.length > 0 && (
        <label className={LABEL}>
          Company shareholder
          <select
            className={FIELD_CLASS}
            value={known?.member ?? (row.identityChoice === 'new' ? 'new' : '')}
            onChange={(event) => {
              if (event.target.value === 'new')
                update({
                  member: known ? crypto.randomUUID() : row.member,
                  identityChoice: 'new',
                  ...(known ? { name: '', residentialAddress: '' } : {}),
                });
              else {
                const selected = companyMembers.find((member) => member.member === event.target.value);
                if (selected && !usedMembers.includes(selected.member))
                  update({
                    member: selected.member,
                    identityChoice: 'existing',
                    name: selected.name ?? '',
                    residentialAddress: selected.residentialAddress ?? '',
                  });
              }
            }}
          >
            <option value="">Choose an existing shareholder or a new one</option>
            {companyMembers.map((member) => (
              <option key={member.member} value={member.member} disabled={usedMembers.includes(member.member)}>
                {member.name || 'Name not recorded'}
                {member.residentialAddress && ` · ${member.residentialAddress}`}
                {companyMembers.filter(
                  (other) => other.name === member.name && other.residentialAddress === member.residentialAddress,
                ).length > 1 && ` · Record ${member.member.slice(-8)}`}
              </option>
            ))}
            <option value="new">New company shareholder</option>
          </select>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Name
          <input
            value={row.name}
            readOnly={preserveParticulars && !!known?.name}
            maxLength={255}
            className={`${FIELD_CLASS} read-only:bg-surface-tertiary read-only:text-text-muted`}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label className={LABEL}>
          Address
          <input
            value={row.residentialAddress}
            readOnly={preserveParticulars && !!known?.residentialAddress}
            maxLength={1000}
            className={`${FIELD_CLASS} read-only:bg-surface-tertiary read-only:text-text-muted`}
            onChange={(event) => update({ residentialAddress: event.target.value })}
          />
        </label>
        <label className={LABEL}>
          Date first added to register
          <input
            type="date"
            max={asAt}
            value={row.enteredOn}
            className={FIELD_CLASS}
            onChange={(event) => update({ enteredOn: event.target.value })}
          />
        </label>
        <label className={LABEL}>
          Shares held
          <input
            inputMode="numeric"
            value={row.shares}
            className={FIELD_CLASS}
            onChange={(event) => update({ shares: event.target.value })}
          />
        </label>
      </div>
      {row.allotments.map((allotment, at) => (
        <fieldset key={allotment.id} className="space-y-4 rounded-xl border border-border-subtle bg-surface-raised p-4">
          <legend className="px-1 text-sm font-medium text-text-primary">Allotment {at + 1}</legend>
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
              Shares in allotment
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
                onChange={(event) =>
                  setAllotment(at, {
                    amountUnpaid: event.target.value,
                    fullyPaid: registerImportMoney(event.target.value) === '0.00',
                  })
                }
              />
            </label>
            <label className={LABEL}>
              Held for someone else?
              <select
                value={allotment.beneficiallyHeld === null ? '' : allotment.beneficiallyHeld ? 'no' : 'yes'}
                className={FIELD_CLASS}
                onChange={(event) =>
                  setAllotment(at, { beneficiallyHeld: event.target.value ? event.target.value === 'no' : null })
                }
              >
                <option value="">Choose</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>
          <details open={!!(allotment.shareReference || allotment.certificateReference)}>
            <summary className="cursor-pointer text-sm text-text-muted">References (optional)</summary>
            <div className="grid gap-3 pt-3 sm:grid-cols-2">
              <label className={LABEL}>
                Share numbers or reference
                <input
                  maxLength={255}
                  value={allotment.shareReference}
                  className={FIELD_CLASS}
                  onChange={(event) => setAllotment(at, { shareReference: event.target.value })}
                />
              </label>
              <label className={LABEL}>
                Certificate reference
                <input
                  maxLength={255}
                  value={allotment.certificateReference}
                  className={FIELD_CLASS}
                  onChange={(event) => setAllotment(at, { certificateReference: event.target.value })}
                />
              </label>
            </div>
          </details>
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
          label="Add allotment"
          context={`shareholder ${index + 1}`}
          onClick={() => update({ allotments: [...row.allotments, blankAllotment()] })}
        />
      </div>
    </fieldset>
  );
}

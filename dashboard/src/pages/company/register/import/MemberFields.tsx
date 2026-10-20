import {
  registerImportMoney,
  type RegisterTransferMember,
  type RegisterAwardRecipient,
  peopleFrom,
} from '@ledova/shared';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { PageAction } from '@components/Page';
import { PersonFields, PersonSelect } from '@pages/company/register/shared/PersonPicker';
import { blankAllotment, type AllotmentDraft, type MemberDraft } from './preparation';

export function MemberFields({
  row,
  index,
  asAt,
  update,
  companyMembers,
  awardRecipients,
  preserveParticulars,
  usedMembers,
}: {
  row: MemberDraft;
  index: number;
  asAt: string;
  update: (patch: Partial<MemberDraft>) => void;
  companyMembers: RegisterTransferMember[];
  awardRecipients: RegisterAwardRecipient[];
  preserveParticulars: boolean;
  usedMembers: string[];
}) {
  const people = peopleFrom({ members: companyMembers, awardRecipients });
  const known = companyMembers.find((member) => member.member === row.member);
  const recipient = awardRecipients.find((candidate) => candidate.member === row.member);
  const retained = known ?? recipient;
  const setAllotment = (at: number, patch: Partial<AllotmentDraft>) =>
    update({
      allotments: row.allotments.map((allotment, current) => (current === at ? { ...allotment, ...patch } : allotment)),
    });
  return (
    <fieldset className="space-y-5">
      <legend className="sr-only">Shareholder details</legend>
      {people.length > 0 && (
        <PersonSelect
          label="Company shareholder"
          people={people}
          value={retained?.member ?? (row.identityChoice === 'new' ? 'new' : '')}
          disabledMembers={usedMembers}
          onChange={(value) => {
            if (value === 'new')
              update({
                member: retained ? crypto.randomUUID() : row.member,
                identityChoice: 'new',
                ...(retained ? { name: '', residentialAddress: '' } : {}),
              });
            else {
              const selected = people.find((person) => person.member === value);
              if (selected && !usedMembers.includes(selected.member))
                update({
                  member: selected.member,
                  identityChoice: selected.awardOnly ? 'award' : 'existing',
                  name: selected.name,
                  residentialAddress: selected.residentialAddress,
                });
            }
          }}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <PersonFields
          name={row.name}
          residentialAddress={row.residentialAddress}
          onName={(name) => update({ name })}
          onResidentialAddress={(residentialAddress) => update({ residentialAddress })}
          nameReadOnly={!!recipient || (preserveParticulars && !!known?.name)}
          addressReadOnly={!!recipient || (preserveParticulars && !!known?.residentialAddress)}
        />
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
          <legend className="sr-only">Allotment {at + 1}</legend>
          {row.allotments.length > 1 && <h4 className="text-sm font-medium text-text-primary">Allotment {at + 1}</h4>}
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

import { Field, TextInput } from '@components/Field';
import { Choices } from '@components/Choices';
import { FIELD_LIMITS, registerImportMoney, type RegisterTransferMember, peopleFrom } from '@ledova/shared';
import { PageAction } from '@components/Page';
import { PersonFields, PersonSelect } from '@pages/company/register/shared/PersonPicker';
import { blankAllotment, type AllotmentDraft, type MemberDraft } from './preparation';
import { Disclosure } from '@components/Ledger';

const HELD_FOR_SOMEONE_ELSE = [
  ['yes', 'Yes'],
  ['no', 'No'],
] as const;

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
  const people = peopleFrom({ members: companyMembers, awardRecipients: [] });
  const retained = companyMembers.find((member) => member.member === row.member);
  const recipient = retained?.onRegister === false ? retained : undefined;
  const known = recipient ? undefined : retained;
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
                  identityChoice: selected.onRegister === false ? 'award' : 'existing',
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
        <Field label="Date first added to register">
          <TextInput
            type="date"
            max={asAt}
            value={row.enteredOn}
            onChange={(event) => update({ enteredOn: event.target.value })}
          />
        </Field>
        <Field label="Shares held">
          <TextInput
            maxLength={FIELD_LIMITS.REGISTER_SHARES}
            inputMode="numeric"
            value={row.shares}
            onChange={(event) => update({ shares: event.target.value })}
          />
        </Field>
      </div>
      {row.allotments.map((allotment, at) => (
        <fieldset key={allotment.id} className="space-y-4 border-t border-border-subtle pt-4">
          <legend className="sr-only">Allotment {at + 1}</legend>
          {row.allotments.length > 1 && <h4 className="text-sm font-medium text-text-primary">Allotment {at + 1}</h4>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Allotment date">
              <TextInput
                type="date"
                max={asAt}
                value={allotment.allottedOn}
                onChange={(event) => setAllotment(at, { allottedOn: event.target.value })}
              />
            </Field>
            <Field label="Shares in allotment">
              <TextInput
                maxLength={FIELD_LIMITS.REGISTER_SHARES}
                inputMode="numeric"
                value={allotment.shares}
                onChange={(event) => setAllotment(at, { shares: event.target.value })}
              />
            </Field>
            <Field label="Amount paid">
              <TextInput
                maxLength={FIELD_LIMITS.AMOUNT}
                inputMode="decimal"
                placeholder="0.00"
                value={allotment.amountPaid}
                onChange={(event) => setAllotment(at, { amountPaid: event.target.value })}
              />
            </Field>
            <Field label="Amount unpaid">
              <TextInput
                maxLength={FIELD_LIMITS.AMOUNT}
                inputMode="decimal"
                placeholder="0.00"
                value={allotment.amountUnpaid}
                onChange={(event) =>
                  setAllotment(at, {
                    amountUnpaid: event.target.value,
                    fullyPaid: registerImportMoney(event.target.value) === '0.00',
                  })
                }
              />
            </Field>
            <Choices
              legend="Held for someone else?"
              options={HELD_FOR_SOMEONE_ELSE}
              value={allotment.beneficiallyHeld === null ? '' : allotment.beneficiallyHeld ? 'no' : 'yes'}
              onChange={(held) => setAllotment(at, { beneficiallyHeld: held === 'no' })}
            />
          </div>
          <Disclosure
            summary="References (optional)"
            defaultOpen={!!(allotment.shareReference || allotment.certificateReference)}
          >
            <div className="grid gap-3 pt-3 sm:grid-cols-2">
              <Field label="Share numbers or reference">
                <TextInput
                  maxLength={FIELD_LIMITS.REFERENCE}
                  value={allotment.shareReference}
                  onChange={(event) => setAllotment(at, { shareReference: event.target.value })}
                />
              </Field>
              <Field label="Certificate reference">
                <TextInput
                  maxLength={FIELD_LIMITS.REFERENCE}
                  value={allotment.certificateReference}
                  onChange={(event) => setAllotment(at, { certificateReference: event.target.value })}
                />
              </Field>
            </div>
          </Disclosure>
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

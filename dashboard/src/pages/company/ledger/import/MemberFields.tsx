import { useState } from 'react';
import { Field, TextInput } from '@components/Field';
import { FIELD_LIMITS, type RegisterTransferMember, peopleFrom } from '@ledova/shared';
import { PersonFields, PersonSelect } from '@pages/company/ledger/shared/PersonPicker';
import { DocumentAttachments } from '@pages/company/ledger/shared/DocumentAttachments';
import { type MemberDraft } from './preparation';
import { AllotmentFields } from './AllotmentFields';

export function MemberFields({
  row,
  index,
  asAt,
  update,
  companyMembers,
  preserveParticulars,
  usedMembers,
  validationAttempt,
}: {
  row: MemberDraft;
  index: number;
  asAt: string;
  update: (patch: Partial<MemberDraft>) => void;
  companyMembers: RegisterTransferMember[];
  preserveParticulars: boolean;
  usedMembers: string[];
  validationAttempt: number;
}) {
  const [personError, setPersonError] = useState('');
  const people = peopleFrom({ members: companyMembers, awardRecipients: [] });
  const retained = companyMembers.find((member) => member.member === row.member);
  const recipient = retained?.onRegister === false ? retained : undefined;
  const known = recipient ? undefined : retained;
  return (
    <fieldset className="space-y-5">
      <legend className="sr-only">Shareholder details</legend>
      {people.length > 0 && (
        <PersonSelect
          label="Company shareholder"
          error={personError}
          people={people}
          value={retained?.member ?? (row.identityChoice === 'new' ? 'new' : '')}
          disabledMembers={usedMembers}
          onChange={(value) => {
            const selected = retained?.member ?? (row.identityChoice === 'new' ? 'new' : '');
            if (value !== selected && row.documents.some((document) => document.file || document.evidence)) {
              setPersonError('Remove the attached documents before choosing another shareholder.');
              return;
            }
            setPersonError('');
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
        <Field label="Current shares held">
          <TextInput
            maxLength={FIELD_LIMITS.REGISTER_SHARES}
            inputMode="numeric"
            value={row.shares}
            onChange={(event) => update({ shares: event.target.value })}
          />
        </Field>
      </div>
      <AllotmentFields
        allotments={row.allotments}
        asAt={asAt}
        shareholder={index + 1}
        validationAttempt={validationAttempt}
        update={(allotments) => update({ allotments })}
      />
      <DocumentAttachments documents={row.documents} update={(documents) => update({ documents })} />
    </fieldset>
  );
}

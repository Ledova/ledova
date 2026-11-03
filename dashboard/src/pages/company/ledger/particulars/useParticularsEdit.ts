import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  REGISTER_PARTICULARS_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  editRegisterParticulars,
  failureStatus,
  isRegisterParticularsEditReceipt,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';

import apiClient from '@services/apiClient';
import { hasProblems, type Problems } from '@hooks/useErrorSummary';
import { registerKey } from '@hooks/useRegisterAccess';
import { registerHoldersKey } from '@hooks/useRegisterClasses';
import { allPeopleKey } from '@pages/company/ledger/shared/usePeople';
import { particularsKey } from '@pages/company/ledger/shared/useRegisterParticulars';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

type Draft = { name: string; address: string; reason: string };

type Particulars = { name: string; address: string };

export const COPY = REGISTER_PARTICULARS_COPY;

const FAILED = 'The change could not be saved. Retry with the same details.';

const CLOSED = 'This particulars form is closed. Reopen it before continuing.';

function problemsOf(draft: Draft): Problems<'name' | 'address'> {
  return {
    name: !draft.name.trim() && 'Give the name.',
    address: !draft.address.trim() && 'Give the residential address.',
  };
}

export type ParticularsFormProps = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  member: string;
  appointment: OwnCompanyAppointment;
  current: Particulars;
  recorded: Particulars;
  blocked: boolean;
  onConflict: () => void;
  onMissing: () => void;
};

export function useParticularsEdit({
  owner,
  guard,
  company,
  member,
  appointment,
  current,
  recorded,
  blocked,
  onConflict,
  onMissing,
}: ParticularsFormProps) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => ({ name: current.name, address: current.address, reason: '' }));
  const [baseline, setBaseline] = useState<Particulars>(() => recorded);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!mounted.current) throw createUserFriendlyError(CLOSED);
  };
  const update = (patch: Partial<Draft>) => {
    if (!conflict) setError('');
    setDraft((previous) => ({ ...previous, ...patch }));
  };
  const reload = () => {
    operation.current = null;
    setError('');
    setConflict(false);
    setBaseline(recorded);
    setDraft((previous) => ({ ...previous, name: current.name, address: current.address }));
  };
  const problems = problemsOf(draft);

  const submit = async () => {
    if (pending.current || busy || blocked || conflict || hasProblems(problems)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const request = {
        appointment: appointment.uuid,
        member,
        name: draft.name.trim(),
        residentialAddress: draft.address.trim(),
        reason: draft.reason.trim(),
        expected: { name: baseline.name, residentialAddress: baseline.address },
      };
      const signature = JSON.stringify(request);
      if (operation.current?.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
      const edit = { operationId: operation.current.key, ...request };
      let changed = '';
      try {
        check();
        const { data } = await editRegisterParticulars(apiClient, edit, { ledovaSubmissionGuard: check });
        check();
        if (!isRegisterParticularsEditReceipt(data, edit)) throw createUserFriendlyError(COPY.RECEIPT_FAILED);
        changed = data.uuid;
      } catch (failure) {
        if (failureStatus(failure) === 409) operation.current = null;
        throw failure;
      }
      check();
      await Promise.all(
        [
          particularsKey(owner, company),
          allPeopleKey(owner),
          registerHoldersKey(owner),
          [...registerKey(owner), 'awards'],
          [...registerKey(owner), 'member-awards', company],
          [...registerKey(owner), 'invitation-awards', company],
        ].map((queryKey) => client.invalidateQueries({ queryKey })),
      );
      check();
      const place = registerPlace({
        company,
        task: 'corrections',
        record: changed,
        outcome: 'Particulars changed.',
      });
      navigate(place.to, { state: place.state });
    } catch (failure) {
      try {
        check();
        setError(apiErrorSentence(failure, FAILED, FAILED));
        if (failureStatus(failure) === 409) {
          setConflict(true);
          onConflict();
        }
        if (failureStatus(failure) === 404) onMissing();
      } catch {
        return;
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return { draft, busy, error, conflict, update, reload, problems, submit } as const;
}

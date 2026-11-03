import { useEffect, useRef, useState } from 'react';
import { isInvitationCode } from '../constants/business/field-limits';
import { acceptCompanyTeamInvitation } from '../services/company-authority';
import { appointmentReceipt } from '../utils/appointments';
import { failureSentence } from '../utils/errors';
import { useApiClient } from './useApiClient';
import type { OrderSubmissionSession } from './useSubmissionOwner';

export function useAcceptInvitationForm({
  disabled,
  guard,
  onRecorded,
  onBusy,
  session,
}: {
  disabled: boolean;
  guard: () => void;
  onRecorded: () => void;
  onBusy: (value: boolean) => void;
  session?: OrderSubmissionSession;
}) {
  const apiClient = useApiClient();
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
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
    if (!mounted.current) throw new Error('Your signed-in account changed. Reopen company team.');
  };
  const ready = accepted && isInvitationCode(code);
  const send = async () => {
    if (disabled || pending.current || !ready) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    setReceipt('');
    try {
      check();
      const { data } = await acceptCompanyTeamInvitation(apiClient, code, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: check,
      });
      check();
      if (!appointmentReceipt(data) || data.source !== 'invitation')
        throw new Error('The appointment outcome could not be confirmed. Retry the same code.');
      setCode('');
      setAccepted(false);
      setReceipt(`Appointment recorded for ${data.companyName}.`);
      onRecorded();
    } catch (failure) {
      if (mounted.current) {
        try {
          guard();
          setError(failureSentence(failure, 'The invitation could not be accepted. Retry the same code.'));
        } catch {
          return;
        }
      }
    } finally {
      pending.current = false;
      onBusy(false);
      if (mounted.current) setBusy(false);
    }
  };
  return { code, setCode, accepted, setAccepted, busy, error, setError, receipt, setReceipt, send };
}

import { acceptCompanyTeamInvitation, failureSentence } from '@ledova/shared';
import { appointmentReceipt } from '@pages/company/shared/appointments';
import apiClient from '@services/apiClient';
import { useEffect, useRef, useState } from 'react';

export function useAcceptInvitationForm({
  disabled,
  guard,
  onRecorded,
  onBusy,
}: {
  disabled: boolean;
  guard: () => void;
  onRecorded: () => void;
  onBusy: (value: boolean) => void;
}) {
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
  const ready = accepted && /^[A-Za-z0-9_-]{43}$/.test(code);
  const send = async () => {
    if (disabled || pending.current || !ready) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    setReceipt('');
    try {
      check();
      const { data } = await acceptCompanyTeamInvitation(apiClient, code, { ledovaSubmissionGuard: check });
      check();
      if (!appointmentReceipt(data) || data.source !== 'invitation')
        throw new Error('The appointment outcome could not be confirmed. Retry the same code or refresh.');
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
  return { code, setCode, accepted, setAccepted, busy, error, setError, receipt, setReceipt, ready, send };
}

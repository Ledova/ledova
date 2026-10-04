import { useEffect, useRef, useState } from 'react';
import {
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  acceptCompanyTeamInvitation,
  getErrorMessage,
} from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { appointmentReceipt } from './appointments';

export function AcceptInvitationForm({
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
      setReceipt(`Appointment recorded for ${data.companyName}: ${data.uuid} (${data.status}).`);
      onRecorded();
    } catch (failure) {
      if (mounted.current) {
        try {
          guard();
          setError(
            getErrorMessage(failure, 'The invitation could not be accepted. Retry the same code.') ??
              'The invitation could not be accepted. Retry the same code.',
          );
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
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className="text-sm text-text-muted">
        Enter the code the company gave you. Acceptance uses your signed-in account and the existing account, email and
        configured identity checks.
      </p>
      <label className="block space-y-1 text-sm text-text-primary">
        Invitation code
        <input
          className={FIELD_CLASS}
          value={code}
          autoComplete="off"
          disabled={disabled || busy}
          onChange={(event) => {
            setCode(event.target.value);
            setAccepted(false);
            setError('');
            setReceipt('');
          }}
        />
      </label>
      <p className="text-sm text-text-primary">{COMPANY_AUTHORITY_DECLARATION}</p>
      <p className="text-sm text-text-muted">
        Declaration version {COMPANY_AUTHORITY_DECLARATION_VERSION}. Company information is provided by the company.
      </p>
      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          checked={accepted}
          disabled={disabled || busy}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        Accept company authorisation declaration
      </label>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {receipt && (
        <p role="status" className="text-sm text-text-primary">
          {receipt}
        </p>
      )}
      <PageAction
        label={busy ? 'Accepting invitation…' : 'Accept invitation'}
        disabled={disabled || busy || !ready}
        onClick={() => void send()}
      />
    </form>
  );
}

import { COMPANY_ACTIVATION_COPY, DESTINATIONS } from '@ledova/shared';
import { LinkRow, Status } from './Ledger';

export function SetupStep({ to, label, note, done }: { to: string; label: string; note: string; done: boolean }) {
  return (
    <LinkRow to={to} label={label} aside={<Status tone={done ? 'done' : 'waiting'}>{done ? 'Done' : 'To do'}</Status>}>
      <p className="text-text-muted">{note}</p>
    </LinkRow>
  );
}

export function ActivationStep({ done }: { done: boolean }) {
  return (
    <SetupStep
      to={DESTINATIONS.companyListing.path}
      label={COMPANY_ACTIVATION_COPY.STEP}
      note={COMPANY_ACTIVATION_COPY.CHECKS}
      done={done}
    />
  );
}

import { GETTING_STARTED_COPY } from '@ledova/shared';
import { LinkRow, Status } from './Ledger';

export function SetupStep({ to, label, note, done }: { to: string; label: string; note: string; done: boolean }) {
  return (
    <LinkRow
      to={to}
      label={label}
      aside={
        <Status tone={done ? 'done' : 'waiting'}>
          {done ? GETTING_STARTED_COPY.DONE : GETTING_STARTED_COPY.TO_DO}
        </Status>
      }
    >
      <p className="text-text-muted">{note}</p>
    </LinkRow>
  );
}

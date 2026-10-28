import { LinkRow, Status } from './Ledger';

export function SetupStep({ to, label, note }: { to: string; label: string; note: string }) {
  return (
    <LinkRow to={to} label={label} aside={<Status tone="waiting">To do</Status>}>
      <p className="text-text-muted">{note}</p>
    </LinkRow>
  );
}

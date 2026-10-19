import { DESTINATIONS, GETTING_STARTED_COPY } from '@ledova/shared';
import { LinkRow, Section, Status } from '@components/Ledger';

export function Step({ to, label, note, done }: { to: string; label: string; note: string; done: boolean }) {
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

export function GettingStarted({ activated, registered }: { activated: boolean; registered: boolean }) {
  return (
    <Section title={GETTING_STARTED_COPY.TITLE}>
      <div className="divide-y divide-border-subtle">
        <Step
          to={DESTINATIONS.companyListing.path}
          label={GETTING_STARTED_COPY.ACTIVATE}
          note={GETTING_STARTED_COPY.ACTIVATE_NOTE}
          done={activated}
        />
        <Step
          to={DESTINATIONS.companyRegister.path}
          label={GETTING_STARTED_COPY.REGISTER}
          note={GETTING_STARTED_COPY.REGISTER_NOTE}
          done={registered}
        />
      </div>
    </Section>
  );
}

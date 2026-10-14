import { Link } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_CORRECTION_COPY,
  formatDateTime,
  formatDate,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { RegisterChanges } from '../register/RegisterChanges';
import { useRegisterEntries } from '../register/useRegisterCorrections';

export function RecentChanges({
  owner,
  guard,
  company,
  token,
  className,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  token: string;
  className: string;
}) {
  const history = useRegisterEntries(owner, token, guard);
  return (
    <Section title="Recent changes">
      <p className="text-sm text-text-muted">Recorded changes in {className}</p>
      {history.isPending || history.isFetching ? (
        <p role="status" className="py-3 text-sm text-text-muted">
          Loading recent changes…
        </p>
      ) : history.hasError ? (
        <div role="alert" className="space-y-2 py-3 text-sm text-text-muted">
          <p>Recent changes could not be loaded.</p>
          <PageAction label="Retry recent changes" onClick={history.retry} />
        </div>
      ) : history.entries.length === 0 ? (
        <p className="py-3 text-sm text-text-muted">No register changes are recorded for this class.</p>
      ) : (
        <ol className="divide-y divide-border-subtle">
          {history.entries.slice(0, 3).map((entry) => (
            <li key={entry.uuid} className="space-y-1 py-3 text-sm">
              <p className="font-medium text-text-primary">
                {REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind]} · Entry {entry.sequence}
              </p>
              <p className="text-xs text-text-muted">
                Effective {formatDate(entry.effectiveOn)} · Recorded {formatDateTime(entry.recordedAt)}
              </p>
              <div className="text-text-primary">
                <RegisterChanges changes={entry.changes} />
              </div>
              {entry.correctedBy && <p className="text-text-muted">Reversed by a later correction.</p>}
            </li>
          ))}
        </ol>
      )}
      <Link
        to={DESTINATIONS.companyRegister.path}
        state={{ registerCompany: company, registerToken: token, registerHistory: true }}
        className="mt-2 w-fit text-sm font-medium text-brand-light hover:underline"
      >
        View register history
      </Link>
    </Section>
  );
}

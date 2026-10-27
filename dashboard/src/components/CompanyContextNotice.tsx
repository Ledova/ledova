import { Link } from 'react-router-dom';
import { DESTINATIONS } from '@ledova/shared';
import { useCompanyContext } from '@hooks/useCompanyContext';

export function CompanyContextNotice() {
  const context = useCompanyContext();
  return (
    <p className="text-sm text-text-muted">
      {context?.companyUuid && 'The selected company is unavailable for this page. '}
      <Link
        to={context?.companyPath(DESTINATIONS.home.path) ?? DESTINATIONS.home.path}
        className="text-brand-light underline"
        onClick={(event) => {
          if (!context || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          context.openDashboard();
        }}
      >
        Choose company on Dashboard
      </Link>
      .
    </p>
  );
}

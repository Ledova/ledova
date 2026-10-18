import { SITE_PATHS } from '@utils/paths';
import { useQuery } from '@tanstack/react-query';
import { getOperator, CACHE_TIMING, useAuth, OPERATOR_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { SITE_URL } from '@utils/siteUrl';

const FOOTER_LINKS = [
  { label: 'About', path: SITE_PATHS.about },
  { label: 'Contact', path: SITE_PATHS.contact },
  { label: 'Terms', path: SITE_PATHS.termsOfService },
  { label: 'Privacy', path: SITE_PATHS.privacyPolicy },
];

function useOperatorName(): string | null {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: OPERATOR_QUERY_KEY,
    queryFn: () => getOperator(apiClient),
    enabled: isAuthenticated,
    staleTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });
  return query.data?.data?.name || null;
}

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const operatorName = useOperatorName();

  return (
    <footer className="relative mt-auto border-t border-border-subtle">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-text-muted md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex flex-col gap-1">
          <p>&copy; {currentYear} Ledova contributors</p>
          {operatorName && <p>Operated by {operatorName}</p>}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {FOOTER_LINKS.map((link) => (
            <a key={link.path} href={`${SITE_URL}${link.path}`} className="transition-colors hover:text-text-primary">
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

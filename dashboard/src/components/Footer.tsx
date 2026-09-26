import { useQuery } from '@tanstack/react-query';
import { getOperator, CACHE_TIMING } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { useAuth } from '@hooks/useAuth';
import { MARKETING_URL } from '@utils/marketingUrl';

const FOOTER_LINKS = [
  { label: 'About', path: '/about' },
  { label: 'Contact', path: '/contact' },
  { label: 'Terms', path: '/terms-of-service' },
  { label: 'Privacy', path: '/privacy-policy' },
];

function useOperatorName(): string | null {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: ['operator'],
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
            <a
              key={link.path}
              href={`${MARKETING_URL}${link.path}`}
              className="transition-colors hover:text-text-primary"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

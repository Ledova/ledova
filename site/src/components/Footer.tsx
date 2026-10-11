import { Link, useLocation } from 'react-router-dom';
import { GITHUB_URL } from '../appLinks';

const FOOTER_LINKS = [
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
  { label: 'Terms', to: '/terms-of-service' },
  { label: 'Privacy', to: '/privacy-policy' },
];

export function Footer() {
  const currentYear = new Date().getFullYear();
  const { pathname } = useLocation();

  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm text-ink-muted md:px-8 lg:flex-row lg:items-center lg:justify-between">
        <p>&copy; {currentYear} Ledova contributors · Ledova Noncommercial License 1.0</p>
        <div className="flex flex-wrap gap-x-6 gap-y-3 md:gap-x-8">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-current={link.to === pathname ? 'page' : undefined}
              className="transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

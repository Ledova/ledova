import { Link } from 'react-router-dom';
import { GITHUB_URL } from '../appLinks';

const FOOTER_LINKS = [
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
  { label: 'Terms', to: '/terms-of-service' },
  { label: 'Privacy', to: '/privacy-policy' },
];

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm text-ink-muted md:flex-row md:items-center md:justify-between md:px-8">
        <p>&copy; {currentYear} Ledova contributors · Ledova Noncommercial License 1.0</p>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {FOOTER_LINKS.map((link) => (
            <Link key={link.to} to={link.to} className="transition-colors hover:text-ink">
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

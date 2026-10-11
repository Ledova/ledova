import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { List as ListIcon, X as XIcon } from '@phosphor-icons/react';
import { Logo } from './Logo';
import { SIGN_IN_URL, SIGN_UP_URL } from '../appLinks';

const NAV_LINKS = [
  { label: 'How it works', to: '/#how-it-works' },
  { label: 'Companies', to: '/#companies' },
  { label: 'Investors', to: '/#investors' },
  { label: 'About', to: '/about' },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const closeMenu = () => setMobileOpen(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-rule bg-paper/90 backdrop-blur-md">
      <div className="mx-auto grid h-16 max-w-6xl grid-cols-[1fr_auto_1fr] items-center px-5 md:h-20 md:px-8">
        <Link to="/" onClick={closeMenu} className="col-start-1 justify-self-start">
          <Logo />
        </Link>

        <div className="col-start-2 hidden items-center gap-10 text-[15px] lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-current={link.to === pathname ? 'page' : undefined}
              className="text-ink-muted transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="col-start-3 flex items-center gap-1 justify-self-end md:gap-6">
          <a
            href={SIGN_IN_URL}
            className="hidden whitespace-nowrap text-[15px] font-medium text-ink transition-colors hover:text-ledger md:inline"
          >
            Sign in
          </a>
          <a
            href={SIGN_UP_URL}
            className="whitespace-nowrap rounded-lg bg-ledger px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ledger-hover md:px-5 md:text-[15px]"
          >
            Register
          </a>
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="-mr-3.5 flex h-11 w-11 items-center justify-center text-ink lg:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="site-menu"
          >
            {mobileOpen ? <XIcon size={22} /> : <ListIcon size={22} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div id="site-menu" className="border-t border-rule bg-paper px-5 pb-6 md:px-8 lg:hidden">
          <div className="mx-auto flex max-w-6xl flex-col">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={closeMenu}
                aria-current={link.to === pathname ? 'page' : undefined}
                className="border-b border-rule-soft py-3.5 text-base text-ink"
              >
                {link.label}
              </Link>
            ))}
            <a
              href={SIGN_IN_URL}
              className="mt-5 flex h-12 items-center justify-center rounded-lg border border-rule-strong text-base font-medium text-ink md:hidden"
            >
              Sign in
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

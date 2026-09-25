import { useState } from 'react';
import { Link } from 'react-router-dom';
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
  const closeMenu = () => setMobileOpen(false);

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-rule bg-paper/90 backdrop-blur-md">
      <div className="mx-auto grid h-16 max-w-6xl grid-cols-[1fr_auto_1fr] items-center px-5 md:h-20 md:px-8">
        <Link to="/" onClick={closeMenu} className="col-start-1 justify-self-start">
          <Logo />
        </Link>

        <div className="col-start-2 hidden items-center gap-10 text-[15px] md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.to} to={link.to} className="text-ink-muted transition-colors hover:text-ink">
              {link.label}
            </Link>
          ))}
        </div>

        <div className="col-start-3 flex items-center gap-1 justify-self-end md:gap-6">
          <a
            href={SIGN_IN_URL}
            className="hidden text-[15px] font-medium text-ink transition-colors hover:text-ledger md:inline"
          >
            Sign in
          </a>
          <a
            href={SIGN_UP_URL}
            className="rounded-lg bg-ledger px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ledger-hover md:px-5 md:text-[15px]"
          >
            Register
          </a>
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="-mr-3.5 flex h-11 w-11 items-center justify-center text-ink md:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <XIcon size={22} /> : <ListIcon size={22} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-rule bg-paper px-5 pb-6 md:hidden">
          <div className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={closeMenu}
                className="border-b border-rule-soft py-3.5 text-base text-ink"
              >
                {link.label}
              </Link>
            ))}
            <a
              href={SIGN_IN_URL}
              className="mt-5 flex h-12 items-center justify-center rounded-lg border border-rule-strong text-base font-medium text-ink"
            >
              Sign in
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

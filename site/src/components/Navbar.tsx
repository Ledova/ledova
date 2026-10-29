import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { List as ListIcon, X as XIcon } from '@phosphor-icons/react';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { SIGN_IN_URL, SIGN_UP_URL } from '../appLinks';

const NAV_LINKS = [
  { label: 'Product', to: '/#product' },
  { label: 'How it works', to: '/#how-it-works' },
  { label: 'Questions', to: '/#questions' },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname, hash } = useLocation();
  const currentPath = pathname + hash;
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
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-border-subtle bg-surface-base/90 backdrop-blur-md">
      <div className="mx-auto grid h-16 max-w-6xl grid-cols-[auto_1fr_auto] items-center px-5 md:h-20 md:px-8 lg:grid-cols-[1fr_auto_1fr]">
        <Link to="/" onClick={closeMenu} className="col-start-1 justify-self-start">
          <Logo />
        </Link>

        <div className="col-start-2 hidden items-center gap-10 text-[15px] lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-current={link.to === currentPath ? 'location' : undefined}
              className="text-text-muted transition-colors hover:text-text-primary"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="col-start-3 flex items-center gap-1 justify-self-end md:gap-6">
          <a
            href={SIGN_IN_URL}
            className="hidden whitespace-nowrap text-[15px] font-medium text-text-primary transition-colors hover:text-brand-light md:inline"
          >
            Sign in
          </a>
          <a
            href={SIGN_UP_URL}
            className="inline-flex whitespace-nowrap rounded-lg bg-brand px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover md:px-5 md:text-[15px]"
          >
            Register
          </a>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="-mr-3.5 flex h-11 w-11 items-center justify-center text-text-primary lg:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="site-menu"
          >
            {mobileOpen ? <XIcon size={22} /> : <ListIcon size={22} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div id="site-menu" className="border-t border-border-subtle bg-surface-base px-5 pb-6 md:px-8 lg:hidden">
          <div className="mx-auto flex max-w-6xl flex-col">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={closeMenu}
                aria-current={link.to === currentPath ? 'location' : undefined}
                className="border-b border-border-faint py-3.5 text-base text-text-primary"
              >
                {link.label}
              </Link>
            ))}
            <a
              href={SIGN_IN_URL}
              className="mt-5 flex h-12 items-center justify-center rounded-lg border border-border text-base font-medium text-text-primary md:hidden"
            >
              Sign in
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

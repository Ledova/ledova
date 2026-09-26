import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { ListIcon, XIcon } from '@phosphor-icons/react';
import { NotificationBell } from '@components/NotificationBell';
import { Sidebar } from '@components/Sidebar';
import { Logo } from '@components/Logo';
import { DESIGN_TOKENS } from '@ledova/shared';

const ICON_MD = DESIGN_TOKENS.icon.sizes.md;

export function MobileHeader() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const [shownPath, setShownPath] = useState(location.pathname);

  if (shownPath !== location.pathname) {
    setShownPath(location.pathname);
    setIsOpen(false);
  }

  const handleClose = useCallback(() => setIsOpen(false), []);

  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b border-border-subtle bg-surface-base px-2 sm:px-4">
        <button
          onClick={() => setIsOpen(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-mid/30"
          aria-label="Open navigation"
        >
          <ListIcon size={ICON_MD} />
        </button>
        <Logo />
        <div className="ml-auto">
          <NotificationBell align="end" />
        </div>
      </div>

      <div
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={handleClose}
        aria-hidden="true"
      />

      <div
        className={`fixed inset-y-0 left-0 z-50 w-60 transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={handleClose}
          className="absolute right-3 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-tertiary hover:text-text-primary"
          aria-label="Close navigation"
        >
          <XIcon size={ICON_MD} />
        </button>

        <Sidebar onNavigate={handleClose} />
      </div>
    </>
  );
}

export default MobileHeader;

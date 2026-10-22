import { Fragment, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react';
import { ListIcon, XIcon } from '@phosphor-icons/react';
import { NotificationBell } from './NotificationBell';
import { Sidebar } from './Sidebar';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { ICON_MD } from './iconSizes';

export function MobileHeader() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const place = `${location.pathname}${location.hash}`;
  const [shownPlace, setShownPlace] = useState(place);

  if (shownPlace !== place) {
    setShownPlace(place);
    setIsOpen(false);
  }

  const handleClose = useCallback(() => setIsOpen(false), []);

  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b border-border-subtle bg-surface-base px-2 sm:px-4">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-tertiary hover:text-text-primary"
          aria-label="Open navigation"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
        >
          <ListIcon size={ICON_MD} />
        </button>
        <Logo />
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <NotificationBell align="end" />
        </div>
      </div>

      <Transition show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={handleClose} aria-label="Navigation">
          <TransitionChild
            as={Fragment}
            enter="transition-opacity duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
          </TransitionChild>

          <TransitionChild
            as={Fragment}
            enter="transform transition-transform duration-300 ease-out"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transform transition-transform duration-300 ease-out"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
          >
            <DialogPanel className="fixed inset-y-0 left-0 w-52">
              <button
                type="button"
                onClick={handleClose}
                className="absolute right-3 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-tertiary hover:text-text-primary"
                aria-label="Close navigation"
              >
                <XIcon size={ICON_MD} />
              </button>

              <Sidebar onNavigate={handleClose} />
            </DialogPanel>
          </TransitionChild>
        </Dialog>
      </Transition>
    </>
  );
}

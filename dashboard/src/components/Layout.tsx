import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import Footer from './Footer';
import { BuyCryptoProvider } from '@components/wallet/BuyCryptoProvider';
import { SendTransferProvider } from '@components/wallet/SendTransferProvider';
import { useSignupFinished } from '@hooks/useSignupFinished';
import { useAuth } from '@ledova/shared';
import { AuthLayoutAction } from './auth';
import { InSignedInFrame } from './InSignedInFrame';
import { SignOutButton } from './SignOutButton';

interface LayoutProps {
  children: ReactNode;
}

function useHeadingFocus() {
  const { pathname, hash } = useLocation();
  const navigation = useNavigationType();
  const place = `${pathname}${hash}`;
  const shown = useRef(place);
  useEffect(() => {
    if (shown.current === place) return;
    shown.current = place;
    if (navigation === 'REPLACE') return;
    let frame = 0;
    let frames = 0;
    const focusHeading = () => {
      if (document.querySelector('[aria-modal="true"]')) {
        if (frames++ < 60) frame = requestAnimationFrame(focusHeading);
        return;
      }
      const main = document.getElementById('main');
      if (!main || main.contains(document.activeElement)) return;
      main.querySelector<HTMLElement>('h1')?.focus();
    };
    frame = requestAnimationFrame(focusHeading);
    return () => cancelAnimationFrame(frame);
  }, [place, navigation]);
}

export default function Layout({ children }: LayoutProps) {
  const framed = useSignupFinished();
  const { isAuthenticated } = useAuth();
  useHeadingFocus();

  if (!framed) {
    return (
      <AuthLayoutAction.Provider value={isAuthenticated ? <SignOutButton /> : null}>
        <div className="flex min-h-screen flex-col bg-surface-base text-text-primary">
          <div className="flex flex-grow flex-col">{children}</div>
          <Footer />
        </div>
      </AuthLayoutAction.Provider>
    );
  }

  return (
    <InSignedInFrame.Provider value>
      <BuyCryptoProvider>
        <SendTransferProvider>
          <div className="min-h-screen bg-surface-base text-text-primary">
            <a
              href="#main"
              onClick={(event) => {
                event.preventDefault();
                document.querySelector<HTMLElement>('#main h1')?.focus();
              }}
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-text-primary"
            >
              Skip to main content
            </a>
            <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
              <Sidebar withNotifications />
            </div>

            <div className="fixed inset-x-0 top-0 z-40 lg:hidden">
              <MobileHeader />
            </div>

            <main id="main" className="pt-14 lg:ml-52 lg:pt-0">
              {children}
            </main>
          </div>
        </SendTransferProvider>
      </BuyCryptoProvider>
    </InSignedInFrame.Provider>
  );
}

import { Sidebar } from './Sidebar';
import { DesktopHeader } from './DesktopHeader';
import { MobileHeader } from './MobileHeader';
import Footer from './Footer';
import type { LayoutProps } from '@ledova/shared';
import { HeaderActionsProvider } from '@hooks/useHeaderActions';
import { BuyCryptoProvider } from '@hooks/useBuyCrypto';
import { SendTransferProvider } from '@hooks/useSendTransfer';
import { useSignupFinished } from '@hooks/useSignupFinished';
import { useAuth } from '@hooks/useAuth';
import { AuthLayoutAction } from './AuthLayout/AuthLayoutAction';
import { InSignedInFrame } from './InSignedInFrame';
import { SignOutButton } from './SignOutButton';

export default function Layout({ children }: LayoutProps) {
  const framed = useSignupFinished();
  const { isAuthenticated } = useAuth();

  if (!framed) {
    return (
      <AuthLayoutAction.Provider value={isAuthenticated ? <SignOutButton /> : null}>
        <div className="relative flex min-h-screen min-w-[390px] flex-col bg-surface-base text-text-primary">
          <div className="flex flex-grow flex-col">{children}</div>
          <Footer />
        </div>
      </AuthLayoutAction.Provider>
    );
  }

  return (
    <InSignedInFrame.Provider value>
      <HeaderActionsProvider>
        <BuyCryptoProvider>
          <SendTransferProvider>
            <div className="relative flex min-h-screen min-w-[390px] bg-surface-base text-text-primary">
              <div className="hidden lg:block">
                <div className="fixed left-0 top-0 bottom-0 z-40">
                  <Sidebar />
                </div>
              </div>

              <div className="fixed top-0 left-0 right-0 z-40 lg:hidden">
                <MobileHeader />
              </div>

              <div className="flex-1 flex flex-col lg:ml-60">
                <div className="hidden lg:block">
                  <DesktopHeader />
                </div>

                <main className="flex-grow pt-16 lg:pt-0">{children}</main>
                <Footer minimal />
              </div>
            </div>
          </SendTransferProvider>
        </BuyCryptoProvider>
      </HeaderActionsProvider>
    </InSignedInFrame.Provider>
  );
}

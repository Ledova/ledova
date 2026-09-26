import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import Footer from './Footer';
import type { LayoutProps } from '@ledova/shared';
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
            <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
              <Sidebar withNotifications />
            </div>

            <div className="fixed inset-x-0 top-0 z-40 lg:hidden">
              <MobileHeader />
            </div>

            <main className="pt-14 lg:ml-60 lg:pt-0">{children}</main>
          </div>
        </SendTransferProvider>
      </BuyCryptoProvider>
    </InSignedInFrame.Provider>
  );
}

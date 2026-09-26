import { ReactNode, useContext } from 'react';
import { Logo } from '@components/Logo';
import { MARKETING_URL } from '@utils/marketingUrl';
import { AuthLayoutAction } from './AuthLayoutAction';

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const action = useContext(AuthLayoutAction);

  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 md:h-20 md:px-8">
        <a href={MARKETING_URL}>
          <Logo />
        </a>
        {action}
      </header>
      <main className="flex flex-1 flex-col justify-center pb-16 pt-6">
        <div className="mx-auto w-full max-w-lg px-4 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}

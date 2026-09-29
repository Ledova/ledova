import { SignOutIcon } from '@phosphor-icons/react';
import { ICON_MD } from '@components/iconSizes';
import { useSignOut } from '@hooks/useSignOut';

const LOOKS = {
  header:
    'text-sm font-medium text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed',
  sidebar:
    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-error/10 hover:text-error-light disabled:opacity-50',
};

export function SignOutButton({ variant = 'header' }: { variant?: keyof typeof LOOKS }) {
  const { signOut, isSigningOut } = useSignOut();

  return (
    <button type="button" onClick={signOut} disabled={isSigningOut} className={LOOKS[variant]}>
      {variant === 'sidebar' && <SignOutIcon size={ICON_MD} />}
      {isSigningOut ? 'Signing out...' : 'Sign out'}
    </button>
  );
}

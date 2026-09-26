import { useSignOut } from '@hooks/useSignOut';

export function SignOutButton() {
  const { signOut, isSigningOut } = useSignOut();

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={isSigningOut}
      className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed"
    >
      {isSigningOut ? 'Signing out...' : 'Sign out'}
    </button>
  );
}

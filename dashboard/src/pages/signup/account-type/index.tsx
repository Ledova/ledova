import { AuthLayout, AuthHeader, AuthDivider, AuthAlert, AuthBack } from '@components/auth';
import { SIGNUP_PATH, SIGNUP_PATHS } from '@utils/paths';
import { useNavigate } from 'react-router-dom';
import { UserIcon, BuildingsIcon } from '@phosphor-icons/react';
import { useSignupAccountType } from '@ledova/shared';
import { ICON_LG } from '@components/iconSizes';

type AccountRole = 'investor' | 'company';

interface AccountTypeOption {
  role: AccountRole;
  title: string;
  description: string;
  icon: typeof UserIcon;
}

const ACCOUNT_TYPES: AccountTypeOption[] = [
  {
    role: 'investor',
    title: 'Individual investor',
    description: 'Invest in private-company shares and track your holdings.',
    icon: UserIcon,
  },
  {
    role: 'company',
    title: 'Company representative',
    description: 'Register your company and manage its share register.',
    icon: BuildingsIcon,
  },
];

export default function SignupAccountType() {
  const navigate = useNavigate();
  const { account, isSubmitting, error, chooseRole } = useSignupAccountType();

  const handleSelect = (role: AccountRole) => chooseRole(role, () => navigate(SIGNUP_PATHS.userProfile));

  const handleBack = () => {
    navigate(SIGNUP_PATH);
  };

  return (
    <AuthLayout>
      <AuthHeader title="Choose account type">
        <p className="text-sm text-text-muted mt-1 px-4">How will you be using Ledova?</p>
      </AuthHeader>

      {error && (
        <div className="mb-4">
          <AuthAlert>{error}</AuthAlert>
        </div>
      )}

      <div className="space-y-3">
        {ACCOUNT_TYPES.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.role}
              onClick={() => handleSelect(option.role)}
              disabled={isSubmitting || !account}
              className="group w-full rounded-xl border border-border bg-surface-raised p-4 text-left transition-all duration-150 hover:border-brand-light hover:bg-brand-mid/5 disabled:cursor-not-allowed disabled:opacity-50 sm:p-5"
            >
              <div className="flex items-start gap-4">
                <div className="p-2 rounded-full bg-surface-tertiary border border-border group-hover:border-brand-light group-hover:bg-brand-mid/10 transition-colors">
                  <Icon size={ICON_LG} className="text-text-muted group-hover:text-brand-light transition-colors" />
                </div>
                <div className="flex-1">
                  <h3 className="font-display text-xl tracking-[-0.01em] text-text-primary">{option.title}</h3>
                  <p className="text-sm text-text-muted mt-1">{option.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <AuthDivider />

      <div className="text-center">
        <p className="text-sm text-text-subtle">
          <AuthBack onClick={handleBack} disabled={isSubmitting} />
        </p>
      </div>
    </AuthLayout>
  );
}

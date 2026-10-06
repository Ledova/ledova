import { useNavigate } from 'react-router-dom';
import { UserIcon, BuildingsIcon, WarningIcon } from '@phosphor-icons/react';
import { useSignupAccountType } from '@ledova/shared';
import { ICON_LG, ICON_MD } from '@components/iconSizes';
import { AuthLayout } from '@components/AuthLayout';

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
    title: 'Individual Investor',
    description: 'Invest in private-company shares and track your holdings.',
    icon: UserIcon,
  },
  {
    role: 'company',
    title: 'Company Representative',
    description: 'Register your company and manage its share register.',
    icon: BuildingsIcon,
  },
];

export function SignupAccountType() {
  const navigate = useNavigate();
  const { account, isSubmitting, error, chooseRole } = useSignupAccountType();

  const handleSelect = (role: AccountRole) =>
    chooseRole(role, () => {
      if (role === 'investor') {
        navigate('/signup/pre-screening');
      } else {
        navigate('/signup/identity-verification');
      }
    });

  const handleBack = () => {
    navigate('/signup/email-confirmation');
  };

  return (
    <AuthLayout>
      <div className="text-center mb-6">
        <h1 className="font-display text-3xl tracking-[-0.01em] text-text-primary">Choose Account Type</h1>
        <p className="text-sm text-text-muted mt-1 px-4">How will you be using Ledova?</p>
      </div>

      {error && (
        <div className="mb-4 bg-error-subtle border border-error-dark rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <WarningIcon size={ICON_MD} className="text-error-light" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-error-light" role="alert">
                {error}
              </p>
            </div>
          </div>
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

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-surface-base text-text-subtle font-medium">or</span>
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm text-text-subtle">
          <button
            type="button"
            onClick={handleBack}
            disabled={isSubmitting}
            className="font-semibold text-brand-light hover:text-brand-subtle transition-colors disabled:opacity-50"
          >
            Go Back
          </button>
        </p>
      </div>
    </AuthLayout>
  );
}

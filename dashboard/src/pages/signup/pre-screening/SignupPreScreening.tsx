import { useNavigate } from 'react-router-dom';
import { Checkbox, Description, Field, Label } from '@headlessui/react';
import { ShieldCheckIcon, WarningIcon, CheckCircleIcon } from '@phosphor-icons/react';
import LoadingState from '@components/signup/LoadingState';
import ErrorState from '@components/signup/ErrorState';
import { useSignupPreScreening } from './useSignupPreScreening';
import { AuthLayout } from '@components/AuthLayout';
import { DESIGN_TOKENS } from '@ledova/shared';

const ICON_MD = DESIGN_TOKENS.icon.sizes.md;

export function SignupPreScreening() {
  const navigate = useNavigate();
  const {
    form,
    acknowledgedWholesaleOnly,
    toggleWholesaleOnly,
    generalError,
    isLoading,
    isSubmitting,
    isFormValid,
    setFieldValue,
    handleSubmit,
    retryLoad,
  } = useSignupPreScreening();

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSubmit(() => {
      navigate('/signup/identity-verification');
    });
  };

  const handleBack = () => {
    navigate('/signup/email-confirmation');
  };

  const declarations = [
    {
      label: 'I am 18 years or older',
      description: 'You must be at least 18 to use our platform',
      checked: form.confirmedOver18,
      onChange: (checked: boolean) => setFieldValue('confirmedOver18', checked),
    },
    {
      label: 'I am currently an Australian resident',
      description: 'Our services are currently only available to Australian residents',
      checked: form.confirmedAustralianResident,
      onChange: (checked: boolean) => setFieldValue('confirmedAustralianResident', checked),
    },
    {
      label: 'I am acting on my own behalf',
      description: 'Not for a business, trust, or on behalf of someone else',
      checked: form.confirmedIndividualAccount,
      onChange: (checked: boolean) => setFieldValue('confirmedIndividualAccount', checked),
    },
    {
      label: 'I understand share offerings here are wholesale only',
      description:
        'Offers are made without a disclosure document to wholesale and sophisticated investors. You will need to evidence that status before you can subscribe.',
      checked: acknowledgedWholesaleOnly,
      onChange: () => toggleWholesaleOnly(),
    },
  ];

  if (isLoading) {
    return <LoadingState message="Loading..." />;
  }

  if (generalError && !isSubmitting) {
    return <ErrorState title="Unable to Load" message={generalError} onRetry={retryLoad} />;
  }

  return (
    <AuthLayout>
      <div className="text-center mb-6">
        <div className="flex justify-center mb-3">
          <div className="p-2 rounded-full bg-surface-raised border border-border">
            <ShieldCheckIcon size={ICON_MD} className="text-text-muted" />
          </div>
        </div>
        <h1 className="font-display text-3xl tracking-[-0.01em] text-text-primary">Eligibility Check</h1>
        <p className="text-sm text-text-muted mt-1 px-4">
          Before we continue, please confirm the following requirements to comply with Australian regulations.
        </p>
      </div>

      <div className="bg-surface-raised rounded-lg border border-border">
        <div className="p-6">
          <form onSubmit={handleContinue} className="space-y-6">
            {generalError && (
              <div className="bg-error-subtle border border-error-dark rounded-lg p-4">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <WarningIcon size={ICON_MD} className="text-error-light" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-error-light" role="alert">
                      {generalError}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {declarations.map((declaration) => (
              <Field key={declaration.label} className="flex items-start gap-3" disabled={isSubmitting}>
                <Checkbox
                  checked={declaration.checked}
                  onChange={declaration.onChange}
                  className="group mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border-2 border-border bg-surface-tertiary transition-colors focus:outline-none data-[checked]:border-brand-mid data-[checked]:bg-brand-mid data-[focus]:ring-2 data-[focus]:ring-border-focus data-[focus]:ring-offset-2"
                >
                  <CheckCircleIcon size={ICON_MD} className="hidden text-white group-data-[checked]:block" />
                </Checkbox>
                <div className="flex-1">
                  <Label className="mb-1 block cursor-pointer text-base font-medium text-text-primary">
                    {declaration.label}
                  </Label>
                  <Description className="text-xs text-text-subtle">{declaration.description}</Description>
                </div>
              </Field>
            ))}

            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="w-full bg-brand-mid hover:bg-brand disabled:bg-surface-disabled disabled:text-text-secondary disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition-colors shadow-lg shadow-brand-light/40 disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-2 focus:ring-offset-surface-base"
            >
              {isSubmitting ? (
                <div className="flex items-center justify-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                  <span>Saving...</span>
                </div>
              ) : (
                'Continue'
              )}
            </button>
          </form>
        </div>
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
            className="font-semibold text-brand-light hover:text-brand-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Go Back
          </button>
        </p>
      </div>
    </AuthLayout>
  );
}

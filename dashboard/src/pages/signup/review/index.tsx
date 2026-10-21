import { AuthLayout, AUTH_BUTTON_CLASS, AuthHeader, AuthDivider } from '@components/auth';
import { SIGNUP_PATHS, SITE_PATHS } from '@utils/paths';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ClipboardTextIcon } from '@phosphor-icons/react';
import { IdentityVerificationModal } from '@components/IdentityVerificationModal';
import { formatPhoneWithCountryCode, formatSourceOfFunds, formatIntendedUse } from '@ledova/shared';
import { ICON_LG } from '@components/iconSizes';
import { useReview } from './useReview';

import { Section } from '@components/Ledger';
import { COMPANY_TYPES } from '@pages/signup/shared/constants';
import { SITE_URL } from '@utils/siteUrl';
import { LoadingState } from '@pages/signup/shared/LoadingState';

function displayCompanyType(companyType: string | undefined) {
  return COMPANY_TYPES.find((type) => type.value === companyType)?.label ?? companyType ?? '';
}

export default function SignupReview() {
  const navigate = useNavigate();
  const {
    data,
    company,
    isCompany,
    identityRequired,
    isLoading,
    error,
    completionError,
    completeSignup,
    isSubmitting,
    canCompleteSignup,
    retryLoad,
    authorityRequest,
    authorityError,
    resetAuthorityRequest,
    isResettingAuthority,
  } = useReview();
  const [verificationOpen, setVerificationOpen] = useState(false);

  const handleBack = () => {
    if (isCompany) {
      navigate(SIGNUP_PATHS.companyRegistration);
    } else {
      navigate(SIGNUP_PATHS.financialProfile);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading your answers…" />;
  }

  if (error) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center justify-center py-8">
          <div className="text-center">
            <h3 className="text-lg font-medium text-error-light mb-2">Error loading data</h3>
            <p className="text-error-light">{error}</p>
            <button type="button" onClick={retryLoad} className="mt-4 font-semibold text-brand-light underline">
              Try again
            </button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  const { userProfile, financialProfile } = data;

  return (
    <AuthLayout>
      <AuthHeader
        title={isCompany ? 'Complete company setup' : 'Review & confirm'}
        icon={<ClipboardTextIcon size={ICON_LG} className="text-text-muted" />}
        review
      >
        <p className="text-sm text-text-muted">
          {isCompany
            ? 'Review your saved details. Documents and team setup can wait until your dashboard.'
            : 'Please review your information before completing signup'}
        </p>
      </AuthHeader>

      <div className="space-y-4">
        <Section title="Personal information">
          {userProfile ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Full name:</span>
                <span className="text-sm text-text-primary font-medium">{userProfile.fullName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Phone:</span>
                <span className="text-sm text-text-primary font-medium">
                  {formatPhoneWithCountryCode(userProfile.phoneCountryCode, userProfile.phoneNumber)}
                </span>
              </div>
              <div className="flex justify-between items-start gap-4">
                <span className="text-sm text-text-muted">Residential address:</span>
                <span className="min-w-0 whitespace-pre-wrap break-words text-right text-sm text-text-primary font-medium">
                  {userProfile.residentialAddress || 'Not provided'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-muted">No personal information found.</p>
          )}
        </Section>

        {isCompany ? (
          <Section title="Company information">
            {company ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Company name:</span>
                  <span className="text-sm text-text-primary font-medium">{company.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">ACN:</span>
                  <span className="text-sm text-text-primary font-medium">{company.acn}</span>
                </div>
                {company.abn && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-muted">ABN:</span>
                    <span className="text-sm text-text-primary font-medium">{company.abn}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Type:</span>
                  <span className="text-sm text-text-primary font-medium">
                    {displayCompanyType(company.companyType)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-muted">No company information found.</p>
            )}
          </Section>
        ) : (
          <Section title="Financial profile">
            {financialProfile ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Source of funds:</span>
                  <span className="text-sm text-text-primary font-medium">
                    {formatSourceOfFunds(financialProfile.sourceOfFunds)}
                  </span>
                </div>
                {financialProfile.sourceOfFundsOtherText && (
                  <div className="flex justify-between items-start">
                    <span className="text-sm text-text-muted">Source (Other):</span>
                    <span className="text-sm text-text-primary font-medium text-right max-w-[200px]">
                      {financialProfile.sourceOfFundsOtherText}
                    </span>
                  </div>
                )}
                {financialProfile.intendedUse && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-muted">Intended use:</span>
                    <span className="text-sm text-text-primary font-medium">
                      {formatIntendedUse(financialProfile.intendedUse)}
                    </span>
                  </div>
                )}
                {financialProfile.intendedUseOtherText && (
                  <div className="flex justify-between items-start">
                    <span className="text-sm text-text-muted">Intended use (Other):</span>
                    <span className="text-sm text-text-primary font-medium text-right max-w-[200px]">
                      {financialProfile.intendedUseOtherText}
                    </span>
                  </div>
                )}
                {financialProfile.occupation && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-muted">Occupation:</span>
                    <span className="text-sm text-text-primary font-medium">{financialProfile.occupation}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-text-muted">No financial profile found.</p>
            )}
          </Section>
        )}

        <div className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5">
          {isCompany && company ? (
            <div className="space-y-3 mb-4 text-sm text-text-body">
              <p className="leading-relaxed">
                By completing setup, you confirm that you are authorised to administer {company.name}, including
                managing its users, and accept the{' '}
                <a
                  href={`${SITE_URL}${SITE_PATHS.termsOfService}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-light hover:text-brand-subtle underline"
                >
                  Terms of Service
                </a>{' '}
                on the company’s behalf.
              </p>
              {authorityError && (
                <div role="alert" className="space-y-2 text-error-light">
                  <p>{authorityError}</p>
                  {authorityRequest?.status === 'pending' && (
                    <button
                      type="button"
                      disabled={isSubmitting || isResettingAuthority}
                      onClick={() => void resetAuthorityRequest().catch(() => undefined)}
                      className="font-semibold underline disabled:opacity-50"
                    >
                      Update saved setup
                    </button>
                  )}
                  <button type="button" onClick={() => void retryLoad()} className="font-semibold underline">
                    Refresh company setup
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-body leading-relaxed mb-4">
              By completing signup, you accept the{' '}
              <a
                href={`${SITE_URL}${SITE_PATHS.termsOfService}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-light hover:text-brand-subtle underline"
              >
                Terms of Service
              </a>{' '}
              and{' '}
              <a
                href={`${SITE_URL}${SITE_PATHS.privacyPolicy}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-light hover:text-brand-subtle underline"
              >
                Privacy Policy
              </a>
              .
            </p>
          )}
          {identityRequired ? (
            <p className="text-sm text-text-body text-center mb-4">
              This platform requires a verified identity before company setup.{' '}
              <button
                type="button"
                onClick={() => setVerificationOpen(true)}
                className="font-semibold text-brand-light hover:text-brand-subtle underline"
              >
                Verify your identity
              </button>
            </p>
          ) : (
            !canCompleteSignup && (
              <p className="text-sm text-error-light text-center mb-4">
                Please ensure all information is complete to proceed.
              </p>
            )
          )}
          {completionError && (
            <p role="alert" className="text-sm text-error-light text-center mb-4">
              {completionError}
            </p>
          )}
          <button
            type="button"
            onClick={() => void completeSignup().catch(() => undefined)}
            disabled={!canCompleteSignup || isSubmitting || isResettingAuthority}
            className={AUTH_BUTTON_CLASS}
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                <span>Completing…</span>
              </div>
            ) : isCompany ? (
              'Complete company setup'
            ) : (
              'Complete signup'
            )}
          </button>
        </div>
      </div>

      <AuthDivider />

      <div className="text-center">
        <p className="text-sm text-text-subtle">
          <button
            type="button"
            onClick={handleBack}
            disabled={isSubmitting || isResettingAuthority}
            className="font-semibold text-brand-light hover:text-brand-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Go back
          </button>
        </p>
      </div>

      {identityRequired && (
        <IdentityVerificationModal
          isOpen={verificationOpen}
          onClose={() => {
            setVerificationOpen(false);
            void retryLoad();
          }}
        />
      )}
    </AuthLayout>
  );
}

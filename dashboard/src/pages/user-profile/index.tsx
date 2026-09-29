import { useState } from 'react';
import { formatDate, formatDateTime, getUserVerificationStatus } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Row, Rows, Section, Status } from '@components/Ledger';
import { DocumentsPanel } from '@components/DocumentsPanel';
import { useDocumentsEnabled } from '@hooks/useDocuments';
import { useUserProfile } from './useUserProfile';
import { IdentityVerificationModal } from './components/IdentityVerificationModal';

export function UserProfilePage() {
  const { userProfile, isLoading, isError, refreshProfile, updateProfile, isUpdating, updateError, resetUpdate } =
    useUserProfile();
  const documentsEnabled = useDocumentsEnabled();
  const verification = getUserVerificationStatus(userProfile);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationOpen, setVerificationOpen] = useState(false);

  function editPhone() {
    setPhoneCode(userProfile?.phoneCountryCode || '');
    setPhoneNumber(userProfile?.phoneNumber || '');
    resetUpdate();
    setEditingPhone(true);
  }

  if (isLoading) return <Page loading />;
  if (isError) {
    return (
      <Page>
        <p role="alert" className="text-sm text-error-light">
          Your profile could not be loaded.
        </p>
        <PageAction label="Try again" onClick={refreshProfile} />
      </Page>
    );
  }
  if (!userProfile)
    return (
      <Page>
        <p className="text-sm text-text-muted">No profile data is available.</p>
      </Page>
    );

  const phone = userProfile.phoneNumber
    ? `${userProfile.phoneCountryCode || ''} ${userProfile.phoneNumber}`.trim()
    : 'Not provided';

  return (
    <Page>
      <Section title="Personal information">
        <Rows>
          <Row label="Full name">
            <span className="break-words">{userProfile.fullName || 'Not provided'}</span>
          </Row>
          <Row label="Email">
            <span className="break-all">{userProfile.email || 'Not provided'}</span>
          </Row>
          <Row label="Phone">{phone}</Row>
          <Row label="Date of birth">{formatDate(userProfile.dateOfBirth, 'Not provided')}</Row>
          <Row label="Address">
            <span className="break-words">{userProfile.residentialAddress || 'Not provided'}</span>
          </Row>
          <Row label="Citizenship">{userProfile.citizenshipCountryName || 'Not provided'}</Row>
        </Rows>
        {editingPhone ? (
          <form
            className="space-y-3 border-t border-border-subtle py-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isUpdating)
                updateProfile({ phoneCountryCode: phoneCode, phoneNumber }, () => setEditingPhone(false));
            }}
          >
            <div className="flex flex-wrap gap-3">
              <label className="flex w-28 flex-col gap-1 text-sm text-text-muted">
                Country code
                <input
                  type="tel"
                  autoComplete="tel-country-code"
                  value={phoneCode}
                  disabled={isUpdating}
                  onChange={(event) => setPhoneCode(event.target.value)}
                  className="min-w-0 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-brand-mid focus:outline-none focus:ring-1 focus:ring-brand-mid"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-text-muted">
                Phone number
                <input
                  type="tel"
                  autoComplete="tel-national"
                  value={phoneNumber}
                  disabled={isUpdating}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  className="min-w-0 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-brand-mid focus:outline-none focus:ring-1 focus:ring-brand-mid"
                />
              </label>
            </div>
            {updateError && (
              <p role="alert" className="text-sm text-error-light">
                Your phone number could not be saved. Try again.
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isUpdating}
                className="rounded-lg border border-brand-mid bg-brand-mid px-3.5 py-2 text-sm text-white disabled:opacity-50"
              >
                {isUpdating ? 'Saving…' : 'Save phone'}
              </button>
              <PageAction label="Cancel" disabled={isUpdating} onClick={() => setEditingPhone(false)} />
            </div>
          </form>
        ) : (
          <PageAction label="Edit phone" onClick={editPhone} />
        )}
      </Section>
      <Section title="Account status">
        <Rows>
          <Row label="Identity check">
            <Status
              tone={verification.type === 'verified' ? 'done' : verification.type === 'rejected' ? 'closed' : 'waiting'}
            >
              {verification.label}
            </Status>
          </Row>
          <Row label="Member since">{formatDate(userProfile.dateJoined, 'Not available')}</Row>
          <Row label="Last login">{formatDateTime(userProfile.lastLogin)}</Row>
        </Rows>
        <PageAction label="Review identity check" onClick={() => setVerificationOpen(true)} />
      </Section>
      {documentsEnabled && (
        <Section title="Supporting payslips">
          <DocumentsPanel />
        </Section>
      )}
      <IdentityVerificationModal
        isOpen={verificationOpen}
        onClose={() => {
          setVerificationOpen(false);
          refreshProfile();
        }}
      />
    </Page>
  );
}

export default UserProfilePage;

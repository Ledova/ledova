import { useState } from 'react';
import { formatDate, formatDateTime, getUserVerificationStatus } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Row, Rows, Section, Status } from '@components/Ledger';
import { DocumentsPanel } from '@components/DocumentsPanel';
import { FIELD_CLASS } from '@components/fieldClass';
import { useUserProfile } from '@hooks/useUserProfile';
import { IdentityVerificationModal } from './components/IdentityVerificationModal';

function UserProfilePage() {
  const {
    userProfile,
    isLoading,
    isError,
    isFetching,
    refreshProfile,
    updateProfile,
    isUpdating,
    updateError,
    resetUpdate,
    sourceKey,
    ownerKey,
  } = useUserProfile();
  const verification = getUserVerificationStatus(userProfile);
  const [editing, setEditing] = useState<{ source: string | null; owner: string | null } | null>(null);
  const [fullName, setFullName] = useState('');
  const [residentialAddress, setResidentialAddress] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationOpen, setVerificationOpen] = useState(false);

  function editDetails() {
    setFullName(userProfile?.fullName || '');
    setResidentialAddress(userProfile?.residentialAddress || '');
    setPhoneCode(userProfile?.phoneCountryCode || '');
    setPhoneNumber(userProfile?.phoneNumber || '');
    resetUpdate();
    setEditing({ source: sourceKey, owner: ownerKey });
  }

  if (isLoading) return <Page narrow loading />;
  if (isError) {
    return (
      <Page narrow>
        <p role="alert" className="text-sm text-error-light">
          Your profile could not be loaded.
        </p>
        <PageAction label="Try again" onClick={refreshProfile} />
      </Page>
    );
  }
  if (!userProfile)
    return (
      <Page narrow>
        <p className="text-sm text-text-muted">No profile data is available.</p>
      </Page>
    );

  const blocked = isFetching || isUpdating;
  const isEditing = editing?.source === sourceKey && editing?.owner === ownerKey;
  const phone = userProfile.phoneNumber
    ? `${userProfile.phoneCountryCode || ''} ${userProfile.phoneNumber}`.trim()
    : 'Not provided';

  return (
    <Page narrow>
      <Section title="Personal information">
        <Rows>
          {!isEditing && (
            <Row label="Full name">
              <span className="break-words">{userProfile.fullName || 'Not provided'}</span>
            </Row>
          )}
          <Row label="Email">
            <span className="break-all">{userProfile.email || 'Not provided'}</span>
          </Row>
          {!isEditing && <Row label="Phone">{phone}</Row>}
          <Row label="Date of birth">{formatDate(userProfile.dateOfBirth, 'Not provided')}</Row>
          {!isEditing && (
            <Row label="Address">
              <span className="break-words">{userProfile.residentialAddress || 'Not provided'}</span>
            </Row>
          )}
          <Row label="Citizenship">{userProfile.citizenshipCountryName || 'Not provided'}</Row>
        </Rows>
        {isEditing ? (
          <form
            className="space-y-4 border-t border-border-subtle pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!blocked)
                updateProfile(
                  {
                    fullName: fullName.trim(),
                    residentialAddress: residentialAddress.trim(),
                    phoneCountryCode: phoneCode,
                    phoneNumber,
                  },
                  () => setEditing(null),
                );
            }}
          >
            <p className="text-sm text-text-muted">
              These details are provided by you. Editing them does not verify your identity.
            </p>
            <label className="flex flex-col gap-1 text-sm text-text-muted">
              Full name
              <input
                type="text"
                autoComplete="name"
                value={fullName}
                maxLength={100}
                disabled={blocked}
                onChange={(event) => setFullName(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-muted">
              Residential address
              <textarea
                autoComplete="street-address"
                value={residentialAddress}
                disabled={blocked}
                onChange={(event) => setResidentialAddress(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="flex w-28 flex-col gap-1 text-sm text-text-muted">
                Country code
                <input
                  type="tel"
                  autoComplete="tel-country-code"
                  value={phoneCode}
                  disabled={blocked}
                  onChange={(event) => setPhoneCode(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-text-muted">
                Phone number
                <input
                  type="tel"
                  autoComplete="tel-national"
                  value={phoneNumber}
                  disabled={blocked}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>
            </div>
            {updateError && (
              <p role="alert" className="text-sm text-error-light">
                Your personal details could not be saved. Try again.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={blocked}
                className="inline-flex items-center rounded-lg border border-brand-mid bg-brand-mid px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isUpdating ? 'Saving…' : 'Save personal details'}
              </button>
              <PageAction label="Cancel" disabled={blocked} onClick={() => setEditing(null)} />
            </div>
          </form>
        ) : (
          <PageAction label="Edit personal details" disabled={blocked} onClick={editDetails} />
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
      <Section title="Supporting payslips">
        <DocumentsPanel />
      </Section>
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

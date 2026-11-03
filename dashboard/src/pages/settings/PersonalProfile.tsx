import { Field, TextArea, TextInput } from '@components/Field';
import { useEffect, useRef, useState } from 'react';
import { FIELD_LIMITS, formatDate, failureSentence } from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { Outcome, Row, Rows, Section, LoadError, Loading, Failure } from '@components/Ledger';
import { useUserProfile } from '@hooks/useUserProfile';

export function PersonalProfile({ profile }: { profile: ReturnType<typeof useUserProfile> }) {
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
  } = profile;
  const [editing, setEditing] = useState<{ source: string | null; owner: string | null } | null>(null);
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [residentialAddress, setResidentialAddress] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const firstField = useRef<HTMLInputElement>(null);
  const editAction = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const isEditing = editing?.source === sourceKey && editing?.owner === ownerKey;
  useEffect(() => {
    if (isEditing) firstField.current?.focus();
    else if (returnFocus.current && !isUpdating && !isFetching && editAction.current) {
      returnFocus.current = false;
      editAction.current.focus();
    }
  }, [isEditing, isUpdating, isFetching]);

  function closeEdit() {
    returnFocus.current = true;
    setEditing(null);
  }

  function editDetails() {
    setFullName(userProfile?.fullName || '');
    setResidentialAddress(userProfile?.residentialAddress || '');
    setPhoneCode(userProfile?.phoneCountryCode || '');
    setPhoneNumber(userProfile?.phoneNumber || '');
    resetUpdate();
    setSavedFor(null);
    setEditing({ source: sourceKey, owner: ownerKey });
  }

  if (isLoading) return <Loading>Loading your profile…</Loading>;
  if (isError) {
    return (
      <Section title="Personal information">
        <LoadError retry={refreshProfile} busy={isFetching}>
          Your profile could not be loaded.
        </LoadError>
      </Section>
    );
  }
  if (!userProfile)
    return (
      <Section title="Personal information">
        <p className="text-sm text-text-muted">No profile data is available.</p>
      </Section>
    );

  const blocked = isFetching || isUpdating;
  const phone = userProfile.phoneNumber
    ? `${userProfile.phoneCountryCode || ''} ${userProfile.phoneNumber}`.trim()
    : 'Not provided';

  return (
    <>
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
        <Outcome>{savedFor !== null && savedFor === ownerKey && 'Your personal details were saved.'}</Outcome>
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
                  () => {
                    closeEdit();
                    setSavedFor(ownerKey);
                  },
                );
            }}
          >
            <p className="text-sm text-text-muted">
              These details are provided by you. Editing them does not verify your identity.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" className="sm:col-span-2">
                <TextInput
                  ref={firstField}
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  maxLength={FIELD_LIMITS.PROFILE_NAME}
                  disabled={blocked}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </Field>
              <Field label="Residential address" className="sm:col-span-2">
                <TextArea
                  autoComplete="street-address"
                  value={residentialAddress}
                  disabled={blocked}
                  onChange={(event) => setResidentialAddress(event.target.value)}
                />
              </Field>
              <Field label="Country code">
                <TextInput
                  maxLength={FIELD_LIMITS.PHONE_COUNTRY_CODE}
                  type="tel"
                  autoComplete="tel-country-code"
                  value={phoneCode}
                  disabled={blocked}
                  onChange={(event) => setPhoneCode(event.target.value)}
                />
              </Field>
              <Field label="Phone number">
                <TextInput
                  maxLength={FIELD_LIMITS.PHONE}
                  type="tel"
                  autoComplete="tel-national"
                  value={phoneNumber}
                  disabled={blocked}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                />
              </Field>
            </div>
            {updateError && (
              <Failure>{failureSentence(updateError, 'Your personal details could not be saved. Try again.')}</Failure>
            )}
            <FormActions>
              <PageAction label="Cancel" disabled={blocked} onClick={closeEdit} />
              <PageAction
                type="submit"
                primary
                label="Save personal details"
                busy={isUpdating}
                busyLabel="Saving…"
                disabled={blocked}
              />
            </FormActions>
          </form>
        ) : (
          <FormActions>
            <PageAction ref={editAction} label="Edit" disabled={blocked} onClick={editDetails} />
          </FormActions>
        )}
      </Section>
    </>
  );
}

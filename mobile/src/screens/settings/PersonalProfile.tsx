import { useState } from 'react';
import { Text, View } from 'react-native';
import { FIELD_LIMITS, failureSentence, formatDate } from '@ledova/shared';
import { Action, Fact, FormActions, Rows, Section, Status } from '../../components/Ledger';
import { Field } from '../../components/register/RegisterFields';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { useUserProfile } from '../../hooks/useUserProfile';

export function PersonalProfile({ profile }: { profile: ReturnType<typeof useUserProfile> }) {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    form: {
      gap: theme.spacing.md,
      paddingTop: theme.spacing.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.subtle,
    },
  }));
  const { userProfile, profile: state, update, updateProfile, sourceKey, ownerKey } = profile;
  const [editing, setEditing] = useState<{ source: string | null; owner: string | null } | null>(null);
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [residentialAddress, setResidentialAddress] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const blocked = state.isFetching || state.isError || !userProfile || update.isPending;
  const isEditing =
    !!editing &&
    editing.owner === ownerKey &&
    !!ownerKey &&
    (editing.source === sourceKey || (!sourceKey && state.isError));
  if (state.isLoading) return <Text style={styles.muted}>Loading your profile…</Text>;
  return (
    <Section title="Personal information">
      {state.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            Your profile could not be loaded.
          </Text>
          <Action label="Try again" disabled={state.isFetching} onPress={() => void state.refetch()} />
        </View>
      ) : !userProfile ? (
        <Text style={styles.muted}>No profile data is available.</Text>
      ) : (
        <>
          <Rows>
            {!isEditing && <Fact label="Full name">{userProfile.fullName || 'Not provided'}</Fact>}
            <Fact label="Email">{userProfile.email || 'Not provided'}</Fact>
            {!isEditing && (
              <Fact label="Phone">
                {userProfile.phoneNumber
                  ? `${userProfile.phoneCountryCode || ''} ${userProfile.phoneNumber}`.trim()
                  : 'Not provided'}
              </Fact>
            )}
            <Fact label="Date of birth">{formatDate(userProfile.dateOfBirth, 'Not provided')}</Fact>
            {!isEditing && <Fact label="Address">{userProfile.residentialAddress || 'Not provided'}</Fact>}
            <Fact label="Citizenship">{userProfile.citizenshipCountryName || 'Not provided'}</Fact>
          </Rows>
          {savedFor !== null && savedFor === ownerKey && (
            <View accessibilityLiveRegion="polite">
              <Status tone="done">Your personal details were saved.</Status>
            </View>
          )}
          {!isEditing && (
            <FormActions>
              <Action
                label="Edit personal details"
                disabled={blocked}
                onPress={() => {
                  setFullName(userProfile.fullName || '');
                  setResidentialAddress(userProfile.residentialAddress || '');
                  setPhoneCode(userProfile.phoneCountryCode || '');
                  setPhoneNumber(userProfile.phoneNumber || '');
                  update.reset();
                  setSavedFor(null);
                  setEditing({ source: sourceKey, owner: ownerKey });
                }}
              />
            </FormActions>
          )}
        </>
      )}
      {isEditing && (
        <View style={look.form}>
          <Text style={styles.muted}>
            These details are provided by you. Editing them does not verify your identity.
          </Text>
          <Field
            label="Full name"
            value={fullName}
            maxLength={FIELD_LIMITS.PROFILE_NAME}
            editable={!blocked}
            onChange={setFullName}
          />
          <Field
            label="Residential address"
            value={residentialAddress}
            multiline
            editable={!blocked}
            onChange={setResidentialAddress}
          />
          <Field
            label="Country code"
            value={phoneCode}
            keyboardType="phone-pad"
            maxLength={FIELD_LIMITS.PHONE_COUNTRY_CODE}
            editable={!blocked}
            onChange={setPhoneCode}
          />
          <Field
            label="Phone number"
            value={phoneNumber}
            keyboardType="phone-pad"
            maxLength={FIELD_LIMITS.PHONE}
            editable={!blocked}
            onChange={setPhoneNumber}
          />
          {state.isFetching && <Text style={styles.muted}>Refreshing profile information…</Text>}
          {update.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {failureSentence(update.error, 'Your personal details could not be saved. Try again.')}
            </Text>
          )}
          <FormActions>
            <Action label="Cancel" disabled={update.isPending} onPress={() => setEditing(null)} />
            <Action
              label={update.isPending ? 'Saving…' : 'Save personal details'}
              primary
              disabled={blocked}
              onPress={() =>
                updateProfile(
                  {
                    fullName: fullName.trim(),
                    residentialAddress: residentialAddress.trim(),
                    phoneCountryCode: phoneCode,
                    phoneNumber,
                  },
                  () => {
                    setEditing(null);
                    setSavedFor(ownerKey);
                  },
                )
              }
            />
          </FormActions>
        </View>
      )}
    </Section>
  );
}

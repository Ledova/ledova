import { useState } from 'react';
import { ActivityIndicator, RefreshControl, Text, TextInput, View } from 'react-native';
import { formatDate, formatDateTime, getUserVerificationStatus } from '@ledova/shared';
import { Action, Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useUserProfile } from './useUserProfile';
import { VerificationModal } from './components/VerificationModal';
import { useAccountStyles } from '../account/styles';
export function UserProfileScreen() {
  const styles = useAccountStyles();
  const { userProfile, profile, update, updateProfile } = useUserProfile();
  const [editing, setEditing] = useState(false);
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationOpen, setVerificationOpen] = useState(false);
  const blocked = profile.isFetching || profile.isError || !userProfile || update.isPending;
  const verification = getUserVerificationStatus(userProfile);
  return (
    <>
      <Page
        testID="profile-scroll"
        title="Profile"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={profile.isFetching && !profile.isLoading}
            onRefresh={() => void profile.refetch()}
          />
        }
      >
        {profile.isLoading ? (
          <ActivityIndicator accessibilityLabel="Loading profile" />
        ) : profile.isError ? (
          <View style={styles.fields}>
            <Text accessibilityRole="alert" style={styles.error}>
              Your profile could not be loaded.
            </Text>
            <Action label="Try again" disabled={profile.isFetching} onPress={() => void profile.refetch()} />
          </View>
        ) : !userProfile ? (
          <Text style={styles.muted}>No profile data is available.</Text>
        ) : (
          <Section title="Personal information">
            <Rows>
              <Row label="Full name">{userProfile.fullName || 'Not provided'}</Row>
              <Row label="Email">{userProfile.email || 'Not provided'}</Row>
              <Row label="Phone">
                {userProfile.phoneNumber
                  ? `${userProfile.phoneCountryCode || ''} ${userProfile.phoneNumber}`.trim()
                  : 'Not provided'}
              </Row>
              <Row label="Date of birth">{formatDate(userProfile.dateOfBirth, 'Not provided')}</Row>
              <Row label="Address">{userProfile.residentialAddress || 'Not provided'}</Row>
              <Row label="Citizenship">{userProfile.citizenshipCountryName || 'Not provided'}</Row>
            </Rows>
            {!editing && (
              <Action
                label="Edit phone"
                disabled={blocked}
                onPress={() => {
                  setPhoneCode(userProfile.phoneCountryCode || '');
                  setPhoneNumber(userProfile.phoneNumber || '');
                  update.reset();
                  setEditing(true);
                }}
              />
            )}
          </Section>
        )}
        {editing && (
          <Section title="Edit phone">
            <View style={styles.fields}>
              <Text style={styles.muted}>Country code</Text>
              <TextInput
                accessibilityLabel="Country code"
                style={styles.input}
                keyboardType="phone-pad"
                value={phoneCode}
                onChangeText={setPhoneCode}
                editable={!update.isPending}
              />
              <Text style={styles.muted}>Phone number</Text>
              <TextInput
                accessibilityLabel="Phone number"
                style={styles.input}
                keyboardType="phone-pad"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                editable={!update.isPending}
              />
              {profile.isFetching && <Text style={styles.muted}>Refreshing profile information…</Text>}
              {update.isError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  Your phone number could not be saved. Try again.
                </Text>
              )}
              <View style={styles.actions}>
                <Action
                  label={update.isPending ? 'Saving…' : 'Save phone'}
                  primary
                  disabled={blocked}
                  onPress={() => updateProfile({ phoneCountryCode: phoneCode, phoneNumber }, () => setEditing(false))}
                />
                <Action label="Cancel" disabled={update.isPending} onPress={() => setEditing(false)} />
              </View>
            </View>
          </Section>
        )}
        {userProfile && !profile.isError && (
          <Section title="Account status">
            <Rows>
              <Row label="Identity check">{verification.label}</Row>
              <Row label="Member since">{formatDate(userProfile.dateJoined, 'Not available')}</Row>
              <Row label="Last login">{formatDateTime(userProfile.lastLogin)}</Row>
            </Rows>
            <Action
              label="Review identity check"
              disabled={profile.isFetching}
              onPress={() => setVerificationOpen(true)}
            />
          </Section>
        )}
      </Page>
      <VerificationModal
        visible={verificationOpen}
        onClose={() => setVerificationOpen(false)}
        onRefresh={() => void profile.refetch()}
      />
    </>
  );
}

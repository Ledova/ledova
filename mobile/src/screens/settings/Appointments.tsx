import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  appointmentDates,
  appointmentStatus,
  formatDate,
  scopeFacts,
  scopeLabels,
  useCompanyTeam,
  useSubmissionOwner,
  type CompanyTeamAppointment,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Action, Actions, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { useMemberRecordsState, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useRole } from '../../hooks/useRole';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';

export function useTeamStyles() {
  return useThemedStyles((theme) => {
    const text = { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20 };
    return {
      stack: { gap: theme.spacing.md },
      hidden: { display: 'none' as const },
      row: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md },
      line: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: theme.spacing.md },
      fill: { flex: 1, minWidth: 0 },
      title: { ...text, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      muted: { ...text, color: theme.colors.text.muted },
      status: {
        ...text,
        flexShrink: 0,
        maxWidth: '45%' as const,
        textAlign: 'right' as const,
        color: theme.colors.text.muted,
      },
      small: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
      footer: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        alignItems: 'center' as const,
        columnGap: theme.spacing.md,
      },
      end: { marginLeft: 'auto' as const },
      toggle: {
        paddingVertical: 6,
        fontFamily: theme.fontFamily.medium,
        fontSize: 14,
        color: theme.colors.brand.light,
      },
    };
  });
}

export function AppointmentRecord({
  appointment,
  companyName,
  disabled,
  onRevoke,
  teamRecord = false,
}: {
  appointment: OwnCompanyAppointment | CompanyTeamAppointment;
  companyName: string;
  disabled: boolean;
  onRevoke: () => void;
  teamRecord?: boolean;
}) {
  const look = useTeamStyles();
  const [declarationShown, setDeclarationShown] = useState(false);
  const person = teamRecord && 'email' in appointment ? appointment : null;
  const title = person ? person.name || person.email : companyName;
  const declaration =
    !teamRecord && appointment.source !== 'legacy_owner' && 'declarationText' in appointment
      ? appointment.declarationText
      : '';
  const scope = scopeLabels(appointment.capabilities);
  const revocable = appointment.status !== 'revoked';
  return (
    <View style={look.row}>
      <View style={look.line}>
        <Text style={[look.title, look.fill]}>{title}</Text>
        <Text style={look.status}>{appointmentStatus(appointment)}</Text>
      </View>
      <Text style={look.small}>
        {[person?.name && person.email, scopeFacts(appointment.capabilities, appointment.delegatableCapabilities)]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Text style={look.small}>{appointmentDates(appointment)}</Text>
      {(!!declaration || revocable) && (
        <View style={look.footer}>
          {!!declaration && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${declarationShown ? 'Hide' : 'Show'} the declaration for ${title}`}
              accessibilityState={{ expanded: declarationShown }}
              onPress={() => setDeclarationShown((shown) => !shown)}
            >
              <Text style={look.toggle}>{declarationShown ? 'Hide the declaration' : 'Show the declaration'}</Text>
            </Pressable>
          )}
          {revocable && (
            <View style={look.end}>
              <Action
                compact
                label="Revoke appointment"
                accessibilityLabel={`Revoke appointment (${title} · ${scope} · appointed ${formatDate(appointment.createdAt)})`}
                disabled={disabled}
                onPress={onRevoke}
              />
            </View>
          )}
        </View>
      )}
      {!!declaration && declarationShown && <Text style={look.muted}>{declaration}</Text>}
    </View>
  );
}

export function RevokeAppointmentModal({ team }: { team: ReturnType<typeof useCompanyTeam> }) {
  const styles = useCompanyStyles();
  const { confirmation, revoking, close, disabled, canRevoke, ticket, revoke } = team;
  return (
    <CustomModal
      visible={!!confirmation}
      title="Revoke appointment permanently?"
      busy={revoking}
      onClose={close}
      actions={
        <Action
          label={revoking ? 'Revoking…' : 'Permanently revoke appointment'}
          primary
          disabled={!confirmation || disabled || !canRevoke(confirmation.appointment)}
          onPress={() => {
            if (
              !confirmation ||
              ticket.current !== confirmation.ticket ||
              disabled ||
              !canRevoke(confirmation.appointment)
            )
              return;
            void revoke(confirmation.appointment).finally(close);
          }}
        />
      }
    >
      {confirmation && (
        <Text style={styles.text}>
          Permanently remove{' '}
          {'name' in confirmation.appointment
            ? `${confirmation.appointment.name || confirmation.appointment.email}'s appointment`
            : 'your appointment'}{' '}
          for {confirmation.companyName}? This appointment loses its company authority. Its history remains retained.
          {confirmation.appointment.source !== 'invitation' &&
            ' Another initial self-declaration cannot restore it; revoking an initial or legacy-owner appointment does not reopen admission.'}
        </Text>
      )}
    </CustomModal>
  );
}

export function YourAppointments() {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  return owner ? (
    <OwnAppointments
      key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}`}
      owner={owner}
      currentOwner={boundary.get}
    />
  ) : null;
}

function OwnAppointments({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const { companies, company: selected } = useMemberRecordsState();
  const { isCompany } = useRole();
  const team = useCompanyTeam({
    owner,
    currentOwner,
    company: selected?.uuid ?? '',
    companyName: selected?.name,
    ownOnly: true,
    session: orderSubmissionSession,
  });
  const { own, appointments, disabled, confirm, error } = team;
  return (
    <>
      <Section title="Your appointments">
        {own.isError ? (
          <LoadError retry={() => own.refetch()} busy={own.isFetching}>
            Your appointments could not be loaded.
          </LoadError>
        ) : own.isPending || own.isFetching ? (
          <Loading>Loading your appointments…</Loading>
        ) : appointments.length === 0 ? (
          <Text style={styles.muted}>No company appointments yet.</Text>
        ) : (
          <Rows>
            {appointments.map((item) => (
              <AppointmentRecord
                key={item.uuid}
                appointment={item}
                companyName={item.companyName}
                disabled={disabled}
                onRevoke={() => confirm(item, item.companyName)}
              />
            ))}
          </Rows>
        )}
        {isCompany && companies.some((row) => row.isOwner) && (
          <Actions>
            <Action compact label="Representative authority" onPress={() => navigation.navigate('Authority')} />
          </Actions>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </Section>
      <RevokeAppointmentModal team={team} />
    </>
  );
}

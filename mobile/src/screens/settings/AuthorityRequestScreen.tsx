import { useRef, useState, type ReactNode } from 'react';
import { Linking, RefreshControl, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import * as Sharing from 'expo-sharing';
import {
  APPOINTMENT_STATUS_LABELS,
  AUTHORITY_REQUEST_TONES,
  COMPANY_SIGNUP_DECLARATION,
  COMPANY_SIGNUP_DECLARATION_VERSION,
  authorityRequestStatus,
  failureSentence,
  formatDateTime,
  requestScopeLabels,
  useAuthorityRequests,
  useErrorSummary,
  useSubmissionOwner,
  type CompanyAuthorityRequest,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import {
  Action,
  Fact,
  FormActions,
  LoadError,
  Loading,
  Rows,
  Section,
  ShowMore,
  Status,
} from '../../components/Ledger';
import { AccountCheck } from '../../components/AccountCheck';
import { CustomModal } from '../../components/modal';
import { Page } from '../../components/Page';
import { Checkbox } from '../../components/Field';
import { PUBLIC_LINKS } from '../../config/publicLinks';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { shareDocumentCopy, shareFile } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { getSessionEpoch } from '../../services/sessionScope';

const TITLE = 'Authority request';

async function shareEvidence(data: ArrayBuffer, request: CompanyAuthorityRequest) {
  const sessionEpoch = getSessionEpoch();
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await shareDocumentCopy(
    sessionEpoch,
    async () => ({ name: request.originalFilename, type: request.mimeType, bytes: new Uint8Array(data) }),
    (uri, type) => shareFile(uri, { mimeType: type }),
  );
}

export function AuthorityRequestScreen({ route }: { route: RouteProp<SignedInStackParamList, 'AuthorityRequest'> }) {
  const { uuid } = route.params;
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  if (!owner)
    return (
      <Page testID="authority-request-scroll" title={TITLE}>
        <AccountCheck />
      </Page>
    );
  return (
    <OwnAuthorityRequest
      key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${uuid}`}
      owner={owner}
      currentOwner={boundary.get}
      uuid={uuid}
    />
  );
}

function OwnAuthorityRequest({
  owner,
  currentOwner,
  uuid,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  uuid: string;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const { history, lifecycle, opening } = useAuthorityRequests({
    owner,
    currentOwner,
    readCompanies: false,
    session: orderSubmissionSession,
    save: shareEvidence,
  });
  const [refreshing, setRefreshing] = useState(false);
  const request = history.data?.find((item) => item.uuid === uuid);
  let content: ReactNode;
  if (history.isError)
    content = (
      <LoadError retry={() => history.refetch()} busy={history.isFetching}>
        Your authority requests could not be loaded.
      </LoadError>
    );
  else if (!history.data || (!request && history.isFetching)) content = <Loading>Loading your request…</Loading>;
  else if (!request) content = <Text style={styles.muted}>This authority request is not one of yours.</Text>;
  else
    content = (
      <>
        <AuthorityRequestRecord
          request={request}
          blocked={lifecycle.isPending || history.isFetching}
          opening={opening.isPending}
          action={lifecycle.isPending ? lifecycle.variables?.action : undefined}
          onDownload={() => opening.mutate(request)}
          onWithdraw={() => lifecycle.mutateAsync({ request, action: 'withdraw' })}
          onAdmit={() => lifecycle.mutate({ request, action: 'admit' })}
          onRevoke={() => lifecycle.mutateAsync({ request, action: 'revoke' })}
        />
        {opening.isError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {failureSentence(opening.error, 'Your evidence could not be downloaded.')}
          </Text>
        )}
        {lifecycle.isError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {failureSentence(lifecycle.error, 'Your request outcome could not be confirmed. Refresh or retry.')}
          </Text>
        )}
      </>
    );
  const shown = request && !history.isError ? request : undefined;
  return (
    <Page
      testID="authority-request-scroll"
      title={shown ? shown.companyIdentityRaw.name : TITLE}
      lede={shown ? `Authority request · ACN ${shown.companyIdentityRaw.acn}` : undefined}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || lifecycle.isPending) return;
            setRefreshing(true);
            void history.refetch().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {content}
    </Page>
  );
}

function AuthorityRequestRecord({
  request,
  blocked,
  opening,
  action,
  onDownload,
  onWithdraw,
  onAdmit,
  onRevoke,
}: {
  request: CompanyAuthorityRequest;
  blocked: boolean;
  opening: boolean;
  action?: 'withdraw' | 'admit' | 'revoke';
  onDownload: () => void;
  onWithdraw: () => Promise<unknown>;
  onAdmit: () => void;
  onRevoke: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    group: { gap: theme.spacing.sm },
    link: {
      alignSelf: 'flex-start' as const,
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.brand.light,
      textDecorationLine: 'underline' as const,
    },
  }));
  const [accepted, setAccepted] = useState(false);
  const acceptance = useErrorSummary({ accepted: !accepted && 'Accept the authority declaration and Terms.' });
  const acceptanceError = acceptance.field('accepted').error;
  const [confirmingWithdrawal, setConfirmingWithdrawal] = useState(false);
  const [confirmingRevocation, setConfirmingRevocation] = useState<symbol | null>(null);
  const revocationConfirmation = useRef<symbol | null>(null);
  const appointment = request.appointment;
  const name = request.companyIdentityRaw.name;
  const closeRevocationConfirmation = () => {
    revocationConfirmation.current = null;
    setConfirmingRevocation(null);
  };
  return (
    <>
      <Section title="Request">
        <Rows>
          <Fact inline label="Status">
            <Status tone={AUTHORITY_REQUEST_TONES.get(request.status) ?? 'closed'}>
              {authorityRequestStatus(request)}
            </Status>
          </Fact>
          <Fact inline label="Requested expiry">
            {request.requestedExpiresAt ? formatDateTime(request.requestedExpiresAt) : 'No requested expiry'}
          </Fact>
          <Fact inline label="Requested actions">
            {requestScopeLabels(request.requestedCapabilities)}
          </Fact>
          <Fact inline label="Requested delegation">
            {requestScopeLabels(request.delegatableCapabilities)}
          </Fact>
          <Fact inline label="Submitted">
            {formatDateTime(request.createdAt)}
          </Fact>
          {request.withdrawnAt && (
            <Fact inline label="Withdrawn">
              {formatDateTime(request.withdrawnAt)}
            </Fact>
          )}
        </Rows>
        <Text style={styles.muted}>{request.verificationMessage}</Text>
        {request.status === 'pending' && (
          <>
            {request.requestedCapabilities.includes('admin') ? (
              <View style={look.group}>
                <Text style={styles.text}>{COMPANY_SIGNUP_DECLARATION}</Text>
                <Text style={styles.muted}>
                  Declaration version {COMPANY_SIGNUP_DECLARATION_VERSION}. Your appointment uses the exact permissions,
                  delegation and expiry of this request. It does not activate the company or approve any register
                  action.
                </Text>
                <Text
                  accessibilityRole="link"
                  style={look.link}
                  onPress={() => void Linking.openURL(PUBLIC_LINKS.termsOfService).catch(() => undefined)}
                >
                  Terms of Service
                </Text>
                <Checkbox
                  label={`Accept authority declaration and Terms for ${name}`}
                  checked={accepted}
                  disabled={blocked}
                  error={acceptanceError}
                  onChange={setAccepted}
                />
                {!!acceptanceError && <Text style={styles.error}>{acceptanceError}</Text>}
              </View>
            ) : (
              <Text style={styles.muted}>
                Initial admission requires Manage company information and team in your own requested actions. Submit a
                new request with that permission to establish your appointment.
              </Text>
            )}
            <Text style={styles.muted}>Withdrawing retires this request and retains its evidence.</Text>
            <CustomModal
              visible={confirmingWithdrawal}
              title="Withdraw this authority request?"
              busy={action === 'withdraw'}
              onClose={() => setConfirmingWithdrawal(false)}
              actions={
                <Action
                  label={action === 'withdraw' ? 'Withdrawing…' : 'Withdraw request'}
                  primary
                  disabled={blocked}
                  onPress={() =>
                    void onWithdraw()
                      .catch(() => undefined)
                      .finally(() => setConfirmingWithdrawal(false))
                  }
                />
              }
            >
              <Text style={styles.text}>
                Your request for {name} is retired and can&apos;t be admitted. Its evidence is retained.
              </Text>
            </CustomModal>
          </>
        )}
      </Section>
      {appointment && (
        <Section title="Appointment">
          <Rows>
            <Fact inline label="Appointment status">
              {APPOINTMENT_STATUS_LABELS[appointment.status]}
            </Fact>
            <Fact inline label="Current company authority">
              {appointment.isEffective ? 'Current' : 'Not current'}
            </Fact>
            <Fact inline label="Admitted">
              {formatDateTime(appointment.createdAt)}
            </Fact>
            <Fact inline label="Appointed actions">
              {requestScopeLabels(appointment.capabilities)}
            </Fact>
            <Fact inline label="Appointed delegation">
              {requestScopeLabels(appointment.delegatableCapabilities)}
            </Fact>
            <Fact inline label="Appointment expiry">
              {appointment.expiresAt ? formatDateTime(appointment.expiresAt) : 'No expiry'}
            </Fact>
            {appointment.revokedAt && (
              <Fact inline label="Revoked">
                {formatDateTime(appointment.revokedAt)}
              </Fact>
            )}
          </Rows>
          <ShowMore show="Show the declaration" hide="Hide the declaration">
            <Text style={styles.muted}>Declaration version {appointment.declarationVersion}</Text>
            <Text style={styles.text}>{appointment.declarationText}</Text>
            <Text style={styles.muted}>
              This is your recorded self-declaration. Company information is provided by the company. An appointment
              does not activate the company or approve any register action.
            </Text>
          </ShowMore>
          <Text style={styles.muted}>
            Revocation permanently removes this appointment&apos;s company authority. You cannot restore it by making
            another initial self-declaration. Its declaration and evidence remain retained.
          </Text>
          <CustomModal
            visible={!!confirmingRevocation}
            title="Revoke appointment permanently?"
            busy={action === 'revoke'}
            onClose={closeRevocationConfirmation}
            actions={
              <Action
                label={action === 'revoke' ? 'Revoking…' : 'Permanently revoke appointment'}
                primary
                disabled={!confirmingRevocation || blocked || appointment.status === 'revoked'}
                onPress={() => {
                  if (
                    !confirmingRevocation ||
                    revocationConfirmation.current !== confirmingRevocation ||
                    blocked ||
                    appointment.status === 'revoked'
                  )
                    return;
                  void onRevoke()
                    .catch(() => undefined)
                    .finally(closeRevocationConfirmation);
                }}
              />
            }
          >
            <Text style={styles.text}>
              Permanently remove your appointment for {name}? You will lose this appointment&apos;s company authority
              and cannot restore it by making another initial self-declaration. Its declaration and evidence remain
              retained.
            </Text>
          </CustomModal>
        </Section>
      )}
      {(request.fileUrl || request.status === 'pending' || (appointment && appointment.status !== 'revoked')) && (
        <FormActions>
          {request.fileUrl && (
            <Action
              label={opening ? 'Downloading…' : 'Download evidence'}
              accessibilityLabel={`Download evidence (${request.originalFilename || name})`}
              disabled={opening || blocked}
              onPress={onDownload}
            />
          )}
          {request.status === 'pending' && (
            <>
              <Action
                label="Withdraw request"
                accessibilityLabel={`Withdraw request (${name})`}
                disabled={blocked}
                onPress={() => setConfirmingWithdrawal(true)}
              />
              {request.requestedCapabilities.includes('admin') && (
                <Action
                  label={action === 'admit' ? 'Establishing appointment…' : 'Establish appointment'}
                  accessibilityLabel={`Establish appointment (${name})`}
                  primary
                  disabled={blocked}
                  onPress={() => {
                    if (acceptance.check()) onAdmit();
                  }}
                />
              )}
            </>
          )}
          {appointment && appointment.status !== 'revoked' && (
            <Action
              label="Revoke appointment"
              accessibilityLabel={`Revoke appointment (${name})`}
              disabled={blocked}
              onPress={() => {
                if (blocked || revocationConfirmation.current) return;
                const confirmation = Symbol();
                revocationConfirmation.current = confirmation;
                setConfirmingRevocation(confirmation);
              }}
            />
          )}
        </FormActions>
      )}
    </>
  );
}

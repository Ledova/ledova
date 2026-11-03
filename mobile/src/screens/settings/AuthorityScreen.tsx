import { useEffect, useRef, useState } from 'react';
import { Keyboard, RefreshControl, Text, View, type ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  AUTHORITY_REQUEST_TONES,
  authorityRequestStatus,
  formatDate,
  useAuthorityRequests,
  useSubmissionOwner,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import {
  Action,
  Actions,
  FormActions,
  LinkRow,
  LoadError,
  Loading,
  Outcome,
  Rows,
  Section,
  Status,
} from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useAppTheme, useMemberRecordsState, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { AccountCheck } from './AccountCheck';
import { AuthorityRequestForm } from './AuthorityRequestForm';
import { CompanyContextNotice } from './CompanyContextNotice';

const TITLE = 'Representative authority';

export function AuthorityScreen() {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  if (!owner)
    return (
      <Page testID="authority-scroll" title={TITLE}>
        <AccountCheck />
      </Page>
    );
  return (
    <OwnAuthorityRequests
      key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}`}
      owner={owner}
      currentOwner={boundary.get}
    />
  );
}

function OwnAuthorityRequests({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    hidden: { display: 'none' as const },
    detail: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
  }));
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const { company: selected, directory } = useMemberRecordsState();
  const { guard, recorded, setRecorded, companies, history, company } = useAuthorityRequests({
    owner,
    currentOwner,
    company: selected?.uuid ?? '',
    session: orderSubmissionSession,
  });
  const [preparing, setPreparing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    if (preparing) scroll.current?.scrollTo({ y: 0, animated: false });
  }, [preparing]);
  const close = () => {
    Keyboard.dismiss();
    setPreparing(false);
  };
  const requests = history.data ?? [];
  return (
    <Page
      ref={scroll}
      testID="authority-scroll"
      title={TITLE}
      lede="Manage your own company appointment and its authorisation declaration."
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || preparing) return;
            setRefreshing(true);
            void Promise.all([history.refetch(), companies.refetch()]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {!!recorded && <Outcome>{`Request recorded. ${recorded.verificationMessage}`}</Outcome>}
      <View style={preparing && look.hidden}>
        <Section title="Authority requests">
          {history.isLoading ? (
            <Loading>Loading your requests…</Loading>
          ) : history.isError ? (
            <LoadError retry={() => history.refetch()} busy={history.isFetching}>
              Your authority requests could not be loaded.
            </LoadError>
          ) : requests.length === 0 ? (
            <Text style={styles.muted}>No authority requests yet.</Text>
          ) : (
            <Rows>
              {requests.map((request) => {
                const status = authorityRequestStatus(request);
                const name = request.companyIdentityRaw.name;
                return (
                  <LinkRow
                    key={request.uuid}
                    label={name}
                    accessibilityLabel={`${name} (authority request submitted ${formatDate(request.createdAt)}, ${status.toLowerCase()})`}
                    aside={<Status tone={AUTHORITY_REQUEST_TONES.get(request.status) ?? 'closed'}>{status}</Status>}
                    onPress={() => navigation.navigate('AuthorityRequest', { uuid: request.uuid })}
                  >
                    <Text style={look.detail}>
                      ACN {request.companyIdentityRaw.acn} · submitted {formatDate(request.createdAt)}
                    </Text>
                  </LinkRow>
                );
              })}
            </Rows>
          )}
        </Section>
      </View>
      <View style={!preparing && look.hidden}>
        <Section title="New authority request">
          {companies.isLoading || directory.isLoading ? (
            <Loading>Loading your companies…</Loading>
          ) : companies.isError ? (
            <LoadError retry={() => companies.refetch()} busy={companies.isFetching}>
              Your companies could not be loaded.
            </LoadError>
          ) : !company ? (
            <CompanyContextNotice />
          ) : null}
          {!recorded && company && (
            <AuthorityRequestForm
              key={company.uuid}
              company={company}
              disabled={companies.isFetching || !preparing}
              guard={guard}
              onCancel={close}
              onSuccess={(request) => {
                guard();
                setRecorded(request);
                close();
                void history.refetch();
              }}
            />
          )}
          {!company && (
            <FormActions>
              <Action label="Cancel" onPress={close} />
            </FormActions>
          )}
        </Section>
      </View>
      {!preparing && (
        <Actions>
          <Action
            label="Request authority"
            primary
            onPress={() => {
              setRecorded(null);
              setPreparing(true);
            }}
          />
        </Actions>
      )}
    </Page>
  );
}

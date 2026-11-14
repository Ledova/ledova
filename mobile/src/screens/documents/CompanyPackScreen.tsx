import { useMemo, useState } from 'react';
import { Keyboard, RefreshControl, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  FIELD_LIMITS,
  companyPacksKey,
  useCompanyPack,
  useCompanyPackAuthority,
  useErrorSummary,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { Action, Actions, FormActions, LoadError, Loading, Outcome, Section, ShowMore } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { RegisterAccess } from '../../components/RegisterAccess';
import { useRetainedScope } from '../../hooks/useRetainedScope';
import { Field } from '../../components/Field';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { CompanyPackHistory } from './OutputHistory';

const TITLE = 'Company pack';
const LEDE = 'Prepare a package of the company’s records.';

export function CompanyPackScreen() {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const { directory, companies, company, companySelection } = useMemberRecordsState();
  const preferences = useUserPreferences();
  const choosing = directory.isLoading || (!company && companies.length > 0);
  const scope = useRetainedScope(
    owner,
    boundary.get,
    company?.uuid,
    !preferences.isError &&
      !preferences.isFetching &&
      !!company?.canReadRegister &&
      !directory.hasError &&
      !choosing &&
      !directory.isRefreshing,
    companySelection,
  );
  if (owner && scope.scope)
    return (
      <OwnCompanyPack
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${scope.scope}`}
        owner={owner}
        currentOwner={boundary.get}
        company={scope.scope}
        sourceReady={scope.available}
      />
    );
  return (
    <Page testID="company-pack-scroll" title={TITLE} lede={LEDE}>
      {!owner ? (
        <AccountCheck />
      ) : directory.hasError ? (
        <LoadError retry={directory.retry} busy={directory.isRefreshing}>
          Your company access could not be confirmed.
        </LoadError>
      ) : choosing ? (
        <Loading>Loading the register…</Loading>
      ) : (
        <CompanyContextNotice />
      )}
    </Page>
  );
}

function OwnCompanyPack({
  owner,
  currentOwner,
  company,
  sourceReady,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  sourceReady: boolean;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const guard = useMemo(
    () => () => {
      if (currentOwner() !== owner) throw new Error('Your signed-in account changed. Reopen the register.');
    },
    [owner, currentOwner],
  );
  const { appointments, appointment, check } = useCompanyPackAuthority({
    owner,
    guard,
    company,
    session: orderSubmissionSession,
    available: sourceReady,
  });
  const formReady = sourceReady && !!appointment;
  const retained = {
    style: [{ gap: theme.spacing.md }, !formReady && { display: 'none' as const }],
    accessibilityElementsHidden: !formReady,
    importantForAccessibility: formReady ? ('auto' as const) : ('no-hide-descendants' as const),
  };
  return (
    <Page
      testID="company-pack-scroll"
      title={TITLE}
      lede={LEDE}
      available={sourceReady}
      unavailable={<RegisterAccess owner={owner} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (!sourceReady || refreshing || open) return;
            setRefreshing(true);
            void Promise.all([
              appointments.refetch(),
              client.refetchQueries({ queryKey: companyPacksKey(owner, company), exact: true }),
            ]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Section title="Prepared packs">
        {appointments.isError ? (
          <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
            Your appointments could not be loaded.
          </LoadError>
        ) : appointments.isSuccess && !appointments.isFetching && !appointment ? (
          <Text style={styles.muted}>A current administrator appointment for this company is required.</Text>
        ) : !appointment ? (
          <Loading>Loading your appointments…</Loading>
        ) : null}
        <View {...retained}>
          <CompanyPackHistory owner={owner} company={company} guard={check} enabled={formReady} />
        </View>
      </Section>
      <View {...retained}>
        <PackForm
          key={company}
          company={company}
          appointment={appointment?.uuid ?? ''}
          guard={check}
          sourceReady={formReady}
          open={open}
          onOpenChange={setOpen}
          onPrepared={() => void client.invalidateQueries({ queryKey: companyPacksKey(owner, company) })}
        />
      </View>
    </Page>
  );
}

function PackForm({
  company,
  appointment,
  guard,
  sourceReady,
  open,
  onOpenChange,
  onPrepared,
}: {
  company: string;
  appointment: string;
  guard: () => void;
  sourceReady: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrepared: () => void;
}) {
  const styles = useCompanyStyles();
  const { instruction, setInstruction, recipient, setRecipient, busy, error, downloaded, problems, download } =
    useCompanyPack({
      company,
      appointment,
      guard,
      sourceReady,
      onDownloaded: onPrepared,
      files: SHARE_SHEET_FILES,
      session: orderSubmissionSession,
    });
  const checks = useErrorSummary(problems);
  if (!open)
    return (
      <Actions>
        <Action
          primary
          label="Prepare company pack"
          disabled={busy || !sourceReady}
          onPress={() => onOpenChange(true)}
        />
      </Actions>
    );
  return (
    <Section title="New company pack">
      <Text style={styles.muted}>
        This company ZIP includes residential addresses and private records. Current company administration, a written
        instruction and a named recipient are required; the captured records and generation time are retained.
      </Text>
      <ShowMore show="Show included records and limitations" hide="Hide included records and limitations">
        <Text style={styles.muted}>
          Packs include non-tokenised registers, employee awards and fully paid external allotments. Unsupported records
          make the whole archive unavailable; use supported inspection copies or unsigned certificates instead.
        </Text>
      </ShowMore>
      <Field
        label="Pack instruction reference"
        value={instruction}
        maxLength={FIELD_LIMITS.REFERENCE}
        editable={!busy && sourceReady}
        error={checks.field('instruction').error}
        onChange={setInstruction}
      />
      <Field
        label="Pack recipient"
        value={recipient}
        maxLength={FIELD_LIMITS.NAME}
        editable={!busy && sourceReady}
        error={checks.field('recipient').error}
        onChange={setRecipient}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {downloaded && <Outcome>The company pack was downloaded.</Outcome>}
      <FormActions>
        <Action
          label="Cancel"
          accessibilityLabel="Cancel (company pack)"
          disabled={busy}
          onPress={() => {
            Keyboard.dismiss();
            onOpenChange(false);
          }}
        />
        <Action
          primary
          label={busy ? 'Preparing company pack…' : 'Prepare and download company pack'}
          disabled={busy || !sourceReady}
          onPress={() => {
            if (!checks.check()) return;
            Keyboard.dismiss();
            void download();
          }}
        />
      </FormActions>
    </Section>
  );
}

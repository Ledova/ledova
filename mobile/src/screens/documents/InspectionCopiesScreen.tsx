import { useEffect, useState } from 'react';
import { Keyboard, RefreshControl, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  FIELD_LIMITS,
  formatDate,
  inspectionCopiesKey,
  useClassInspectionCopy,
  useClassRegister,
  useErrorSummary,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, Fact, FormActions, LoadError, Loading, Outcome, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { RegisterAccess } from '../../components/RegisterAccess';
import { useRetainedScope } from '../../hooks/useRetainedScope';
import { Field } from '../../components/register/RegisterFields';
import { SelectField } from '../../components/SelectField';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { InspectionCopyHistory } from './OutputHistory';
import { useDocumentStyles } from './useDocumentStyles';

const TITLE = 'Inspection copies';
const LEDE = 'Prepare a copy of the register for someone who requests one.';

export function InspectionCopiesScreen() {
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
      <CompanyInspectionCopies
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${scope.scope}`}
        owner={owner}
        currentOwner={boundary.get}
        company={scope.scope}
        available={scope.available}
      />
    );
  return (
    <Page testID="inspection-copies-scroll" title={TITLE} lede={LEDE}>
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

function CompanyInspectionCopies({
  owner,
  currentOwner,
  company,
  available,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  available: boolean;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const source = useClassRegister(
    owner,
    currentOwner,
    company,
    chosen,
    'inspection',
    orderSubmissionSession,
    available,
  );
  if (!open && chosen && source.sourceReady && !source.options.some((item) => item.uuid === chosen)) setChosen(null);
  const [retained, setRetained] = useState<TokenHoldersResponse | undefined>();
  if (source.ready && source.register.data !== retained) setRetained(source.register.data);
  const register = source.ready ? source.register.data : retained?.token.uuid === source.token ? retained : undefined;
  const retry = () => source.retry().catch(() => undefined);
  return (
    <Page
      testID="inspection-copies-scroll"
      title={TITLE}
      lede={LEDE}
      available={available}
      unavailable={<RegisterAccess owner={owner} />}
      titleAction={
        available && source.sourceReady && source.options.length > 1 ? (
          <FilterPopover>
            {(close) => (
              <SelectField
                label="Share class"
                options={source.options.map((item) => ({ value: item.uuid, label: `${item.name} · ${item.symbol}` }))}
                value={source.token}
                disabled={open}
                onChange={(token) => {
                  if (open) return;
                  close();
                  setChosen(token);
                }}
              />
            )}
          </FilterPopover>
        ) : undefined
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (!available || refreshing || open) return;
            setRefreshing(true);
            void retry().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {source.hasError ? (
        <LoadError retry={retry} busy={source.isRefreshing}>
          The register could not be loaded.
        </LoadError>
      ) : !source.sourceReady || (!register && source.options.length > 0) ? (
        <Loading>Loading the register…</Loading>
      ) : null}
      {open && !source.ready && (
        <View>
          <Text style={styles.muted}>Current share-class access must be confirmed before continuing.</Text>
          <FormActions>
            <Action
              label="Cancel"
              accessibilityLabel="Cancel (inspection copy)"
              disabled={formBusy}
              onPress={() => setOpen(false)}
            />
          </FormActions>
        </View>
      )}
      {register && (
        <View
          style={[{ gap: theme.spacing.md }, !source.ready && { display: 'none' }]}
          accessibilityElementsHidden={!source.ready}
          importantForAccessibility={source.ready ? 'auto' : 'no-hide-descendants'}
        >
          <Text style={styles.muted}>
            {register.token.name} · {register.token.symbol}
          </Text>
          <Section title="Inspection copy">
            <ClassInspectionCopy
              key={register.token.uuid}
              owner={owner}
              register={register}
              guard={source.guard}
              sourceReady={source.ready}
              open={open}
              onBusyChange={setFormBusy}
              onOpenChange={setOpen}
            />
          </Section>
        </View>
      )}
    </Page>
  );
}

function ClassInspectionCopy({
  owner,
  register,
  guard,
  sourceReady,
  open,
  onBusyChange,
  onOpenChange,
}: {
  owner: OrderSubmissionOwner;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  open: boolean;
  onBusyChange: (busy: boolean) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  return (
    <>
      <InspectionCopyHistory owner={owner} token={register.token.uuid} guard={guard} enabled={sourceReady} />
      <InspectionForm
        register={register}
        guard={guard}
        sourceReady={sourceReady}
        open={open}
        onBusyChange={onBusyChange}
        onOpenChange={onOpenChange}
        onPrepared={() => void client.invalidateQueries({ queryKey: inspectionCopiesKey(owner, register.token.uuid) })}
      />
    </>
  );
}

function InspectionForm({
  register,
  guard,
  sourceReady,
  open,
  onBusyChange,
  onOpenChange,
  onPrepared,
}: {
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  open: boolean;
  onBusyChange: (busy: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onPrepared: () => void;
}) {
  const styles = useCompanyStyles();
  const look = useDocumentStyles();
  const { draft, setDraft, target, setTarget, busy, error, downloaded, problems, blocked, preview, download } =
    useClassInspectionCopy({
      register,
      guard,
      sourceReady,
      onDownloaded: onPrepared,
      files: SHARE_SHEET_FILES,
      session: orderSubmissionSession,
    });
  useEffect(() => {
    onBusyChange(!!busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const checks = useErrorSummary(problems);
  if (!open)
    return (
      <FormActions>
        <Action label="Prepare inspection copy" disabled={blocked} onPress={() => onOpenChange(true)} />
      </FormActions>
    );
  return (
    <View style={look.form}>
      <Text accessibilityRole="header" style={look.heading}>
        New inspection copy
      </Text>
      <Text style={styles.muted}>
        Prepare an inspection CSV under your current company appointment. It includes residential addresses. The
        company&apos;s request and output provenance are retained.
      </Text>
      {target ? (
        <Rows>
          <Fact label="Share class">{register.token.name}</Fact>
          <Fact label="Instruction">{target.request.instruction}</Fact>
          <Fact label="Recipient">{target.request.recipient}</Fact>
          <Fact label="Request date">{formatDate(target.request.requestedOn)}</Fact>
        </Rows>
      ) : (
        <>
          <Field
            label="Written instruction reference"
            value={draft.instruction}
            maxLength={FIELD_LIMITS.REFERENCE}
            editable={!blocked}
            error={checks.field('instruction').error}
            onChange={(instruction) => setDraft({ ...draft, instruction })}
          />
          <Field
            label="Recipient"
            value={draft.recipient}
            maxLength={FIELD_LIMITS.NAME}
            editable={!blocked}
            error={checks.field('recipient').error}
            onChange={(recipient) => setDraft({ ...draft, recipient })}
          />
          <Field
            label="Date of request (Sydney)"
            value={draft.requestedOn}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!blocked}
            error={checks.field('requestedOn').error}
            onChange={(requestedOn) => setDraft({ ...draft, requestedOn: requestedOn.trim() })}
          />
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {downloaded && <Outcome>The inspection copy was downloaded.</Outcome>}
      <FormActions>
        <Action
          label="Cancel"
          accessibilityLabel="Cancel (inspection copy)"
          disabled={!!busy}
          onPress={() => {
            Keyboard.dismiss();
            onOpenChange(false);
          }}
        />
        {target && <Action label="Edit request" disabled={blocked} onPress={() => setTarget(null)} />}
        {target ? (
          <Action
            key="download"
            primary
            label={busy === 'download' ? 'Downloading inspection copy…' : 'Confirm and download inspection copy'}
            disabled={blocked}
            onPress={() => void download()}
          />
        ) : (
          <Action
            key="preview"
            primary
            label={busy === 'preview' ? 'Preparing preview…' : 'Preview inspection copy'}
            disabled={blocked}
            onPress={() => {
              if (!checks.check()) return;
              Keyboard.dismiss();
              void preview();
            }}
          />
        )}
      </FormActions>
    </View>
  );
}

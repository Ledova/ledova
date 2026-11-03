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
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, Fact, FormActions, LoadError, Loading, Outcome, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
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
  const { directory, companies, company } = useMemberRecordsState();
  const choosing = directory.isLoading || (!company && companies.length > 0);
  if (owner && company?.canReadRegister && !directory.hasError && !choosing)
    return (
      <CompanyInspectionCopies
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company.uuid}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company.uuid}
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
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const source = useClassRegister(owner, currentOwner, company, chosen, 'inspection', orderSubmissionSession);
  if (chosen && source.sourceReady && !source.options.some((item) => item.uuid === chosen)) setChosen(null);
  const selected = source.options.find((item) => item.uuid === source.token);
  const register = source.sourceReady ? source.register.data : undefined;
  const retry = () => source.retry().catch(() => undefined);
  return (
    <Page
      testID="inspection-copies-scroll"
      title={TITLE}
      lede={LEDE}
      titleAction={
        source.sourceReady && source.options.length > 1 ? (
          <FilterPopover>
            {(close) => (
              <SelectField
                label="Share class"
                options={source.options.map((item) => ({ value: item.uuid, label: `${item.name} · ${item.symbol}` }))}
                value={source.token}
                onChange={(token) => {
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
            if (refreshing || open) return;
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
      ) : !source.sourceReady ? (
        <Loading>Loading the register…</Loading>
      ) : source.options.length === 0 ? null : !selected || !register ? (
        <Loading>Loading the register…</Loading>
      ) : (
        <>
          <Text style={styles.muted}>
            {selected.name} · {selected.symbol}
          </Text>
          <Section title="Inspection copy">
            <ClassInspectionCopy
              owner={owner}
              register={register}
              guard={source.guard}
              sourceReady={source.ready}
              onOpenChange={setOpen}
            />
          </Section>
        </>
      )}
    </Page>
  );
}

function ClassInspectionCopy({
  owner,
  register,
  guard,
  sourceReady,
  onOpenChange,
}: {
  owner: OrderSubmissionOwner;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  return (
    <>
      <InspectionCopyHistory owner={owner} token={register.token.uuid} guard={guard} enabled={sourceReady} />
      <InspectionForm
        key={JSON.stringify([register, sourceReady])}
        register={register}
        guard={guard}
        sourceReady={sourceReady}
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
  onOpenChange,
  onPrepared,
}: {
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  onOpenChange: (open: boolean) => void;
  onPrepared: () => void;
}) {
  const styles = useCompanyStyles();
  const look = useDocumentStyles();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onOpenChange(open);
    return () => onOpenChange(false);
  }, [onOpenChange, open]);
  const { draft, setDraft, target, setTarget, busy, error, downloaded, problems, blocked, preview, download } =
    useClassInspectionCopy({
      register,
      guard,
      sourceReady,
      onDownloaded: onPrepared,
      files: SHARE_SHEET_FILES,
      session: orderSubmissionSession,
    });
  const checks = useErrorSummary(problems);
  if (!open)
    return (
      <FormActions>
        <Action label="Prepare inspection copy" disabled={blocked} onPress={() => setOpen(true)} />
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
            setOpen(false);
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

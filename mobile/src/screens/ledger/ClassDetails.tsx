import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { FIELD_LIMITS, REGISTER_CLASS_TYPES, type CompanyShareToken, type useClassDetails } from '@ledova/shared';
import { Choices, Field } from '../../components/Field';
import { Action, Fact, FormActions, Outcome, Rows, Section } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { useLedgerStyles } from './useLedgerStyles';

type Details = ReturnType<typeof useClassDetails>;
type ClassDetailsProps = { token: CompanyShareToken; details: Details; available: boolean };

function ClassDetailsEditor({ details, available }: { details: Details; available: boolean }) {
  const look = useLedgerStyles();
  const [attempted, setAttempted] = useState(false);
  const editor = details.editor!;
  const draft = editor.draft;
  const nameError = !draft.name.trim() ? 'Enter the class name.' : undefined;
  const codeError = !/^[A-Z]{1,5}$/.test(draft.symbol) ? 'Enter a class code of 1–5 letters.' : undefined;
  const unchanged =
    draft.name.trim() === editor.target.name &&
    draft.symbol === editor.target.symbol &&
    draft.tokenType === editor.target.tokenType;
  const locked = details.busy || details.pending || !available;
  return (
    <View accessibilityLabel="Edit class details" style={look.fields}>
      <Field
        label="Class name"
        value={draft.name}
        maxLength={FIELD_LIMITS.CLASS_NAME}
        editable={!locked}
        autoFocus
        error={attempted ? nameError : undefined}
        onChange={(name) => details.setEditor({ ...editor, draft: { ...draft, name } })}
      />
      <Field
        label="Class code"
        value={draft.symbol}
        maxLength={FIELD_LIMITS.CLASS_CODE}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!locked}
        error={attempted ? codeError : undefined}
        onChange={(symbol) => details.setEditor({ ...editor, draft: { ...draft, symbol: symbol.toUpperCase() } })}
      />
      <Choices
        legend="Class type"
        options={REGISTER_CLASS_TYPES}
        value={draft.tokenType}
        disabled={locked}
        onChange={(tokenType) => details.setEditor({ ...editor, draft: { ...draft, tokenType } })}
      />
      {!!details.error && (
        <Text accessibilityRole="alert" style={look.smallError}>
          {details.error}
        </Text>
      )}
      <FormActions>
        <Action label="Cancel" disabled={details.busy || details.pending} onPress={details.close} />
        <Action
          primary
          label={
            details.busy
              ? 'Saving…'
              : details.pending
                ? details.retry
                  ? 'Retry original save'
                  : 'Check original save'
                : 'Save'
          }
          disabled={!available || details.busy || (!details.pending && unchanged)}
          onPress={() => {
            setAttempted(true);
            if (details.pending) void details.recover();
            else if (!nameError && !codeError && !unchanged) void details.save();
          }}
        />
      </FormActions>
    </View>
  );
}

export function ClassDetails(props: ClassDetailsProps) {
  return (
    <Section title="Class details">
      <ClassDetailsContent {...props} />
    </Section>
  );
}

export function ClassDetailsActions({ token, details, available }: ClassDetailsProps) {
  if (details.editor || !(token.canDelete || token.deletionBlockedReason || token.canEditDetails)) return null;
  return (
    <>
      {token.canEditDetails && (
        <Action
          label="Edit"
          accessibilityLabel="Edit Class details"
          disabled={!available || details.held}
          onPress={() => details.open('edit')}
        />
      )}
      {(token.canDelete || token.deletionBlockedReason) && (
        <Action
          label="Delete"
          accessibilityLabel="Delete share class"
          disabled={!available || details.held || !token.canDelete}
          onPress={() => details.open('delete')}
        />
      )}
    </>
  );
}

export function ClassDetailsContent({
  token,
  details,
  available,
  children,
}: ClassDetailsProps & { children?: ReactNode }) {
  const look = useLedgerStyles();
  const target = details.deleting;
  const currentDelete = available && target?.updatedAt === token.updatedAt && token.canDelete;
  return (
    <>
      {details.editor ? (
        <ClassDetailsEditor details={details} available={available} />
      ) : (
        <View style={look.fields}>
          {children ? (
            <View style={look.fields}>
              <Fact label="Class name">{token.name}</Fact>
              <Fact label="Class code">{token.symbol}</Fact>
              <Fact label="Class type">{token.tokenTypeDisplay}</Fact>
            </View>
          ) : (
            <Rows>
              <Fact label="Class name" inline>
                {token.name}
              </Fact>
              <Fact label="Class code" inline>
                {token.symbol}
              </Fact>
              <Fact label="Class type" inline>
                {token.tokenTypeDisplay}
              </Fact>
            </Rows>
          )}
          {!!token.deletionBlockedReason && <Text style={look.muted}>{token.deletionBlockedReason}</Text>}
          {!children && (token.canDelete || token.deletionBlockedReason || token.canEditDetails) && (
            <FormActions>
              <ClassDetailsActions token={token} details={details} available={available} />
            </FormActions>
          )}
          {!!details.outcome && <Outcome>{details.outcome}</Outcome>}
          {!target && !!details.error && (
            <Text accessibilityRole="alert" style={look.smallError}>
              {details.error}
            </Text>
          )}
        </View>
      )}
      {children}
      <CustomModal
        visible={!!target && available}
        onClose={details.close}
        title={`Delete ${target?.name ?? 'share class'}?`}
        busy={details.busy || details.pending}
        actions={
          <Action
            label={
              details.busy
                ? 'Deleting…'
                : details.pending
                  ? details.retry
                    ? 'Retry original deletion'
                    : 'Check original deletion'
                  : 'Delete class'
            }
            disabled={!available || details.busy || (!details.pending && !currentDelete)}
            onPress={() => void (details.pending ? details.recover() : details.remove())}
          />
        }
      >
        <Text style={look.text}>
          Delete {target?.name} ({target?.symbol}) from active share classes? Abandoned setup drafts and audit history
          are kept.
        </Text>
        {!!details.error && (
          <Text accessibilityRole="alert" style={look.smallError}>
            {details.error}
          </Text>
        )}
      </CustomModal>
    </>
  );
}

import { useEffect } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  REGISTER_MEMBER_DOCUMENT_CATEGORIES,
  UPLOAD_RULE,
  useMemberDocuments,
  type DocumentDraft,
  type RegisterMemberDocumentCategory,
} from '@ledova/shared';
import { Action, Actions, FormActions, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { FileField } from '../../components/register/RegisterFields';
import { SearchSelect } from '../../components/SearchSelect';
import { SelectField } from '../../components/SelectField';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useLedgerStyles } from './useLedgerStyles';

type Props = Omit<Parameters<typeof useMemberDocuments>[0], 'member' | 'files' | 'newKey' | 'session'> & {
  onHeldChange?: (held: boolean) => void;
};

const CATEGORIES = Object.entries(REGISTER_MEMBER_DOCUMENT_CATEGORIES).map(([value, label]) => ({
  value: value as RegisterMemberDocumentCategory,
  label,
}));

export function ShareholderDocuments(props: Props) {
  return (
    <OwnShareholderDocuments
      key={`${props.owner.userUuid}/${props.owner.ownerAccountUuid}/${props.company}/${props.token ?? ''}`}
      {...props}
    />
  );
}

function OwnShareholderDocuments({ onHeldChange, ...props }: Props) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  const documents = useMemberDocuments({
    ...props,
    files: SHARE_SHEET_FILES,
    newKey: randomUUID,
    session: orderSubmissionSession,
  });
  const { editor } = documents;
  useEffect(() => {
    onHeldChange?.(!!editor || documents.busy || documents.held);
    return () => onHeldChange?.(false);
  }, [editor, documents.busy, documents.held, onHeldChange]);
  const locked = documents.busy || documents.held || !documents.ready;
  const chosen = !!editor?.documents.some((row) => row.file);
  const change = (rows: (current: DocumentDraft[]) => DocumentDraft[]) =>
    documents.setEditor((current) => current && { ...current, documents: rows(current.documents) });
  return (
    <Section title="Shareholder documents">
      {documents.appointments.isError ? (
        <LoadError retry={() => documents.appointments.refetch()} busy={documents.appointments.isFetching}>
          Your company appointments could not be loaded.
        </LoadError>
      ) : !props.sourceReady || !documents.appointments.isSuccess || documents.appointments.isFetching ? (
        <Loading>Loading document access…</Loading>
      ) : !documents.authorised ? (
        <Text style={look.muted}>Documents are private to current company register appointees.</Text>
      ) : documents.query.isError ? (
        <LoadError retry={() => documents.query.refetch()} busy={documents.query.isFetching}>
          Documents could not be loaded.
        </LoadError>
      ) : !documents.ready ? (
        <Loading>Loading documents…</Loading>
      ) : (
        <>
          {documents.query.data?.length ? (
            <Rows>
              {documents.query.data.map((document) => {
                const holding = props.holdings.find(
                  (row) => row.member === document.member && row.token === document.token,
                );
                return (
                  <View key={document.uuid} style={[look.row, look.line]}>
                    <View style={[look.fill, look.terms]}>
                      <Text style={look.title}>{document.snapshot.name}</Text>
                      <Text style={look.small}>
                        {REGISTER_MEMBER_DOCUMENT_CATEGORIES[document.category]}
                        {holding?.label ? ` · ${holding.label}` : ''}
                      </Text>
                    </View>
                    <Action
                      label="Download"
                      accessibilityLabel={`Download (${document.snapshot.name})`}
                      disabled={documents.busy}
                      onPress={() => void documents.download(document)}
                    />
                  </View>
                );
              })}
            </Rows>
          ) : (
            <Text style={look.muted}>No supporting documents attached.</Text>
          )}
          {!editor && documents.appointment && props.holdings.length > 0 && (
            <Action label="Add documents" disabled={documents.busy} onPress={documents.open} />
          )}
        </>
      )}
      {editor && (
        <View style={look.fields}>
          {props.holdings.length > 1 && (
            <SearchSelect
              label="Shareholder"
              choices={props.holdings.map((holding) => ({
                value: `${holding.member}/${holding.token}`,
                label: holding.label,
              }))}
              value={`${editor.member}/${editor.token}`}
              noun={['shareholder', 'shareholders']}
              disabled={locked || chosen}
              onChange={(value) => {
                if (chosen) return;
                const holding = props.holdings.find((row) => `${row.member}/${row.token}` === value);
                if (holding)
                  documents.setEditor(
                    (current) => current && { ...current, member: holding.member, token: holding.token },
                  );
              }}
            />
          )}
          <Actions>
            <Action
              label="Add document"
              disabled={locked}
              onPress={() => change((rows) => [...rows, { id: randomUUID(), category: 'other', file: null }])}
            />
          </Actions>
          {editor.documents.length > 0 && (
            <Rows>
              {editor.documents.map((document, index) => (
                <View key={document.id} style={[look.row, look.summary]}>
                  <SelectField
                    label="Category"
                    options={CATEGORIES}
                    value={document.category}
                    disabled={locked}
                    onChange={(category) =>
                      change((rows) => rows.map((row) => (row.id === document.id ? { ...row, category } : row)))
                    }
                  />
                  <FileField
                    label="File"
                    hint={UPLOAD_RULE.HINT}
                    disabled={locked}
                    onFile={(file) =>
                      change((rows) => rows.map((row) => (row.id === document.id ? { ...row, file } : row)))
                    }
                  />
                  <Actions>
                    <Action
                      label="Remove"
                      accessibilityLabel={`Remove (document ${index + 1})`}
                      disabled={locked}
                      onPress={() => change((rows) => rows.filter((row) => row.id !== document.id))}
                    />
                  </Actions>
                </View>
              ))}
            </Rows>
          )}
          {documents.held && (
            <Text style={look.muted}>Keep these details and recover the original save before changing documents.</Text>
          )}
          <FormActions>
            <Action
              label="Cancel"
              disabled={documents.busy || documents.held}
              onPress={() => {
                Keyboard.dismiss();
                documents.close();
              }}
            />
            <Action
              primary
              label={documents.busy ? 'Saving documents…' : documents.held ? 'Recover original save' : 'Save documents'}
              disabled={documents.busy || !documents.ready}
              onPress={() => {
                Keyboard.dismiss();
                void documents.save();
              }}
            />
          </FormActions>
        </View>
      )}
      {!!documents.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {documents.error}
        </Text>
      )}
    </Section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  getErrorMessage,
  OPTIONAL_DOCUMENTS,
  REQUIRED_DOCUMENTS,
  type CompanyDocument,
  type DocumentType,
} from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { useCompanyDocumentActions } from '../../hooks/useCompanyDocumentActions';
import { useCompanyStyles } from '../company-register/styles';
import { CompanyReadNotice, type CompanyActionRead } from './CompanyState';
import { CompanyUpload } from './CompanyUpload';
import { DocumentEntry } from './DocumentEntry';

export function CompanyDocuments({ read }: { read: CompanyActionRead }) {
  const styles = useCompanyStyles();
  const actions = useCompanyDocumentActions(read);
  const [upload, setUpload] = useState<{ type: DocumentType; label: string } | null>(null);
  const [removing, setRemoving] = useState<CompanyDocument | null>(null);
  const confirmation = useRef<CompanyDocument | null>(null);
  const pending = useRef(false);
  useEffect(
    () => () => {
      confirmation.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!read.error && !read.isRefreshing && !read.canAdmin) {
      confirmation.current = null;
      setRemoving(null);
    }
  }, [read.canAdmin, read.error, read.isRefreshing]);
  const company = read.company;
  const uuid = read.companyUuid;
  const ready = !!uuid && !!company && read.canAdmin;
  const closeRemoval = () => {
    if (pending.current) return;
    confirmation.current = null;
    setRemoving(null);
  };
  const remove = async () => {
    if (!ready || !removing || confirmation.current !== removing || pending.current) return;
    const target = removing;
    const guard = () => {
      if (confirmation.current !== target) throw new Error('This document removal is no longer open.');
    };
    pending.current = true;
    try {
      await actions.deletion.mutateAsync({ companyUuid: uuid, documentUuid: target.uuid, assertCurrent: guard });
      guard();
      confirmation.current = null;
      setRemoving(null);
    } catch {
    } finally {
      pending.current = false;
    }
  };
  return (
    <>
      {company && !read.error && !read.isRefreshing && !read.canAdmin && (
        <Text style={styles.muted}>Current company administration is required to access company documents.</Text>
      )}
      {company && !read.error && read.canAdmin && (
        <Section title="Company documents">
          <CompanyReadNotice read={read} />
          {company.documents.length === 0 && <Text style={styles.muted}>No company documents yet.</Text>}
          {company.documents.map((document) => (
            <DocumentEntry
              key={document.uuid}
              document={document}
              companyUuid={company.uuid}
              read={read}
              editable={read.canAdmin}
              removable={ready && !actions.deletion.isPending}
              onRemove={() => {
                actions.deletion.reset();
                const next = { ...document };
                confirmation.current = next;
                setRemoving(next);
              }}
            />
          ))}
          <View style={styles.choices}>
            {[...REQUIRED_DOCUMENTS, ...OPTIONAL_DOCUMENTS].map(({ type, label }) => (
              <Action
                key={type}
                label={`Upload ${label}`}
                disabled={!ready || actions.isUploading || actions.deletion.isPending}
                onPress={() => setUpload({ type, label })}
              />
            ))}
          </View>
        </Section>
      )}
      {uuid && upload && (
        <CompanyUpload
          companyUuid={uuid}
          type={upload.type}
          label={upload.label}
          canUpload={ready}
          read={read}
          upload={actions.upload}
          onClose={() => setUpload(null)}
        />
      )}
      {removing && read.canAdmin && (
        <CustomModal
          visible
          title="Remove document"
          busy={actions.deletion.isPending}
          onClose={closeRemoval}
          actions={
            <Action
              label="Confirm removal"
              disabled={!ready || actions.deletion.isPending}
              onPress={() => void remove()}
            />
          }
        >
          <View style={styles.group}>
            <Text style={styles.text}>{removing.name}</Text>
            <CompanyReadNotice read={read} />
            {actions.deletion.isError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {getErrorMessage(actions.deletion.error, 'The document could not be removed. Try again.')}
              </Text>
            )}
          </View>
        </CustomModal>
      )}
    </>
  );
}

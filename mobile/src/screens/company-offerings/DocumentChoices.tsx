import { Switch, Text, View } from 'react-native';
import { OFFER_DOCUMENT_COPY, type CompanyDocument } from '@ledova/shared';
import { useCompanyStyles } from '../company-register/styles';

export function DocumentChoices({
  documents,
  chosen,
  kept = [],
  busy,
  onChange,
}: {
  documents: CompanyDocument[];
  chosen: string[];
  kept?: string[];
  busy: boolean;
  onChange: (uuid: string, attached: boolean) => void;
}) {
  const styles = useCompanyStyles();
  return (
    <>
      {documents.map((document) => {
        const stays = kept.includes(document.uuid);
        return (
          <View key={document.uuid} style={styles.group}>
            <Text style={styles.text}>{document.name}</Text>
            <Text style={styles.muted}>
              {stays
                ? `${document.documentTypeDisplay} · ${OFFER_DOCUMENT_COPY.ATTACHED}`
                : document.documentTypeDisplay}
            </Text>
            <Switch
              accessibilityLabel={`${OFFER_DOCUMENT_COPY.ATTACH} ${document.name}`}
              value={stays || chosen.includes(document.uuid)}
              disabled={busy || stays}
              onValueChange={(value) => onChange(document.uuid, value)}
            />
          </View>
        );
      })}
    </>
  );
}

import { Text, View } from 'react-native';
import { classRightsTerms, rightsWithoutConditions, type useNewClassRights } from '@ledova/shared';
import { Action, Outcome } from '../../components/Ledger';
import { RightsEditor, RightsSummary } from './ClassRights';
import { useLedgerStyles } from './useLedgerStyles';

export function NewClassRights({
  rights,
  administrator,
  problems,
  classLocked,
  blocked,
}: {
  rights: ReturnType<typeof useNewClassRights>;
  administrator?: string;
  problems: string[];
  classLocked: boolean;
  blocked: boolean;
}) {
  const look = useLedgerStyles();
  const revision = rights.saved;
  const editor = rights.editor;
  const recorded =
    !!editor &&
    (Object.keys(editor.attributes).length > 0 ||
      !!editor.summary.trim() ||
      !!editor.effectiveDate ||
      editor.documents.some((row) => row.file || row.snapshot));
  return (
    <View style={look.fields}>
      {(editor || revision) && (
        <Text style={look.muted}>Company-recorded terms. The governing documents determine the rights.</Text>
      )}
      {!editor && !revision && <Text style={look.muted}>No rights recorded.</Text>}
      {!editor && administrator && (
        <Action
          label={revision ? 'Edit class rights' : 'Add class rights'}
          disabled={rights.busy || blocked}
          onPress={() => {
            if (blocked) return;
            rights.open({
              appointment: administrator,
              previousRevision: revision?.revision ?? 0,
              attributes: rightsWithoutConditions(revision?.attributes ?? {}),
              summary: classRightsTerms(revision?.attributes ?? {}, revision?.summary ?? ''),
              effectiveDate: revision?.effectiveDate ?? '',
              documents: (revision?.documents ?? []).map((snapshot) => ({
                id: snapshot.evidence,
                file: null,
                snapshot,
              })),
            });
          }}
        />
      )}
      {editor ? (
        <>
          {problems.map((problem) => (
            <Text key={problem} accessibilityRole="alert" style={look.smallError}>
              {problem}
            </Text>
          ))}
          <RightsEditor
            rights={{ ...rights, stale: false }}
            saveLabel="Save class rights"
            saveDisabled={problems.length > 0 || !recorded}
          />
        </>
      ) : (
        <>
          {revision && <RightsSummary revision={revision} />}
          {!!rights.outcome && <Outcome>{rights.outcome}</Outcome>}
          {!!rights.error && (
            <Text accessibilityRole="alert" style={look.smallError}>
              {rights.error}
            </Text>
          )}
        </>
      )}
      {classLocked && rights.error && (
        <Text style={look.muted}>
          The original class details are kept. Retry the original save, or close this form and continue setup.
        </Text>
      )}
    </View>
  );
}

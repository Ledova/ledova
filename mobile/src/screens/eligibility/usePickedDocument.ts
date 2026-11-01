import { useEffect, useRef, useState } from 'react';
import { uploadRefusal } from '@ledova/shared';
import { discardDocument, pickDocument, type PickedDocument } from '../../services/documentCopies';

export function usePickedDocument() {
  const [file, setFile] = useState<PickedDocument | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const kept = useRef<PickedDocument | null>(null);
  useEffect(
    () => () => {
      if (kept.current) discardDocument(kept.current.uri);
    },
    [],
  );

  const keep = (next: PickedDocument | null) => {
    if (kept.current && kept.current.uri !== next?.uri) discardDocument(kept.current.uri);
    kept.current = next;
    setFile(next);
  };

  const choose = async () => {
    if (isPicking) return;
    setIsPicking(true);
    try {
      const candidate = await pickDocument();
      if (!candidate) return;
      const problem = uploadRefusal(candidate);
      if (problem) discardDocument(candidate.uri);
      setRefusal(problem);
      keep(problem ? null : candidate);
    } catch {
      setRefusal('The file could not be opened. Choose it again.');
    } finally {
      setIsPicking(false);
    }
  };

  const remove = () => {
    setRefusal(null);
    keep(null);
  };

  return { file, refusal, isPicking, choose, remove };
}

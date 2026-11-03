import { useEffect, useRef, useState } from 'react';
import { uploadRefusal } from '@ledova/shared';
import { discardDocument, pickDocument, type PickedDocument } from '../services/documentCopies';

export function usePickedDocument(onFile: (file: PickedDocument | null) => void) {
  const [file, setFile] = useState<PickedDocument | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const kept = useRef<PickedDocument | null>(null);
  const picking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (kept.current) discardDocument(kept.current.uri);
      kept.current = null;
    };
  }, []);

  const keep = (next: PickedDocument | null) => {
    if (kept.current && kept.current.uri !== next?.uri) discardDocument(kept.current.uri);
    kept.current = next;
    setFile(next);
    onFile(next);
  };

  const choose = async () => {
    if (picking.current) return;
    picking.current = true;
    setIsPicking(true);
    try {
      const candidate = await pickDocument();
      if (!candidate) return;
      if (!mounted.current) {
        discardDocument(candidate.uri);
        return;
      }
      const problem = uploadRefusal(candidate);
      if (problem) discardDocument(candidate.uri);
      setRefusal(problem);
      keep(problem ? null : candidate);
    } catch {
      if (mounted.current) setRefusal('The file could not be opened. Choose it again.');
    } finally {
      picking.current = false;
      if (mounted.current) setIsPicking(false);
    }
  };

  return { file, refusal, isPicking, choose };
}

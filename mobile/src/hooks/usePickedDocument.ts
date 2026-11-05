import { useEffect, useRef, useState } from 'react';
import { uploadRefusal, type UploadFile } from '@ledova/shared';
import { discardDocument, pickDocument, type PickedDocument } from '../services/documentCopies';

export function usePickedDocument(value: UploadFile | null | undefined, onFile: (file: PickedDocument | null) => void) {
  const file = value && 'uri' in value ? value : null;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const picking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const choose = async () => {
    if (picking.current) return;
    picking.current = true;
    setIsPicking(true);
    try {
      const candidate = await pickDocument();
      if (!candidate) return;
      if (!mounted.current) {
        if (candidate.uri !== file?.uri) discardDocument(candidate.uri);
        return;
      }
      const problem = uploadRefusal(candidate);
      if (problem) discardDocument(candidate.uri);
      setRefusal(problem);
      const next = problem ? null : candidate;
      if (file && file.uri !== next?.uri) discardDocument(file.uri);
      onFile(next);
    } catch {
      if (mounted.current) setRefusal('The file could not be opened. Choose it again.');
    } finally {
      picking.current = false;
      if (mounted.current) setIsPicking(false);
    }
  };

  return { file, refusal, isPicking, choose };
}

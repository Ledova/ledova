import { Directory, File, Paths } from 'expo-file-system';
import { assertSessionEpoch, subscribeSession } from './sessionScope';

let viewing: number | undefined;

interface DocumentView {
  name: string;
  type: string;
  bytes: Uint8Array;
}

function local(uri: string): string {
  return uri.replace(/^file:\/\/(\/private(?=\/))?/, '');
}

function inside(file: File, directory: Directory): boolean {
  return local(file.uri).startsWith(local(directory.uri).replace(/\/?$/, '/'));
}

function removeCopy(file: File): void {
  try {
    if (!inside(file, Paths.cache)) return;
    if (file.info().exists) file.delete();
    if (file.info().exists) throw new Error('Document copy remains.');
  } catch {
    console.warn('Document cache cleanup did not complete.');
  }
}

function viewDirectory(): Directory {
  return new Directory(Paths.cache, 'ledova-document-views-v1');
}

function entries(directory: Directory): (File | Directory)[] {
  try {
    return directory.exists ? directory.list() : [];
  } catch {
    console.warn('Document cache cleanup did not complete.');
    return [];
  }
}

function sweepViewCopies(): void {
  for (const entry of entries(viewDirectory())) {
    if (entry instanceof File) removeCopy(entry);
  }
}

subscribeSession(sweepViewCopies);

async function writeViewCopy(
  sessionEpoch: number,
  download: () => Promise<DocumentView>,
  guard?: () => void,
): Promise<{ uri: string; type: string }> {
  const { name, type, bytes } = await download();
  assertSessionEpoch(sessionEpoch);
  guard?.();
  sweepViewCopies();
  const copy = new File(viewDirectory(), name);
  copy.create({ intermediates: true, overwrite: true });
  copy.write(bytes);
  return { uri: copy.uri, type };
}

export const UTI_BY_MIME_TYPE: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'image/png': 'public.png',
  'image/jpeg': 'public.jpeg',
};

export async function shareDocumentCopy(
  sessionEpoch: number,
  download: () => Promise<DocumentView>,
  share: (uri: string, type: string) => Promise<void>,
  guard?: () => void,
): Promise<void> {
  assertSessionEpoch(sessionEpoch);
  guard?.();
  if (viewing === sessionEpoch) return;
  viewing = sessionEpoch;
  const copy = await writeViewCopy(sessionEpoch, download, guard).finally(() => {
    if (viewing === sessionEpoch) viewing = undefined;
  });
  assertSessionEpoch(sessionEpoch);
  guard?.();
  await share(copy.uri, copy.type);
}

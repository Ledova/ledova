import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { assertSessionEpoch, subscribeSession } from './sessionScope';

const PICKER_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9_-]{0,32})?$/i;
let viewing: number | undefined;

interface DocumentView {
  name: string;
  type: string;
  bytes: Uint8Array;
}

function temporaryDirectory(): Directory {
  return new Directory(Paths.document, '..', 'tmp');
}

function local(uri: string): string {
  return uri.replace(/^file:\/\/(\/private(?=\/))?/, '');
}

function inside(file: File, directory: Directory): boolean {
  return local(file.uri).startsWith(local(directory.uri).replace(/\/?$/, '/'));
}

function removeCopy(file: File): void {
  try {
    if (!inside(file, Paths.cache) && !(Platform.OS === 'ios' && inside(file, temporaryDirectory()))) return;
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

function sweep(directory: Directory, owned: (name: string) => boolean = () => true): void {
  for (const entry of entries(directory)) {
    if (entry instanceof File && owned(entry.name)) removeCopy(entry);
  }
}

function sweepViewCopies(): void {
  sweep(viewDirectory());
}

export function sweepEarlierUploadCopies(): void {
  sweep(new Directory(Paths.cache, 'DocumentPicker'), (name) => PICKER_NAME.test(name));
  sweep(new Directory(Paths.cache, 'ledova-upload-copies-v1'));
  if (Platform.OS !== 'ios') return;
  for (const entry of entries(temporaryDirectory())) {
    if (entry instanceof Directory && entry.name.endsWith('-Inbox')) sweep(entry);
  }
}

subscribeSession(() => {
  sweepEarlierUploadCopies();
  sweepViewCopies();
});

async function writeViewCopy(
  sessionEpoch: number,
  download: () => Promise<DocumentView>,
): Promise<{ uri: string; type: string }> {
  const { name, type, bytes } = await download();
  assertSessionEpoch(sessionEpoch);
  sweepViewCopies();
  const copy = new File(viewDirectory(), name);
  copy.create({ intermediates: true, overwrite: true });
  copy.write(bytes);
  return { uri: copy.uri, type };
}

export async function shareDocumentCopy(
  sessionEpoch: number,
  download: () => Promise<DocumentView>,
  share: (uri: string, type: string) => Promise<void>,
): Promise<void> {
  assertSessionEpoch(sessionEpoch);
  if (viewing === sessionEpoch) return;
  viewing = sessionEpoch;
  const copy = await writeViewCopy(sessionEpoch, download).finally(() => {
    if (viewing === sessionEpoch) viewing = undefined;
  });
  assertSessionEpoch(sessionEpoch);
  await share(copy.uri, copy.type);
}

import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { UPLOAD_TYPES, type FileDelivery } from '@ledova/shared';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from './sessionScope';

const PICKER_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9_-]{0,32})?$/i;
const PICKING_CANCELLED = ['ERR_FILE_PICKING_CANCELLED', 'ERR_PICKER_CANCELLED'];
const picked = new Set<string>();
let viewing: number | undefined;

interface DocumentView {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface PickedDocument {
  uri: string;
  name: string;
  type: string;
  size: number;
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

export function discardDocument(uri: string): void {
  if (picked.delete(uri)) removeCopy(new File(uri));
}

subscribeSession(() => {
  [...picked].forEach(discardDocument);
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

// A share sheet that cannot open rejects at once. iOS never settles a cancelled Save to Files,
// so a sheet that has stayed open this long has the file.
const SHARE_HANDOVER_MS = 1500;

export async function shareFile(uri: string, options: Sharing.SharingOptions): Promise<void> {
  const sharing = Sharing.shareAsync(uri, options);
  sharing.catch(() => undefined);
  await Promise.race([sharing, new Promise<void>((resolve) => setTimeout(resolve, SHARE_HANDOVER_MS))]);
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

export async function pickDocument(): Promise<PickedDocument | null> {
  const epoch = getSessionEpoch();
  let uri: string | undefined;
  try {
    const choice = await File.pickFileAsync();
    uri = (Array.isArray(choice) ? choice[0] : choice)?.uri;
  } catch (failure) {
    if (PICKING_CANCELLED.includes((failure as { code?: string } | null)?.code ?? '')) return null;
    throw failure;
  }
  if (!uri) return null;
  const file = new File(uri);
  picked.add(file.uri);
  if (epoch !== getSessionEpoch()) {
    discardDocument(file.uri);
    return null;
  }
  const type = file.type ?? '';
  const extension = Object.keys(UPLOAD_TYPES).find((key) => UPLOAD_TYPES[key] === type) ?? '';
  return {
    uri: file.uri,
    name: file.name.includes('.') ? file.name : `document${extension}`,
    type,
    size: file.size ?? 0,
  };
}

export const SHARE_SHEET_FILES: FileDelivery = {
  responseType: 'arraybuffer',
  save: async (data, name, type) => {
    if (!(data instanceof ArrayBuffer)) throw new Error('The file could not be read.');
    const sessionEpoch = getSessionEpoch();
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
    await shareDocumentCopy(
      sessionEpoch,
      async () => ({ name, type, bytes: new Uint8Array(data) }),
      (uri, mimeType) => shareFile(uri, { mimeType }),
    );
  },
};

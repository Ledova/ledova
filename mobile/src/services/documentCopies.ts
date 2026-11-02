import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { uploadType } from '@ledova/shared';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from './sessionScope';

const PICKER_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9_-]{0,32})?$/i;
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
  epoch: number;
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

export function sweepPickedCopies(): void {
  sweep(new Directory(Paths.cache, 'DocumentPicker'), (name) => PICKER_NAME.test(name));
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
  sweepPickedCopies();
  sweep(new Directory(Paths.cache, 'ledova-upload-copies-v1'));
  sweepViewCopies();
});

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

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

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

export async function pickDocument(): Promise<PickedDocument | null> {
  const epoch = getSessionEpoch();
  const result = await DocumentPicker.getDocumentAsync({
    type: Object.keys(EXTENSION_BY_MIME_TYPE),
    copyToCacheDirectory: Platform.OS === 'android',
    multiple: false,
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;
  picked.add(asset.uri);
  if (epoch !== getSessionEpoch()) {
    discardDocument(asset.uri);
    return null;
  }
  const declared = asset.mimeType !== 'application/octet-stream' && asset.mimeType;
  return {
    uri: asset.uri,
    name: asset.name,
    type: declared || uploadType(asset.name) || '',
    size: asset.size ?? new File(asset.uri).info().size ?? 0,
    epoch,
  };
}

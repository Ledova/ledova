interface Entry {
  size: number;
  content: string;
}

export const files = new Map<string, Entry>();
export const cache = 'file:///private/cache/';

function join(parts: (string | { uri: string })[]) {
  return parts.map((part) => (typeof part === 'string' ? part : part.uri).replace(/\/$/, '')).join('/');
}

class File {
  uri: string;

  constructor(...parts: (string | { uri: string })[]) {
    this.uri = join(parts);
  }

  get name() {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }

  info() {
    return { exists: files.has(this.uri), size: files.get(this.uri)?.size, uri: this.uri };
  }

  delete() {
    files.delete(this.uri);
  }

  create() {
    files.set(this.uri, { size: 0, content: '' });
  }

  write(bytes: Uint8Array) {
    files.set(this.uri, { size: bytes.length, content: String.fromCharCode(...bytes) });
  }

  move(destination: File) {
    const entry = files.get(this.uri);
    if (!entry || files.has(destination.uri)) throw new Error('Synthetic move refused');
    files.set(destination.uri, entry);
    files.delete(this.uri);
    this.uri = destination.uri;
  }
}

class Directory {
  uri: string;

  constructor(...parts: (string | { uri: string })[]) {
    this.uri = join(parts) + '/';
  }

  create() {}

  get exists() {
    return [...files.keys()].some((uri) => uri.startsWith(this.uri));
  }

  list() {
    return [...files.keys()].filter((uri) => uri.startsWith(this.uri)).map((uri) => new File(uri));
  }
}

export const nativeFileSystem = { File, Directory, Paths: { cache: new Directory(cache) } };

export function pickedFile(id: number) {
  const uri = `${cache}DocumentPicker/00000000-0000-0000-0000-${String(id).padStart(12, '0')}.pdf`;
  files.set(uri, { size: 5, content: 'file' });
  return {
    canceled: false as const,
    assets: [{ uri, name: `${id}.pdf`, mimeType: 'application/pdf', size: 5, lastModified: 0 }],
  };
}

export function resetFiles() {
  files.clear();
}

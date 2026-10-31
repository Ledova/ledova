interface Entry {
  size: number;
  content: string;
}

const files = new Map<string, Entry>();
export const cache = 'file:///private/cache/';

function join(parts: (string | { uri: string })[]) {
  return parts
    .map((part) => (typeof part === 'string' ? part : part.uri).replace(/\/$/, ''))
    .join('/')
    .replace(/\/[^/]+\/\.\.(?=\/|$)/g, '');
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
}

class Directory {
  uri: string;

  constructor(...parts: (string | { uri: string })[]) {
    this.uri = join(parts) + '/';
  }

  get exists() {
    return [...files.keys()].some((uri) => uri.startsWith(this.uri));
  }

  list() {
    return [...files.keys()].filter((uri) => uri.startsWith(this.uri)).map((uri) => new File(uri));
  }
}

export const nativeFileSystem = {
  File,
  Directory,
  Paths: { cache: new Directory(cache), document: new Directory('file:///private/document/') },
};

export function resetFiles() {
  files.clear();
}

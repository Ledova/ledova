export interface FileDelivery {
  responseType?: 'arraybuffer';
  save: (data: Blob | ArrayBuffer, name: string, type: string) => unknown;
}

export interface DownloadedFile {
  data: Blob | ArrayBuffer;
  type: string;
  size: number;
}

export function downloadedFile(response: { data?: unknown; headers?: unknown }): DownloadedFile | null {
  const { data } = response;
  if (data instanceof Blob) return { data, type: data.type, size: data.size };
  if (!(data instanceof ArrayBuffer)) return null;
  const type = (response.headers as Record<string, unknown> | undefined)?.['content-type'];
  return { data, type: typeof type === 'string' ? type : '', size: data.byteLength };
}

export async function downloadedText(file: DownloadedFile) {
  return file.data instanceof Blob ? file.data.text() : new TextDecoder().decode(file.data);
}

export function retainedName(snapshot: unknown, fallback: string) {
  const name = (snapshot as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name ? name : fallback;
}

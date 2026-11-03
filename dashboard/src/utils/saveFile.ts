import type { FileDelivery } from '@ledova/shared';

export function saveFile(data: Blob | ArrayBuffer, name: string, type?: string) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const BROWSER_FILES: FileDelivery = { save: saveFile };

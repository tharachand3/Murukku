import { api } from './api.js';

function responseFilename(contentDisposition) {
  if (typeof contentDisposition !== 'string') return null;
  const extended = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  const quoted = contentDisposition.match(/filename="([^"]+)"/i);
  const plain = contentDisposition.match(/filename=([^;]+)/i);
  const match = extended?.[1] ?? quoted?.[1] ?? plain?.[1]?.trim();
  if (!match) return null;
  const decoded = extended ? decodeURIComponent(match) : match;
  const filename = decoded.replace(/^["']|["']$/g, '').split(/[\\/]/).pop();
  return filename || null;
}

export async function downloadAuthenticatedFile(url, params, defaultFilename) {
  const { data, headers } = await api.get(url, {
    params,
    responseType: 'blob'
  });
  const disposition = typeof headers?.get === 'function'
    ? headers.get('content-disposition')
    : headers?.['content-disposition'];
  const filename = responseFilename(disposition) ?? defaultFilename;
  const objectUrl = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
  return filename;
}

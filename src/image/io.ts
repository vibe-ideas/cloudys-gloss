export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif']);
export function imageUrl(source: string) {
  const url = new URL(source);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请选择普通 HTTP(S) 图片链接，或打开本地图片');
  return url;
}
export async function readImage(source: File | string, signal: AbortSignal) {
  let blob: Blob;
  if (typeof source === 'string') {
    const url = imageUrl(source);
    const response = await fetch(url, { signal, credentials: 'include', referrerPolicy: 'no-referrer' });
    if (!response.ok || !imageTypes.has(response.headers.get('content-type')?.split(';')[0]?.trim() ?? '')) throw new Error('无法读取这张图片，请下载后选择本地图片');
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('图片超过 20 MB，请裁剪后重试');
    const reader = response.body?.getReader(); if (!reader) throw new Error('图片内容为空');
    const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('图片超过 20 MB，请裁剪后重试'); }
        chunks.push(new Uint8Array(value));
      }
    } finally { reader.releaseLock(); }
    blob = new Blob(chunks, { type: response.headers.get('content-type')!.split(';')[0] });
  } else blob = source;
  signal.throwIfAborted();
  if (blob.size > MAX_IMAGE_BYTES || !blob.size) throw new Error('请选择非空且小于 20 MB 的图片');
  if (!imageTypes.has(blob.type)) throw new Error('支持 PNG、JPEG、WebP、GIF、BMP 和 AVIF 图片');
  return blob;
}

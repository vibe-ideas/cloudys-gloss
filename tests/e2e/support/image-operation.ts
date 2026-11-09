/** Test-copy DOM driver for Firefox's extension realms, which BiDi cannot inspect. */
export async function imageOperation(operation: string, args: string[], view: Window & typeof globalThis) {
  const document = view.document;
  if (operation === 'ready') return !!document.querySelector('#image-url');
  if (operation === 'mode') {
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="识别模式"]')!;
    select.value = args[0]!; select.dispatchEvent(new view.Event('change', { bubbles: true })); return null;
  }
  if (operation === 'only') { document.querySelector<HTMLInputElement>('.toolbar input[type="checkbox"]')!.click(); return null; }
  if (operation === 'file') {
    const transfer = new view.DataTransfer();
    transfer.items.add(new view.File([Uint8Array.from(atob(args[0]!), c => c.charCodeAt(0))], args[1]!, { type: args[2] || 'image/png' }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    input.files = transfer.files; input.dispatchEvent(new view.Event('change', { bubbles: true })); return null;
  }
  if (operation === 'click') {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === args[0]);
    if (!button || button.disabled) throw new Error('Image button unavailable: ' + args[0]); button.click(); return null;
  }
  if (operation === 'snapshot') {
    const main = document.querySelector<HTMLElement>('main')!; const box = document.querySelector('.picture')?.getBoundingClientRect();
    return { ocrMs: Number(main.dataset.ocrMs), totalMs: Number(main.dataset.totalMs), cached: main.dataset.ocrCached === 'true',
      status: document.querySelector('[role="status"]')?.textContent ?? '', error: document.querySelector('[role="alert"]')?.textContent ?? '',
      lines: [...document.querySelectorAll('.text-card li')].map(node => ({ source: node.querySelector('textarea')!.value, score: Number(node.getAttribute('data-confidence')), translation: node.querySelector('.translation')!.textContent })),
      overlays: document.querySelectorAll('.translated-region').length,
      picture: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null };
  }
  throw new Error('Unknown image operation');
}

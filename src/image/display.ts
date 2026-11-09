/** Map natural OCR coordinates onto an <img> content box, including letterboxing/cropping. */
export function imageDisplay(width: number, height: number, naturalWidth: number, naturalHeight: number, fit: string, position: string) {
  if (![width, height, naturalWidth, naturalHeight].every(value => Number.isFinite(value) && value > 0)) return undefined;
  let x = width / naturalWidth; let y = height / naturalHeight;
  if (fit !== 'fill') {
    const scale = fit === 'cover' ? Math.max(x, y) : fit === 'none' ? 1 : fit === 'scale-down' ? Math.min(1, x, y) : Math.min(x, y);
    x = y = scale;
  }
  const tokens = position.trim().split(/\s+/);
  if (tokens.length !== 2) return undefined;
  const offset = (token: string, extra: number, axis: number) => {
    if (token === 'center') return extra / 2;
    if (token === (axis ? 'top' : 'left')) return 0;
    if (token === (axis ? 'bottom' : 'right')) return extra;
    if (/^-?[\d.]+%$/.test(token)) return extra * parseFloat(token) / 100;
    if (/^-?[\d.]+px$/.test(token) || token === '0') return parseFloat(token);
    return NaN;
  };
  const left = offset(tokens[0]!, width - naturalWidth * x, 0); const top = offset(tokens[1]!, height - naturalHeight * y, 1);
  if (![left, top].every(Number.isFinite)) return undefined;
  return { left, top, scaleX: x, scaleY: y };
}

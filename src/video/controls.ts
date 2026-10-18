import { OWN } from '../page/blocks';

const css = `
:host{all:initial!important;display:inline-flex!important;position:relative!important;float:left!important;vertical-align:top!important;align-self:center!important;flex:0 0 88px!important;width:88px!important;height:100%!important;min-height:36px!important;margin-inline-end:4px!important;color-scheme:dark!important;direction:ltr!important;visibility:inherit!important;pointer-events:inherit!important}
*{box-sizing:border-box}
button{all:unset;position:relative;display:flex;align-items:center;justify-content:center;width:44px;height:100%;flex:0 0 44px;color:#f5f5f5;cursor:pointer;touch-action:manipulation;font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-tap-highlight-color:transparent}
.face{position:relative;display:flex;align-items:center;justify-content:center;width:36px;height:32px;border-radius:7px;transition:background-color 120ms,color 120ms;pointer-events:none}
button:hover .face{background:#ffffff18}
button:active .face{background:#ffffff28}
button[aria-pressed=true],button[aria-expanded=true]{color:#dfff72}
.face:after{content:"";position:absolute;bottom:1px;left:11px;width:14px;height:2px;border-radius:2px;background:currentColor;opacity:0}
button[aria-pressed=true] .face:after,button[aria-expanded=true] .face:after{opacity:1}
button:focus-visible .face{outline:2px solid #dfff72;outline-offset:1px}
svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.tip{position:absolute;bottom:calc(100% + 8px);right:0;width:max-content;max-width:160px;padding:6px 9px;border:1px solid #ffffff20;border-radius:5px;background:#202124f5;color:#fff;font:500 12px/1.4 system-ui;text-align:center;pointer-events:none;visibility:hidden;opacity:0;transition:opacity 120ms}
button:first-of-type .tip{right:-44px}
button:not([data-hide-tip]):is(:hover,:focus-visible) .tip{visibility:inherit;opacity:1;transition-delay:300ms}
@media(prefers-reduced-motion:reduce){.face,.tip{transition:none}}
@media(forced-colors:active){button{color:ButtonText}button[aria-pressed=true],button[aria-expanded=true]{color:Highlight}.face:after{forced-color-adjust:none}button:focus-visible .face{outline-color:Highlight}.tip{background:Canvas;color:CanvasText;border-color:CanvasText}}
`;

/** Separate from YouTube's .ytp-button rules, including its hover pseudo-elements. */
export function createSubtitleControls(signal: AbortSignal) {
  const host = document.createElement('div'); host.setAttribute(OWN, 'video-controls');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = css; shadow.append(style);
  const makeButton = (kind: string) => {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute(OWN, kind);
    const face = document.createElement('span'); face.className = 'face'; face.setAttribute('aria-hidden', 'true');
    const tip = document.createElement('span'); tip.className = 'tip'; tip.setAttribute('aria-hidden', 'true');
    button.append(face, tip); shadow.append(button);
    for (const event of ['click', 'dblclick', 'pointerdown', 'keydown', 'keyup']) button.addEventListener(event, event => {
      if (event instanceof KeyboardEvent && ![' ', 'Enter', 'Escape'].includes(event.key)) return;
      event.stopPropagation();
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') button.setAttribute('data-hide-tip', '');
        if (event.repeat && (event.key === ' ' || event.key === 'Enter')) event.preventDefault();
      }
    }, { signal });
    for (const event of ['pointerenter', 'focus']) button.addEventListener(event, () => button.removeAttribute('data-hide-tip'), { signal });
    return { button, face };
  };
  const toggle = makeButton('video-toggle'); toggle.face.textContent = '双语';
  const history = makeButton('video-history-toggle');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 4.5h16v15H4z M14.5 4.5v15 M7 9h4 M7 12h4 M7 15h3 M17 9h.5 M17 12h.5 M17 15h.5');
  icon.append(path); history.face.append(icon);
  return { host, button: toggle.button, historyButton: history.button };
}

export function labelSubtitleControl(button: HTMLButtonElement, label: string) {
  if (button.getAttribute('aria-label') === label) return;
  button.setAttribute('aria-label', label);
  button.querySelector('.tip')!.textContent = label;
}

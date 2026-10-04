import { OWN } from './blocks';

/** One stylesheet per translation session; animations only change opacity. */
export function mountTranslationMotion() {
  const style = document.createElement('style');
  style.setAttribute(OWN, 'motion');
  style.textContent = `
@keyframes cloudys-breathe{0%,100%{opacity:.25}50%{opacity:.8}}
@keyframes cloudys-reveal{from{opacity:.25}to{opacity:1}}
[${OWN}] [data-gloss-part="text"]{all:unset!important;color:inherit!important;font:inherit!important;letter-spacing:inherit!important;line-height:inherit!important;text-transform:none!important}
[${OWN}] [data-gloss-reveal="true"]{animation:cloudys-reveal .22s ease-out!important}
[${OWN}] [data-gloss-part="loader"]{all:initial!important;display:inline-flex!important;align-items:center!important;gap:4px!important;height:1em!important;margin:0!important;vertical-align:middle!important;color:inherit!important}
[${OWN}] [data-gloss-part="loader"] i{all:initial!important;display:block!important;width:4px!important;height:4px!important;border-radius:50%!important;background:currentColor!important;color:inherit!important;opacity:.25!important}
[${OWN}][data-state="translating"] i,[${OWN}][data-state="partial"] i{animation:cloudys-breathe 1.3s ease-in-out infinite!important}
[${OWN}] [data-gloss-part="loader"] i:nth-child(2){animation-delay:.16s!important}
[${OWN}] [data-gloss-part="loader"] i:nth-child(3){animation-delay:.32s!important}
@media(prefers-reduced-motion:reduce){[${OWN}] [data-gloss-part="text"],[${OWN}] [data-gloss-part="loader"] i{animation:none!important}}
`;
  document.documentElement.append(style);
  return style;
}

export function translationLoader(hasText: boolean, active: boolean) {
  const loader = document.createElement('span');
  loader.dataset.glossPart = 'loader';
  loader.setAttribute('role', 'img');
  loader.setAttribute('aria-label', active ? '翻译中' : '等待翻译');
  loader.title = active ? '翻译中' : '等待翻译';
  if (hasText) loader.style.setProperty('margin-inline-start', '0.4em', 'important');
  for (let i = 0; i < 3; i++) loader.append(document.createElement('i'));
  return loader;
}

import tokens from '../styles/tokens.css?raw';

// tokens.css is the single palette source. Shadow roots cannot see page-level :root
// variables, so reuse its two :root blocks (light, then dark) on a scoped element.
const [light = '', dark = ''] = [...tokens.matchAll(/:root\s*\{([^}]*)\}/g)]
  .map(([, body]) => body!.replace(/color-scheme:[^;]*;/, '').replace(/\s+/g, ' ').trim());

/** Light by default, `.dark` forced, `.system` following the OS — matching the theme setting values. */
export const themeCss = (selector: string) =>
  `${selector}{${light}}${selector}.dark{${dark}}@media(prefers-color-scheme:dark){${selector}.system{${dark}}}`;

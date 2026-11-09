const paths = {
  translate: '<path d="M3 5h11M8 3v2m4 0c0 6-4 9-8 11m1-8c1 3 4 6 7 7m1 6 4-10 4 10m-6-4h4"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/>',
  retry: '<path d="M3 11a9 9 0 1 1 2.7 7.4M3 4v7h7"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M7.5 10.5h6m-3-3v6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01"/>',
  spinner: '<path d="M21 12a9 9 0 1 1-9-9"/>',
} as const;

/** Static, dependency-free icons sharing one optical size and stroke weight. */
export function imageIcon(name: keyof typeof paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

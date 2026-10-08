import type { ComponentChildren } from 'preact';

type Props = { label: string; hint?: ComponentChildren; full?: boolean; children: ComponentChildren };

/** Stacked form field: label, control, optional one-line hint. */
export function Field({ label, hint, full, children }: Props) {
  return <label class={`field${full ? ' full' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

/** Inline preference row: title and description on the left, compact control on the right. */
export function Row({ label, hint, children }: Omit<Props, 'full'>) {
  return <label class="row"><span class="row-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}

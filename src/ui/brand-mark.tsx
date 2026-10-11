import brand from '../../data/brand-mark.json';

/** Shared geometry for extension pages and the Shadow DOM control; no image fetch. */
export function BrandMark({ className = 'gloss-mark', badge = true }: { className?: string; badge?: boolean }) {
  return <svg class={className} viewBox={badge ? brand.viewBox : '3 3 26 26'} width="32" height="32" aria-hidden="true" focusable="false">
    {badge && <rect width="32" height="32" rx={brand.badge.radius} fill={brand.badge.fill} />}
    {brand.parts.map(part => <path key={part.name} class={`gloss-${part.name}`} fill={part.fill} d={part.d} />)}
  </svg>;
}

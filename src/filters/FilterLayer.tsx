import { FILTERS, filterMatrix, getFilter } from './registry';

/** SVG <defs> for every non-original filter. `prefix` keeps ids unique per <svg>/usage. */
export function FilterDefs({ prefix }: { prefix: string }) {
  return (
    <defs>
      {FILTERS.filter((f) => f.id !== 'original').map((f) => (
        <filter key={f.id} id={`${prefix}-${f.id}`} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={filterMatrix(f.params).join(' ')} />
        </filter>
      ))}
    </defs>
  );
}

/** Value for the `filter` attribute of an <image>; undefined for Original (no filter node = fastest). */
export const filterAttr = (prefix: string, id: string): string | undefined =>
  getFilter(id).id === 'original' ? undefined : `url(#${prefix}-${getFilter(id).id})`;

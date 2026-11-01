import { Icon } from '../../components/Icon';
import { useTheme } from '../../theme/theme';

/** One-tap Light <-> Dark for the panel header. (The full Light / Dark / System choice is in Appearance.) */
export function ThemeToggle({ onFail }: { onFail: () => void }) {
  const { resolved, setPref } = useTheme();
  const toDark = resolved === 'light';
  return (
    <button type="button" className="btn ghost adm-icon-btn" aria-label={toDark ? 'Switch to dark mode' : 'Switch to light mode'} title={toDark ? 'Dark mode' : 'Light mode'}
      onClick={() => { if (!setPref(toDark ? 'dark' : 'light')) onFail(); }}>
      <Icon name={toDark ? 'moon' : 'sun'} />
    </button>
  );
}

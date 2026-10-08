import { THEME_PREFS, type ThemePref, useTheme } from '../../theme/theme';
import { ChoiceRow, Hint } from './ui';
import type { AdminCtx, SectionDef } from './types';

const LABEL: Record<ThemePref, { label: string; icon: string }> = {
  light: { label: 'LIGHT', icon: 'sun' },
  dark: { label: 'DARK', icon: 'moon' },
  system: { label: 'SYSTEM', icon: 'monitor' }
};

function Theme({ notify }: AdminCtx) {
  const { pref, resolved, setPref } = useTheme();
  return (
    <>
      <ChoiceRow label="THEME" hint="Applies to the whole booth, including the screens customers see" value={pref}
        options={THEME_PREFS.map((p) => ({ value: p, label: LABEL[p].label, icon: LABEL[p].icon }))}
        onChange={(p) => { if (!setPref(p)) notify('error', 'THEME CHANGED, BUT THIS DEVICE WOULD NOT REMEMBER IT'); }} />
      <Hint>{pref === 'system' ? `SYSTEM follows this device\u2019s light/dark setting (it is ${resolved} now).` : `Saved on this device. Choose SYSTEM to follow the device setting instead.`} Receipts always print black on white, whatever the theme.</Hint>
    </>
  );
}

export const appearanceSection: SectionDef = {
  id: 'appearance',
  label: 'Appearance',
  icon: 'contrast',
  description: 'Light or dark look for the booth and this settings panel.',
  cards: [
    { id: 'appearance-theme', title: 'Colour scheme', keywords: ['theme', 'dark mode', 'light mode', 'dark', 'light', 'system', 'appearance', 'colour', 'color', 'night', 'display', 'screen'], render: (c) => <Theme {...c} /> }
  ]
};

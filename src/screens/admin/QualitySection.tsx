import { THERMAL_PRESETS, TONE_KEYS, type DitherMode, type ThermalSettings } from '../../print';
import { ChoiceRow, StepperRow, SwitchRow } from './ui';
import { TestPrintBody } from './TestPrint';
import type { AdminCtx, SectionDef } from './types';

const DITHERS: DitherMode[] = ['atkinson', 'floyd-steinberg', 'ordered', 'threshold', 'halftone'];
/** Which tone preset the current thermal tuning equals (CUSTOM once any value is nudged). */
const presetOf = (t: ThermalSettings) => THERMAL_PRESETS.find((p) => TONE_KEYS.every((k) => t[k] === p.tone[k]));

function Tone({ s, tune }: AdminCtx) {
  const t = s.thermal;
  const cur = presetOf(t);
  return (
    <>
      <ChoiceRow label="PRESET" hint="A starting point for the values below" value={cur?.id ?? null} note={cur ? undefined : 'CUSTOM'}
        options={THERMAL_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(id) => { const pick = THERMAL_PRESETS.find((p) => p.id === id)!; tune(Object.fromEntries(TONE_KEYS.map((k) => [k, pick.tone[k]])) as Partial<ThermalSettings>); /* tone only: margins/feed/cut stay */ }} />
      <ChoiceRow label="DITHER" hint="How grey is turned into black dots" value={t.dither} options={DITHERS.map((d) => ({ value: d, label: d.toUpperCase() }))} onChange={(d) => tune({ dither: d })} />
      {t.dither === 'halftone' && <StepperRow label="DOT SIZE" value={String(t.dotSize)} onMinus={() => tune({ dotSize: t.dotSize - 1 })} onPlus={() => tune({ dotSize: t.dotSize + 1 })} />}
      <StepperRow label="BRIGHTNESS" hint="Too dark? Go down in small steps" value={String(t.brightness)} onMinus={() => tune({ brightness: t.brightness - 10 })} onPlus={() => tune({ brightness: t.brightness + 10 })} />
      <StepperRow label="CONTRAST" value={String(t.contrast)} onMinus={() => tune({ contrast: t.contrast - 10 })} onPlus={() => tune({ contrast: t.contrast + 10 })} />
      <StepperRow label="DENSITY" hint="Print head heat" value={String(t.density)} onMinus={() => tune({ density: t.density - 1 })} onPlus={() => tune({ density: t.density + 1 })} />
      <StepperRow label="SHARPEN" value={String(t.sharpen)} onMinus={() => tune({ sharpen: t.sharpen - 5 })} onPlus={() => tune({ sharpen: t.sharpen + 5 })} />
      <StepperRow label="AUTO LEVEL" value={String(t.autoLevel)} onMinus={() => tune({ autoLevel: t.autoLevel - 10 })} onPlus={() => tune({ autoLevel: t.autoLevel + 10 })} />
      <StepperRow label="THRESHOLD" value={String(t.threshold)} onMinus={() => tune({ threshold: t.threshold - 8 })} onPlus={() => tune({ threshold: t.threshold + 8 })} />
    </>
  );
}

function Paper({ s, set, tune }: AdminCtx) {
  const t = s.thermal;
  return (
    <>
      <ChoiceRow label="PAPER" hint="Roll width" value={s.paperWidthMm} options={[{ value: 58, label: '58 MM' }, { value: 80, label: '80 MM' }]} onChange={(w) => set({ paperWidthMm: w })} />
      <StepperRow label="SIDE MARGIN" value={String(t.marginX)} onMinus={() => tune({ marginX: t.marginX - 8 })} onPlus={() => tune({ marginX: t.marginX + 8 })} />
      <StepperRow label="FEED LINES" hint="Blank paper after the print" value={String(t.feedLines)} onMinus={() => tune({ feedLines: t.feedLines - 1 })} onPlus={() => tune({ feedLines: t.feedLines + 1 })} />
      <SwitchRow label="CUT" hint="Cut the paper after each print" checked={t.cut} onChange={(v) => tune({ cut: v })} />
    </>
  );
}

export const qualitySection: SectionDef = {
  id: 'quality',
  label: 'Print quality',
  icon: 'sliders',
  description: 'Paper size and how photos are converted to black-and-white dots. Changes save instantly; print a test page to see them.',
  cards: [
    { id: 'quality-tone', title: 'Photo tone', description: 'Brightness, contrast and dot pattern.', keywords: ['preset', 'photobooth face', 'halftone', 'legacy', 'dither', 'atkinson', 'floyd-steinberg', 'ordered', 'threshold', 'dot size', 'brightness', 'contrast', 'density', 'sharpen', 'auto level', 'too dark', 'too pale', 'image', 'photo'], render: (c) => <Tone {...c} /> },
    { id: 'quality-paper', title: 'Paper & cutting', description: 'Roll width, margins and what happens after printing.', keywords: ['paper', '58 mm', '80 mm', 'width', 'side margin', 'margin', 'feed lines', 'feed', 'cut', 'cutter', 'roll', 'receipt'], render: (c) => <Paper {...c} /> },
    { id: 'quality-test', title: 'Test print', description: 'The 1-bit result, exactly as the printer receives it.', aside: true, keywords: ['test print', 'preview', 'test page', 'result'], render: (c) => <TestPrintBody c={c} /> }
  ]
};

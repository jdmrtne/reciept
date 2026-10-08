import type { ReactNode } from 'react';
import type { BoothSettings } from '../../config/settings';
import type { ThermalSettings } from '../../print';

export type NoticeKind = 'info' | 'success' | 'error';
export interface Notice { id: number; kind: NoticeKind; text: string }

/** Everything a settings card needs from the panel. Cards stay dumb: they read `s` and call `set`/`tune`/`actions`. */
export interface AdminCtx {
  s: BoothSettings;
  /** Merge-and-save, exactly as the old panel did (mergeSettings repairs the value, saveSettings persists it). */
  set: (p: Partial<BoothSettings>) => void;
  tune: (p: Partial<ThermalSettings>) => void;
  busy: boolean;
  /** Object URL of the last 1-bit test page, or null. */
  testUrl: string | null;
  notify: (kind: NoticeKind, text: string) => void;
  clearNotice: () => void;
  actions: { pair: () => void; testPrint: () => void; testShare: () => void; changePin: () => void };
}

export type SectionId = 'printer' | 'quality' | 'sharing' | 'appearance' | 'security';

export interface CardDef {
  id: string;
  title: string;
  description?: string;
  /** Extra search terms: every setting label in the card plus plain-language synonyms. */
  keywords: string[];
  /** Wide screens: park this card in a sticky right-hand column (the test-print preview). */
  aside?: boolean;
  render: (c: AdminCtx) => ReactNode;
}

export interface SectionDef {
  id: SectionId;
  label: string;
  /** Icon name from components/Icon. */
  icon: string;
  description: string;
  cards: CardDef[];
}

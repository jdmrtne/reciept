import type { ReactNode } from 'react';
import type { BoothSettings } from '../../config/settings';
import type { ThermalSettings } from '../../print';

export type NoticeKind = 'info' | 'success' | 'error';
export interface Notice { id: number; kind: NoticeKind; text: string }

/** Everything a settings card needs from the panel. Cards stay dumb: they read `s` and call `set`/`tune`/`actions`. */
export interface AdminCtx {
  s: BoothSettings;
  /** Merge-and-save, exactly as the old panel did (mergeSettings repairs the value, saveSettings persists it). Returns false when the device refused the write. */
  set: (p: Partial<BoothSettings>) => boolean;
  tune: (p: Partial<ThermalSettings>) => void;
  busy: boolean;
  /** Object URL of the last 1-bit test page, or null. */
  testUrl: string | null;
  notify: (kind: NoticeKind, text: string) => void;
  clearNotice: () => void;
  actions: { pair: () => void; testPrint: () => void; testShare: () => void; changePin: () => void };
  /** Jump to another sub-tab of the SAME category (never changes the category, never discards a draft). Absent outside the panel (tests). */
  goTab?: (tab: string) => void;
}

export type SectionId = 'events' | 'layouts' | 'frames' | 'frameText' | 'printer' | 'quality' | 'sharing' | 'autosave' | 'appearance' | 'security';

/** One horizontal sub-tab of a category. A category with a single tab shows no tab bar. */
export interface TabDef {
  id: string;
  label: string;
  /** This tab holds an unsaved draft (event text / frame text): its label gets a marker while the draft is dirty, even when another tab is open. */
  draft?: 'event' | 'frameText';
}

export interface CardDef {
  id: string;
  /** Which of the section's tabs shows this card. */
  tab: string;
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
  /** Sub-tabs in display order; the first is the default. Every card names one of them. */
  tabs: TabDef[];
  cards: CardDef[];
}

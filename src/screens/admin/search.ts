import type { CardDef, SectionDef } from './types';

export interface Hit { section: SectionDef; card: CardDef }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Every word the person typed must appear somewhere in the card's title, description, section name or keywords. */
export function cardMatches(section: SectionDef, card: CardDef, query: string): boolean {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const hay = norm([card.title, card.description ?? '', section.label, section.description, ...card.keywords].join(' '));
  return words.every((w) => hay.includes(w));
}

/** Section order, then card order. An empty query matches nothing here (the panel shows the selected section instead). */
export function searchSettings(sections: SectionDef[], query: string): Hit[] {
  if (!norm(query)) return [];
  return sections.flatMap((section) => section.cards.filter((card) => cardMatches(section, card, query)).map((card) => ({ section, card })));
}

/** One font stack for editor (SVG), preview and print canvas. Courier Prime (OFL) is bundled in src/assets/fonts. */
export const FONT_FAMILY = "'Courier Prime'";
export const FONT_STACK = "'Courier Prime', 'Courier New', Courier, monospace";

/** Display face for poster-style frames (Rye, OFL, bundled in src/assets/fonts). */
export const FONT_DISPLAY_STACK = "'Rye', Rockwell, Georgia, serif";

/** Canvas text only uses a web font once it is loaded, so the renderer awaits this first. Never throws. */
export async function ensureFonts(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`400 16px ${FONT_FAMILY}`), document.fonts.load(`700 16px ${FONT_FAMILY}`), document.fonts.load("400 16px 'Rye'")]);
  } catch { /* fall back to Courier New / monospace */ }
}

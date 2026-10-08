import type { ReactNode } from 'react';

/** Simple black line icons (24×24, stroke = currentColor). Decorative: buttons keep their text labels. */
const P: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7M8 12h12" />,
  camera: <><path d="M3 8.5h4l1.6-2.5h6.8L17 8.5h4V19H3z" /><circle cx="12" cy="13.5" r="3.6" /></>,
  flip: <><path d="M4 9a8 8 0 0113.6-3.2L20 8M20 4v4h-4" /><path d="M20 15a8 8 0 01-13.6 3.2L4 16M4 20v-4h4" /></>,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  redo: <path d="M20 8v5h-5M19.5 13A8 8 0 106 18" />,
  undo: <path d="M4 8v5h5M4.5 13A8 8 0 1118 18" />,
  reset: <><path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7L4 9" /><path d="M4 4v5h5" /></>,
  layout: <><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M4 10h16M12 10v10.5" /></>,
  frame: <><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><rect x="7.5" y="7.5" width="9" height="9" rx="1" /></>,
  filter: <><circle cx="9" cy="10" r="5.5" /><circle cx="15" cy="10" r="5.5" /><circle cx="12" cy="15" r="5.5" /></>,
  sticker: <path d="M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" />,
  swap: <path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />,
  print: <><path d="M7 9V3.5h10V9" /><rect x="3.5" y="9" width="17" height="8" rx="2" /><path d="M7 14h10v6.5H7z" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V5a1.5 1.5 0 00-1.5-1.5H5A1.5 1.5 0 003.5 5v9A1.5 1.5 0 005 15.5h3.5" /></>,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  close: <path d="M5 5l14 14M19 5L5 19" />,
  home: <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5" />,
  retry: <path d="M20 12a8 8 0 11-2.4-5.7M20 4v5h-5" />,
  play: <path d="M8 5l11 7-11 7z" />,
  photo: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M3.5 17l5-4.5 4 3.5 3-2.5 5 4" /></>,
  save: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  film: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 14.5h4M16.5 9h4M16.5 14.5h4" /></>,
  // --- owner settings
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20h6M12 16.5V20" /></>,
  contrast: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 000 17z" fill="currentColor" /></>,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2.5v2.5H14zM20 14v2.5M17.5 20H20M14 20v.1" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 018 0v2.5M12 14.5v2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /></>,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.7v.1" /></>
};

export function Icon({ name }: { name: keyof typeof P | string }) {
  return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">{P[name]}</svg>;
}

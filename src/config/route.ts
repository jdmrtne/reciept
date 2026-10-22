/** Owner shortcut URL. `/admin` (also `/admin/`, or under a sub-path like `/booth/admin`) opens the PIN-gated ADMIN screen. */
export const isAdminPath = (pathname: string) => /(^|\/)admin\/?$/.test(pathname);

/** Where to send the address bar after leaving ADMIN, so a reload boots to standby instead of the keypad again. */
export const homePath = (pathname: string) => pathname.replace(/admin\/?$/, '') || '/';

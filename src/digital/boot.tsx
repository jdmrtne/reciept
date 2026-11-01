import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DigitalPhotoPage } from './DigitalPhotoPage';

/** Phone-side entry for `/p/<id>`. No kiosk behaviour: no service worker, no wake lock, no blocked context menu or zoom. */
export function mountDigitalPage(id: string) {
  document.title = 'Your photo';
  const head = document.head;
  // The kiosk shell disables pinch-zoom; a customer's phone should be allowed to zoom, and search engines should skip this private page.
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
  const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex, nofollow'; head.appendChild(robots);
  document.body.classList.add('dp-body');
  createRoot(document.getElementById('root')!).render(<StrictMode><DigitalPhotoPage id={id} /></StrictMode>);
}

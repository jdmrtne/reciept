import { photoPageId } from './share/url';
import { initTheme } from './theme/theme';
import './styles/tokens.css';
import './styles/global.css';

// Theme first (light/dark/system), for the booth and for the customer's phone page alike.
initTheme();

// `/p/<id>` is the page a customer's phone opens from the QR code: a tiny separate bundle, no kiosk code or service worker.
// Every other URL is the booth.
const photoId = photoPageId(location.pathname);
if (photoId !== null) void import('./digital/boot').then((m) => m.mountDigitalPage(photoId));
else void import('./kiosk').then((m) => m.bootKiosk());

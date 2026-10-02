import { photoPageId } from './share/url';
import './styles/tokens.css';
import './styles/global.css';

// `/p/<id>` is the page a customer's phone opens from the QR code: a tiny separate bundle, no kiosk code or service worker.
// Every other URL is the booth.
const photoId = photoPageId(location.pathname);
if (photoId !== null) void import('./digital/boot').then((m) => m.mountDigitalPage(photoId));
else void import('./kiosk').then((m) => m.bootKiosk());

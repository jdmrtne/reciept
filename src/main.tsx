import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { sessionStore } from './state/session';
import { isAdminPath } from './config/route';
import './styles/tokens.css';
import './styles/global.css';

registerSW({ immediate: true });
// Owner shortcut: opening /admin goes straight to the PIN keypad. Every other URL boots to standby as always.
if (isAdminPath(location.pathname)) sessionStore.go('admin');
// Kiosk hygiene: no context menu, no pinch-zoom of the page itself.
document.addEventListener('contextmenu', (e) => e.preventDefault());
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

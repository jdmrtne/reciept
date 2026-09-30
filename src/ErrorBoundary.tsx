import { Component, type ReactNode } from 'react';
import { sessionStore } from './state/session';
import { RECOVER_DELAY_MS, recoveryAction } from './recovery';

// Module-level (not instance state) so it survives the boundary remounting its children.
let lastCrashAt: number | null = null;

/**
 * Last line of defence for an unattended booth: if any screen throws while rendering, show a short black-and-white
 * "restarting" card and return to standby with everything wiped, instead of leaving a blank tablet in front of a guest.
 * A repeat crash within RELOAD_WINDOW_MS reloads the page (the service worker serves it offline).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private timer: number | undefined;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[photobooth] a screen crashed; restarting', error);
    const now = Date.now();
    const action = recoveryAction(now, lastCrashAt);
    lastCrashAt = now;
    this.timer = window.setTimeout(() => {
      if (action === 'reload') return location.reload();
      sessionStore.reset(); // revokes photo blob URLs, new session id
      this.setState({ failed: false });
    }, RECOVER_DELAY_MS);
  }

  componentWillUnmount() {
    window.clearTimeout(this.timer);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app">
        <div className="screen crash" role="alert">
          <p className="crash-head">ONE MOMENT</p>
          <hr className="dash" />
          <p className="crash-sub">RESTARTING THE BOOTH</p>
        </div>
      </div>
    );
  }
}

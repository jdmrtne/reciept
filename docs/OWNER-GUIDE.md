# Owner guide (setup + daily use)

Written for the person running the booth, not the developer. Android menu names vary by manufacturer; the ideas are the same everywhere.

## One-time setup
1. **Install**: open the booth URL in Chrome on the tablet (online, first time only), let the standby screen appear, then Chrome menu → *Install app* / *Add to Home screen*. Launch from the icon (full-screen, no address bar).
2. **Camera permission**: the first time a guest starts, Chrome asks for camera access. Choose *Allow* (and if offered, *Allow while visiting / every time*). Do this yourself before the event.
3. **Open ADMIN**: on the standby screen tap the small **heart** doodle. (Or open `<booth URL>/admin` in a normal Chrome tab.) First time: create an owner PIN. Write it down: guests can reach the keypad but not the settings behind it, and 5 wrong tries locks it for a minute.
4. **Printer** (ADMIN → PRINTER). The booth ships set to **TEST PRINTER**, which prints nothing. Pick your real connection, then:
   - Set **PAPER** to match your roll: **58 mm or 80 mm**. The default is 58 mm; an 80 mm printer such as the XP-T80A needs 80 mm.
   - USB or Bluetooth: **PAIR PRINTER** and choose the printer in Chrome's list.
   - Press **TEST PRINT** and check the whole border is visible, the grey ramp has visible steps and the solid bar is black.
5. **Event name**: shown on the standby screen and printed in frames. There is no ADMIN control for it yet (it defaults to PHOTOBOOTH); changing it currently needs a developer.
6. **Tablet settings** (Android Settings; the app also asks the screen to stay on, but set these too):
   - Screen timeout → longest / *Stay awake while charging* (Developer options on some tablets).
   - Keep the tablet **plugged in** for the whole event.
   - **Screen pinning / app pinning** (Security or Display settings) so guests cannot leave the app.
   - Turn on *Do Not Disturb* and silence notifications.
   - Turn off auto-updates during the event if you can, so Chrome or Android does not restart mid-event.

## Before each event (2 minutes)
- Tablet charged and plugged in; printer powered, paper loaded, cover closed.
- Open the booth: the top-left dot on standby should say **PRINTER READY**. *CHECK PAPER* = paper low/out or cover open; *PRINTER OFFLINE* = not connected/powered.
- Do one full test strip yourself, then let it return to standby.

## During the event
- The booth wipes itself after every guest (DONE, or 60 s of no touches) and returns to standby. Nothing of a guest is kept.
- If a print fails the guest sees a plain message and a **RETRY** button; if it keeps failing, check paper/power/connection.
- If a screen ever crashes, the booth shows **ONE MOMENT / RESTARTING THE BOOTH** and returns to standby by itself.

## Troubleshooting
| Symptom | Try |
|---|---|
| Camera shows nothing / "camera unavailable" | Chrome site settings → Camera → Allow; close other apps using the camera; reopen the booth |
| PRINTER OFFLINE | Power/USB cable/Bluetooth on; ADMIN → PAIR PRINTER again; for network/Windows setups make sure the print bridge is running |
| Prints are clipped at the sides | ADMIN → PAPER width wrong (58 vs 80 mm), or raise SIDE MARGIN |
| Prints too dark / too pale | ADMIN → BRIGHTNESS / DENSITY (small steps), TEST PRINT again |
| Blank/garbled Bluetooth print | ADMIN → lower BT CHUNK, raise BT DELAY MS |
| Booth shows an old design after an update | Updates apply at standby between guests; leave it idle a minute, then reload |
| Forgot the owner PIN | Chrome → Site settings for the booth URL → **Clear data** (or Android Settings → Apps → Chrome/booth → Storage). This also erases printer settings and pairing, so redo step 4 |
| Nothing loads and there is no internet | Only the first-ever visit needs internet. If the installed app was cleared, reconnect once |

## What the booth never does
No text entry for guests, no accounts, no uploads, no saved photos.

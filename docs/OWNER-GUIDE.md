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
- Choose the event: **ADMIN → Events**, tap the event, then **MAKE ACTIVE** (see "Events" below). The next guest gets it.
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

## Settings layout and dark mode (ADMIN)

ADMIN is now grouped by topic. On a tablet/laptop the sections are listed on the left; on a phone they are a menu under the search box.

| Section | What is in it |
|---|---|
| **Events** | The events you can run, which one is active, the text printed on every receipt, and a preview. See "Events" below |
| **Layouts** | Which strip layouts guests can pick on CHOOSE YOUR STRIP. See "Choosing which layouts guests see" below |
| **Frames** | Which frame designs guests can pick in the editor. See "Choosing which frame designs guests see" below |
| **Printer** | Printer type, connection details (Windows printer name, printer IP, BRIDGE URL, Bluetooth chunk/delay), PAIR / CHECK PRINTER, TEST PRINT |
| **Print quality** | PRESET, DITHER, BRIGHTNESS, CONTRAST, DENSITY, SHARPEN, AUTO LEVEL, THRESHOLD, PAPER, SIDE MARGIN, FEED LINES, CUT, plus a pinned TEST PRINT preview |
| **Photo sharing** | SHARE QR, PUBLIC / SITE URL, upload address, CHECK SHARE |
| **Appearance** | LIGHT / DARK / SYSTEM theme |
| **Security** | CHANGE PIN |

- **Search** (top of the panel) finds a setting by name or plain words: try "brightness", "dark mode", "qr", "pin".
- **Saving:** every setting is stored the instant you change it; the SAVED badge confirms it. The one exception is **Events**, which has a **SAVE** button (see below). If the device refuses to store settings, a message says so.
- **Dark mode:** ADMIN → Appearance, or the moon/sun button in the panel header. The choice is kept on this device and applies to the whole booth, including the screens customers see. SYSTEM follows the tablet's own light/dark setting. The default is LIGHT, so a booth looks as before until you change it. Receipts, the print preview and stickers stay black-on-white in every theme, because that is how they print.
- Control names (BRIGHTNESS, CUT, etc.) are unchanged, so the troubleshooting table above still applies. The old "+" buttons that cycled PAPER, PRESET, DITHER, SHARE QR and CUT are now clearly labelled choices and switches.

## Events (ADMIN → Events)
An *event* is the text printed on every receipt: name, header, up to three detail lines, a thank-you and a small branding line. You can keep several events (a wedding, a birthday, ...) and switch between them without any rebuild.

- **Pick the event for the next guest:** tap the event in the list, then **MAKE ACTIVE**. The ACTIVE tag moves. A guest who has already started keeps the event they started with; the next guest gets the new one.
- **Edit an event:** tap it, change the fields under **Event text**, then **SAVE**. Nothing changes for guests until you press SAVE, even if it is the active event. **CANCEL** throws your changes away. The bar with SAVE and CANCEL stays at the top of the form so the on-screen keyboard does not cover it.
- **The fields:** EVENT NAME (required), HEADER / TITLE, DETAIL LINE 1 to 3 (use these for venue, host or date; blank lines are skipped), THANK-YOU MESSAGE (leave blank to print none), SHOW BRANDING and BRANDING TEXT (blank prints "Printed by Memorys"). Each line holds up to 40 characters. A line that is too long, or has emoji or other characters the receipt cannot print, is marked and cannot be saved; nothing is cut off for you.
- **Some frames already print the name, date, time or a thank-you.** The booth never prints the same thing twice: it adds only what that frame lacks, under the picture.
- **Leaving with unsaved changes:** switching events, changing section, searching, EXIT or closing the page asks first (KEEP EDITING / DISCARD).
- **NEW EVENT** adds an event (not active yet). **DUPLICATE** copies the selected one (not active). **RESET TEXT** puts the selected event's text back to the defaults (asks first). **DELETE** removes an event (asks first). You cannot delete the active event (make another one active first) or the last remaining event.
- **Two events may share a name.** They stay separate; the small `#event-2` code under each name tells them apart.
- **Preview:** shows your unsaved text on a sample receipt (pick the frame). It uses a sample photo, date and time; nothing is printed, saved or sent, and the QR code is not drawn in it. Check the real receipt with a test strip.
- **If the booth times out while you type,** your unsaved text is still there when you come back through the PIN, until the page is reloaded.
- **Known limits:** the PIN is stored on the tablet and only keeps casual guests out; see the audit notes. Tiny text on 58 mm paper must be checked on the real printer.

## Choosing which layouts guests see (ADMIN → Layouts)
Open **ADMIN → Layouts** to switch layouts on or off for the **CHOOSE YOUR STRIP** screen.
- Every layout has a switch and a small preview (with a sample QR). The **JLC 20th Anniv. Special** group has a **whole group** switch plus one switch per NCL Pass.
- Turn a layout off and guests no longer see it. If every pass in the special group is off, its card disappears.
- At least one layout always stays on: the last one cannot be switched off. **SHOW ALL** turns everything back on.
- Changes save immediately and show the next time a guest reaches the picker (no reload needed). They only affect the guest picker, not the layout tray inside the editor.
- The setting is stored on this device (like the other booth settings). New layouts added in a future update appear automatically.

## Choosing which frame designs guests see (ADMIN → Frames)
Open **ADMIN → Frames** to switch frame designs on or off for the frame list guests see while editing their strip.
- Frames are split into **RECEIPT STYLES** and **DESIGNS**. Every frame has a switch and a small preview. Each group has **SHOW ALL** / **HIDE ALL**, and **SHOW ALL FRAMES** at the bottom turns everything back on.
- At least one frame always stays on: the last one cannot be switched off, and **HIDE ALL** is unavailable when it would hide the last frames.
- The **JLC NCL Boarding Pass** frame is not listed. It always goes with the JLC layouts, which you control under **ADMIN → Layouts**.
- A guest who already picked a frame keeps it, even if you hide it afterwards; it just won't be offered to the next guest. If you hide the default frame (Classic Receipt), new guests start with the first frame that is still shown.
- Changes save immediately and apply the next time a guest opens the editor (no reload). The setting is stored on this device, and new frames added in a future update appear automatically. It does not affect the frame choice in **ADMIN → Events** (that preview is for you).

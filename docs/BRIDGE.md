# Print bridge (network printers)

Browsers can't open raw TCP, so the app sends the print job to a tiny local program which forwards it to the printer's port 9100.

    npm run bridge            # listens on http://localhost:9101 (PORT=9101 to change)

ADMIN → PRINTER = NETWORK → set PRINTER IP (e.g. 10.0.0.11) and BRIDGE URL (default http://localhost:9101) → CHECK PRINTER → TEST PRINT.

- `GET /status?host=&port=` → `{ok:true}` if the printer accepts a connection. `POST /print?host=&port=` (raw bytes) → sends them.
- Only private IPv4 addresses and port 9100 are accepted (`ALLOW_PORTS=9100,9101` to extend).
- Tablet: run the bridge on the PC (or any always-on machine on the LAN) and set BRIDGE URL to `http://<that-PC-LAN-IP>:9101`.
  An HTTPS-hosted app cannot call a plain-http LAN bridge (mixed content); serve the app from the same PC over http://localhost or put the bridge behind HTTPS.
- Code: `bridge/server.mjs`, `src/print/transports/bridge.ts`, `src/print/adapters/network.ts`, tests in `src/print/network.test.ts`.

## Finding the printer's IP
    npm run find-printer                # scans this PC's local networks for port 9100
    npm run find-printer -- 192.168.1   # or one subnet
ETIMEDOUT from the bridge = the PC can't reach that IP (wrong/old address, different network). Also: printer self-test sheet, or Windows > Printers > POS80 > Printer properties > Ports.

## Windows printer (USB printer installed in Windows) — the bench setup
Owner's printer: USB, Windows queue "POS80 10.0.0.11" (the IP in the name is just a label). WebUSB can't claim it on Windows (OS driver owns it), so the bridge sends RAW ESC/POS to the queue through the spooler (`bridge/windows.mjs`, PowerShell + winspool P/Invoke; no install).
    npm run list-printers      # shows each queue + its port; a USB printer should use USB001
    npm run bridge
ADMIN → PRINTER = WINDOWS PRINTER → name = the queue name → CHECK PRINTER → TEST PRINT.
Bridge endpoints: `GET /printers`, `GET /status?printer=NAME`, `POST /print?printer=NAME`. The C# was compile-checked with mono but the PowerShell path has only been run through fakes: verify on real Windows.

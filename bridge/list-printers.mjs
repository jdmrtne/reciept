#!/usr/bin/env node
// Lists the Windows print queues and the port each one uses.   npm run list-printers
import { listPrinters } from './windows.mjs';
try {
  const list = await listPrinters();
  console.log('Windows printers (Name  |  Port  |  Driver):\n');
  for (const p of list) console.log(`  ${p.Name}  |  ${p.PortName}  |  ${p.DriverName}`);
  console.log('\nA USB printer should use a port like USB001. Copy the Name exactly into ADMIN > WINDOWS PRINTER NAME.');
} catch (e) { console.error('Could not list printers:', e.message); process.exit(1); }

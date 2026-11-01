/** Minimal structural types for WebUSB / Web Bluetooth (lib.dom doesn't ship them). Real objects satisfy these; tests pass fakes. */
export interface UsbEndpoint { endpointNumber: number; direction: 'in' | 'out'; type: 'bulk' | 'interrupt' | 'isochronous' }
export interface UsbAlternate { alternateSetting: number; interfaceClass: number; endpoints: UsbEndpoint[] }
export interface UsbInterface { interfaceNumber: number; alternates: UsbAlternate[] }
export interface UsbConfiguration { configurationValue: number; interfaces: UsbInterface[] }
export interface UsbDeviceLike {
  productName?: string | null; opened: boolean;
  configuration: UsbConfiguration | null; configurations: UsbConfiguration[];
  open(): Promise<void>; close(): Promise<void>;
  selectConfiguration(v: number): Promise<void>; claimInterface(n: number): Promise<void>; releaseInterface(n: number): Promise<void>;
  selectAlternateInterface(n: number, alt: number): Promise<void>;
  transferOut(ep: number, data: BufferSource): Promise<{ status: string; bytesWritten?: number }>;
  transferIn(ep: number, length: number): Promise<{ status: string; data?: DataView }>;
}
export interface UsbLike {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(o: { filters: object[] }): Promise<UsbDeviceLike>;
  addEventListener(t: 'disconnect', l: (e: { device: UsbDeviceLike }) => void): void;
  removeEventListener(t: 'disconnect', l: (e: { device: UsbDeviceLike }) => void): void;
}

export interface BtCharacteristic {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithoutResponse(d: BufferSource): Promise<void>;
  writeValueWithResponse(d: BufferSource): Promise<void>;
}
export interface BtService { uuid: string; getCharacteristics(): Promise<BtCharacteristic[]> }
export interface BtServer { connected: boolean; getPrimaryServices(): Promise<BtService[]>; disconnect(): void }
export interface BtDeviceLike {
  id: string; name?: string;
  gatt?: { connected: boolean; connect(): Promise<BtServer>; disconnect(): void };
  addEventListener(t: 'gattserverdisconnected', l: () => void): void;
  removeEventListener(t: 'gattserverdisconnected', l: () => void): void;
}
export interface BtLike {
  requestDevice(o: { acceptAllDevices: true; optionalServices: string[] }): Promise<BtDeviceLike>;
  getDevices?(): Promise<BtDeviceLike[]>;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`${what} timed out`)), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

// What kind of device is the game running on? Drives two things: the mobile interface (ui/mobile.css, switched on by `body.mobile`, so the desktop layout is never
// touched) and the display settings a phone or tablet starts with. No imports: tests load it under plain node.

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

export interface DeviceFacts {
  /** The main pointer is a finger (`(pointer: coarse)`). A laptop with a touch screen still has a fine main pointer, and stays a desktop. */
  coarse: boolean;
  /** The shorter side of the screen, in CSS pixels (does not change when the device turns). */
  shortSide: number;
  maxTouchPoints?: number;
  userAgent?: string;
}

/** iPadOS asks for the desktop site by default: it says "Macintosh", but a Mac has no touch points. */
const iPadAsMac = (f: DeviceFacts) => /Macintosh/.test(f.userAgent ?? '') && (f.maxTouchPoints ?? 0) > 1;

export function classifyDevice(f: DeviceFacts): DeviceClass {
  if (!f.coarse && !iPadAsMac(f)) return 'desktop';
  return f.shortSide < 600 ? 'phone' : 'tablet';
}

let cls: DeviceClass = 'desktop';
export const deviceClass = () => cls;
export const isTouchDevice = () => cls !== 'desktop';

/** Look at the browser once, and mark `<body>` (`mobile`, `phone` or `tablet`) so the stylesheet can follow. Call before the interface is built. */
export function initDevice(): DeviceClass {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const shortSide = Math.min(screen.width || innerWidth, screen.height || innerHeight, innerWidth || 9999, innerHeight || 9999) || 9999;
    // `screen` can report the physical size in a few browsers; the window is what the layout lives in, so the smaller of both decides
    cls = classifyDevice({ coarse, shortSide, maxTouchPoints: navigator.maxTouchPoints, userAgent: navigator.userAgent });
  } catch { cls = 'desktop'; }
  const url = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('device') : null;   // ?device=phone|tablet|desktop to try a layout on a computer
  if (url === 'phone' || url === 'tablet' || url === 'desktop') cls = url;
  if (cls !== 'desktop') document.body.classList.add('mobile', cls);
  return cls;
}

/** The display settings a touch device starts with, until its player chooses their own (see settings.ts `playerChoseSettings`).
 *  What a phone or tablet needs is fewer pixels and a steadier frame, not fewer features: no multisampled canvas (the screen is dense enough), a render scale
 *  of at most 1.5, and a frame rate limit so a 120 Hz screen (iPad Pro, newer iPhones) does not run the whole game twice as often as anyone can use. */
export function touchDefaults(c: DeviceClass): { quality: 'low' | 'medium'; antialias: false; fpsCap: 60; pixelCap?: number } | null {
  if (c === 'phone') return { quality: 'low', antialias: false, fpsCap: 60, pixelCap: 1.25 };
  if (c === 'tablet') return { quality: 'medium', antialias: false, fpsCap: 60, pixelCap: 1.5 };
  return null;
}

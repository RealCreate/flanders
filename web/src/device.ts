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

function measure(): DeviceClass {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const shortSide = Math.min(screen.width || innerWidth, screen.height || innerHeight, innerWidth || 9999, innerHeight || 9999) || 9999;
    // `screen` can report the physical size in a few browsers; the window is what the layout lives in, so the smaller of both decides
    return classifyDevice({ coarse, shortSide, maxTouchPoints: navigator.maxTouchPoints, userAgent: navigator.userAgent });
  } catch { return 'desktop'; }
}

/** A touch device whose window changed size: an iPad window narrowed in Split View or Stage Manager has a phone's width and takes the phone layout, and widened
 *  again takes the tablet one back. Never turns a touch device into a desktop or the other way round (that is the kind of pointer, which a resize does not change). */
export function reclassify(was: DeviceClass, now: DeviceClass): DeviceClass {
  if (was === 'desktop' || now === 'desktop') return was;
  return now;
}

/** Look at the browser once, and mark `<body>` (`mobile`, `phone` or `tablet`) so the stylesheet can follow. Call before the interface is built.
 *  On a touch device the phone/tablet mark follows the window afterwards (see `reclassify`); `onChange` hears about it. */
export function initDevice(onChange?: (c: DeviceClass) => void): DeviceClass {
  cls = measure();
  const url = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('device') : null;   // ?device=phone|tablet|desktop to try a layout on a computer
  const forced = url === 'phone' || url === 'tablet' || url === 'desktop';
  if (forced) cls = url;
  if (cls !== 'desktop') document.body.classList.add('mobile', cls);
  if (!forced && cls !== 'desktop') addEventListener('resize', () => {
    const next = reclassify(cls, measure());
    if (next === cls) return;
    document.body.classList.replace(cls, next); cls = next;
    onChange?.(next);
  });
  return cls;
}

/** The display settings a touch device starts with, until its player chooses their own (see settings.ts `playerChoseSettings`).
 *  What a phone or tablet needs is fewer pixels and a steadier frame, not fewer features: no multisampled canvas (the screen is dense enough), a render scale
 *  of at most 1.25, and a frame rate limit so a 120 Hz screen (iPad Pro, newer iPhones) does not run the whole game twice as often as anyone can use.
 *  A tablet also starts without the glossy water: the sea is a large transparent physical material that covers much of the screen along a coast, and Safari
 *  (every browser on iPad) cannot time the GPU, so the adaptive resolution only finds out late that the water is what costs. */
export function touchDefaults(c: DeviceClass): { quality: 'low' | 'medium'; antialias: false; fpsCap: 60; pixelCap?: number; waterFx?: false } | null {
  if (c === 'phone') return { quality: 'low', antialias: false, fpsCap: 60, pixelCap: 1.25 };
  if (c === 'tablet') return { quality: 'medium', antialias: false, fpsCap: 60, pixelCap: 1.25, waterFx: false };
  return null;
}

/** Lighter work a tablet or phone does where the desktop presets do not reach: fewer lamp lights at night, and moving villagers, soldiers and animals that do not
 *  cast shadows (their shadows force the shadow map to be redrawn several times a second while anything walks). Buildings and trees keep their shadows. */
export function touchLimits(c: DeviceClass): { lampLights: number; crowdShadows: boolean } {
  return c === 'desktop' ? { lampLights: 4, crowdShadows: true } : { lampLights: 2, crowdShadows: false };
}

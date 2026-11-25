// Words for a finger instead of a mouse. Hints and notices are written for a mouse ("click", "right-click", "Shift+click"); on a phone or tablet they are shown
// through this, so they name the gestures that exist there. No imports: tests load it under plain node.

const RULES: [RegExp, string][] = [
  [/\bShift[+-]click(?:ing|s)?\b/gi, 'tap with Select more on'],
  [/\bRight[- ]click(?:ing)?\b/g, 'Hold'], [/\bright[- ]click(?:ing)?\b/g, 'hold'],
  [/\bRight[- ]clicks\b/g, 'Holds'], [/\bright[- ]clicks\b/g, 'holds'],
  [/\bDouble[- ]click\b/g, 'Double-tap'], [/\bdouble[- ]click\b/g, 'double-tap'],
  [/\bClicking\b/g, 'Tapping'], [/\bclicking\b/g, 'tapping'],
  [/\bClicked\b/g, 'Tapped'], [/\bclicked\b/g, 'tapped'],
  [/\bClicks\b/g, 'Taps'], [/\bclicks\b/g, 'taps'],
  [/\bClick\b/g, 'Tap'], [/\bclick\b/g, 'tap'],
  [/\bLeft-drag\b/g, 'Drag'], [/\bleft-drag\b/g, 'drag'],
];

/** The same text with mouse words turned into touch words ("right-click" → "hold", "click" → "tap", "Shift+click" → "tap with Select more on"). */
export function touchWording(text: string): string {
  let t = text;
  for (const [re, to] of RULES) t = t.replace(re, to);
  return t;
}

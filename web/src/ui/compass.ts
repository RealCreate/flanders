/** Compass words for a direction on the map: +x is east, +z is south (so "north" is up on the minimap). */
const WORDS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
export function compassWord(dx: number, dz: number): string {
  return WORDS[((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8];
}

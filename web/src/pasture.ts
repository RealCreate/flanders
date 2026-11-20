export const PASTURE = 45;
export const PIGSTY = 46;
export const isLivestockPen = (kind: number) => kind === PASTURE || kind === PIGSTY;
export const PEN_HALF_WIDTH = 4.8;
export const PEN_HALF_DEPTH = 4.4;
export const GRAZING_RADIUS = 3.65;

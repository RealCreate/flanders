/** Is a deposit at (dx, dz) within `r` of (x, z)? Deposits farther than the view from the camera are not drawn (see Deposits.cull). */
export function deposit_near(dx: number, dz: number, x: number, z: number, r: number): boolean { return (dx - x) ** 2 + (dz - z) ** 2 <= r * r; }

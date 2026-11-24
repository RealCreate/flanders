import type * as THREE from 'three';

/** Mark objects that never move (containers in world coordinates, terrain chunks, merged meshes).
 *
 *  three.js recomposes the matrix of every object with `matrixAutoUpdate` on, every frame, and that marks the object's world matrix dirty, which forces every
 *  descendant to recompute its world matrix too, even descendants that are themselves frozen. One un-frozen container above the forest's thousands of tree
 *  meshes therefore costs thousands of matrix multiplies per frame. Freezing the container computes its matrix once; children that do move keep their own
 *  `matrixAutoUpdate` and still update themselves.
 *
 *  Only use this on objects whose position, rotation and scale are never changed afterwards (or call `updateMatrix()` after changing them). */
export function freeze<T extends THREE.Object3D>(...objects: T[]): T {
  for (const o of objects) { o.updateMatrix(); o.matrixAutoUpdate = false; }
  return objects[0];
}

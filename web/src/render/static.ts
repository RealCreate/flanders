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

/** Take a whole subtree out of the per-frame matrix walk. `freeze` stops matrices being recomputed, but three.js still calls `updateMatrixWorld` on every descendant
 *  every frame just to find nothing to do: for the forest that is about 3,900 calls a frame. Only for a subtree that never moves and whose objects all sit at the
 *  identity (every tree is placed in world coordinates), including objects added to it later (they start at the identity too). */
export function freezeSubtree<T extends THREE.Object3D>(root: T): T {
  root.updateMatrixWorld(true);
  root.traverse(o => { o.matrixAutoUpdate = false; o.matrixWorldNeedsUpdate = false; });
  root.updateMatrixWorld = () => {};
  return root;
}

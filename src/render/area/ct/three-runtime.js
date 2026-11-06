/* Shared three r187 namespace for the controller port.
   Huge world files stay plain ESM (not checkJs). This module is the upgrade seam:
   GLTFLoader and SkeletonUtils from three/addons, mergeGeometries aliased over
   the removed mergeBufferGeometries name, and a mutable THREE object so the
   ported scripts can still say THREE.GLTFLoader.
*/
import * as THREE_NS from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const extras = {
  GLTFLoader,
  SkeletonUtils: { clone: cloneSkeleton },
  BufferGeometryUtils: {
    mergeGeometries,
    mergeBufferGeometries: mergeGeometries,
  },
};

/** @type {typeof THREE_NS & typeof extras} */
export const THREE = new Proxy(THREE_NS, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(extras, prop)) {
      return extras[prop];
    }
    return Reflect.get(target, prop, receiver);
  },
});

export { mergeGeometries };

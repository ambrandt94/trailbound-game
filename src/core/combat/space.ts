/**
 * Camera-relative movement, the same stick the town motor uses.
 * `ix` is strafe (D is positive). `iz` is forward (W is positive).
 * Yaw is degrees, matching `camYaw` on the area camera.
 */
export function cameraWish(ix: number, iz: number, camYawDeg: number): { x: number; z: number } {
  const th = (camYawDeg * Math.PI) / 180;
  let x = Math.cos(th) * ix - Math.sin(th) * iz;
  let z = -Math.sin(th) * ix - Math.cos(th) * iz;
  const mag = Math.hypot(x, z);
  if (mag > 1) {
    x /= mag;
    z /= mag;
  }
  return { x, z };
}

export interface FollowCamera {
  x: number;
  y: number;
  z: number;
  lookY: number;
}

/**
 * Third-person follow placement used by the town camera.
 * Pitch and yaw are degrees. The look point sits `lookHeight` metres
 * above the target, and the lens does not drop through the floor.
 */
export function followCamera(
  target: { x: number; y: number; z: number },
  yawDeg: number,
  pitchDeg: number,
  dist: number,
  lookHeight: number,
): FollowCamera {
  const pitch = (pitchDeg * Math.PI) / 180;
  const yaw = (yawDeg * Math.PI) / 180;
  const lift = target.y + lookHeight + Math.sin(pitch) * dist;
  return {
    x: target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    y: Math.max(0.4, lift),
    z: target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    lookY: target.y + lookHeight,
  };
}

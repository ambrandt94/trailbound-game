/* Settlement walls from AreaExport segments[]. One instanced run per kit,
   following the ground height. Gate gaps are already missing from the polyline. */
(function () {
  function localOf(x, y, origin, meters) {
    const m = meters || 1;
    const ox = origin && origin.x ? origin.x : 0;
    const oy = origin && origin.y ? origin.y : 0;
    return { x: (x - ox) * m, z: (y - oy) * m };
  }

  /* Local +X (the kit's long side) follows the wall. Three.js yaw sends +X to (cos θ, -sin θ). */
  function wallYaw(dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    return Math.atan2(-dy / len, dx / len);
  }

  function place(parent, groundY, payload, meters) {
    if (!parent || typeof THREE === 'undefined') return null;
    const segments = (payload && payload.segments) || [];
    if (!segments.length || !window.TBProps || !TBProps.specOf || !TBProps.partsFor) return null;
    const origin = (payload.area && payload.area.innerOrigin) || { x: 0, y: 0 };
    const bins = {};
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s];
      if (!segment || !segment.points || segment.points.length < 2) continue;
      const kit = segment.kit;
      const spec = TBProps.specOf(kit);
      if (!spec) continue;
      const list = bins[kit] || (bins[kit] = []);
      const pts = segment.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (!(len > 0.35)) continue;
        const yaw = wallYaw(dx, dy);
        let cursor = 0;
        const span = Math.max(1.25, spec.w || 3);
        while (cursor < len - 0.2) {
          let step = span;
          const t0 = cursor / len;
          const t1 = Math.min(1, (cursor + step) / len);
          const x0 = a[0] + dx * t0;
          const y0 = a[1] + dy * t0;
          const x1 = a[0] + dx * t1;
          const y1 = a[1] + dy * t1;
          const p0 = localOf(x0, y0, origin, meters);
          const p1 = localOf(x1, y1, origin, meters);
          const g0 = groundY ? groundY(p0.x, p0.z) || 0 : 0;
          const g1 = groundY ? groundY(p1.x, p1.z) || 0 : 0;
          if (Math.abs(g1 - g0) > 1.35 && step > 1.3) step *= 0.5;
          const t = Math.min(1, (cursor + step * 0.5) / len);
          const x = a[0] + dx * t;
          const y = a[1] + dy * t;
          const p = localOf(x, y, origin, meters);
          list.push({ x: p.x, z: p.z, yaw: yaw });
          cursor += step;
          if (list.length > 4000) break;
        }
      }
    }
    const kits = Object.keys(bins);
    if (!kits.length) return null;
    const group = new THREE.Group();
    group.name = 'tb-area-walls';
    const dummy = new THREE.Object3D();
    for (let k = 0; k < kits.length; k++) {
      const kit = kits[k];
      const spec = TBProps.specOf(kit);
      const parts = TBProps.partsFor(spec);
      const items = bins[kit];
      if (!spec || !parts || !items.length) continue;
      for (let pi = 0; pi < parts.length; pi++) {
        const pt = parts[pi];
        const mesh = new THREE.InstancedMesh(pt.geo, pt.mat, items.length);
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const y = groundY ? groundY(it.x, it.z) || 0 : 0;
          dummy.position.set(it.x, y, it.z);
          dummy.rotation.set(0, it.yaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = !!pt.solid;
        mesh.receiveShadow = !!pt.solid;
        mesh.frustumCulled = false;
        mesh.userData.tbWall = kit;
        if (!pt.solid) mesh.userData.surface = 1;
        group.add(mesh);
      }
    }
    parent.add(group);
    return group;
  }

  window.TBWalls = { place: place };
})();

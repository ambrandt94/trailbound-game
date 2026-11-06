import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { controllerExitToMap, exitFromCancel, exitFromPose } from '../../src/app/area-exit';
import { areaFromExport, townFixtureId } from '../../src/render/area/area-from-export';

test('walking past an edge reports that side and a position along it', () => {
  expect(exitFromPose(0, 0, 0, 8)).toBeNull();
  expect(exitFromPose(8.2, 0, 0.4, 8)).toEqual({ side: 'east', pos: 0.5, yaw: 0.4 });
  expect(exitFromPose(-9, 4, 1, 8)?.side).toBe('west');
  expect(exitFromPose(0, 9, 0, 8)?.side).toBe('south');
  expect(exitFromPose(0, -9, 0, 8)?.side).toBe('north');
});

test('a controller edge exit becomes a map side', () => {
  expect(
    controllerExitToMap(
      { side: 'E', pos: { x: 40, z: 10 }, yaw: 1.2 },
      { minX: 0, maxX: 100, minZ: 0, maxZ: 80 },
    ),
  ).toEqual({ side: 'east', pos: 0.125, yaw: 1.2 });
  expect(controllerExitToMap({ side: 'north', pos: 0.2, yaw: 0 })).toEqual({
    side: 'north',
    pos: 0.2,
    yaw: 0,
  });
});

test('veldcross v05 is an AreaExport and the default town fixture', () => {
  const raw = JSON.parse(readFileSync('tests/fixtures/area-veldcross-v05.json', 'utf8')) as unknown;
  const area = areaFromExport(raw);
  expect(area.type).toBe('trailbound.area');
  expect(area.version.startsWith('0.')).toBe(true);
  expect(area.grid.w).toBeGreaterThan(8);
  expect(area.area.innerOrigin).toBeTruthy();
  expect(townFixtureId('')).toBe('veldcross');
  expect(townFixtureId('?town=jadewild')).toBe('jadewild');
  expect(townFixtureId('hollowmere')).toBe('hollowmere');
  expect(() => areaFromExport({ type: 'nope' })).toThrow(/AreaExport/);
});

test('cancel leaves through the facing side and asks to restore the entry tile', () => {
  expect(exitFromCancel(0)).toEqual({ side: 'north', pos: 0.5, yaw: 0, cancel: true });
  expect(exitFromCancel(Math.PI / 2).side).toBe('east');
  expect(exitFromCancel(Math.PI).side).toBe('south');
  expect(exitFromCancel(-Math.PI / 2).side).toBe('west');
  expect(exitFromCancel(Math.PI).cancel).toBe(true);
});

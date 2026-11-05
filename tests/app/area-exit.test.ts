import { expect, test } from 'vitest';
import { exitFromCancel, exitFromPose } from '../../src/app/area-exit';

test('walking past an edge reports that side and a position along it', () => {
  expect(exitFromPose(0, 0, 0, 8)).toBeNull();
  expect(exitFromPose(8.2, 0, 0.4, 8)).toEqual({ side: 'east', pos: 0.5, yaw: 0.4 });
  expect(exitFromPose(-9, 4, 1, 8)?.side).toBe('west');
  expect(exitFromPose(0, 9, 0, 8)?.side).toBe('south');
  expect(exitFromPose(0, -9, 0, 8)?.side).toBe('north');
});

test('cancel leaves through the facing side at mid-edge', () => {
  expect(exitFromCancel(0)).toEqual({ side: 'north', pos: 0.5, yaw: 0 });
  expect(exitFromCancel(Math.PI / 2).side).toBe('east');
  expect(exitFromCancel(Math.PI).side).toBe('south');
  expect(exitFromCancel(-Math.PI / 2).side).toBe('west');
});

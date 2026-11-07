import { expect, test } from 'vitest';
import { clearAreaLeaveOverlay } from '../../src/render/area/leave-overlay';

test('clearing the area leave overlay removes the black fade', () => {
  const fade = document.createElement('div');
  fade.id = 'tb-leave-fade';
  fade.style.opacity = '1';
  fade.style.background = '#000';
  document.body.append(fade);
  const vig = document.createElement('div');
  vig.id = 'tb-leave-vig';
  vig.style.opacity = '0.8';
  document.body.append(vig);
  const card = document.createElement('div');
  card.id = 'tb-back-card';
  card.style.display = 'flex';
  document.body.append(card);

  clearAreaLeaveOverlay(document);

  expect(document.getElementById('tb-leave-fade')).toBeNull();
  expect(document.getElementById('tb-leave-vig')).toBeNull();
  expect(document.getElementById('tb-back-card')).toBeNull();
});

import { expect, test } from 'vitest';
import { placeBuildingLabels, type ScreenMark } from '../../src/render/map/building-labels';

const measure = () => ({ w: 108, h: 14 });

test('piled building marks at map zoom draw no labels', () => {
  const marks: ScreenMark[] = [];
  for (let i = 0; i < 30; i++) {
    marks.push({
      text: 'Home — Saltgate',
      x: 480 + (i % 6) * 3,
      y: 320 + Math.floor(i / 6) * 3,
    });
  }
  expect(placeBuildingLabels(marks, measure)).toEqual([]);
});

test('spread buildings keep one label and skip any that would overlap it', () => {
  const marks: ScreenMark[] = [
    { text: 'Home — Saltgate', x: 0, y: 0 },
    { text: 'Inn — Saltgate', x: 40, y: 0 },
    { text: 'Temple — Saltgate', x: 420, y: 0 },
    { text: 'Market — Saltgate', x: 420, y: 220 },
  ];
  const placed = placeBuildingLabels(marks, measure);
  expect(placed.map((label) => label.text)).toEqual([
    'Home — Saltgate',
    'Temple — Saltgate',
    'Market — Saltgate',
  ]);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      const overlaps = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      expect(overlaps).toBe(false);
    }
  }
});

test('a lone building still gets its label', () => {
  const placed = placeBuildingLabels([{ text: 'Home — Saltgate', x: 80, y: 90 }], measure);
  expect(placed).toHaveLength(1);
  expect(placed[0]?.text).toBe('Home — Saltgate');
});

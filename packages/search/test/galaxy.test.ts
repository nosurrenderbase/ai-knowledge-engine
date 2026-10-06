import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {layout, project, seeded} from '../src/galaxy.ts';

/** Two tight groups of random unit vectors around two far-apart centres. */
function clusters(n: number, d: number): Float32Array[] {
  const r = seeded(1);
  const centre = () => Float32Array.from({length: d}, () => r() - 0.5);
  const [a, b] = [centre(), centre()];
  return Array.from({length: n}, (_, i) => Float32Array.from(i < n / 2 ? a : b, x => x + (r() - 0.5) * 0.05));
}

describe('galaxy layout', () => {
  it('is deterministic for the same vectors', () => {
    const v = clusters(40, 64);
    assert.deepEqual(layout(v), layout(v));
    assert.deepEqual(seeded(3)(), seeded(3)());
    assert.equal(project(v, 8, seeded(2))[0].length, 8);
  });

  it('keeps similar chunks together: every point is nearer to its own group', () => {
    const xyz = layout(clusters(60, 128));
    const mean = (pts: number[][]) => [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length);
    const [ca, cb] = [mean(xyz.slice(0, 30)), mean(xyz.slice(30))];
    const d = (p: number[], c: number[]) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    xyz.forEach((p, i) => assert.ok(i < 30 ? d(p, ca) < d(p, cb) : d(p, cb) < d(p, ca), `nokta ${i}`));
    assert.ok(xyz.every(p => Math.hypot(...p) <= 1.0001), 'birim kürenin içinde');
  });
});

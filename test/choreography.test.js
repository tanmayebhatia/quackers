const { test } = require('node:test');
const assert = require('node:assert');

const choreography = require('../src/renderer/choreography');

test('sticky choreography moves through fetch, write, carry, stick, done in order', () => {
  const samples = [0, 0.7, 2.5, 3.4, 4.0].map((time) => choreography.stickyFrame(time));
  assert.deepEqual(samples.map((sample) => sample.phase), ['fetch', 'write', 'carry', 'stick', 'done']);
  assert.equal(samples[0].writeProgress, 0);
  assert.ok(samples[1].writeProgress > 0 && samples[1].writeProgress < 1);
  assert.equal(samples[2].writeProgress, 1);
  assert.equal(samples[4].done, true);
});

test('reduced-motion sticky choreography preserves semantic beats and finishes quickly', () => {
  assert.equal(choreography.stickyFrame(0, true).phase, 'write');
  assert.equal(choreography.stickyFrame(0.2, true).phase, 'stick');
  assert.equal(choreography.stickyFrame(0.4, true).phase, 'done');
  assert.equal(choreography.stickyFrame(0.4, true).done, true);
});

test('easing helpers clamp hostile values', () => {
  assert.equal(choreography.easeOutCubic(-99), 0);
  assert.equal(choreography.easeOutCubic(99), 1);
  assert.equal(choreography.easeInOutCubic(Number.NaN), 0);
});

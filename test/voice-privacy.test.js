const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'voice.js'), 'utf8');

test('microphone capture exists only on the explicit talk path', () => {
  const captures = source.match(/navigator\.mediaDevices\.getUserMedia\(/g) || [];
  assert.equal(captures.length, 1);
  assert.doesNotMatch(source, /function warmMic\b/);
  assert.doesNotMatch(source, /pointermove/);
  assert.doesNotMatch(source, /realtimePrewarm/);

  const start = source.indexOf('async function startSession');
  const stop = source.indexOf('function handleConnectionDrop', start);
  const talkPath = source.slice(start, stop);
  assert.ok(talkPath.indexOf('await window.quackers.keyStatus()') < talkPath.indexOf('navigator.mediaDevices.getUserMedia('));
});

test('hiding Quackers releases any live microphone tracks', () => {
  assert.match(source, /function stopForHide\(\)/);
  assert.match(source, /window\.quackers\.onDismiss\(stopForHide\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /micStream\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
});

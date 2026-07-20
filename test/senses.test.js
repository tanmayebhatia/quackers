// Unit tests for the pure parts of the ambient senses (no polling, no macOS).
const { test } = require('node:test');
const assert = require('node:assert');

const senses = require('../src/senses');

test('call-app detection: meeting apps yes, everything else no', () => {
  assert.equal(senses.isCallApp('zoom.us'), true);
  assert.equal(senses.isCallApp('FaceTime'), true);
  assert.equal(senses.isCallApp('Microsoft Teams'), true);
  assert.equal(senses.isCallApp('Webex'), true);
  assert.equal(senses.isCallApp('Figma'), false);
  assert.equal(senses.isCallApp('Google Chrome'), false);
  assert.equal(senses.isCallApp(''), false);
  assert.equal(senses.isCallApp(null), false);
});

test('ambient line: music and calls read naturally, empty snapshot stays silent', () => {
  assert.equal(senses.ambientLineFrom({}), '');
  const line = senses.ambientLineFrom({
    app: 'Figma',
    appMinutes: 45,
    onCall: false,
    music: { track: 'Weird Fishes', artist: 'Radiohead', app: 'Spotify' },
    battery: 80,
    charging: true,
  });
  assert.match(line, /Figma \(for 45 min straight\)/);
  assert.match(line, /"Weird Fishes" by Radiohead/);
  assert.ok(!line.includes('battery'), 'healthy battery stays out of the line');

  const callLine = senses.ambientLineFrom({ app: 'zoom.us', appMinutes: 5, onCall: true });
  assert.match(callLine, /on a call/);
});

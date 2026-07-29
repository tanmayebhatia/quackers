const { test } = require('node:test');
const assert = require('node:assert');

const safety = require('../src/trick-safety');
const frame = { size: { width: 1200, height: 800 } };

test('trick actions are schema- and bounds-checked before actuation', () => {
  assert.equal(safety.validateAction({ action: 'click', x: 20, y: 30, describe: 'click button' }, frame).ok, true);
  assert.equal(safety.validateAction({ action: 'click', x: 2000, y: 30 }, frame).ok, false);
  assert.equal(safety.validateAction({ action: 'type', text: '' }, frame).ok, false);
  assert.equal(safety.validateAction({ action: 'scroll', direction: 'sideways' }, frame).ok, false);
  assert.equal(safety.validateAction({ action: 'menu_item', app: 'Finder', menu: '', item: 'Empty Trash' }, frame).ok, false);
  assert.equal(safety.validateAction({ action: 'teleport' }, frame).ok, false);
});

test('risky actions are identified independently of the model flag', () => {
  assert.equal(safety.actionLooksRisky({ action: 'menu_item', item: 'Empty Trash' }), true);
  assert.equal(safety.actionLooksRisky({ action: 'click', describe: 'Confirm purchase' }), true);
  assert.equal(safety.actionLooksRisky({ action: 'key', key: 'return' }, {}, [{ action: 'type' }]), true);
  assert.equal(
    safety.actionLooksRisky(
      { action: 'key', key: 'return' },
      { steps: [{ what: 'send the message', risky: true }] }
    ),
    true
  );
  assert.equal(safety.actionLooksRisky({ action: 'click', describe: 'Open settings' }), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createTCMBankStructureIndex} = require('./tcmbank-structure-index.cjs');

test('bundled structure pool contains only TCMBank records with explicit herb relationships', () => {
  const index = createTCMBankStructureIndex();
  const data = index.load();
  assert.match(data.metadata.source, /^TCMBank /);
  assert.doesNotMatch(data.metadata.source, /^HERB\b|HERB ingredient/i);
  assert.ok(data.records.length > 1000);
  assert.ok(data.records.every(record => /^TCMBANKIN\d{6}$/.test(record.id)));
  assert.ok(data.records.every(record => Array.isArray(record.herbs) && record.herbs.length > 0));
  const quercetin = index.find('', 'quercetin');
  assert.ok(quercetin);
  assert.ok(quercetin.identifiers.length > 1, 'duplicate relation rows should be consolidated by structure');
  assert.equal(index.find(quercetin.identifiers.at(-1), ''), quercetin);
});

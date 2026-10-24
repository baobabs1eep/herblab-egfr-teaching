'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {describe, tanimoto} = require('./morgan.cjs');
const {screenSeed} = require('./candidate-policy.cjs');

test('Morgan ECFP4 produces 2048-bit fingerprints and stable Tanimoto values', async () => {
  const a = await describe('CC1=CC=CC=C1O');
  const b = await describe('CC1=CC=CC=C1O');
  const c = await describe('O');
  assert.equal(a.fingerprint.length, 256);
  assert.equal(tanimoto(a.fingerprint, b.fingerprint), 1);
  assert.ok(tanimoto(a.fingerprint, c.fingerprint) < 0.8);
  assert.match(a.method, /ECFP4/);
});

test('seed policy excludes water and very small auxiliary molecules', async () => {
  assert.deepEqual(screenSeed({name: 'water'}), {eligible: false, reason: '水或溶剂'});
  const ethanol = await describe('CCO');
  assert.equal(screenSeed({name: 'unknown'}, ethanol).eligible, false);
});

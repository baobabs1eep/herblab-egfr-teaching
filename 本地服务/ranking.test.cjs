const test = require('node:test');
const assert = require('node:assert/strict');
const ranking = require('../演示前端/ranking.js');

const NODE = 'synthetic-fixture';
function candidate(id, overrides = {}) { return { id, name: id, identity: { status: 'verified', source: NODE }, docking: { score: -8, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, filter: { status: 'pass', source: NODE, policy: 'filter-v1' }, ...overrides }; }
function data(candidates = [candidate('A')], metadata = {}) { return { metadata: { version: 'synthetic-v1', target: 'EGFR-L858R', protocol: 'dock-v1', filterPolicy: 'filter-v1', ...metadata }, candidates }; }

test('exports version 0.3 and only supported parameters', () => {
  assert.equal(ranking.VERSION, 'herblab-ranking-0.3.0');
  assert.deepEqual(ranking.settings({ bonus: 20, smoothing: 10 }), { strong: -12, weak: -4, minBase: 50 });
  assert.deepEqual(Object.keys(ranking.settings({ bonus: 20, smoothing: 10 })).sort(), ['minBase', 'strong', 'weak']);
});

test('missing literature does not block conventional matching ranking', () => {
  const result = ranking.compute(data([
    candidate('high', { docking: { score: -9, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' } }),
    candidate('low', { docking: { score: -7, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' } }),
  ]), { minBase: 0 });
  assert.deepEqual(result.conventional.map(r => r.id), ['high', 'low']);
  assert.equal(result.conventionalEligible, 2);
  assert.equal(result.rows.every(r => r.heat === null), true);
  assert.equal('cold' in result, false);
  assert.equal('surprisal' in result.rows[0], false);
});

test('incomplete match object cannot fall back to docking', () => {
  const result = ranking.compute(data([candidate('incomplete', { match: { score: null, source: '', target: 'EGFR-L858R', policy: 'match-v1' } })], { matchPolicy: 'match-v1' }));
  const row = result.rows[0];
  assert.equal(row.base, null); assert.equal(row.matchEligible, false); assert.equal(row.matchMethod, null); assert.equal(result.conventional.length, 0);
});

test('explicit and structured scores use target, policy, and weights', () => {
  const result = ranking.compute(data([
    candidate('explicit', { match: { score: 88, source: NODE, target: 'EGFR-L858R', policy: 'match-v1' } }),
    candidate('structured', { match: { score: null, source: NODE, target: 'EGFR-L858R', policy: 'match-v1', components: { structure: { value: 80, source: NODE }, channel: { value: 60, source: NODE }, affinity: { value: 40, source: NODE } } } }),
  ], { matchPolicy: 'match-v1', matchWeights: [2, 1, 1] }));
  assert.equal(result.rows.find(r => r.id === 'explicit').base, 88); assert.equal(result.rows.find(r => r.id === 'structured').base, 65);
  assert.deepEqual(result.matchingWeights, [0.5, 0.25, 0.25]); assert.deepEqual(result.conventional.map(r => r.id), ['explicit', 'structured']);
});

test('mismatched targets and filters are excluded without docking fallback', () => {
  const result = ranking.compute(data([
    candidate('bad-target', { match: { score: 99, source: NODE, target: 'EGFR-T790M', policy: 'match-v1' } }),
    candidate('bad-policy', { match: { score: 99, source: NODE, target: 'EGFR-L858R', policy: 'other' } }),
    candidate('filter-fail', { filter: { status: 'fail', source: NODE, policy: 'filter-v1' } }),
    candidate('filter-unknown', { filter: { status: 'unknown', source: NODE, policy: 'filter-v1' } }),
  ], { matchPolicy: 'match-v1' }));
  assert.equal(result.conventional.length, 0);
  for (const id of ['bad-target', 'bad-policy']) { const row = result.rows.find(r => r.id === id); assert.equal(row.base, null); assert.equal(row.matchEligible, false); }
  assert.equal(result.rows.find(r => r.id === 'filter-fail').status, '过滤未通过'); assert.equal(result.rows.find(r => r.id === 'filter-unknown').status, '待补数据');
});

test('docking is used only without a match object and minBase applies', () => {
  const result = ranking.compute(data([
    candidate('strong-docking', { docking: { score: -12, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' } }),
    candidate('weak-docking', { docking: { score: -4, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' } }),
  ]), { minBase: 60 });
  assert.equal(result.rows.find(r => r.id === 'strong-docking').base, 100); assert.equal(result.rows.find(r => r.id === 'weak-docking').base, 0);
  assert.equal(result.conventional.length, 1); assert.equal(result.rows.find(r => r.id === 'weak-docking').status, '低于基础门槛');
});

test('identity, filter, weights, and numeric fields remain validated', () => {
  assert.throws(() => ranking.validate(data([candidate('pending', { identity: { status: 'other', source: NODE } })])), /identity.status/);
  assert.throws(() => ranking.validate(data([candidate('bad-score', { match: { score: 'bad' } })])), /match.score/);
  assert.throws(() => ranking.compute(data([candidate('bad-weight')], { matchWeights: [1, 0, 1] })), /matchWeights/);
  assert.throws(() => ranking.compute(data([candidate('bad-weight')], { matchWeights: [1, 1] })), /matchWeights/);
});

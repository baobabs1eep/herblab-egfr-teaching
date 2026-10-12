const test = require('node:test');
const assert = require('node:assert/strict');
const ranking = require('../演示前端/evidence-ranking.js');

const base = (candidates) => ({ disease: '肺癌', version: 'evidence-v1', candidates });
const ev = (id, overrides = {}) => ({ id, kind: 'clinical', quality: 1, qualityBasis: 'controlled study', source: 'fixture', verified: true, diseaseRelevant: true, support: 'supports', ...overrides });
const candidate = (id, evidence = []) => ({ id, name: id, evidence });

test('exports fixed clinical evidence weights and version', () => {
  assert.equal(ranking.VERSION, 1);
  assert.deepEqual(ranking.WEIGHTS, { clinical: .35, animal: .25, cell: .20, computational: .15, review: .05 });
});

test('no evidence is pending and excluded from competition', () => {
  const result = ranking.compute(base([candidate('pending'), candidate('scored', [ev('e1')])]));
  assert.equal(result.rows[0].score, null);
  assert.equal(result.rows[0].rank, null);
  assert.deepEqual(result.ranking.map(row => row.id), ['scored']);
});

test('volume and repeated references cannot inflate a score', () => {
  const one = ranking.compute(base([candidate('one', [ev('e1')])]));
  const many = ranking.compute(base([candidate('many', [ev('e2'), ev('e3'), ev('e4')])]));
  assert.equal(one.rows[0].score, many.rows[0].score);
  const shared = ranking.compute(base([candidate('a', [ev('same')]), candidate('b', [ev('same')])]));
  assert.equal(shared.rows[0].score, shared.rows[1].score);
  const exact = ranking.compute(base([candidate('repeat', [ev('same'), ev('same')])]));
  assert.equal(exact.rows[0].evidence.total, 1);
  assert.throws(() => ranking.compute(base([candidate('conflict', [ev('same'), ev('same', { quality: 0.5 })])])), /conflicting duplicate/);
});

test('contradictory and unclear evidence is visible but does not add points', () => {
  const result = ranking.compute(base([candidate('mixed', [ev('support'), ev('contra', { support: 'contradicts', quality: 1 }), ev('unclear', { support: 'unclear', quality: 1 })])]));
  const row = result.rows[0];
  assert.equal(row.score, 35);
  assert.deepEqual(row.flags, { hasContradiction: true, hasUnclear: true });
  assert.equal(row.evidence.contradicts, 1);
});

test('only non-qualifying evidence remains pending, while quality zero is scoreable', () => {
  const result = ranking.compute(base([
    candidate('contradiction', [ev('c', { support: 'contradicts' })]),
    candidate('unverified', [ev('u', { verified: false })]),
    candidate('zero', [ev('z', { quality: 0 })]),
  ]));
  assert.equal(result.rows[0].score, null);
  assert.equal(result.rows[1].score, null);
  assert.equal(result.rows[2].score, 0);
});

test('invalid evidence kinds and quality values are rejected', () => {
  assert.throws(() => ranking.compute(base([candidate('bad', [ev('e', { kind: 'blog' })])])), /kind is invalid/);
  assert.throws(() => ranking.compute(base([candidate('bad', [ev('e', { quality: '1' })])])), /quality/);
  assert.throws(() => ranking.compute(base([candidate('bad', [ev('e', { quality: 2 })])])), /quality/);
  assert.throws(() => ranking.compute(base([candidate('bad', [ev('e', { qualityBasis: '' })])])), /qualityBasis/);
});

test('candidate and evidence record limits are enforced', () => {
  assert.throws(() => ranking.compute(base(Array.from({ length: 1001 }, (_, i) => candidate(`c${i}`)))), /1000/);
  assert.throws(() => ranking.compute(base([candidate('too-many', Array.from({ length: 101 }, (_, i) => ev(`e${i}`)))])), /100/);
});

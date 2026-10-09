const test = require('node:test');
const assert = require('node:assert/strict');
const ranking = require('../演示前端/ranking.js');

const NODE = 'synthetic-fixture';

function candidate(id, overrides = {}) {
  return {
    id,
    name: id,
    identity: { status: 'verified', source: NODE },
    docking: { score: -8, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' },
    filter: { status: 'pass', source: NODE, policy: 'filter-v1' },
    heat: { count: 10, query: 'synthetic query', source: NODE, date: '2026-09-26' },
    ...overrides,
  };
}

function data(candidates = [candidate('A')], metadata = {}) {
  return {
    metadata: {
      version: 'synthetic-v1',
      target: 'EGFR-L858R',
      protocol: 'dock-v1',
      filterPolicy: 'filter-v1',
      heatDefinition: 'synthetic count',
      heatDate: '2026-09-26',
      ...metadata,
    },
    candidates,
  };
}

test('exports compute, validate, and settings', () => {
  assert.equal(typeof ranking.compute, 'function');
  assert.equal(typeof ranking.validate, 'function');
  assert.equal(typeof ranking.settings, 'function');
});

test('incomplete real-shaped data is retained as excluded, with synthetic fixture only', () => {
  const result = ranking.compute(data([
    candidate('real-shaped-missing', {
      identity: { status: 'pending', source: NODE },
      docking: { score: null, source: '', protocol: '', target: '' },
      filter: { status: 'unknown', source: '', policy: '' },
      heat: { count: null, query: '', source: '', date: '' },
    }),
  ]));
  assert.equal(result.total, 1);
  assert.equal(result.eligible, 0);
  assert.equal(result.rows[0].status, '待补数据');
  assert.deepEqual(result.conventional, []);
  assert.deepEqual(result.cold, []);
});

test('cold ranking can reverse conventional ranking', () => {
  const result = ranking.compute(data([
    candidate('high-base', { docking: { score: -8.8, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 1000, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('low-base-cold', { docking: { score: -8.4, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 0, query: 'q', source: NODE, date: '2026-09-26' } }),
  ], {}), { minBase: 0 });
  assert.deepEqual(result.conventional.map(r => r.id), ['high-base', 'low-base-cold']);
  assert.deepEqual(result.cold.map(r => r.id), ['low-base-cold', 'high-base']);
  assert.deepEqual(result.cold.map(r => r.delta), [1, -1]);
});

test('missing heat stays conventional but is excluded from cold, and singleton zero has no artificial bonus', () => {
  const missing = ranking.compute(data([candidate('missing-count', { heat: { count: null, query: 'q', source: NODE, date: '2026-09-26' } })]));
  assert.equal(missing.rows[0].heat, null);
  assert.equal(missing.rows[0].novelty, null);
  assert.equal(missing.eligible, 0);
  assert.equal(missing.conventional.length, 1);
  assert.deepEqual(missing.rows[0].heatMissing.length > 0, true);

  const zero = ranking.compute(data([candidate('zero-count', { heat: { count: 0, query: 'q', source: NODE, date: '2026-09-26' } })]));
  assert.equal(zero.rows[0].novelty, 0);
  assert.equal(zero.rows[0].boost, 0);
  assert.equal(zero.rows[0].cold, zero.rows[0].base);
});

test('filter fail and unknown, plus pending identity, stay out of the queue', () => {
  const result = ranking.compute(data([
    candidate('filter-fail', { filter: { status: 'fail', source: NODE, policy: 'filter-v1' } }),
    candidate('filter-unknown', { filter: { status: 'unknown', source: NODE, policy: 'filter-v1' } }),
    candidate('identity-pending', { identity: { status: 'pending', source: NODE } }),
  ]));
  assert.equal(result.eligible, 0);
  assert.equal(result.rows.find(r => r.id === 'filter-fail').status, '过滤未通过');
  assert.equal(result.rows.find(r => r.id === 'filter-unknown').status, '待补数据');
  assert.equal(result.rows.find(r => r.id === 'identity-pending').status, '待补数据');
});

test('protocol, target, date, and filter policy mismatches exclude candidates', () => {
  const fields = [
    ['protocol', { docking: { score: -8, source: NODE, protocol: 'other', target: 'EGFR-L858R' } }],
    ['target', { docking: { score: -8, source: NODE, protocol: 'dock-v1', target: 'EGFR-T790M' } }],
    ['date', { heat: { count: 2, query: 'q', source: NODE, date: '2026-09-25' } }],
    ['policy', { filter: { status: 'pass', source: NODE, policy: 'other' } }],
  ];
  for (const [label, overrides] of fields) {
    const result = ranking.compute(data([candidate(label, overrides)]));
    assert.equal(result.eligible, 0, label);
    assert.equal(result.conventional.length, label === 'date' ? 1 : 0, label);
    assert.equal(result.rows[0].status, label === 'date' ? '可排序' : '待补数据', label);
  }
});

test('invalid numeric values and duplicate ids are rejected', () => {
  assert.throws(() => ranking.validate(data([candidate('bad-score', { docking: { score: 'bad', source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' } })])), /docking\.score/);
  assert.throws(() => ranking.validate(data([candidate('bad-count', { heat: { count: 1.5, query: 'q', source: NODE, date: '2026-09-26' } })])), /heat\.count/);
  assert.throws(() => ranking.validate(data([candidate('same'), candidate('same')])), /唯一 id/);
});

test('threshold excludes below-minimum rows and ties share a competition rank', () => {
  const result = ranking.compute(data([
    candidate('tie-b', { docking: { score: -8, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 10, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('tie-a', { docking: { score: -8, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 10, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('below', { docking: { score: -6, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' } }),
  ]));
  assert.deepEqual(result.conventional.map(r => r.id), ['tie-a', 'tie-b']);
  assert.deepEqual(result.conventional.map(r => r.rank), [1, 1]);
  assert.equal(result.rows.find(r => r.id === 'below').status, '低于基础门槛');
});

test('bonus zero makes conventional and cold order and ranks identical', () => {
  const result = ranking.compute(data([
    candidate('A', { docking: { score: -9, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 0, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('B', { docking: { score: -7, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 1000, query: 'q', source: NODE, date: '2026-09-26' } }),
  ], {}), { bonus: 0 });
  assert.deepEqual(result.conventional.map(r => r.id), result.cold.map(r => r.id));
  assert.deepEqual(result.conventional.map(r => r.rank), result.cold.map(r => r.rank));
});

test('explicit match score is used, and invalid target or source does not fall back to docking', () => {
  const meta = { matchPolicy: 'match-v1' };
  const result = ranking.compute(data([
    candidate('explicit', { match: { score: 88, source: NODE, target: 'EGFR-L858R', policy: 'match-v1' } }),
    candidate('bad-target', { match: { score: 99, source: NODE, target: 'other', policy: 'match-v1' } }),
    candidate('bad-source', { match: { score: 99, source: '', target: 'EGFR-L858R', policy: 'match-v1' } }),
  ], meta));
  assert.equal(result.rows.find(r => r.id === 'explicit').matchMethod, 'provided-score');
  assert.equal(result.rows.find(r => r.id === 'explicit').base, 88);
  for (const id of ['bad-target', 'bad-source']) {
    const row = result.rows.find(r => r.id === id);
    assert.equal(row.base, null);
    assert.equal(row.matchEligible, false);
    assert.equal(row.matchMissing.length > 0, true);
  }
});

test('null explicit score remains pending, while complete structured components produce weighted match', () => {
  const result = ranking.compute(data([
    candidate('pending', { match: { score: null, source: '', target: 'EGFR-L858R', policy: 'match-v1' } }),
    candidate('structured', { match: {
      score: null, source: NODE, target: 'EGFR-L858R', policy: 'match-v1',
      components: {
        structure: { value: 80, source: NODE },
        channel: { value: 60, source: NODE },
        affinity: { value: 40, source: NODE },
      },
    } }),
  ], { matchPolicy: 'match-v1', matchWeights: [2, 1, 1] }));
  const pending = result.rows.find(r => r.id === 'pending');
  const structured = result.rows.find(r => r.id === 'structured');
  assert.equal(pending.base, null);
  assert.equal(pending.matchEligible, false);
  assert.equal(structured.matchMethod, 'structured-components');
  assert.equal(structured.base, 65);
  assert.deepEqual(result.matchingWeights, [0.5, 0.25, 0.25]);
});

test('equal counts produce zero novelty and rare candidate cannot rescue below threshold', () => {
  const equal = ranking.compute(data([
    candidate('A', { heat: { count: 2, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('B', { heat: { count: 2, query: 'q', source: NODE, date: '2026-09-26' } }),
  ]));
  assert.deepEqual(equal.cold.map(r => r.novelty), [0, 0]);
  assert.deepEqual(equal.cold.map(r => r.boost), [0, 0]);
  const threshold = ranking.compute(data([
    candidate('rare-below', { docking: { score: -7, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 0, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('common', { docking: { score: -8, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: 1000, query: 'q', source: NODE, date: '2026-09-26' } }),
  ]));
  assert.equal(threshold.rows.find(r => r.id === 'rare-below').matchEligible, false);
  assert.equal(threshold.cold.some(r => r.id === 'rare-below'), false);
});

test('smoothing is finite and changes surprisal ordering without unstable ties', () => {
  assert.throws(() => ranking.settings({ smoothing: 0 }), /平滑项/);
  assert.throws(() => ranking.settings({ smoothing: 101 }), /平滑项/);
  const result = ranking.compute(data([
    candidate('zero', { heat: { count: 0, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('one', { heat: { count: 1, query: 'q', source: NODE, date: '2026-09-26' } }),
  ]), { smoothing: 100 });
  assert.equal(result.reference.smoothing, 100);
  assert.equal(result.rows.every(r => Number.isFinite(r.surprisal)), true);
  assert.deepEqual(result.cold.map(r => r.id), ['zero', 'one']);
});

test('rank movement compares only common heat-known pool', () => {
  const result = ranking.compute(data([
    candidate('unknown-first', { docking: { score: -12, source: NODE, protocol: 'dock-v1', target: 'EGFR-L858R' }, heat: { count: null } }),
    candidate('known'),
  ]));
  assert.equal(result.cold[0].firstRankOriginal, 2);
  assert.equal(result.cold[0].baselineRankInColdPool, 1);
  assert.equal(result.cold[0].delta, 0);
});

test('large component weights normalize safely and malformed weights are rejected', () => {
  const c = candidate('structured', { match: { score: null, source: NODE, target: 'EGFR-L858R', policy: 'match-v1', components: {
    structure: { value: 80, source: NODE }, channel: { value: 60, source: NODE }, affinity: { value: 40, source: NODE },
  } } });
  const result = ranking.compute(data([c], { matchPolicy: 'match-v1', matchWeights: [1e308, 1e308, 1e308] }));
  assert.equal(result.rows[0].base, 60);
  assert.throws(() => ranking.compute(data([c], { matchWeights: [1, 0, 1] })), /matchWeights/);
  assert.throws(() => ranking.compute(data([c], { matchWeights: [1, 1] })), /matchWeights/);
});

test('surprisal stays finite with tiny positive smoothing and safe integer counts', () => {
  const result = ranking.compute(data([
    candidate('rare', { heat: { count: 0, query: 'q', source: NODE, date: '2026-09-26' } }),
    candidate('popular', { heat: { count: Number.MAX_SAFE_INTEGER, query: 'q', source: NODE, date: '2026-09-26' } }),
  ]), { smoothing: Number.MIN_VALUE });
  assert.ok(result.cold.every(r => Number.isFinite(r.cold) && Number.isFinite(r.surprisal)));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createJournalMetricIndex, sortByJournalImpact} = require('./journal-metrics.cjs');

const index = createJournalMetricIndex({meta:{source:'测试表'},records:[
  {name:'Journal of Test Medicine',issns:['1234-567X'],jif:8.2,jifYear:2025,releaseYear:2026},
  {name:'Clinical Examples',issns:['9876-5432'],jif:3.1,jifYear:2025,releaseYear:2026}
]});

test('journal metrics match ISSN before normalized journal name', () => {
  assert.equal(index.match({journal:'Wrong title',issn:'1234-567X'}).matchedBy,'ISSN');
  assert.equal(index.match({journal:'Journal-of Test Medicine'}).jif,8.2);
  assert.equal(index.match({journal:'Unknown'}),null);
});

test('journal impact sorting puts unmatched records last and uses date as tie breaker', () => {
  const rows=index.enrich([
    {pmid:'1',journal:'Unknown',date:'2026-01-01'},
    {pmid:'2',journal:'Clinical Examples',date:'2025-01-01'},
    {pmid:'3',journal:'Journal of Test Medicine',date:'2024-01-01'},
    {pmid:'4',journal:'Clinical Examples',date:'2026-01-01'}
  ]);
  assert.deepEqual(sortByJournalImpact(rows).map(x=>x.pmid),['3','4','2','1']);
});

/* Evidence-only teaching heuristic. Browser and Node share this implementation. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EvidenceRanking = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const WEIGHTS = Object.freeze({ clinical: 0.35, animal: 0.25, cell: 0.20, computational: 0.15, review: 0.05 });
  const KINDS = Object.freeze(Object.keys(WEIGHTS));
  const SUPPORT = new Set(['supports', 'contradicts', 'unclear']);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const finite = value => typeof value === 'number' && Number.isFinite(value);

  function validate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('data is required');
    if (!text(data.disease) || !text(data.version) || !Array.isArray(data.candidates)) throw new Error('disease, version, and candidates are required');
    if (data.candidates.length > 1000) throw new Error('at most 1000 candidates are allowed');
    const candidateIds = new Set();
    for (const candidate of data.candidates) {
      if (!candidate || typeof candidate !== 'object' || !text(candidate.id) || !text(candidate.name)) throw new Error('candidate id and name are required');
      if (candidateIds.has(candidate.id)) throw new Error(`duplicate candidate id: ${candidate.id}`);
      candidateIds.add(candidate.id);
      if (candidate.evidence == null) continue;
      if (!Array.isArray(candidate.evidence)) throw new Error(`${candidate.id}.evidence must be an array`);
      if (candidate.evidence.length > 100) throw new Error(`${candidate.id}.evidence has at most 100 records`);
      const localIds = new Set();
      const localRecords = new Map();
      for (const item of candidate.evidence) {
        if (!item || typeof item !== 'object' || !text(item.id)) throw new Error(`${candidate.id} evidence id is required`);
        if (localIds.has(item.id)) {
          const prior = localRecords.get(item.id);
          const same = ['kind', 'quality', 'qualityBasis', 'source', 'verified', 'diseaseRelevant', 'support'].every(key => prior[key] === item[key]);
          if (!same) throw new Error(`conflicting duplicate evidence id: ${item.id}`);
          continue;
        }
        localIds.add(item.id);
        localRecords.set(item.id, item);
        if (!KINDS.includes(item.kind)) throw new Error(`${item.id}.kind is invalid`);
        if (!finite(item.quality) || item.quality < 0 || item.quality > 1) throw new Error(`${item.id}.quality must be a number from 0 to 1`);
        if (!text(item.qualityBasis)) throw new Error(`${item.id}.qualityBasis is required`);
        if (typeof item.verified !== 'boolean' || typeof item.diseaseRelevant !== 'boolean') throw new Error(`${item.id} verification annotations are required`);
        if (!text(item.source)) throw new Error(`${item.id}.source is required`);
        if (!SUPPORT.has(item.support)) throw new Error(`${item.id}.support is invalid`);
      }
    }
    return data;
  }

  function rankRows(rows) {
    const eligible = rows.filter(row => row.score !== null).slice().sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let previous = null;
    let rank = 0;
    eligible.forEach((row, index) => {
      if (previous === null || row.score !== previous) rank = index + 1;
      previous = row.score;
      row.rank = rank;
    });
    rows.forEach(row => { if (row.score === null) row.rank = null; });
    return eligible;
  }

  function compute(data) {
    validate(data);
    const rows = data.candidates.map(candidate => {
      const unique = [];
      const seen = new Set();
      for (const item of candidate.evidence || []) {
        if (!seen.has(item.id)) { seen.add(item.id); unique.push(item); }
      }
      const maxByKind = {};
      const qualifying = unique.filter(item => item.verified && item.diseaseRelevant && text(item.source) && item.support === 'supports');
      for (const kind of KINDS) {
        const values = qualifying.filter(item => item.kind === kind).map(item => item.quality);
        maxByKind[kind] = values.length ? Math.max(...values) : 0;
      }
      const hasQualifyingSupport = qualifying.length > 0;
      const score = hasQualifyingSupport ? KINDS.reduce((sum, kind) => sum + WEIGHTS[kind] * maxByKind[kind], 0) * 100 : null;
      const counts = { total: unique.length, verifiedSupports: qualifying.length, contradicts: unique.filter(item => item.support === 'contradicts').length, unclear: unique.filter(item => item.support === 'unclear').length };
      return { id: candidate.id, name: candidate.name, score, rank: null, status: hasQualifyingSupport ? 'scored' : 'pending', pending: !hasQualifyingSupport, maxByKind, evidence: counts, flags: { hasContradiction: counts.contradicts > 0, hasUnclear: counts.unclear > 0 } };
    });
    const ranking = rankRows(rows);
    return { version: data.version, engineVersion: VERSION, disease: data.disease, weights: { ...WEIGHTS }, rows, ranking, policy: 'Heuristic teaching score; not clinically validated. Fixed denominator; missing evidence is not renormalized.' };
  }

  return { VERSION, WEIGHTS, KINDS, validate, compute };
}));

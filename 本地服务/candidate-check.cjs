'use strict';

const MISSING = '查询服务未提供';

function errorSummary(error) {
  if (error instanceof Error) return { name: error.name || 'Error', message: error.message || String(error) };
  if (error && typeof error === 'object') {
    return { name: String(error.name || 'Error'), message: String(error.message || error.error || error) };
  }
  return { name: 'Error', message: String(error) };
}

function safeText(value, max = 240) {
  if (value == null) return value;
  const text = typeof value === 'string' ? value : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function summarizeRecord(record) {
  if (record == null || typeof record !== 'object') return safeText(record);
  const summary = {};
  for (const key of ['pmid', 'title', 'name', 'identifier', 'accession', 'id', 'moleculeId', 'cid', 'url', 'source', 'date', 'journal', 'query', 'status']) {
    if (record[key] != null) summary[key] = safeText(record[key]);
  }
  return summary;
}

function summarizeRecords(value) {
  const records = Array.isArray(value) ? value : Array.isArray(value?.records) ? value.records : [];
  return records.slice(0, 3).map(summarizeRecord);
}

function settledResult(result) {
  if (result.status === 'fulfilled') return { status: 'ok', data: result.value };
  return { status: 'error', error: errorSummary(result.reason) };
}

function validTarget(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(value.trim());
}

function createCandidateChecker({ research, sources } = {}) {
  if (!research || !sources) throw new TypeError('research and sources services are required');
  const invoke = (service, method, ...args) => Promise.resolve().then(() => {
    if (typeof service[method] !== 'function') throw new Error(`${method}: ${MISSING}`);
    return service[method](...args);
  });

  async function check(input = {}) {
    const candidate = input.candidate;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError('candidate is required');
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    if (!name) throw new TypeError('candidate.name is required');

    const target = typeof input.target === 'string' ? input.target.trim() : input.target;
    const targetRequested = validTarget(target);
    const jobs = [
      invoke(research, 'compound', name),
      invoke(research, 'naturalProduct', name),
      invoke(sources, 'molecule', name),
    ];
    if (targetRequested) jobs.push(invoke(sources, 'target', target));
    const results = await Promise.allSettled(jobs);
    const pubchem = settledResult(results[0]);
    const coconut = settledResult(results[1]);
    const chembl = settledResult(results[2]);
    const targetResult = targetRequested ? settledResult(results[3]) : { status: 'not_requested' };

    return {
      schemaVersion: 1,
      candidate: { ...candidate },
      identity: { pubchem, coconut, chembl },
      target: targetResult,
      provenance: {
        disease: input.disease ?? '',
        query: input.query ?? '',
        retrievedAt: input.retrievedAt ?? null,
        checkedAt: new Date().toISOString(),
        records: summarizeRecords(input.records),
      },
      readiness: {
        status: 'pending_data',
        missing: ['同协议对接', '热度', '过滤规则与性质'],
        canRank: false,
      },
      reviewRequired: true,
    };
  }

  return { check };
}

module.exports = { createCandidateChecker, summarizeRecords, validTarget };

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

function suggestedTargets(tcmbankResult, diseaseResult) {
  const ingredientRecords = tcmbankResult?.records || [];
  const ingredientTargets = ingredientRecords.flatMap(record => (record.targets || []).map(target => ({ ...target, ingredientId: record.identifier, ingredientName: record.name })));
  const diseaseTargets = diseaseResult?.records || [];
  const diseaseByGene = new Map(diseaseTargets.map(target => [String(target.gene || '').toUpperCase(), target]));
  const found = new Map();
  for (const target of ingredientTargets) {
    const gene = String(target.gene || '').toUpperCase();
    if (!gene || found.has(gene)) continue;
    const disease = diseaseByGene.get(gene);
    found.set(gene, { ...target, gene, evidence: disease ? '成分与疾病共同关联' : '成分关联', diseaseAssociated: Boolean(disease), diseaseReference: disease?.reference || '' });
  }
  for (const target of diseaseTargets) {
    const gene = String(target.gene || '').toUpperCase();
    if (!gene || found.has(gene)) continue;
    found.set(gene, { ...target, gene, evidence: '疾病关联', diseaseAssociated: true });
  }
  return [...found.values()].sort((a, b) => Number(b.diseaseAssociated) - Number(a.diseaseAssociated) || a.gene.localeCompare(b.gene)).slice(0, 20);
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
      invoke(sources, 'ingredient', name),
    ];
    if (targetRequested) jobs.push(invoke(sources, 'target', target));
    const disease = typeof input.disease === 'string' ? input.disease.trim() : '';
    if (disease) jobs.push(invoke(sources, 'diseaseTargets', disease));
    const results = await Promise.allSettled(jobs);
    const pubchem = settledResult(results[0]);
    const coconut = settledResult(results[1]);
    const tcmbank = settledResult(results[2]);
    const targetResult = targetRequested ? settledResult(results[3]) : { status: 'not_requested' };
    const diseaseIndex = targetRequested ? 4 : 3;
    const diseaseTargetResult = disease ? settledResult(results[diseaseIndex]) : { status: 'not_requested' };
    const suggestions = suggestedTargets(tcmbank.data, diseaseTargetResult.data);

    return {
      schemaVersion: 1,
      candidate: { ...candidate },
      identity: { pubchem, coconut, tcmbank },
      target: targetResult,
      diseaseTargets: diseaseTargetResult,
      suggestedTargets: suggestions,
      provenance: {
        disease: input.disease ?? '',
        query: input.query ?? '',
        retrievedAt: input.retrievedAt ?? null,
        checkedAt: new Date().toISOString(),
        records: summarizeRecords(input.records),
      },
      readiness: {
        status: 'pending_data',
        missing: ['靶点作用方向与实验验证', '过滤规则与性质'],
        canRank: false,
      },
      reviewRequired: true,
    };
  }

  return { check };
}

module.exports = { createCandidateChecker, summarizeRecords, validTarget, suggestedTargets };

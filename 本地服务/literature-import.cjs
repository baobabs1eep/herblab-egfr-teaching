'use strict';

const fs = require('node:fs');

class LiteratureImportError extends Error {
  constructor(message) { super(message); this.name = 'LiteratureImportError'; this.statusCode = 400; }
}

const topKeys = new Set(['schemaVersion', 'caseId', 'disease', 'records', 'candidates', 'source', 'retrievedAt', 'query', 'warnings', 'total', 'identityChecks']);
const recordKeys = new Set(['pmid', 'title', 'journal', 'date', 'doi', 'url', 'abstract', 'teachingEvidenceType', 'teachingQuestions']);
const candidateKeys = new Set(['name', 'identifier', 'source', 'pmids', 'excerpts', 'status']);
const diseaseKeys = new Set(['label', 'term']);
const MAX_TEXT = 500;

function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, name, max = MAX_TEXT, required = false) {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw new LiteratureImportError(`${name} 格式不正确。`);
  return value.trim();
}
function rejectUnknown(value, allowed, name) {
  if (!plain(value)) throw new LiteratureImportError(`${name} 格式不正确。`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) delete value[key];
}
function pmid(value, name = 'pmid') {
  const valueText = text(value, name, 12, true);
  if (!/^\d{1,12}$/.test(valueText)) throw new LiteratureImportError(`${name} 必须是数字 PMID。`);
  return valueText;
}
function pubmedUrl(id, value) {
  if (value == null || value === '') return `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
  const candidate = text(value, 'url', 300, true);
  let parsed;
  try { parsed = new URL(candidate); } catch { throw new LiteratureImportError('url 必须是 HTTPS 地址。'); }
  if (parsed.protocol !== 'https:') throw new LiteratureImportError('url 必须是 HTTPS 地址。');
  const hostname = parsed.hostname.toLowerCase();
  const allowed = new Set(['pubmed.ncbi.nlm.nih.gov', 'europepmc.org', 'doi.org', 'dx.doi.org']);
  if (!allowed.has(hostname)) throw new LiteratureImportError('url 只能指向受支持的文献来源。');
  return hostname === 'pubmed.ncbi.nlm.nih.gov' ? `https://pubmed.ncbi.nlm.nih.gov/${id}/` : parsed.href;
}
function cleanRecord(input, seen, teaching = false) {
  if (!plain(input)) throw new LiteratureImportError('records 中包含无效记录。');
  rejectUnknown(input, recordKeys, 'record');
  const id = pmid(input.pmid);
  if (seen.has(id)) throw new LiteratureImportError(`重复 PMID：${id}。`);
  seen.add(id);
  const out = {
    pmid: id,
    title: text(input.title, 'title', 500, true),
    journal: text(input.journal ?? '', 'journal', 250),
    date: text(input.date ?? '', 'date', 120),
    doi: text(input.doi ?? '', 'doi', 300),
    url: pubmedUrl(id, input.url),
    abstract: text(input.abstract ?? '', 'abstract', 1500),
  };
  if (teaching && input.teachingEvidenceType !== undefined) out.teachingEvidenceType = text(input.teachingEvidenceType, 'teachingEvidenceType', 120);
  if (teaching && input.teachingQuestions !== undefined) {
    if (!Array.isArray(input.teachingQuestions) || input.teachingQuestions.length > 12) throw new LiteratureImportError('teachingQuestions 格式不正确。');
    out.teachingQuestions = input.teachingQuestions.map(x => text(x, 'teachingQuestions', 300, true));
  }
  return out;
}
function cleanCandidate(input, known, teaching = false) {
  if (!plain(input)) throw new LiteratureImportError('candidates 中包含无效候选。');
  rejectUnknown(input, candidateKeys, 'candidate');
  const out = { name: text(input.name, 'candidate.name', 200, true), identifier: text(input.identifier ?? '', 'candidate.identifier', 200), source: text(input.source ?? '', 'candidate.source', 300) };
  if (!Array.isArray(input.pmids) || input.pmids.length > 8) throw new LiteratureImportError('candidate.pmids 格式不正确。');
  out.pmids = input.pmids.map(x => pmid(x, 'candidate.pmids')).filter((x, i, a) => a.indexOf(x) === i);
  if (out.pmids.some(x => !known.has(x))) throw new LiteratureImportError('candidate.pmids 必须引用已有记录。');
  if (input.excerpts !== undefined) {
    if (!Array.isArray(input.excerpts) || input.excerpts.length > 8) throw new LiteratureImportError('candidate.excerpts 格式不正确。');
    out.excerpts = input.excerpts.map(x => text(x, 'candidate.excerpts', 500, true));
  } else out.excerpts = [];
  if (teaching && input.status !== undefined) out.status = text(input.status, 'candidate.status', 100);
  if (!teaching) out.status = 'manual (unverified)';
  return out;
}
function cleanTrustedChecks(value) {
  if (!plain(value) || Object.keys(value).length > 20) throw new LiteratureImportError('identityChecks 格式不正确。');
  const out = {};
  for (const [index, check] of Object.entries(value)) {
    if (!/^\d{1,2}$/.test(index) || !plain(check)) throw new LiteratureImportError('identityChecks 格式不正确。');
    const raw = JSON.stringify(check);
    if (raw.length > 30000) throw new LiteratureImportError('identityChecks 内容过长。');
    const scrub = item => {
      if (Array.isArray(item)) return item.slice(0, 20).map(scrub);
      if (!plain(item)) return typeof item === 'string' ? item.slice(0, 1500) : item;
      const result = {};
      for (const [key, nested] of Object.entries(item)) {
        if (/password|secret|token|authorization|api[_-]?key/i.test(key)) continue;
        result[key] = scrub(nested);
      }
      return result;
    };
    out[index] = scrub(check);
  }
  return out;
}
function normalize(input, { teaching = false } = {}) {
  if (!plain(input)) throw new LiteratureImportError('研究资料必须是 JSON 对象。');
  rejectUnknown(input, topKeys, 'research');
  if (!plain(input.disease)) throw new LiteratureImportError('disease 格式不正确。');
  rejectUnknown(input.disease, diseaseKeys, 'disease');
  const disease = { label: text(input.disease.label, 'disease.label', 200, true), term: text(input.disease.term, 'disease.term', 200, true) };
  if (!Array.isArray(input.records) || input.records.length > 50) throw new LiteratureImportError('records 数量必须为 0 至 50。');
  const seen = new Set();
  const records = input.records.map(x => cleanRecord(x, seen, teaching));
  if (!Array.isArray(input.candidates) || input.candidates.length > 20) throw new LiteratureImportError('candidates 数量必须为 0 至 20。');
  const candidates = input.candidates.map(x => cleanCandidate(x, seen, teaching));
  const out = {
    disease,
    records,
    candidates,
    source: text(input.source, 'source', 300, true),
    retrievedAt: text(input.retrievedAt, 'retrievedAt', 80, true),
    query: text(input.query ?? '', 'query', 500),
    warnings: [],
    total: records.length,
  };
  if (Number.isNaN(Date.parse(out.retrievedAt))) throw new LiteratureImportError('retrievedAt 必须是有效时间。');
  if (input.warnings !== undefined) {
    if (!Array.isArray(input.warnings) || input.warnings.length > 20) throw new LiteratureImportError('warnings 格式不正确。');
    out.warnings = input.warnings.map(x => text(x, 'warnings', 500, true));
  }
  if (teaching) {
    out.schemaVersion = Number.isInteger(input.schemaVersion) ? input.schemaVersion : 1;
    if (input.caseId !== undefined) out.caseId = text(input.caseId, 'caseId', 120, true);
    if (input.identityChecks !== undefined) out.identityChecks = cleanTrustedChecks(input.identityChecks);
  } else {
    out.source = `manual (unverified): ${out.source}`;
    out.warnings.unshift('资料由用户手动导入，未经本地服务核验；摘要仅供教学参考，请回到原文确认。');
  }
  return out;
}
function validateResearchImport(input) { return normalize(input); }
function loadTeachingCase(filePath) {
  let value;
  try { value = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { throw new Error('教学案例文件无法读取。'); }
  return normalize(value, { teaching: true });
}

module.exports = { LiteratureImportError, validateResearchImport, loadTeachingCase };

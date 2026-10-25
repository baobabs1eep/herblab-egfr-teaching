'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DATA_PATH = path.join(__dirname, 'data', 'journal-metrics.json');

function normalizeIssn(value) {
  const compact = String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
  return compact.length === 8 ? compact : '';
}

function normalizeJournalName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function metricValue(record) {
  const value = Number(record?.journalMetric?.jif);
  return Number.isFinite(value) ? value : null;
}

function publicationTime(record) {
  const parsed = Date.parse(String(record?.date || ''));
  if (Number.isFinite(parsed)) return parsed;
  const year = Number(String(record?.date || '').match(/\b(18|19|20)\d{2}\b/)?.[0]);
  return Number.isFinite(year) ? Date.UTC(year, 0, 1) : 0;
}

function sortByJournalImpact(records) {
  return [...(records || [])].sort((a, b) => {
    const left = metricValue(a), right = metricValue(b);
    if (left == null && right != null) return 1;
    if (left != null && right == null) return -1;
    if (left != null && right != null && left !== right) return right - left;
    const time = publicationTime(b) - publicationTime(a);
    return time || String(a.pmid || '').localeCompare(String(b.pmid || ''));
  });
}

function createJournalMetricIndex(data = {}) {
  const rows = Array.isArray(data) ? data : (Array.isArray(data.records) ? data.records : []);
  const meta = !Array.isArray(data) && data.meta && typeof data.meta === 'object' ? data.meta : {};
  const byIssn = new Map(), byName = new Map();
  for (const row of rows) {
    const jif = Number(row?.jif);
    if (!row || !row.name || !Number.isFinite(jif)) continue;
    const metric = {
      journal: String(row.name),
      jif,
      jifYear: Number(row.jifYear) || null,
      releaseYear: Number(row.releaseYear) || null,
      source: String(meta.source || row.source || '本地期刊指标表')
    };
    for (const raw of [...(Array.isArray(row.issns) ? row.issns : []), row.issn, row.eissn]) {
      const issn = normalizeIssn(raw);
      if (issn && !byIssn.has(issn)) byIssn.set(issn, metric);
    }
    const name = normalizeJournalName(row.name);
    if (name && !byName.has(name)) byName.set(name, metric);
  }
  function match(record = {}) {
    const issns = [record.issn, record.eissn, ...(Array.isArray(record.issns) ? record.issns : [])]
      .map(normalizeIssn).filter(Boolean);
    for (const issn of issns) {
      const metric = byIssn.get(issn);
      if (metric) return {...metric, matchedBy: 'ISSN'};
    }
    const name = normalizeJournalName(record.journal);
    const metric = name && byName.get(name);
    return metric ? {...metric, matchedBy: '期刊名称'} : null;
  }
  function enrich(records = []) {
    return records.map(record => ({...record, journalMetric: match(record)}));
  }
  return {match, enrich, meta, size: rows.length};
}

function loadDefaultJournalMetrics() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return createJournalMetricIndex(data);
  } catch (error) {
    return createJournalMetricIndex({meta:{warning:`期刊指标表未加载：${error.message}`},records:[]});
  }
}

const defaultJournalMetrics = loadDefaultJournalMetrics();

module.exports = {
  DATA_PATH,
  normalizeIssn,
  normalizeJournalName,
  sortByJournalImpact,
  createJournalMetricIndex,
  defaultJournalMetrics
};

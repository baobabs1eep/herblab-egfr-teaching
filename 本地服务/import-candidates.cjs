#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SOURCES = {
  TCMSP: new Set(['old.tcmsp-e.com', 'tcmsp-e.com']),
  HERB: new Set(['herb.ac.cn']),
};

function usage() {
  return '用法: node import-candidates.cjs input.json output.json --source TCMSP|HERB --version string --source-url https://官方域名/... --retrieved-at ISO时间';
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  if (argv.length < 2) fail(usage());
  const options = { input: argv[0], output: argv[1] };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) fail(`缺少参数值: ${key || '(空)'}`);
    const name = key.slice(2);
    if (!['source', 'version', 'source-url', 'retrieved-at'].includes(name)) {
      fail(`未知参数: ${key}`);
    }
    options[name] = argv[++i];
  }
  for (const name of ['source', 'version', 'source-url', 'retrieved-at']) {
    if (!options[name]) fail(`缺少必填参数: --${name}`);
  }
  options.source = options.source.toUpperCase();
  if (!SOURCES[options.source]) fail('--source 必须是 TCMSP 或 HERB');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(options['retrieved-at']) || Number.isNaN(Date.parse(options['retrieved-at']))) {
    fail('--retrieved-at 必须是 ISO 8601 时间');
  }
  let url;
  try { url = new URL(options['source-url']); } catch { fail('--source-url 必须是 HTTPS URL'); }
  if (url.protocol !== 'https:' || !SOURCES[options.source].has(url.hostname.toLowerCase())) {
    fail(`--source-url 必须使用 ${options.source} 官方 HTTPS 域名`);
  }
  return options;
}

function readRecords(inputPath) {
  const raw = fs.readFileSync(inputPath);
  const text = raw.toString('utf8');
  if (/^\s*</.test(text) || /<\/?html(?:\s|>)/i.test(text)) {
    fail('输入文件看起来是 HTML，不接受网页错误页或文件名作为数据；仅支持 JSON');
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (error) {
    fail(`输入文件不是有效 JSON: ${error.message}`);
  }
  const records = Array.isArray(parsed) ? parsed : parsed && parsed.records;
  if (!Array.isArray(records)) fail('JSON 必须是裸数组或包含 records 数组的对象');
  return { raw, records };
}

function normalizeRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`records[${index}] 必须是对象`);
  const candidateId = typeof record.candidateId === 'string' ? record.candidateId.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!candidateId) fail(`records[${index}].candidateId 必须是非空字符串`);
  if (!name) fail(`records[${index}].name 必须是非空字符串`);
  const nullableString = (key) => record[key] == null ? null : (typeof record[key] === 'string' ? record[key] : fail(`records[${index}].${key} 必须是字符串或 null`));
  const nullableArray = (key) => record[key] == null ? null : (Array.isArray(record[key]) ? record[key] : fail(`records[${index}].${key} 必须是数组或 null`));
  return {
    candidateId,
    name,
    smiles: nullableString('smiles'),
    sourceHerb: nullableString('sourceHerb'),
    targets: nullableArray('targets'),
    literatureIds: nullableArray('literatureIds'),
  };
}

function importCandidates({ inputPath, outputPath, source, version, sourceUrl, retrievedAt, now = new Date().toISOString() }) {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  if (input === output) fail('输入和输出路径不能相同');
  if (fs.existsSync(output)) fail(`拒绝覆盖已有输出文件: ${outputPath}`);
  const { raw, records: sourceRecords } = readRecords(input);
  const records = sourceRecords.map(normalizeRecord);
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.candidateId)) fail(`发现重复 candidateId: ${record.candidateId}`);
    ids.add(record.candidateId);
  }
  const provenance = {
    inputsha256: crypto.createHash('sha256').update(raw).digest('hex'),
    source,
    sourceVersion: version,
    retrievedAt,
    rawUrl: sourceUrl,
    importedAt: now,
    validationStatus: 'needs_review',
  };
  fs.writeFileSync(output, `${JSON.stringify({ provenance, records }, null, 2)}\n`, 'utf8');
  return { provenance, records };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    importCandidates({
      inputPath: options.input,
      outputPath: options.output,
      source: options.source,
      version: options.version,
      sourceUrl: options['source-url'],
      retrievedAt: options['retrieved-at'],
    });
    process.stdout.write(`已导入候选记录到 ${options.output}\n`);
  } catch (error) {
    process.stderr.write(`导入失败: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { importCandidates, normalizeRecord, parseArgs, readRecords };

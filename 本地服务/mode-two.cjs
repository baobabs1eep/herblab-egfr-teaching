'use strict';

const {describe} = require('./morgan.cjs');
const {screenSeed} = require('./candidate-policy.cjs');
const {createTCMBankStructureIndex} = require('./tcmbank-structure-index.cjs');

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';
const STRUCTURE_THRESHOLD = 0.4;

class ModeTwoError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'ModeTwoError'; this.status = this.statusCode = status; }
}

function normalized(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function memberKey(item) { return item.inchiKey || item.identifier || normalized(item.name); }

function createModeTwoService({sources, index = createTCMBankStructureIndex(), fetchImpl = global.fetch} = {}) {
  if (!sources || typeof sources.ingredient !== 'function' || typeof sources.geneIngredients !== 'function') throw new TypeError('sources is required');

  async function pubchemIdentity(name) {
    const url = `${PUBCHEM}/name/${encodeURIComponent(name)}/property/ConnectivitySMILES,InChIKey,Title/JSON`;
    const response = await fetchImpl(url, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new ModeTwoError('PubChem 未找到可核验结构', response.status === 404 ? 404 : 502);
    const row = (await response.json())?.PropertyTable?.Properties?.[0];
    if (!row?.ConnectivitySMILES) throw new ModeTwoError('PubChem 未返回可计算结构', 404);
    return {name: String(row.Title || name), smiles: String(row.ConnectivitySMILES), inchiKey: String(row.InChIKey || ''), source: 'PubChem', sourceURL: url};
  }

  async function resolveSeed(candidate) {
    const name = String(candidate?.name || '').trim();
    const early = screenSeed(candidate);
    if (!early.eligible) return {excluded: early};
    let ingredient = null;
    let identity = null;
    const warnings = [];
    try {
      const search = await sources.ingredient(name);
      ingredient = search.records?.find(record => normalized(record.name) === normalized(name)) || null;
      if (!ingredient && search.records?.length) warnings.push(`TCMBank 未精确匹配“${name}”，已拒绝使用首条模糊记录“${search.records[0].name}”作为种子。`);
      if (ingredient?.identifier) {
        const details = await sources.ingredientDetail(ingredient.identifier);
        const detail = details.records?.[0];
        if (detail?.smiles) identity = {name: detail.name || ingredient.name || name, smiles: detail.smiles, inchiKey: '', identifier: ingredient.identifier, source: 'TCMBank'};
      }
    } catch (error) { warnings.push(`TCMBank 身份查询：${error.message}`); }
    if (!identity) {
      try { identity = await pubchemIdentity(name); }
      catch (error) { warnings.push(error.message); }
    }
    if (!identity) return {excluded: {eligible: false, reason: '未找到可核验的明确分子结构'}, warnings};
    const chemical = await describe(identity.smiles);
    const policy = screenSeed(candidate, chemical);
    if (!policy.eligible) return {excluded: policy, identity, warnings};
    return {candidate, identity: {...identity, smiles: chemical.canonicalSmiles}, chemical, ingredient, targets: ingredient?.targets || [], warnings};
  }

  async function buildGroup(candidate, {diseaseTargets = []} = {}) {
    const seed = await resolveSeed(candidate);
    if (seed.excluded) return {status: 'excluded', candidate, exclusion: seed.excluded, warnings: seed.warnings || []};
    const members = new Map();
    const seedName = normalized(seed.identity.name || candidate.name);
    const seedKey = seed.identity.inchiKey || '';
    for (const hit of index.similar(seed.chemical.fingerprint, STRUCTURE_THRESHOLD)) {
      if ((seedKey && hit.inchiKey === seedKey) || normalized(hit.name) === seedName) continue;
      members.set(memberKey(hit), {...hit, identifier: hit.id, sources: ['TCMBank 中药关联结构索引'], routes: ['structure'], targetRelevance: '结构上可能相关', targets: []});
    }
    const diseaseGenes = new Set(diseaseTargets.map(item => String(item.gene || '').toUpperCase()).filter(Boolean));
    for (const target of seed.targets) {
      if (!target.tcmbankId) continue;
      try {
        const related = await sources.geneIngredients(target.tcmbankId);
        for (const ingredient of related.records || []) {
          if (normalized(ingredient.name) === seedName || ingredient.identifier === seed.identity.identifier) continue;
          const strictRecord = typeof index.similarity === 'function' ? index.similarity(seed.chemical.fingerprint, ingredient.identifier, ingredient.name) : null;
          if (!strictRecord) continue;
          const existingEntry = [...members.entries()].find(([, item]) => (ingredient.identifier && (item.identifier === ingredient.identifier || item.identifiers?.includes(ingredient.identifier))) || normalized(item.name) === normalized(ingredient.name));
          const key = existingEntry?.[0] || memberKey(strictRecord);
          const old = existingEntry?.[1] || {...strictRecord, identifier: strictRecord.id, sources: [], routes: [], targetRelevance: '有报道', targets: []};
          old.sources = [...new Set([...old.sources, 'TCMBank gene/toingredients'])];
          old.routes = [...new Set([...old.routes, 'target'])];
          old.targetRelevance = '有报道';
          if (!old.targets.some(item => item.gene === target.gene)) old.targets.push({gene: target.gene, tcmbankId: target.tcmbankId, diseaseRelated: diseaseGenes.has(String(target.gene || '').toUpperCase()), reference: ingredient.reference || ''});
          members.set(key, old);
        }
      } catch (error) { seed.warnings.push(`${target.gene || target.tcmbankId} 反查失败：${error.message}`); }
    }
    const rows = [...members.values()].sort((a, b) => Number(b.routes.includes('target')) - Number(a.routes.includes('target')) || Number(b.similarity || 0) - Number(a.similarity || 0) || String(a.name).localeCompare(String(b.name)));
    return {
      status: rows.length ? 'ready' : 'empty',
      seed: {name: candidate.name, identity: seed.identity, targets: seed.targets, modeOneCandidate: candidate},
      members: rows,
      total: rows.length,
      warnings: seed.warnings,
      criteria: {combination: 'union', pool: {source: 'TCMBank', rule: '仅纳入官方成分表中至少有一条明确中药关联且通过基础小分子排除规则的成分'}, structure: {method: 'Morgan fingerprint (ECFP4)', radius: 2, bits: 2048, metric: 'Tanimoto', threshold: STRUCTURE_THRESHOLD}, target: {rule: '共享至少一个 TCMBank 已记录靶点；无需限定为疾病相关靶点', confidenceOrAffinityClaimed: false}},
      provenance: {structure: index.load().metadata, target: 'TCMBank ingredient/totargets + gene/toingredients', generatedAt: new Date().toISOString()},
    };
  }

  return {resolveSeed, buildGroup};
}

module.exports = {createModeTwoService, ModeTwoError, STRUCTURE_THRESHOLD};

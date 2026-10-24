'use strict';

const BASE = 'http://tcmbank.cn/api/';

class TCMBankError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'TCMBankError';
    this.status = this.statusCode = status;
  }
}

function cleanText(value, label, max = 120) {
  if (typeof value !== 'string') throw new TCMBankError(`${label} must be text`, 400);
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f<>`"'\\]|(?:https?:)?\/\//i.test(text)) {
    throw new TCMBankError(`${label} is invalid`, 400);
  }
  return text;
}

function cleanId(value, prefix) {
  const id = cleanText(value, 'tcmbank_id', 24).toUpperCase();
  if (!new RegExp(`^${prefix}\\d{6}$`).test(id)) throw new TCMBankError('TCMBank ID is invalid', 400);
  return id;
}

function createTCMBankService(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const timeoutMs = Math.max(1000, Math.min(60000, Number(options.timeoutMs) || 45000));
  const ttl = Math.max(0, Math.min(86400000, Number(options.cacheTtlMs) || 86400000));
  const minIntervalMs = Math.max(0, Number(options.minIntervalMs) || 1100);
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const cache = new Map();
  const inflight = new Map();
  let queue = Promise.resolve();
  let lastRequestAt = 0;

  function scheduled(work) {
    const next = queue.then(async () => {
      const wait = minIntervalMs - (Date.now() - lastRequestAt);
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      return work();
    });
    queue = next.catch(() => {});
    return next;
  }

  async function request(path, params = {}) {
    const url = new URL(path, BASE);
    for (const [key, value] of Object.entries(params)) if (value !== '' && value != null) url.searchParams.set(key, String(value));
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await scheduled(async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            return await fetchImpl(url, {
              signal: controller.signal,
              headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 HerbLab/1.0', 'x-requested-with': 'XMLHttpRequest' },
            });
          } finally { clearTimeout(timer); }
        });
        if (response?.status === 429) {
          lastError = new TCMBankError('TCMBank 请求过多，请稍后重试', 429);
          await sleep(1500 * (attempt + 1));
          continue;
        }
        if (!response?.ok) {
          lastError = new TCMBankError(response?.status >= 500 ? 'TCMBank 服务暂时异常' : 'TCMBank 查询失败', response?.status >= 500 ? 502 : response?.status || 502);
          if (response?.status >= 500 && attempt < 2) { await sleep(800 * (attempt + 1)); continue; }
          throw lastError;
        }
        let payload;
        try { payload = await response.json(); }
        catch { throw new TCMBankError('TCMBank 返回数据不完整，无法解析', 502); }
        if (!payload || payload.status !== true) throw new TCMBankError(String(payload?.message || 'TCMBank 未返回有效数据'), 502);
        return { data: payload.data, url: url.href, remaining: response.headers?.get?.('x-ratelimit-remaining') || null };
      } catch (error) {
        if (error instanceof TCMBankError) throw error;
        lastError = new TCMBankError(error?.name === 'AbortError' ? 'TCMBank 查询超时' : '无法连接 TCMBank', error?.name === 'AbortError' ? 504 : 502);
        if (attempt < 2) await sleep(800 * (attempt + 1));
      }
    }
    throw lastError || new TCMBankError('TCMBank 查询失败');
  }

  async function cached(key, work) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      const value = await work();
      cache.set(key, { value, expires: Date.now() + ttl });
      while (cache.size > 200) cache.delete(cache.keys().next().value);
      return value;
    })();
    inflight.set(key, pending);
    try { return await pending; } finally { inflight.delete(key); }
  }

  function normalizeTarget(row = {}, relation = 'ingredient') {
    return {
      tcmbankId: String(row.TCMBank_ID || ''),
      targetId: String(row.Target_id || ''),
      gene: String(row.Gene_name || ''),
      aliases: String(row.Gene_alias || ''),
      description: String(row.Description || ''),
      mapLocation: String(row.Map_location || ''),
      reference: String(row.Reference || ''),
      relation,
    };
  }

  async function targetsForIngredient(id) {
    const tcmbankId = cleanId(id, 'TCMBANKIN');
    return cached(`ingredient-targets:${tcmbankId}`, async () => {
      const response = await request('ingredient/totargets', { tcmbank_id: tcmbankId });
      const rows = Array.isArray(response.data) ? response.data : [];
      return { source: 'TCMBank', retrievedAt: new Date().toISOString(), records: rows.map(row => normalizeTarget(row, 'ingredient')).filter(row => row.gene), total: rows.length, tcmbankId, cached: false };
    });
  }

  async function herbsForIngredient(id) {
    const tcmbankId = cleanId(id, 'TCMBANKIN');
    return cached(`ingredient-herbs:${tcmbankId}`, async () => {
      const response = await request('ingredient/toherbs', { tcmbank_id: tcmbankId });
      const rows = Array.isArray(response.data) ? response.data : [];
      const records = rows.map(row => ({
        identifier: String(row.Herb_ID || row.TCMBank_ID || ''),
        name: String(row.TCM_name || ''),
        englishName: String(row.TCM_name_en || ''),
        pinyinName: String(row.TCM_name2 || ''),
        therapeuticClass: String(row.Therapeutic_cn_class || ''),
        function: String(row.Function || ''),
        reference: String(row.Reference || ''),
        source: 'TCMBank',
      })).filter(row => row.identifier || row.name || row.englishName || row.pinyinName);
      return {source: 'TCMBank', retrievedAt: new Date().toISOString(), records, total: rows.length, tcmbankId, cached: false};
    });
  }

  async function searchIngredient(name) {
    const query = cleanText(name, 'name');
    return cached(`ingredient:${query.toLowerCase()}`, async () => {
      const response = await request('ingredient/search', { ingredient_name: query, cur_page: 1, per_page: 5 });
      const block = response.data && typeof response.data === 'object' ? response.data : {};
      const rows = Array.isArray(block.list) ? block.list.slice(0, 5) : [];
      const records = [];
      for (const row of rows.slice(0, 3)) {
        const tcmbankId = String(row.TCMBank_ID || '');
        let targetResult = { records: [], total: 0 };
        if (tcmbankId) {
          try { targetResult = await targetsForIngredient(tcmbankId); }
          catch (error) { targetResult = { records: [], total: null, warning: error.message }; }
        }
        records.push({
          identifier: tcmbankId,
          name: String(row.name || ''),
          aliases: String(row.Alias || ''),
          formula: String(row.Molecular_Formula || ''),
          molecularWeight: row.Molecular_Weight ?? null,
          alogp: row.ALogP ?? null,
          polarSurfaceArea: row.Molecular_PolarSurfaceArea ?? null,
          source: 'TCMBank',
          targets: targetResult.records || [],
          targetTotal: targetResult.total,
          targetWarning: targetResult.warning || null,
        });
      }
      return { source: 'TCMBank', retrievedAt: new Date().toISOString(), records, total: Number(block.total_ingredients ?? rows.length), warnings: [], query, cached: false };
    });
  }

  async function ingredientDetail(id) {
    const tcmbankId = cleanId(id, 'TCMBANKIN');
    return cached(`ingredient-detail:${tcmbankId}`, async () => {
      const response = await request('ingredient/detail', { tcmbank_id: tcmbankId });
      const row = response.data && typeof response.data === 'object' ? response.data : {};
      const record = {
        identifier: String(row.TCMBank_ID || tcmbankId),
        name: String(row['Ingredient Name'] || ''),
        aliases: String(row['Ingredient Alias'] || ''),
        smiles: String(row.Smiles || ''),
        formula: String(row['Molecular Formula'] || ''),
        molecularWeight: row['Molecular Weight'] ?? null,
        pubchemId: row['PubChem id'] ?? null,
        drugbankId: row['DrugBank id'] ?? null,
        casId: row['CAS id'] ?? null,
        admet: {
          solubility: row.ADMET_Solubility ?? null,
          solubilityLevel: row.ADMET_Solubility_Level ?? null,
          bbb: row.ADMET_BBB ?? null,
          bbbLevel: row.ADMET_BBB_Level ?? null,
          absorptionLevel: row.ADMET_Absorption_Level ?? null,
          hepatotoxicity: row['ADMET_EXT_Hepatotoxic#Prediction'] ?? row.ADMET_EXT_Hepatotoxic ?? null,
          cyp2d6: row['ADMET_EXT_CYP2D6#Prediction'] ?? row.ADMET_EXT_CYP2D6 ?? null,
          plasmaProteinBinding: row['ADMET_EXT_PPB#Prediction'] ?? row.ADMET_EXT_PPB ?? null,
        },
      };
      return { source: 'TCMBank', retrievedAt: new Date().toISOString(), records: [record], total: 1, tcmbankId, cached: false };
    });
  }

  async function diseaseTargets(name) {
    const query = cleanText(name, 'disease', 120);
    return cached(`disease-targets:${query.toLowerCase()}`, async () => {
      const search = await request('disease/search', { disease_name: query, cur_page: 1, per_page: 5 });
      const block = search.data && typeof search.data === 'object' ? search.data : {};
      const diseases = (Array.isArray(block.list) ? block.list : []).slice(0, 5).map(row => ({ identifier: String(row.TCMBank_ID || ''), name: String(row.Disease_name || ''), type: String(row.Disease_type || '') }));
      const exact = diseases.find(row => row.name.toLowerCase() === query.toLowerCase());
      const chosen = exact || diseases[0];
      if (!chosen?.identifier) return { source: 'TCMBank', retrievedAt: new Date().toISOString(), records: [], total: 0, diseases, matchedDisease: null, warnings: ['TCMBank 未找到可用于靶点建议的疾病记录。'], cached: false };
      const relation = await request('disease/totargets', { tcmbank_id: cleanId(chosen.identifier, 'TCMBANKDI') });
      const rows = Array.isArray(relation.data) ? relation.data : [];
      return { source: 'TCMBank', retrievedAt: new Date().toISOString(), records: rows.slice(0, 50).map(row => normalizeTarget(row, 'disease')).filter(row => row.gene), total: rows.length, diseases, matchedDisease: chosen, warnings: exact ? [] : ['疾病名称未精确匹配，当前靶点建议来自首条模糊匹配记录，请人工核对。'], cached: false };
    });
  }

  async function searchGene(name) {
    const query = cleanText(name, 'gene', 80);
    return cached(`gene:${query.toLowerCase()}`, async () => {
      const response = await request('gene/search', { gene_name: query, cur_page: 1, per_page: 20 });
      const block = response.data && typeof response.data === 'object' ? response.data : {};
      const rows = Array.isArray(block.list) ? block.list : [];
      const records = rows.map(row => ({
        identifier: String(row.TCMBank_ID || ''),
        targetId: String(row.Target_id || ''),
        gene: String(row.Gene_name || row.gene_name || ''),
        aliases: String(row.Gene_alias || ''),
        description: String(row.Description || ''),
        source: 'TCMBank',
      })).filter(row => row.identifier && row.gene);
      return {source: 'TCMBank', retrievedAt: new Date().toISOString(), records, total: Number(block.total_genes ?? rows.length), query, cached: false};
    });
  }

  async function ingredientsForGene(id) {
    const tcmbankId = cleanId(id, 'TCMBANKGE');
    return cached(`gene-ingredients:${tcmbankId}`, async () => {
      const response = await request('gene/toingredients', { tcmbank_id: tcmbankId });
      const rows = Array.isArray(response.data) ? response.data : [];
      const records = rows.map(row => ({
        identifier: String(row.TCMBank_ID || row.Ingredient_id || ''),
        name: String(row.Ingredient_name || row.name || ''),
        aliases: String(row.Ingredient_alias || row.Alias || ''),
        formula: String(row.Molecular_Formula || ''),
        reference: String(row.Reference || ''),
        source: 'TCMBank',
        targetId: tcmbankId,
      })).filter(row => row.identifier || row.name);
      return {source: 'TCMBank', retrievedAt: new Date().toISOString(), records, total: rows.length, tcmbankId, cached: false};
    });
  }

  return { searchIngredient, ingredientDetail, targetsForIngredient, herbsForIngredient, diseaseTargets, searchGene, ingredientsForGene, TCMBankError };
}

module.exports = { createTCMBankService, TCMBankError };

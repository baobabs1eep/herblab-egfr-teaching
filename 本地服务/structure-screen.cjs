'use strict';

// PubChem PUG REST property endpoint: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest-tutorial

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';
const MAX_CACHE = 100;

class StructureScreenError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'StructureScreenError'; this.status = status; }
}

function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function asInput(value, label) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value !== 'string') throw new StructureScreenError(`${label} is required`);
  const text = value.trim();
  if (!text || text.length > 100 || /[\u0000-\u001f\u007f]/.test(text) || /(?:https?:)?\/\//i.test(text)) throw new StructureScreenError(`${label} is invalid`);
  if (/^\d+$/.test(text)) {
    if (!Number.isSafeInteger(Number(text)) || Number(text) <= 0) throw new StructureScreenError(`${label} CID is invalid`);
    return text;
  }
  if (!/^[A-Za-z][A-Za-z0-9 .(),'()+\-]*$/.test(text)) throw new StructureScreenError(`${label} must be an English compound name or CID`);
  return text;
}

function cidValue(value) {
  const cid = value?.CID ?? value?.cid;
  return Number.isInteger(Number(cid)) && Number(cid) > 0 ? Number(cid) : null;
}

function popcount(value) { let n = value; let count = 0; while (n) { n &= n - 1; count += 1; } return count; }

function fingerprintBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new StructureScreenError('PubChem fingerprint is malformed', 502);
  let bytes;
  try { bytes = Buffer.from(value, 'base64'); } catch { throw new StructureScreenError('PubChem fingerprint is malformed', 502); }
  if (bytes.length !== 115 || bytes.readUInt32BE(0) !== 881) throw new StructureScreenError('PubChem fingerprint is malformed', 502);
  // 881 bits occupy 111 bytes; the seven unused low bits must be zero.
  if ((bytes[114] & 0x7f) !== 0) throw new StructureScreenError('PubChem fingerprint padding is malformed', 502);
  if(!bytes.subarray(4).some(x=>x!==0))throw new StructureScreenError('PubChem fingerprint is empty',502);
  return bytes.subarray(4);
}

function fingerprintTanimoto(left, right) {
  const a = fingerprintBytes(left);
  const b = fingerprintBytes(right);
  let intersection = 0; let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    intersection += popcount(a[i] & b[i]);
    union += popcount(a[i] | b[i]);
  }
  return union === 0 ? 1 : intersection / union;
}

function createStructureScreen({ fetchImpl = global.fetch, timeoutMs = 8000, cacheTtlMs = 300000, batchBudgetMs = 75000, now = Date.now, tcmbank = null } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const timeout = Math.max(250, Math.min(8000, Number(timeoutMs) || 8000));
  const ttl = Math.max(0, Math.min(3600000, Number(cacheTtlMs) || 300000));
  const budget=Math.max(1000,Math.min(75000,Number(batchBudgetMs)||75000));
  const cache = new Map();
  const inflight = new Map();

  async function request(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!response?.ok) throw new StructureScreenError(`Official source request failed (${response?.status || 502})`, response?.status || 502);
      return await response.json();
    } catch (error) {
      if (error instanceof StructureScreenError) throw error;
      if (error?.name === 'AbortError') throw new StructureScreenError('Official source request timed out', 504);
      throw new StructureScreenError('Unable to reach official source', 502);
    } finally { clearTimeout(timer); }
  }

  async function cached(url) {
    const existing = cache.get(url);
    if (existing && existing.expires > Date.now()) return existing.value;
    if (inflight.has(url)) return inflight.get(url);
    const promise = request(url).then(value => {
      cache.set(url, { value, expires: Date.now() + ttl });
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      return value;
    });
    inflight.set(url, promise);
    try { return await promise; } finally { inflight.delete(url); }
  }

  async function pubchem(value) {
    const kind = /^\d+$/.test(value) ? 'cid' : 'name';
    const url = `${PUBCHEM}/${kind}/${encodeURIComponent(value)}/property/Fingerprint2D,ConnectivitySMILES,InChIKey,MolecularFormula/JSON`;
    const data = await cached(url);
    const p = data?.PropertyTable?.Properties?.[0];
    if (data?.PropertyTable?.Properties?.length!==1 || !p || !p.Fingerprint2D || !p.InChIKey || !p.ConnectivitySMILES) throw new StructureScreenError('PubChem returned invalid or ambiguous identity', 502);
    fingerprintBytes(p.Fingerprint2D);
    const cid = cidValue(p);
    if (!cid) throw new StructureScreenError('PubChem returned invalid CID', 502);
    return { cid, inchiKey: String(p.InChIKey), smiles: String(p.ConnectivitySMILES), fingerprint: String(p.Fingerprint2D), sourceURL: url };
  }

  async function tcmbankProfile(name) {
    if (!tcmbank || typeof tcmbank.ingredient !== 'function' || /^\d+$/.test(name)) return { status: 'unavailable', records: [], total: null, targets: [], warning: 'TCMBank 需要英文成分名称；当前记录待人工核对。' };
    try {
      const result = await tcmbank.ingredient(name);
      const targets = [];
      const seen = new Set();
      for (const record of result.records || []) for (const target of record.targets || []) {
        const gene = String(target.gene || '').toUpperCase();
        if (gene && !seen.has(gene)) { seen.add(gene); targets.push({ ...target, gene, ingredientId: record.identifier, ingredientName: record.name }); }
      }
      return { status: result.records?.length ? 'recorded' : 'no_record', records: result.records || [], total: result.total, targets: targets.slice(0, 20), warning: result.records?.length ? null : 'TCMBank 未返回名称匹配记录；这不代表该成分不存在。' };
    } catch (error) { return { status: 'pending', records: [], total: null, targets: [], warning: error.message }; }
  }

  async function screen(input = {}) {
    const startedAt=now();
    if (!plain(input) || !Array.isArray(input.names) || input.names.length < 1 || input.names.length > 8) throw new StructureScreenError('names must contain 1 to 8 entries');
    const names = input.names.map((value, index) => asInput(value, `names[${index}]`));
    const referenceInput = asInput(input.reference, 'reference');
    let targetInput = input.accession == null ? null : String(input.accession).trim();
    if (targetInput && !/^[A-Za-z0-9_-]{1,30}$/.test(targetInput)) throw new StructureScreenError('target is invalid');
    const reference = await pubchem(referenceInput);
    const candidates = [];
    const warnings = [];
    for (const name of names) {
      if(now()-startedAt>=budget){
        candidates.push({name,identity:null,structure:{status:'pending',score:null,tanimoto:null,method:'Tanimoto',referenceCID:reference.cid},tcmbank:{status:'pending',records:[],targets:[],total:null,warning:'本批查询预算已用完，请单独重试此成分。'},warning:'本批查询预算已用完，请单独重试此成分。'});
        continue;
      }
      try {
        const identity = await pubchem(name);
        const tanimoto = fingerprintTanimoto(reference.fingerprint, identity.fingerprint);
        candidates.push({ name, identity, structure: { status: 'computed', tanimoto, score: 100 * tanimoto, source: 'PubChem Fingerprint2D', method: 'Tanimoto', referenceCID: reference.cid }, tcmbank: await tcmbankProfile(name) });
      } catch (error) {
        candidates.push({ name, identity: null, structure: { status: 'pending', tanimoto: null, score: null, source: 'PubChem Fingerprint2D', method: 'Tanimoto', referenceCID: reference.cid }, tcmbank: await tcmbankProfile(name), warning: error.message });
      }
    }
    return { schemaVersion: 1, target: { requested: targetInput || null }, reference, candidates, provenance: { queriedAt: new Date().toISOString(), warnings } };
  }

  return { screen };
}

module.exports = { createStructureScreen, fingerprintTanimoto, StructureScreenError };

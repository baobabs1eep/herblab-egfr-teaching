'use strict';

// PubChem PUG REST property endpoint: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest-tutorial
// ChEMBL web services: https://chembl.github.io/using-new-chembl-web-services/

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';
const CHEMBL = 'https://www.ebi.ac.uk/chembl/api/data';
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

function createStructureScreen({ fetchImpl = global.fetch, timeoutMs = 8000, cacheTtlMs = 300000, batchBudgetMs = 75000, now = Date.now } = {}) {
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

  async function resolveTarget(accession) {
    if (!accession) return null;
    const url = `${CHEMBL}/target.json?target_components__accession=${encodeURIComponent(accession)}&target_type=SINGLE%20PROTEIN&limit=5`;
    const data = await cached(url);
    if(!Array.isArray(data?.targets))throw new StructureScreenError('ChEMBL returned invalid target records',502);
    const records = data.targets;
    const valid = records.filter(t => {
      const organism = typeof t.organism === 'object' ? t.organism.scientific_name || t.organism.name : t.organism;
      const targetOrganism = t.target_organism || organism;
      return String(t.target_type || '').toUpperCase() === 'SINGLE PROTEIN' && Array.isArray(t.target_components) && t.target_components.some(c => String(c.accession || '').toUpperCase() === accession.toUpperCase()) && String(targetOrganism || '').toLowerCase() === 'homo sapiens';
    });
    return valid.length === 1 && Number(data.page_meta?.total_count??records.length)<=records.length ? { id: String(valid[0].target_chembl_id), url } : { ambiguous: true, url };
  }

  async function binding(identity, target) {
    if (!target) return { status: 'unavailable', records: [], total: null, truncated: false, warning: 'No UniProt accession was supplied.' };
    if (target.ambiguous || target.error) return { status: 'pending', records: [], total: null, truncated: false, warning: target.error || 'Target mapping is ambiguous; no activity query was issued.' };
    try {
      const moleculeURL = `${CHEMBL}/molecule.json?molecule_structures__standard_inchi_key=${encodeURIComponent(identity.inchiKey)}&limit=2`;
      const molecules = await cached(moleculeURL);
      if(!Array.isArray(molecules?.molecules))throw new StructureScreenError('ChEMBL returned invalid molecule records',502);
      const rows = molecules.molecules.filter(m => String(m.molecule_structures?.standard_inchi_key || '').toUpperCase() === identity.inchiKey.toUpperCase());
      if (rows.length !== 1 || !rows[0].molecule_chembl_id || Number(molecules.page_meta?.total_count??molecules.molecules.length)>molecules.molecules.length) return { status: 'pending', records: [], total: null, truncated: false, warning: 'ChEMBL molecule identity was not unique.' };
      const moleculeId = String(rows[0].molecule_chembl_id);
      const activityURL = `${CHEMBL}/activity.json?molecule_chembl_id=${encodeURIComponent(moleculeId)}&target_chembl_id=${encodeURIComponent(target.id)}&assay_type=B&limit=20`;
      const data = await cached(activityURL);
      if(!Array.isArray(data?.activities))throw new StructureScreenError('ChEMBL returned invalid activity records',502);
      const activities = data.activities;
      const records = activities.slice(0, 20).map(a => ({ type: a.standard_type ?? a.type ?? null, relation: a.standard_relation ?? a.relation ?? null, value: a.standard_value ?? a.value ?? null, units: a.standard_units ?? a.units ?? null, assay: { id: a.assay_chembl_id ?? null, type: a.assay_type ?? null, description: a.assay_description ?? null }, document: { id: a.document_chembl_id ?? null, doi: a.document_doi ?? null, pmid: a.document_pmid ?? null }, flags: { potentialDuplicate: Boolean(a.potential_duplicate), validity: a.data_validity_comment ?? null } }));
      const total = Number(data?.page_meta?.total_count ?? records.length);
      return { status: records.length ? 'recorded' : 'no_record', records, total, truncated: total > records.length, sourceURL:activityURL,moleculeSourceURL:moleculeURL,targetSourceURL:target.url, warning: records.length ? null : 'No binding record was returned; this does not imply lack of affinity.' };
    } catch (error) { return { status: 'pending', records: [], total: null, truncated: false, warning: error.message }; }
  }

  async function screen(input = {}) {
    const startedAt=now();
    if (!plain(input) || !Array.isArray(input.names) || input.names.length < 1 || input.names.length > 8) throw new StructureScreenError('names must contain 1 to 8 entries');
    const names = input.names.map((value, index) => asInput(value, `names[${index}]`));
    const referenceInput = asInput(input.reference, 'reference');
    let accession = input.accession == null ? null : String(input.accession).trim();
    if (accession && !/^[A-Za-z0-9]{6,12}$/.test(accession)) throw new StructureScreenError('accession is invalid');
    const reference = await pubchem(referenceInput);
    let target;try{target=await resolveTarget(accession);}catch(error){target={error:error.message};}
    const candidates = [];
    const warnings = [];
    for (const name of names) {
      if(now()-startedAt>=budget){
        candidates.push({name,identity:null,structure:{status:'pending',score:null,tanimoto:null,method:'Tanimoto',referenceCID:reference.cid},binding:{status:'pending',records:[],total:null,warning:'本批查询预算已用完，请单独重试此成分。'},warning:'本批查询预算已用完，请单独重试此成分。'});
        continue;
      }
      try {
        const identity = await pubchem(name);
        const tanimoto = fingerprintTanimoto(reference.fingerprint, identity.fingerprint);
        candidates.push({ name, identity, structure: { status: 'computed', tanimoto, score: 100 * tanimoto, source: 'PubChem Fingerprint2D', method: 'Tanimoto', referenceCID: reference.cid }, binding: await binding(identity, target) });
      } catch (error) {
        candidates.push({ name, identity: null, structure: { status: 'pending', tanimoto: null, score: null, source: 'PubChem Fingerprint2D', method: 'Tanimoto', referenceCID: reference.cid }, binding: { status: 'pending', records: [], total: null, truncated: false, warning: error.message }, warning: error.message });
      }
    }
    if (target?.ambiguous) warnings.push('ChEMBL target mapping was ambiguous.');
    if(target?.error)warnings.push(target.error);
    return { schemaVersion: 1, target: { accession: accession || null }, reference, candidates, provenance: { queriedAt: new Date().toISOString(), warnings } };
  }

  return { screen };
}

module.exports = { createStructureScreen, fingerprintTanimoto, StructureScreenError };

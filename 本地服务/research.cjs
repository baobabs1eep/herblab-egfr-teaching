'use strict';

const PUBMED = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/';
const PUBTATOR = 'https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/export/biocjson?pmids=';
const EUROPEPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const ALIASES = new Map([
  ['三叉神经痛', ['Trigeminal neuralgia', 'trigeminal neuralgia']], ['trigeminal neuralgia', ['Trigeminal neuralgia', 'trigeminal neuralgia']],
  ['高血压', ['高血压', 'hypertension']], ['原发性高血压', ['原发性高血压', 'primary hypertension']], ['hypertension', ['Hypertension', 'hypertension']], ['primary hypertension', ['Primary hypertension', 'primary hypertension']],
  ['肺癌', ['Lung cancer', 'lung cancer']], ['lung cancer', ['Lung cancer', 'lung cancer']],
  ['非小细胞肺癌', ['Non-small cell lung cancer', 'non-small cell lung cancer']], ['non-small cell lung cancer', ['Non-small cell lung cancer', 'non-small cell lung cancer']],
  ['糖尿病', ['Diabetes mellitus', 'diabetes mellitus']], ['diabetes mellitus', ['Diabetes mellitus', 'diabetes mellitus']],
  ['阿尔茨海默病', ['Alzheimer disease', 'Alzheimer disease']], ['阿尔兹海默病', ['Alzheimer disease', 'Alzheimer disease']], ['alzheimer disease', ['Alzheimer disease', 'Alzheimer disease']],
  ['乳腺癌', ['Breast cancer', 'breast cancer']], ['breast cancer', ['Breast cancer', 'breast cancer']],
  ['炎症', ['Inflammation', 'inflammation']], ['inflammation', ['Inflammation', 'inflammation']]
]);

class ResearchError extends Error { constructor(message, status = 502) { super(message); this.status = status; this.statusCode = status; this.code = 'RESEARCH_ERROR'; } }
function normalizeInput(value, name = 'input', max = 100) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new ResearchError(`${name} must be text`, 400);
  const s = value.trim();
  if (s.length > max) throw new ResearchError(`${name} is too long`, 400);
  if (/[\u0000-\u001f\u007f<>\[\]"`]|https?:\/\//i.test(s)) throw new ResearchError(`${name} contains invalid characters`, 400);
  return s;
}
function diseaseInput(value) {
  const raw = normalizeInput(value, 'disease', 100);
  if (!raw) throw new ResearchError('disease is required', 400);
  const hit = ALIASES.get(raw.toLowerCase());
  if (hit) return { label: hit[0], term: hit[1] };
  if (/^[\x00-\x7F]+$/.test(raw)) return { label: raw, term: raw };
  return { label: raw, term: '', needsResolution: true };
}
function decodeXml(s) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, x) => { const m = x.toLowerCase(); if (m === 'amp') return '&'; if (m === 'lt') return '<'; if (m === 'gt') return '>'; if (m === 'quot') return '"'; if (m === 'apos') return "'"; const n = m[0] === '#' ? (m[1] === 'x' ? parseInt(m.slice(2), 16) : parseInt(m.slice(1), 10)) : NaN; return Number.isFinite(n) ? String.fromCodePoint(n) : _; }); }
function tag(xml, name) { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decodeXml(m[1].replace(/<[^>]+>/g, '').trim()) : ''; }
function between(xml, name) { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; }
function esummary(json, pmid) { const d = json?.result?.[pmid] || {}; const article = { pmid, title: d.title || '', journal: d.fulljournalname || d.source || '', date: d.pubdate || '', doi: '', url: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`, abstract: '' }; for (const x of (d.articleids || [])) if (String(x.idtype).toLowerCase() === 'doi') article.doi = x.value || ''; return article; }

function createResearchService(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = options.timeoutMs || 12000, minIntervalMs = options.minIntervalMs == null ? 500 : options.minIntervalMs;
  const cache = new Map(), inflight = new Map(); let lastRequest = 0, queue = Promise.resolve();
  async function pacedFetch(url, init = {}) {
    const run = queue.then(async () => { const wait = Math.max(0, minIntervalMs - (Date.now() - lastRequest)); if (wait) await new Promise(r => setTimeout(r, wait)); lastRequest = Date.now();
      let last; for (let attempt = 0; attempt < 3; attempt++) { const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs); try { const res = await fetchImpl(url, { ...init, signal: ctl.signal }); if (res.ok || (res.status < 400 && res.status !== 0)) return res; last = new ResearchError(res.status===404?'未找到对应数据库记录。':`外部数据库请求失败（${res.status}）`, res.status===404?404:502); if (![429, 500, 502, 503, 504].includes(res.status) || attempt === 2) throw last; } catch (e) { last = e.name === 'AbortError' ? new ResearchError('上游数据库连接超时。', 504) : e; const retryable = last instanceof ResearchError ? [429, 500, 502, 503, 504].includes(last.status) : last?.name === 'TypeError'; if (attempt === 2 || !retryable) throw last; } finally { clearTimeout(timer); } await new Promise(r => setTimeout(r, Math.max(minIntervalMs, 500) * (attempt + 1))); } throw last; }); queue = run.catch(() => {}); return run;
  }
  function checkAccess(response) {
    if (response.url && new URL(response.url).hostname === 'misuse.ncbi.nlm.nih.gov') {
      const error = new ResearchError('NCBI 已限制服务器的 PubMed 访问，需要登记工具与联系邮箱并申请恢复。', 503);
      error.code = 'NCBI_BLOCKED';
      throw error;
    }
  }
  async function bodyJson(url, init) { const r = await pacedFetch(url, init); checkAccess(r); try { return await r.json(); } catch { throw new ResearchError('上游返回格式无效，请稍后重试。'); } }
  async function bodyText(url) { const r = await pacedFetch(url); checkAccess(r); return r.text(); }
  async function search(input = {}) {
    let disease = diseaseInput(input.disease);
    if (disease.needsResolution) {
      if (typeof options.resolveDisease !== 'function') throw new ResearchError('暂时无法自动识别这个中文疾病名称，请填写对应英文名称后检索。', 400);
      let term;
      try { term = normalizeInput(await options.resolveDisease(disease.label), 'normalized disease', 100); }
      catch (e) { throw new ResearchError(e?.message || '疾病名称自动规范化失败，请填写对应英文名称后检索。', 502); }
      if (!/^[A-Za-z0-9][A-Za-z0-9 .,'()\/-]{1,99}$/.test(term)) throw new ResearchError('疾病名称自动规范化结果无效，请填写对应英文名称后检索。', 502);
      disease = { label: disease.label, term, normalizedBy: 'AI' };
    }
    const target = normalizeInput(input.target, 'target', 100), compound = normalizeInput(input.compound, 'compound', 120);
    const limit = Math.max(1, Math.min(50, Number.isFinite(Number(input.limit)) ? Number(input.limit) : 20));
    const offset = Math.max(0, Math.min(1000, Number.isFinite(Number(input.offset)) ? Math.floor(Number(input.offset)) : 0));
    const sort = input.sort === 'relevance' ? 'relevance' : 'date';
    const currentYear = new Date().getUTCFullYear();
    const fromYear = Number.isInteger(Number(input.fromYear)) && Number(input.fromYear) >= 1800 && Number(input.fromYear) <= currentYear ? Number(input.fromYear) : null;
    const toYear = Number.isInteger(Number(input.toYear)) && Number(input.toYear) >= 1800 && Number(input.toYear) <= currentYear ? Number(input.toYear) : null;
    if (fromYear && toYear && fromYear > toYear) throw new ResearchError('起始年份不能晚于结束年份。', 400);
    const scope = input.scope === 'all' ? 'all' : 'natural-products';
    const query = [`("${disease.term}"[Title/Abstract])`]; if (scope !== 'all' && !compound) query.push('("natural product" OR herbal OR flavonoid OR phytochemical OR "plant extract" OR "traditional Chinese medicine")[Title/Abstract]'); if (target) query.push(`("${target}"[Title/Abstract])`); if (compound) query.push(`("${compound}"[Title/Abstract])`); const queryText = query.join(' AND ');
    const key = JSON.stringify([disease.term, target, compound, scope, limit, offset, sort, fromYear, toYear]); const old = cache.get(key); if (old && old.expires > Date.now()) return { ...old.value, cached: true }; if (inflight.has(key)) return inflight.get(key);
    const work = (async () => { const warnings = []; const base = { disease, scope, query: queryText, total: 0, offset, nextOffset: offset + limit, pageSize: limit, sort, fromYear, toYear, hasMore: false, retrievedAt: new Date().toISOString(), records: [], candidates: [], warnings, source: 'PubMed', cached: false };
      let es; let ids; try {
        const dateParams = `${fromYear ? `&mindate=${fromYear}/01/01` : ''}${toYear ? `&maxdate=${toYear}/12/31` : ''}${fromYear || toYear ? '&datetype=pdat' : ''}`;
        es = await bodyJson(`${PUBMED}esearch.fcgi?tool=herblab&db=pubmed&retmode=json&retmax=${limit}&retstart=${offset}&sort=${sort === 'date' ? 'pub+date' : 'relevance'}${dateParams}&term=${encodeURIComponent(queryText)}`);
        if (!es || !es.esearchresult || !Array.isArray(es.esearchresult.idlist) || !Number.isFinite(Number(es.esearchresult.count))) throw new ResearchError('PubMed 返回格式无效，请稍后重试。');
        ids = es.esearchresult.idlist.map(String); base.total = Number(es.esearchresult.count); base.hasMore = offset + ids.length < base.total;
      } catch (primaryError) {
        const dateQuery = fromYear || toYear ? ` AND FIRST_PDATE:[${fromYear || 1800}-01-01 TO ${toYear || currentYear}-12-31]` : '';
        const epmcQuery = `SRC:MED AND TITLE_ABS:"${disease.term}"${target ? ` AND TITLE_ABS:"${target}"` : ''}${compound ? ` AND TITLE_ABS:"${compound}"` : scope === 'all' ? '' : ' AND (TITLE_ABS:"natural product" OR TITLE_ABS:herbal OR TITLE_ABS:flavonoid OR TITLE_ABS:phytochemical OR TITLE_ABS:"plant extract" OR TITLE_ABS:"traditional Chinese medicine")'}${dateQuery}${sort === 'date' ? ' sort_date:y' : ''}`;
        let epmc;
        try { epmc = await bodyJson(`${EUROPEPMC}?query=${encodeURIComponent(epmcQuery)}&resultType=core&format=json&pageSize=${limit}&page=${Math.floor(offset / limit) + 1}`); }
        catch (fallbackError) {
          throw new ResearchError(`文献检索暂不可用。PubMed：${primaryError.message} Europe PMC：${fallbackError.message} 请稍后重试；本次未返回文献，不代表没有相关研究。`, fallbackError.status || 502);
        }
        if (!epmc || !epmc.resultList || !Array.isArray(epmc.resultList.result) || !Number.isFinite(Number(epmc.hitCount))) throw new ResearchError('Europe PMC 返回格式无效，请稍后重试。');
        base.source = 'Europe PMC（PubMed记录）'; base.provider = 'Europe PMC'; base.query = epmcQuery; base.total = Number(epmc.hitCount); base.warnings.push(`PubMed 不可用，已切换 Europe PMC：${primaryError.message}`);
        const rows = epmc.resultList.result;
        base.hasMore = offset + rows.length < base.total;
        base.records = rows.slice(0, limit).map(x => { const pmid = String(x.pmid || x.id || ''); const clean = value => decodeXml(String(value || '').replace(/<[^>]+>/g, '').trim()); const abstract = clean(x.abstractText).slice(0, 1500); return { pmid, title: clean(x.title), journal: x.journalInfo?.journal?.title || x.journalTitle || '', date: x.firstPublicationDate || '', doi: x.doi || '', url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/` : '', abstract }; }).filter(x => x.pmid);
        const found = new Map(); for (const row of rows) for (const c of (row.chemicalList?.chemical || [])) { const identifier = String(c.registryNumber || '').trim(); if (!identifier || identifier === '0') continue; const name = String(c.name || '').trim(); if (!name) continue; const key = `${name.toLowerCase()}|${identifier}`; const item = found.get(key) || { name, identifier, pmids: [], excerpts: [], status: '文献索引·待核验', source: 'Europe PMC化学索引' }; if (row.pmid && !item.pmids.includes(String(row.pmid))) item.pmids.push(String(row.pmid)); found.set(key, item); }
        base.candidates = [...found.values()].slice(0, 20); return base;
      }
      if (!ids.length) return base;
      let sum; try { sum = await bodyJson(`${PUBMED}esummary.fcgi?tool=herblab&db=pubmed&retmode=json&id=${ids.map(encodeURIComponent).join(',')}`); } catch (e) { warnings.push(`文献题录暂不可用：${e.message}`); sum={}; }
      base.records = ids.map(id => esummary(sum, id)); try { const xml = await bodyText(`${PUBMED}efetch.fcgi?tool=herblab&db=pubmed&retmode=xml&id=${ids.map(encodeURIComponent).join(',')}`); const arts = [...xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi)]; for (const a of arts) { const pmid = tag(a[1], 'PMID'); const hit = base.records.find(x => x.pmid === pmid); if (hit) hit.abstract = [...a[1].matchAll(/<AbstractText(?:[^>]*)>([\s\S]*?)<\/AbstractText>/gi)].map(x => decodeXml(x[1].replace(/<[^>]+>/g, '').trim())).join('\n').slice(0, 1500); } if (base.records.some(x => x.abstract)) warnings.push('摘要摘录来自 PubMed，部分摘要受版权保护；请保留出处并到原文核验。'); } catch (e) { warnings.push(`文献摘要暂不可用：${e.message}`); }
      try { const bio = await bodyJson(`${PUBTATOR}${ids.map(encodeURIComponent).join(',')}`); const docs = Array.isArray(bio) ? bio : (bio?.PubTator3 || bio?.documents || []); if (!Array.isArray(docs)) throw new ResearchError('化学实体注释格式异常。'); if (docs.length<ids.length) warnings.push('部分论文暂未提供 PubTator3 化学实体注释，不能据此判断没有相关成分。'); const found = new Map(); for (const doc of docs) { const pmid = String(doc?.id || doc?.infons?.pmid || ''); for (const passage of (doc?.passages || [])) { const text = String(passage?.text || ''); for (const ann of (passage?.annotations || [])) { const inf = ann?.infons || {}; if (String(inf.type || '').toLowerCase() !== 'chemical') continue; const name = String(inf.name || ann.text || '').trim(); if (!name) continue; const identifier = String(inf.identifier || inf.cui || '').trim(); const key = identifier&&identifier!=='-' ? identifier : name.toLowerCase(); const item = found.get(key) || { name, identifier, pmids: [], excerpts: [], status: '机器识别·待核验', source: 'PubTator3' }; if (pmid && !item.pmids.includes(pmid)) item.pmids.push(pmid); const excerpt = text.slice(0, 250); if (excerpt && !item.excerpts.includes(excerpt)) item.excerpts.push(excerpt); found.set(key, item); } } } base.candidates = [...found.values()].slice(0, 20); } catch (e) { warnings.push(`化学实体识别暂不可用：${e.message}`); }
      return base;
    })(); inflight.set(key, work); try { const result = await work; cache.set(key, { value: result, expires: Date.now() + 3600000 }); while (cache.size > 100) cache.delete(cache.keys().next().value); return result; } finally { inflight.delete(key); }
  }
  async function compound(name) { const n = normalizeInput(name, 'compound', 120); if (!n) throw new ResearchError('compound is required', 400); const url = `${PUBCHEM}${encodeURIComponent(n)}/property/MolecularFormula,MolecularWeight,InChIKey,IUPACName/JSON`; const data = await bodyJson(url); const p = data?.PropertyTable?.Properties?.[0]; if (!p || p.CID == null) throw new ResearchError('未找到分子身份，请核对英文名或同义词。', 404); return { name: n, cid: Number(p.CID), formula: p.MolecularFormula || '', molecularWeight: p.MolecularWeight ?? null, inchiKey: p.InChIKey || '', iupacName: p.IUPACName || '', url: `https://pubchem.ncbi.nlm.nih.gov/compound/${encodeURIComponent(p.CID)}`, retrievedAt: new Date().toISOString(), source: 'PubChem', identityStatus: 'needs_review' }; }
  async function naturalProduct(name) { const n = normalizeInput(name, 'name', 120); if (!n) throw new ResearchError('name is required', 400); const data = await bodyJson('https://coconut.naturalproducts.net/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: n, limit: 5, page: 1, offset: 0 }) }); const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.data?.data) ? data.data.data : (data?.results || []))); if (!Array.isArray(rows)) throw new ResearchError('Invalid COCONUT response'); return { source: 'COCONUT', records: rows.slice(0, 5).map(x => { const identifier = x.identifier || x.id || x.accession || ''; return { identifier: String(identifier), name: x.name || x.common_name || n, smiles: x.canonical_smiles || x.smiles || '', iupacName: x.iupac_name || x.iupacName || '', url: identifier ? `https://coconut.naturalproducts.net/compounds/${encodeURIComponent(identifier)}` : 'https://coconut.naturalproducts.net/', }; }), retrievedAt: new Date().toISOString() }; }
  return { search, compound, naturalProduct, normalizeInput };
}
module.exports = { createResearchService, normalizeInput, ResearchError };

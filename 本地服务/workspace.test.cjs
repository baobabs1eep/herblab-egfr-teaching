const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', '演示前端', 'app.js'), 'utf8');
const storage = new Map();
const node = () => ({innerHTML: '', textContent: '', classList: {add() {}, remove() {}}, style: {}, focus() {}, scrollTop: 0});
const document = {querySelector: () => node(), getElementById: () => node(), querySelectorAll: () => [], addEventListener() {}};
const context = {console, document, location: {hash: '#task', protocol: 'http:'}, URL, Blob, FileReader: class {}, AbortController, setTimeout, clearTimeout,
  confirm: () => true, crypto: {randomUUID: () => 'test-session'}, localStorage: {getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v)}, window: null};
context.window = context; context.addEventListener = () => {}; context.toastTimer = null;
context.rankingView = () => ''; context.rankSummary = () => 'EGFR ranking';
vm.runInNewContext(source, context, {filename: 'app.js'});
const api = context.HerbWorkspace;
assert.equal(typeof api.selectResearchCandidate, 'function');

const snapshot = {disease: {label: '乳腺癌', term: 'breast cancer'}, records: [{pmid: '123', title: 'Paper'}], review: {123: {note: '核对摘要', reviewed: true}}};
const candidate = {name: '候选甲', identifier: 'CHEM-1', source: 'PubMed', status: 'candidate'};
const selected = api.selectResearchCandidate(candidate, snapshot);
assert.equal(selected.origin, 'research');
assert.match(selected.id, /breast cancer\|chem-1/);
assert.equal(api.currentCandidate().disease.label, '乳腺癌');
assert.match(vm.runInNewContext('reportText()', context), /123/);
assert.doesNotMatch(vm.runInNewContext('completeReportText()', context), /EGFR ranking/);

// The snapshot review is copied into the active external draft, while EGFR remains selectable.
context.document = document;
vm.runInNewContext("state.experiment.hypothesis='乳腺癌草稿'", context);
api.selectResearchCandidate({name: '候选乙', identifier: 'CHEM-2'}, {disease: {label: '胃癌', term: 'stomach cancer'}, records: []});
assert.equal(api.currentCandidate().name, '候选乙');
assert.equal(vm.runInNewContext('state.experiment.hypothesis', context), '');
api.selectResearchCandidate(candidate, snapshot);
assert.equal(vm.runInNewContext('state.experiment.hypothesis', context), '乳腺癌草稿');

// Stable identity comes from snapshot disease when candidate has no disease property.
assert.equal(api.stableKey({name: '候选甲', identifier: 'CHEM-1'}, snapshot), 'research:breast cancer|chem-1');
assert.equal(vm.runInNewContext("validWorkspace({activeResearchKey:'',externalCandidates:[],drafts:{}})", context), false);
assert.equal(vm.runInNewContext("validWorkspace({activeResearchKey:'',externalCandidates:{},drafts:{bad:[]}})", context), false);
assert.equal(vm.runInNewContext("validTextMap({ok:'yes',bad:3})", context), false);
assert.equal(vm.runInNewContext('validRecordState(state)', context), true);
assert.equal(vm.runInNewContext('validBoolMap({123:true})', context), true);
assert.equal(vm.runInNewContext('validBoolMap({123:"true"})', context), false);
assert.equal(vm.runInNewContext('state.notes[123]', context), '核对摘要');
api.selectResearchCandidate({name:'liquiritin',identifier:'MESH:C512196',selectedIdentity:{name:'liquiritin',identifier:'503737',source:'pubchem',url:'https://pubchem.ncbi.nlm.nih.gov/compound/503737'},candidateReview:{identityConfirmed:true,relevanceConfirmed:true,note:'测试确认依据',updatedAt:'2026-10-09T00:00:00Z'},check:{provenance:{checkedAt:'2026-10-09T00:00:00Z'}}},{disease:{label:'三叉神经痛',term:'trigeminal neuralgia'},records:[{pmid:'41880679',title:'Test record'}]});
const report=vm.runInNewContext('completeReportText()',context);
assert.match(report,/503737/);
assert.match(report,/测试确认依据/);
assert.match(report,/确认时间：2026-10-09T00:00:00Z/);
assert.doesNotMatch(report,/EGFR ranking/);
assert.match(vm.runInNewContext('wordReportHtml()',context),/候选核对与人工确认/);
console.log('workspace tests passed');

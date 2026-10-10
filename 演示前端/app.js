// 本地教学页面。AI 问答通过同源 /api/chat 完成。
const candidates = [];
const steps=[['task','target','研究需求输入'],['evidence','library-big','文献与证据'],['ranking','list-filter','候选与排序'],['experiment','flask-conical','验证方案'],['report','clipboard-check','结果与报告']];
const DEFAULT_AGENT_URL='https://yuanqi.tencent.com/webim/#/chat/vcaDuu?appid=2103722870126603328&experience=true';
const makeSessionId=()=>{try{return crypto.randomUUID();}catch{return 'herblab-'+Date.now()+'-'+Math.random().toString(16).slice(2);}};
const EXPERIMENT_FIELDS=['hypothesis','model','controls','readouts','plan','resources','replicates','analysis','criteria'];
const blankExperiment=()=>Object.fromEntries(EXPERIMENT_FIELDS.map(k=>[k,'']));
const blankResult=()=>({observation:'',data:'',interpretation:'',nextStep:''});
function candidateCheckSummary(c=currentCandidate()){
  if(!c.id)return '尚未选择候选。';
  const i=c.selectedIdentity||{},v=c.candidateReview||{},check=c.check||{};
  return `候选身份与相关性核对\n选择身份：${i.name||c.name||'未选择'} / ${i.identifier||'未填写'}\n结构：${i.smiles||'未提供'}\n身份来源：${i.source||'未提供'} ${i.url||''}\n人工身份确认：${v.identityConfirmed?'已由用户确认':'未确认'}\n研究相关性：${v.relevanceConfirmed?'已由用户确认':'未确认'}\n确认依据：${v.note||'未填写'}\n确认时间：${v.reviewedAt||v.updatedAt||'未记录'}\n自动查询时间：${check.provenance?.checkedAt||'未记录'}\n排序状态：缺少统一计算数据，待补；人工确认不等于药效或安全性验证。`;
}
const initial=()=>({selected:'',rankingMode:'evidence',reason:'',demand:'围绕三叉神经痛，检索可能相关的天然产物或中药单体，核对文献、分子身份与证据局限。',notes:{},reviewed:{},experiment:blankExperiment(),result:blankResult(),agentUrl:DEFAULT_AGENT_URL,updated:'',chat:{messages:[],draft:'',userId:makeSessionId()},workspace:{schemaVersion:1,externalCandidates:{},drafts:{},activeResearchKey:''}});
let state=initial();
try { const saved=JSON.parse(localStorage.getItem('herblab-egfr-v1')); if(saved&&typeof saved==='object') state={...state,...saved}; } catch {}
// 兼容尚未配置链接的旧草稿，保留学生笔记。
if(typeof state.agentUrl!=='string'||!state.agentUrl.trim()) state.agentUrl=DEFAULT_AGENT_URL;
if(!state.chat||typeof state.chat!=='object') state.chat=initial().chat;
if(!Array.isArray(state.chat.messages)) state.chat.messages=[];
if(typeof state.chat.draft!=='string') state.chat.draft='';
if(typeof state.chat.userId!=='string'||!state.chat.userId) state.chat.userId=makeSessionId();
if(typeof state.demand!=='string')state.demand=initial().demand;
if(!['evidence','mechanism'].includes(state.rankingMode))state.rankingMode='evidence';
state.experiment={...blankExperiment(),...(state.experiment||{})};
state.result={...blankResult(),...(state.result||{})};
state.workspace={...initial().workspace,...(state.workspace||{})};
if(!state.workspace.externalCandidates||typeof state.workspace.externalCandidates!=='object')state.workspace.externalCandidates={};
if(!state.workspace.drafts||typeof state.workspace.drafts!=='object')state.workspace.drafts={};
if(!state.workspace.activeResearchKey)state.workspace.activeResearchKey='';
state.chat.loading=false;
state.chat.error='';
state.chat.configured=undefined;
if(state.chat.messages.length&&state.chat.messages[state.chat.messages.length-1].role==='user'){
  state.chat.draft=state.chat.messages.pop().content||state.chat.draft;
}
let healthChecked=false,mobileAssistantOpen=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stableKey=(candidate={},snapshot={})=>{const disease=snapshot?.disease?.term||snapshot?.disease?.label||candidate.disease?.term||candidate.disease?.label||candidate.disease||'';const id=candidate.identifier||candidate.name||'';return `research:${String(disease).trim().toLowerCase()}|${String(id).trim().toLowerCase()}`.replace(/\s+/g,' ');};
const externalList=()=>Object.values(state.workspace.externalCandidates||{});
const externalById=id=>externalList().find(c=>c.id===id);
function draftFor(key){return state.workspace.drafts[key]||(state.workspace.drafts[key]={reason:'',notes:{},reviewed:{},experiment:blankExperiment(),result:blankResult()});}
function activeDraft(){return state.workspace.activeResearchKey?draftFor(state.workspace.activeResearchKey):state;}
function currentCandidate(){const ext=externalById(state.selected);if(ext)return {...ext,origin:'research',disease:ext.disease};const c=candidates.find(x=>x.id===state.selected);return c?{...c,origin:'egfr'}:{id:'',name:'尚未选择候选',origin:'research',disease:{label:'研究需求'},source:'尚未核对',snapshot:{records:[]}};}
function allSelectable(){return [...candidates,...externalList()];}
function candidateLabel(c){return c.origin==='research'?`${c.name||'未命名疾病'} · ${c.identifier||c.selectedIdentity?.identifier||'无标识'} · ${c.source||'外部检索'}`:`${c.name} · ${c.id}`;}
function selectResearchCandidate(candidate,snapshot){
  if(!candidate||typeof candidate!=='object')return false;
  const key=stableKey(candidate,snapshot); const old=state.workspace.activeResearchKey;
  if(old) state.workspace.drafts[old]={reason:state.reason,notes:state.notes,reviewed:state.reviewed,experiment:state.experiment,result:state.result};
  else state.workspace.drafts.__egfr={reason:state.reason,notes:state.notes,reviewed:state.reviewed,experiment:state.experiment,result:state.result};
  const snap=snapshot&&typeof snapshot==='object'?snapshot:{}; const record={...candidate,id:`EXT:${key}`,origin:'research',disease:snap.disease||candidate.disease||{label:candidate.name||'',term:candidate.identifier||''},snapshot:snap,status:candidate.status||'unverified'};
  state.workspace.externalCandidates[key]=record;state.workspace.activeResearchKey=key;state.selected=record.id;
  const d=draftFor(key);const review=snap.review&&typeof snap.review==='object'?snap.review:{};const reviewNotes=Object.fromEntries(Object.entries(review).map(([pmid,v])=>[pmid,typeof v?.note==='string'?v.note:'']));const reviewFlags=Object.fromEntries(Object.entries(review).map(([pmid,v])=>[pmid,!!v?.reviewed]));state.reason=d.reason;state.notes=Object.keys(d.notes||{}).length?d.notes:reviewNotes;state.reviewed=Object.keys(d.reviewed||{}).length?d.reviewed:reviewFlags;state.experiment={...blankExperiment(),...d.experiment};state.result={...blankResult(),...d.result};save();render();return record;
}
function selectCandidateId(id){
  const old=state.workspace.activeResearchKey;
  state.workspace.drafts[old||'__egfr']={reason:state.reason,notes:state.notes,reviewed:state.reviewed,experiment:state.experiment,result:state.result};
  const ext=externalById(id);state.selected=id;
  if(ext){state.workspace.activeResearchKey=Object.keys(state.workspace.externalCandidates).find(k=>state.workspace.externalCandidates[k].id===id)||'';const d=draftFor(state.workspace.activeResearchKey);state.reason=d.reason;state.notes=d.notes;state.reviewed=d.reviewed;state.experiment={...blankExperiment(),...d.experiment};state.result={...blankResult(),...d.result};}
  else {state.workspace.activeResearchKey='';const d=state.workspace.drafts.__egfr;if(d){state.reason=d.reason;state.notes=d.notes;state.reviewed=d.reviewed;state.experiment={...blankExperiment(),...d.experiment};state.result={...blankResult(),...d.result};}}
  save();render();
}
window.HerbWorkspace={selectResearchCandidate,currentCandidate,stableKey,allSelectable};
const icon=n=>`<i data-lucide="${n}"></i>`;
const pubmed=c=>`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`;
const pubchem=c=>`https://pubchem.ncbi.nlm.nih.gov/compound/${c.cid}`;
function save(){state.updated=new Date().toLocaleString('zh-CN');try{localStorage.setItem('herblab-egfr-v1',JSON.stringify({...state,chat:{messages:state.chat.messages,draft:state.chat.draft,userId:state.chat.userId}}));}catch{toast('当前浏览器未允许保存草稿');}}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.remove('show'),3000);}
function page(){const p=location.hash.slice(1);return steps.some(s=>s[0]===p)?p:'task';}
function heading(top,title,sub,tag='通用疾病研究'){return `<div class="page-heading"><span class="eyebrow">${top}</span><div class="heading-row"><h1>${title}</h1><span class="tag">${tag}</span></div><p class="sub">${sub}</p></div>`;}
function actions(note,next,label){return `<div class="actionbar"><span>${note}</span><button class="primary" data-next="${next}">${label}${icon('arrow-right')}</button></div>`;}
function taskView(){return heading('01 / 开始研究','从一个疾病问题开始','输入任意疾病，选择检索范围，再建立对应的文献与候选研究记录。')+(window.ResearchUI?ResearchUI.taskPanel():'');}
function evidenceView(){return heading('02 / 文献与证据','理解本轮检索结果','先看研究概览，再展开文献、核对来源并继续向 AI 提问。')+(window.ResearchUI?ResearchUI.evidencePanel():'');}
function researchCandidateView(){const evidence=window.ResearchUI?.hasResult()?ResearchUI.candidatePanel():`<section class="research-empty-page"><div>${icon('list-filter')}<h2>尚无文献候选</h2><p>先完成疾病文献检索，系统才会在这一模式显示待核验化学线索。</p><button data-next="task" class="primary">返回开始研究</button></div></section>`;const mode=state.rankingMode||'evidence',content=mode==='evidence'?`<section class="ranking-mode-section"><div class="mode-heading"><span>MODE 01</span><h2>证据与数据库匹配候选</h2><p>候选来自当前疾病文献和数据库核对；排序优先级可追溯，但不等同于疗效强弱。</p></div>${evidence}</section>`:`<section class="ranking-mode-section"><div class="mode-heading"><span>MODE 02</span><h2>结构与机制潜力候选</h2><p>候选不以疾病论文为准入条件。结构与真实数据库字段独立展示，缺失维度不补零。</p></div>${window.StructureUI?.panel()||''}</section>`;return heading('03 / 候选与排序','选择一条候选发现路径','两种模式彼此独立；切换模式不会把文献热度带入结构机制路线。')+`<section class="ranking-mode-tabs" role="tablist" aria-label="候选排序模式"><button type="button" role="tab" aria-selected="${mode==='evidence'}" class="${mode==='evidence'?'active':''}" data-ranking-mode="evidence"><span>模式一</span><strong>证据与数据库匹配</strong><small>已有报道与数据库支持</small></button><button type="button" role="tab" aria-selected="${mode==='mechanism'}" class="${mode==='mechanism'?'active':''}" data-ranking-mode="mechanism"><span>模式二</span><strong>结构与机制潜力</strong><small>不要求已有疾病论文</small></button></section>${content}`;}
function experimentView(){const c=currentCandidate();if(!c.id)return heading('04 / 湿实验设计','先核对并选择讨论对象','请先在候选与排序页完成身份及研究相关性确认。')+'<section class="section"><button data-next="ranking" class="primary">返回候选与排序</button></section>';const ext=c.origin==='research';const hypothesisHint='准备验证什么？区分疾病相关表型与直接作用机制。';return heading('04 / 湿实验设计','把候选变成可讨论的验证方案','以下是方案记录表。实验条件、伦理和安全要求需要导师审核，页面不会自动生成已执行结果。')+`
<section class="section flow-card"><div class="section-head"><h2>当前拟验证候选</h2><span class="pill neutral">外部检索 · 药效待验证</span></div><label>选择候选<select id="selected">${allSelectable().map(x=>`<option value="${x.id}" ${state.selected===x.id?'selected':''}>${esc(candidateLabel(x))}</option>`).join('')}</select></label><p class="mini-note">当前：${esc(c.name||'未命名')} · ${esc(c.disease?.label||'当前研究疾病')} · 来源：${esc(c.source||'待核对')}${c.snapshot?.records?.length?` · PMID ${c.snapshot.records.map(r=>esc(r.pmid)).join(', ')}`:''}。身份与相关性确认记录见导出报告；药效仍未验证，不能据此得出临床疗效结论。</p></section>
<section class="section flow-card"><div class="section-head"><h2>实验设计记录</h2><span class="pill warn">待导师确认</span></div><div class="form-grid">${[['hypothesis','待验证假设',hypothesisHint],['model','研究模型','拟采用什么模型？为何适合这一问题？'],['controls','对照设置','阳性、阴性及溶剂对照如何设置？'],['readouts','观察指标','用哪些指标判断现象与机制？'],['plan','方案与待确认事项','记录重复、分析方法及需导师审核的条件。'],['resources','资源与可用性','记录需核对的材料、平台或共享资源。'],['replicates','重复与批次','只记录待确认的重复计划。'],['analysis','分析与数据处理','记录待确认的分析方法。'],['criteria','判定标准','记录待确认的成功或失败标准。']].map(([key,label,hint])=>`<label class="${['plan','analysis','criteria'].includes(key)?'full':''}">${label}<textarea data-experiment="${key}" placeholder="${hint}">${esc(state.experiment[key])}</textarea></label>`).join('')}</div><div class="button-row"><button id="outline">填入讨论提纲</button><button id="askPlan" class="primary">请智能体讨论方案</button></div><p class="mini-note">这里只保存设计草稿，未提供实验操作指令或自动执行。</p></section>${actions('方案保存在当前浏览器','report','进入结果回填')}`;}
function reportText(){const c=currentCandidate(),records=c.snapshot?.records||[];const refs=records.map(r=>`${r.pmid||'无 PMID'} ${r.title||''} ${r.url||''}`).join('\n')||'无外部文献记录';return `本草研习｜${c.disease?.label||c.name||'通用疾病'} 研究记录\n\n选择候选：${c.name||'尚未选择'}（${c.identifier||c.id||'无标识'}）\n来源：${c.source||'待核对'}\n状态：${c.id?'候选身份与研究相关性需人工确认，药效未验证。':'尚未选择候选。'}\n外部候选引用：\n${refs}\n我的判断：${state.reason||'未填写'}\n\n核验笔记：\n${records.map(r=>`${r.pmid||'无 PMID'}：${state.notes[r.pmid]||'未填写（摘要摘录不等于个人核验笔记）'}`).join('\n\n')||'未填写'}\n\n局限：文献路径和结构路径均不能直接证明疗效；缺失的结构、通道、亲和力、ADMET、BBB 与毒性数据不得自动补零。\n\n导出时间：${new Date().toLocaleString('zh-CN')}`;}
function completeReportText(){const c=currentCandidate();return `用户需求：${state.demand||'未填写'}\n\n本轮文献检索\n${c.origin==='research'?('文献来源：'+(c.snapshot?.source||'未填写')+'；化学线索来源：'+(c.source||'未填写')+'；查询：'+(c.snapshot?.query||'未记录')+'；获取时间：'+(c.snapshot?.retrievedAt||'未记录')+'；候选未核验'):(window.ResearchUI?ResearchUI.provenance():'未检索')}\n\n${reportText()}\n\n${candidateCheckSummary(c)}\n\n湿实验设计（待审核）\n${Object.entries({hypothesis:'待验证假设',model:'研究模型',controls:'对照设置',readouts:'观察指标',plan:'设计备注',resources:'资源',replicates:'重复',analysis:'分析',criteria:'判定标准'}).map(([k,v])=>`${v}：${state.experiment[k]||'未填写'}`).join('\n')}\n\n实际结果回填\n${Object.entries({observation:'观察',data:'原始数据位置',interpretation:'解释与局限',nextStep:'下一步'}).map(([k,v])=>`${v}：${state.result[k]||'未填写'}`).join('\n')}`;}
function wordReportHtml(){const c=currentCandidate(),records=c.snapshot?.records||[];const table=(items,labels)=>`<table>${items.map(([k,v])=>`<tr><th>${esc(labels[k]||k)}</th><td>${esc(v||'未填写').replace(/\n/g,'<br>')}</td></tr>`).join('')}</table>`;return `<!doctype html><html><head><meta charset="utf-8"><title>启真问智研究报告</title><style>body{font-family:"Microsoft YaHei",sans-serif;color:#24362d;line-height:1.65;margin:36px}h1{color:#1e6548;border-bottom:3px solid #1e6548;padding-bottom:12px}h2{color:#2e6a50;margin-top:28px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #cfd9d2;padding:9px;text-align:left;vertical-align:top}th{width:22%;background:#eff5f1}li{margin:6px 0}.notice{background:#fff6e8;border:1px solid #e8d5b3;padding:12px}</style></head><body><h1>启真问智 · ${esc(c.disease?.label||c.name||'通用疾病')}研究报告</h1><p>导出时间：${esc(new Date().toLocaleString('zh-CN'))}</p><p class="notice">科研教学辅助材料，不构成诊疗或用药建议；机器提取线索和 AI 回答需要回到原文核验。</p><h2>1. 研究问题</h2><p>${esc(state.demand||'未填写')}</p><h2>2. 当前讨论对象</h2>${table([['name',c.name||'尚未选择'],['source',c.source||'待核对'],['status',c.id?'外部候选，药效未验证':'尚未选择候选']],{name:'名称',source:'来源',status:'证据状态'})}<h2>3. 文献来源</h2><ol>${records.map(r=>`<li>${esc(r.title||'无题名')}；PMID ${esc(r.pmid||'无')} ${r.url?`<a href="${esc(r.url)}">查看原文</a>`:''}</li>`).join('')||'<li>暂无记录</li>'}</ol><h2>4. 候选核对与人工确认</h2><pre>${esc(candidateCheckSummary(c))}</pre><h2>5. 证据判断与疑问</h2><p>${esc(state.reason||'未填写').replace(/\n/g,'<br>')}</p><h2>6. 验证方案（待审核）</h2>${table(Object.entries(state.experiment),{hypothesis:'待验证假设',model:'研究模型',controls:'对照设置',readouts:'观察指标',plan:'方案备注',resources:'资源',replicates:'重复与批次',analysis:'分析方法',criteria:'判定标准'})}<h2>7. 实际结果回填</h2>${table(Object.entries(state.result),{observation:'实际观察',data:'原始数据位置',interpretation:'解释与局限',nextStep:'下一步'})}</body></html>`}
function exportWord(){const c=currentCandidate(),name=(c.disease?.label||c.name||'研究记录').replace(/[\\/:*?"<>|]/g,'_'),url=URL.createObjectURL(new Blob(['\ufeff',wordReportHtml()],{type:'application/msword;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`${name}研究报告.doc`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('结构化 Word 报告已导出');}
function exportWorkspace(){state.workspace.drafts[state.workspace.activeResearchKey||'__egfr']={reason:state.reason,notes:state.notes,reviewed:state.reviewed,experiment:state.experiment,result:state.result};const payload={schemaVersion:1,kind:'HerbWorkspaceRecord',exportedAt:new Date().toISOString(),state:{selected:state.selected,demand:state.demand,reason:state.reason,notes:state.notes,reviewed:state.reviewed,experiment:state.experiment,result:state.result,workspace:state.workspace}};const raw=JSON.stringify(payload);if(raw.length>2*1024*1024){toast('记录超过 2 MB，无法导出');return;}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([raw],{type:'application/json'}));a.download='herblab-research-record.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function plainObject(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function validTextMap(v){return plainObject(v)&&Object.values(v).every(x=>typeof x==='string'&&x.length<=50000);}
function validBoolMap(v){return plainObject(v)&&Object.values(v).every(x=>typeof x==='boolean');}
function validDraft(d){return plainObject(d)&&typeof d.reason==='string'&&validTextMap(d.notes)&&validBoolMap(d.reviewed)&&validTextMap(d.experiment)&&validTextMap(d.result);}
function validWorkspace(w){
 if(!plainObject(w)||w.schemaVersion!==1||typeof w.activeResearchKey!=='string'||!plainObject(w.externalCandidates)||!plainObject(w.drafts))return false;
 const rows=Object.entries(w.externalCandidates);if(rows.length>100||Object.keys(w.drafts).length>101)return false;
 for(const [key,c] of rows){
  if(!plainObject(c)||c.id!==`EXT:${key}`||typeof c.name!=='string'||!plainObject(c.disease)||typeof c.disease.label!=='string'||typeof c.disease.term!=='string'||!plainObject(c.snapshot))return false;
   if(!Array.isArray(c.snapshot.records)||c.snapshot.records.length>50||c.snapshot.records.some(r=>!plainObject(r)||typeof r.pmid!=='string'||!/^\d{1,12}$/.test(r.pmid)||typeof r.title!=='string'||(r.abstract!==undefined&&typeof r.abstract!=='string')))return false;
 }
 return Object.values(w.drafts).every(validDraft)&&(!w.activeResearchKey||!!w.externalCandidates[w.activeResearchKey]);
}
function validRecordState(s){return validDraft(s)&&typeof s.demand==='string'&&typeof s.selected==='string'&&validWorkspace(s.workspace)&&(s.selected===''||Object.values(s.workspace.externalCandidates).some(c=>c.id===s.selected));}
function importWorkspace(file){if(!file||file.size>2*1024*1024){toast('文件需小于等于 2 MB');return;}const rd=new FileReader();rd.onload=()=>{try{const p=JSON.parse(rd.result);const s=p?.state;if(p?.schemaVersion!==1||p.kind!=='HerbWorkspaceRecord'||!validRecordState(s))throw new Error('结构无效');if(!confirm('导入将覆盖当前本地草稿，是否继续？'))return;state={...state,demand:s.demand,selected:typeof s.selected==='string'?s.selected:state.selected,reason:s.reason,notes:s.notes,reviewed:s.reviewed,experiment:{...blankExperiment(),...s.experiment},result:{...blankResult(),...s.result},workspace:s.workspace};state.workspace.importedFromUser=true;save();render();toast('已导入用户研究记录（不改变 ResearchUI 状态）');}catch(err){toast(`导入失败：${err.message||'结构无效'}`);}};rd.readAsText(file);}
function discussionOutline(){const vals={hypothesis:'待确认：该候选在指定模型中的可观察表型与机制边界。',model:'待确认：模型、适用范围与选择理由。',controls:'待确认：阳性、阴性和溶剂对照。',readouts:'待确认：表型与机制观察指标。',plan:'待确认：实验顺序、风险和导师审核事项。',resources:'待确认：材料、平台和共享资源。',replicates:'待确认：重复与批次安排。',analysis:'待确认：数据整理与统计方法。',criteria:'待确认：结果判定标准。'};for(const k of EXPERIMENT_FIELDS)if(!String(state.experiment[k]||'').trim())state.experiment[k]=vals[k];save();render();}
function resultView(){return heading('05 / 结果回填','记录实际观察，再整理报告','尚未开展实验时请留空；预测排名和 AI 回答不能作为实验结果。')+`
<section class="section flow-card"><div class="section-head"><h2>实验结果记录</h2><span class="pill neutral">当前浏览器保存</span></div><div class="form-grid">${[['observation','观察到什么','如尚未实验，请留空。'],['data','原始数据位置或编号','记录实验本或文件编号。'],['interpretation','结果解释与局限','结果支持什么？还有哪些其他解释？'],['nextStep','下一步验证','哪些问题需要重复或补充实验？']].map(([key,label,hint])=>`<label>${label}<textarea data-result="${key}" placeholder="${hint}">${esc(state.result[key])}</textarea></label>`).join('')}</div><p class="mini-note">本页不验证数据真实性。记录仅留在当前浏览器，导出后请自行保存。</p></section>
<section class="section flow-card"><div class="section-head"><h2>学习报告</h2><span class="pill neutral">可导出</span></div><label>我的证据判断<textarea id="reason" placeholder="论文支持什么，排序能说明什么，还有什么需要实验验证？">${esc(state.reason)}</textarea></label><pre class="rank-source">文献证据路径与结构机制路径相互独立；只有补齐真实、可追溯且同口径的数据后才生成正式排名。缺失的 ADMET、BBB、毒性、通道和亲和力数据保持待补。</pre><details><summary>打印预览</summary><pre id="printableReport">${esc(completeReportText())}</pre></details><div class="button-row"><button data-next="experiment">返回实验设计</button><button id="printReport">打印报告 / 保存 PDF</button><button id="exportWord" class="primary">${icon('file-text')}导出 Word 报告</button><button id="download">${icon('download')}导出纯文本</button><button id="exportRecord">导出研究记录 JSON</button><button id="importRecord">导入研究记录</button><input id="importFile" type="file" accept="application/json" hidden></div><p class="mini-note">Word 导出为兼容 Microsoft Word 的 .doc 文档；PDF 使用浏览器打印窗口“另存为 PDF”。</p></section>`;}
function chatStatus(){if(location.protocol==='file:')return `<div class="chat-status warn">${icon('triangle-alert')}当前以文件方式打开。请访问 <a href="http://127.0.0.1:8787">http://127.0.0.1:8787</a>，并先运行项目根目录的“启动研学助手.cmd”。</div>`;if(state.chat.configured===true)return `<div class="chat-status ok">${icon('wifi')}智能体服务已配置</div>`;if(state.chat.configured===false)return `<div class="chat-status warn">${icon('triangle-alert')}智能体服务未配置，请检查服务端环境变量。</div>`;if(state.chat.configured==='unavailable')return `<div class="chat-status warn">${icon('triangle-alert')}暂时无法连接智能体服务，请确认服务已启动后重试。</div>`;return `<div class="chat-status">${icon('loader-circle')}正在检查智能体服务…</div>`;}
function chatHtml(value){return esc(value).replace(/\[(\d{7,9})\]\(https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\1\/?\)|\bPMID\s*[:：]?\s*(\d{7,9})\b/g,(_,linked,plain)=>{const id=linked||plain;return `<a href="https://pubmed.ncbi.nlm.nih.gov/${id}/" target="_blank" rel="noopener noreferrer">PMID ${id}</a>`;});}
function assistantView(p){const tips={task:['从疾病开始','输入疾病并开始研究，获得真实文献后再向助手提问。'],ranking:['解读候选','比较证据路径与结构机制路径；缺失的计算数据保持待补。'],evidence:['基于本轮文献','快捷问题会自动带入本轮检索资料并直接发送。'],experiment:['方案讨论','先写假设、模型、对照和观察指标，再请导师核对。'],report:['结果核对','只填写实际获得的数据；尚未实验的字段可以留空。']}[p]||['研习助手','围绕当前研究步骤提出可核对的问题。'];const msgs=state.chat.messages.map(m=>`<div class="chat-message ${m.role==='user'?'user':'bot'}"><span class="chat-role">${m.role==='user'?'你':'研习助手'}</span><div class="chat-text">${chatHtml(m.content)}</div></div>`).join('');const err=state.chat.error?`<div class="chat-error" role="alert">${esc(state.chat.error)}<button id="retryChat">重试</button></div>`:'';return `<div class="assistant-title">${icon('sparkles')}研习助手<small>AI 问答</small><button id="assistantClose" class="assistant-close" aria-label="关闭研习助手">${icon('x')}</button></div><div class="assistant-body"><div class="assistant-kicker">${icon('compass')}当前步骤</div><h3>${tips[0]}</h3><p>${tips[1]}</p>${window.ResearchUI?`<p class="assistant-scope">${esc(ResearchUI.scope())}</p>`:''}${chatStatus()}<div id="chatMessages" class="chat-messages">${msgs||`<div class="chat-empty">检索后可点击推荐问题，或在这里输入你自己的问题。</div>`}${state.chat.loading?`<div class="chat-message bot"><span class="chat-role">研习助手</span><div class="chat-text chat-loading">正在基于本轮资料整理回答…</div></div>`:''}</div>${err}<label class="chat-compose"><span>你的问题</span><textarea id="chatDraft" rows="4" placeholder="例如：这些文献主要支持什么结论，还有哪些局限？">${esc(state.chat.draft)}</textarea></label><div class="chat-actions"><button id="clearChat">${icon('trash-2')}清空对话</button><button id="sendChat" class="primary" ${state.chat.loading?'disabled':''}>${icon('send')}${state.chat.loading?'发送中…':'发送'} <small>Ctrl+Enter</small></button></div></div>`;}
async function checkHealth(){
 if(healthChecked||location.protocol==='file:')return;
 healthChecked=true;
 try{const res=await fetch('/api/health',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(5000)});if(!res.ok)throw new Error();const data=await res.json();state.chat.configured=data.configured===true;}
 catch{state.chat.configured='unavailable';}
 render();
}
async function sendChat(){
 if(state.chat.loading)return;
 if(location.protocol==='file:'){state.chat.error='请先运行启动研学助手.cmd，并打开 http://127.0.0.1:8787 进行问答。';render();return;}
 const draft=(state.chat.draft||'').trim();
 if(!draft){document.querySelector('#chatDraft')?.focus();return;}
 if(draft.length>6000){state.chat.error='问题过长，请缩短到 6000 字符以内。';render();return;}
 state.chat.error='';state.chat.loading=true;
 const prior=state.chat.messages.slice(-38);
 state.chat.messages=[...prior,{role:'user',content:draft}];save();render();
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),100000);
 try{
  const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({messages:state.chat.messages,user_id:state.chat.userId,research_id:window.ResearchUI?ResearchUI.getResearchId():''}),signal:controller.signal});
  let data={};try{data=await res.json();}catch{}
  if(!res.ok||typeof data.reply!=='string'||!data.reply.trim())throw new Error(typeof data.error==='string'?data.error:`请求失败（${res.status}）`);
  state.chat.messages.push({role:'assistant',content:data.reply});state.chat.draft='';state.chat.error='';
 }catch(err){
  state.chat.messages=prior;
  state.chat.error=err.name==='AbortError'?'请求超时，请重试。':(err.message||'暂时无法连接智能体，请稍后重试。');
 }finally{clearTimeout(timer);state.chat.loading=false;save();render();document.querySelector('#chatDraft')?.focus();}
}
window.HerbChat={ask(question){if(state.chat.loading)return;mobileAssistantOpen=true;state.chat.draft=String(question||'').trim();save();render();sendChat();},focus(){mobileAssistantOpen=true;render();document.querySelector('#chatDraft')?.focus();}};
function render(){const p=page(),assistant=document.querySelector('#assistant'),content=document.querySelector('.content'),toggle=document.querySelector('#assistantToggle');document.querySelector('#nav').innerHTML=steps.map(([key,i,label],n)=>`<a href="#${key}" class="${p===key?'active':''}" ${p===key?'aria-current="step"':''}>${icon(i)}<span class="nav-copy"><strong>${label}</strong><small>${['输入疾病并开始研究','查看本轮真实来源','比较两条候选路径','记录验证方案','整理观察与结论'][n]}</small></span><span class="step">0${n+1}</span></a>`).join('');document.querySelector('#main').innerHTML=({task:taskView,ranking:researchCandidateView,evidence:evidenceView,experiment:experimentView,report:resultView})[p]();assistant.hidden=p==='task';if(p==='task')mobileAssistantOpen=false;content.classList?.toggle?.('single-column',p==='task');assistant.classList?.toggle?.('open',mobileAssistantOpen&&!assistant.hidden);if(toggle)toggle.hidden=p==='task';if(!assistant.hidden)assistant.innerHTML=assistantView(p);if(window.lucide)lucide.createIcons();for(const id of ['chatDraft','clearChat','reset','askAgent']){const el=document.getElementById(id);if(el)el.disabled=!!state.chat.loading;}const log=document.getElementById('chatMessages');if(log)log.scrollTop=log.scrollHeight;}
document.addEventListener('click',async e=>{const next=e.target.closest('[data-next]');if(next)location.hash=next.dataset.next;const mode=e.target.closest('[data-ranking-mode]');if(mode){state.rankingMode=mode.dataset.rankingMode;save();render();}
 if(e.target.closest('#assistantToggle')){mobileAssistantOpen=true;render();setTimeout(()=>document.querySelector('#chatDraft')?.focus(),0);}
 if(e.target.closest('#assistantClose')){mobileAssistantOpen=false;render();}
 if(!state.chat.loading&&e.target.closest('#reset')&&confirm('清除当前浏览器中的笔记和报告草稿？')){const link=state.agentUrl;state={...initial(),agentUrl:link};save();location.hash='task';render();toast('案例草稿已重置');}
 if(e.target.closest('#copyPrompt')){const prompt=document.querySelector('#samplePrompt').textContent.trim();try{await navigator.clipboard.writeText(prompt);toast('问题已复制');}catch{window.prompt('请复制这段问题：',prompt);}}
 if(!state.chat.loading&&e.target.closest('#askAgent')){state.chat.draft=document.querySelector('#samplePrompt')?.textContent.trim()||'';render();document.querySelector('#chatDraft')?.focus();}
 if(e.target.closest('#sendChat'))sendChat();
 if(e.target.closest('#retryChat'))sendChat();
 if(e.target.closest('#outline'))discussionOutline();
 if(e.target.closest('#askPlan')){state.chat.draft=`请讨论当前实验方案草稿，明确指出待核验处。候选：${currentCandidate().name||''}。请先说明需要核对哪些文献、模型、对照和观察指标；我的实验和结果草稿未附带。`;save();render();document.querySelector('#chatDraft')?.focus();}
 if(!state.chat.loading&&e.target.closest('#clearChat')){state.chat.messages=[];state.chat.error='';state.chat.draft='';save();render();document.querySelector('#chatDraft')?.focus();}
 if(e.target.closest('#download')){const url=URL.createObjectURL(new Blob(['\ufeff'+completeReportText()],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;const c=currentCandidate();a.download=`${(c.disease?.label||c.name||'研究记录').replace(/[\\/:*?"<>|]/g,'_')}研究记录.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('报告已导出');}
 if(e.target.closest('#printReport')){const pre=document.querySelector('#printableReport');if(pre){pre.textContent=completeReportText();pre.parentElement.open=true;}window.print();}
 if(e.target.closest('#exportWord'))exportWord();
 if(e.target.closest('#exportRecord'))exportWorkspace();
 if(e.target.closest('#importRecord'))document.querySelector('#importFile')?.click();
});
document.addEventListener('input',e=>{const el=e.target;if(el.dataset.note)state.notes[el.dataset.note]=el.value;else if(el.dataset.experiment)state.experiment[el.dataset.experiment]=el.value;else if(el.dataset.result)state.result[el.dataset.result]=el.value;else if(el.id==='demand')state.demand=el.value;else if(el.id==='reason')state.reason=el.value;else if(el.id==='agentUrl')state.agentUrl=el.value;else if(el.id==='chatDraft'){state.chat.draft=el.value;try{localStorage.setItem('herblab-egfr-v1',JSON.stringify(state));}catch{}}else return;save();});
document.addEventListener('keydown',e=>{if(e.target.id==='chatDraft'&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();sendChat();}});
document.addEventListener('change',e=>{const el=e.target;if(el.dataset.reviewed){state.reviewed[el.dataset.reviewed]=el.checked;save();}if(el.id==='selected')selectCandidateId(el.value);if(el.id==='importFile')importWorkspace(el.files?.[0]);});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});render();checkHealth();

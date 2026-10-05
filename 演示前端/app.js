// 本地教学页面。AI 问答通过同源 /api/chat 完成。
const candidates = [
  {id:'C001',name:'槲皮素',en:'Quercetin',cid:5280343,formula:'C15H10O7',pmid:'34572484',context:'EGFR C797S 耐药非小细胞肺癌的细胞和移植瘤模型',finding:'摘要提出 AXL 相关机制。',limit:'不能据此说已证实直接抑制 EGFR。',status:'文献支持 · 特定模型'},
  {id:'C002',name:'木犀草素',en:'Luteolin',cid:5280445,formula:'C15H10O6',pmid:'24471765',context:'EGFR L858R/T790M 耐药非小细胞肺癌的细胞和小鼠模型',finding:'摘要报告与突变 EGFR 降解及 Hsp90 相互作用有关。',limit:'结果仅适用于论文的实验条件，不能外推为临床疗效。',status:'文献支持 · 特定模型'},
  {id:'C003',name:'黄芩素',en:'Baicalein',cid:5281605,formula:'C15H10O5',pmid:'27586635',context:'非小细胞肺癌 H-460 细胞和小鼠模型',finding:'这篇摘要重点讨论 VEGF 等变化。',limit:'不能仅凭此文标为直接作用 EGFR 已验证；黄芩素与黄芩苷是不同分子。',status:'肺癌相关 · EGFR 待核验'}
];
const steps=[['task','target','用户需求输入'],['evidence','library-big','文献检索结果'],['ranking','list-filter','待选药物单体'],['experiment','flask-conical','湿实验设计'],['report','clipboard-check','结果回填']];
const DEFAULT_AGENT_URL='https://yuanqi.tencent.com/webim/#/chat/vcaDuu?appid=2103722870126603328&experience=true';
const makeSessionId=()=>{try{return crypto.randomUUID();}catch{return 'herblab-'+Date.now()+'-'+Math.random().toString(16).slice(2);}};
const EXPERIMENT_FIELDS=['hypothesis','model','controls','readouts','plan','resources','replicates','analysis','criteria'];
const blankExperiment=()=>Object.fromEntries(EXPERIMENT_FIELDS.map(k=>[k,'']));
const blankResult=()=>({observation:'',data:'',interpretation:'',nextStep:''});
const initial=()=>({selected:'C002',reason:'',demand:'比较肺癌 EGFR 相关的中药单体，查看文献证据与两条候选排序路径。',notes:{},reviewed:{},experiment:blankExperiment(),result:blankResult(),agentUrl:DEFAULT_AGENT_URL,updated:'',chat:{messages:[],draft:'',userId:makeSessionId()},workspace:{schemaVersion:1,externalCandidates:{},drafts:{},activeResearchKey:''}});
let state=initial();
try { const saved=JSON.parse(localStorage.getItem('herblab-egfr-v1')); if(saved&&typeof saved==='object') state={...state,...saved}; } catch {}
// 兼容尚未配置链接的旧草稿，保留学生笔记。
if(typeof state.agentUrl!=='string'||!state.agentUrl.trim()) state.agentUrl=DEFAULT_AGENT_URL;
if(!state.chat||typeof state.chat!=='object') state.chat=initial().chat;
if(!Array.isArray(state.chat.messages)) state.chat.messages=[];
if(typeof state.chat.draft!=='string') state.chat.draft='';
if(typeof state.chat.userId!=='string'||!state.chat.userId) state.chat.userId=makeSessionId();
if(typeof state.demand!=='string')state.demand=initial().demand;
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
let healthChecked=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stableKey=(candidate={},snapshot={})=>{const disease=snapshot?.disease?.term||snapshot?.disease?.label||candidate.disease?.term||candidate.disease?.label||candidate.disease||'';const id=candidate.identifier||candidate.name||'';return `research:${String(disease).trim().toLowerCase()}|${String(id).trim().toLowerCase()}`.replace(/\s+/g,' ');};
const externalList=()=>Object.values(state.workspace.externalCandidates||{});
const externalById=id=>externalList().find(c=>c.id===id);
function draftFor(key){return state.workspace.drafts[key]||(state.workspace.drafts[key]={reason:'',notes:{},reviewed:{},experiment:blankExperiment(),result:blankResult()});}
function activeDraft(){return state.workspace.activeResearchKey?draftFor(state.workspace.activeResearchKey):state;}
function currentCandidate(){const ext=externalById(state.selected);if(ext)return {...ext,origin:'research',disease:ext.disease};const c=candidates.find(x=>x.id===state.selected)||candidates[1];return {...c,origin:'egfr'};}
function allSelectable(){return [...candidates,...externalList()];}
function candidateLabel(c){return c.origin==='research'?`${c.name||'未命名疾病'} · ${c.identifier||'无标识'} · ${c.source||'外部检索'}`:`${c.name} · ${c.id}`;}
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
function page(){const p=location.hash.slice(1);return p==='compare'||steps.some(s=>s[0]===p)?p:'task';}
function heading(top,title,sub){return `<div class="page-heading"><span class="eyebrow">${top}</span><div class="heading-row"><h1>${title}</h1><span class="tag">教学案例 / 01</span></div><p class="sub">${sub}</p></div>`;}
function actions(note,next,label){return `<div class="actionbar"><span>${note}</span><button class="primary" data-next="${next}">${label}${icon('arrow-right')}</button></div>`;}
function taskView(){return heading('01 / 用户需求输入','先说清楚你想研究什么','当前页面保留肺癌 EGFR 固定教学案例，同时支持明确点击后的新疾病 PubMed 检索。')+(window.ResearchUI?ResearchUI.taskPanel():'')+`
<section class="section flow-card"><div class="section-head"><h2>研究需求</h2><span class="pill neutral">本地记录</span></div><label>你想解决的问题<textarea id="demand" placeholder="例如：比较肺癌 EGFR 相关中药单体的证据与候选顺序">${esc(state.demand)}</textarea></label><div class="form-grid flow-fields"><div><span class="field-caption">疾病场景</span><strong>肺癌 / 非小细胞肺癌</strong></div><div><span class="field-caption">教学靶点</span><strong>EGFR · 2ITW 野生型结构</strong></div></div><p class="mini-note">这两个条件是当前案例的边界。换疾病或靶点需要另建检索资料和对接数据。</p></section>
<section class="section"><div class="section-head"><h2>本节目标</h2><span class="pill neutral">固定教学案例</span></div>
<p>阅读三种候选分子的样例论文，区分“肺癌相关”“涉及 EGFR 突变模型”与“直接作用 EGFR 已证实”。选择一条候选，写下依据和仍需核验的问题。</p>
<div class="stats"><div class="stat"><span>已核验候选</span><strong>03</strong><small>本地案例资料</small></div><div class="stat green"><span>样例论文</span><strong>03</strong><small>各一篇</small></div><div class="stat"><span>教学工作流</span><strong>01</strong><small>腾讯元器中已调试</small></div></div>
<div class="target-info">${icon('info')}<span>双排序已载入 EGFR 2ITW 同协议教学对接与统一检索数据。当前门槛 45 可展示三候选排名；参数未经科学校准，完整风险筛查尚未完成。请到“双排序”查看依据与参数。</span></div></section>
<section class="section"><div class="section-head"><h2>完整研学路径</h2></div><ol class="plan"><li><span class="number">1</span><div><h3>文献检索与核验</h3><p>阅读现有三篇样例文献，检查 PMID 和证据边界。</p></div>${icon('book-open-text')}</li><li><span class="number">2</span><div><h3>两条路径选候选</h3><p>比较最匹配与非热门排序，查看参数和原始输入。</p></div>${icon('list-filter')}</li><li><span class="number">3</span><div><h3>设计实验并回填结果</h3><p>形成待讨论方案，记录真实实验观察，导出完整报告。</p></div>${icon('flask-conical')}</li></ol></section>${actions('资料核验日期：2026-09-26','evidence','查看文献')}`;}
function compareView(){return heading('CANDIDATE COMPARISON / 候选对比','三种候选，三种证据语境','逐条查看来源，再判断文献到底支持什么。')+`
<section class="section"><div class="section-head"><h2>候选资料</h2><small>PubChem + 对应 PubMed 摘要</small></div><div class="table-scroll"><table><thead><tr><th>候选</th><th>PubChem CID</th><th>分子式</th><th>样例文献</th><th>证据状态</th></tr></thead><tbody>${candidates.map(c=>`<tr><td><strong>${c.name}</strong><small>${c.en}</small></td><td><a href="${pubchem(c)}" target="_blank" rel="noopener noreferrer">${c.cid}</a></td><td>${c.formula}</td><td><a href="${pubmed(c)}" target="_blank" rel="noopener noreferrer">PMID ${c.pmid}</a></td><td><span class="pill ${c.id==='C003'?'warn':''}">${c.status}</span></td></tr>`).join('')}</tbody></table></div><p class="mini-note">一篇样例论文不等于该分子的文献总数。手机上可左右滑动表格。</p></section>
<section class="section"><div class="section-head"><h2>查看双排序</h2></div><p>检查统一对接、过滤和文献热度数据，比较常规与冷门排名。</p><button class="primary" data-next="ranking">进入双排序</button></section><section class="section"><div class="section-head"><h2>思考题</h2></div><div class="evidence-item"><h3>哪两篇论文涉及 EGFR 突变模型？</h3><p>它们报告的机制有何不同？为什么第三篇不能算直接作用 EGFR 的证据？</p><button class="primary" data-next="evidence">研读证据 ${icon('arrow-right')}</button></div></section>`;}
function evidenceView(){return heading('02 / 文献检索结果','把结论放回研究条件中','固定 EGFR 教学资料与实时检索结果分开呈现；新疾病需要明确点击开始检索。')+(window.ResearchUI?ResearchUI.evidencePanel():'')+`<div class="flow-notice">${icon('search')}<span>以下三篇是 EGFR 教学样例，不会用于新疾病排序。实时结果请查看上方 PubMed 检索卡片。</span></div>`+candidates.map(c=>`
<article class="evidence-item"><div class="evidence-top"><div><h3>${c.name} <span class="sub">${c.en}</span></h3><p>${esc(c.context)}</p></div><span class="pill ${c.id==='C003'?'warn':''}">${c.status}</span></div>
<p><strong>摘要要点：</strong>${esc(c.finding)}</p><p><strong>判断边界：</strong>${esc(c.limit)}</p><div class="evidence-links"><a href="${pubmed(c)}" target="_blank" rel="noopener noreferrer">查看 PMID ${c.pmid} ${icon('external-link')}</a><a href="${pubchem(c)}" target="_blank" rel="noopener noreferrer">查看 PubChem ${icon('external-link')}</a></div>
<label>我的证据笔记<textarea data-note="${c.id}" placeholder="记录研究模型、结果、局限或追问…">${esc(state.notes[c.id]||'')}</textarea></label><label class="check-label"><input type="checkbox" data-reviewed="${c.id}" ${state.reviewed[c.id]?'checked':''}>我已阅读并记录这条资料</label></article>`).join('')+`
<section class="section"><div class="section-head"><h2>向智能体追问</h2></div><p>把这道问题送入右侧研习助手，回答会保留在当前学习工作台。</p><div class="prompt-box" id="samplePrompt">槲皮素与木犀草素的样例论文都涉及 EGFR 突变模型，它们报告的机制有什么不同？黄芩素为什么不能仅凭这篇论文标为 EGFR 已验证？请分别给出 PMID 和结论适用范围。</div><div class="button-row"><button id="copyPrompt">${icon('copy')}复制提问</button><button id="askAgent" class="primary">${icon('message-circle')}向智能体提问</button></div></section>${actions('核对原文后再判断候选','ranking','查看两条筛选路径')}`;}
function experimentView(){const c=currentCandidate(), ext=c.origin==='research';const hypothesisHint=ext?'准备验证什么？区分疾病相关表型与直接作用机制。':'准备验证什么？区分抗肿瘤表型与直接作用 EGFR。';return heading('04 / 湿实验设计','把候选变成可讨论的验证方案','以下是方案记录表。实验条件、伦理和安全要求需要导师审核，页面不会自动生成已执行结果。')+`
<section class="section flow-card"><div class="section-head"><h2>当前拟验证候选</h2><span class="pill neutral">${ext?'外部检索 · 未核验':'EGFR 教学草稿'}</span></div><label>选择候选<select id="selected">${allSelectable().map(x=>`<option value="${x.id}" ${state.selected===x.id?'selected':''}>${esc(candidateLabel(x))}</option>`).join('')}</select></label><p class="mini-note">当前：${esc(c.name||'未命名')} · ${esc(c.disease?.label||'肺癌 / EGFR')} · 来源：${esc(c.source||'本地教学资料')}${ext&&c.snapshot?.records?.length?` · PMID ${c.snapshot.records.map(r=>esc(r.pmid)).join(', ')}`:''}。${ext?'该候选未经核验，不能据此得出临床疗效结论。':'选择候选只是确定讨论对象，不表示该分子已被实验验证。'}</p></section>
<section class="section flow-card"><div class="section-head"><h2>实验设计记录</h2><span class="pill warn">待导师确认</span></div><div class="form-grid">${[['hypothesis','待验证假设',hypothesisHint],['model','研究模型','拟采用什么模型？为何适合这一问题？'],['controls','对照设置','阳性、阴性及溶剂对照如何设置？'],['readouts','观察指标','用哪些指标判断现象与机制？'],['plan','方案与待确认事项','记录重复、分析方法及需导师审核的条件。'],['resources','资源与可用性','记录需核对的材料、平台或共享资源。'],['replicates','重复与批次','只记录待确认的重复计划。'],['analysis','分析与数据处理','记录待确认的分析方法。'],['criteria','判定标准','记录待确认的成功或失败标准。']].map(([key,label,hint])=>`<label class="${['plan','analysis','criteria'].includes(key)?'full':''}">${label}<textarea data-experiment="${key}" placeholder="${hint}">${esc(state.experiment[key])}</textarea></label>`).join('')}</div><div class="button-row"><button id="outline">填入讨论提纲</button><button id="askPlan" class="primary">请智能体讨论方案</button></div><p class="mini-note">这里只保存设计草稿，未提供实验操作指令或自动执行。</p></section>${actions('方案保存在当前浏览器','report','进入结果回填')}`;}
function reportText(){const c=currentCandidate(),ext=c.origin==='research';const records=c.snapshot?.records||[];const refs=records.map(r=>`${r.pmid||'无 PMID'} ${r.title||''} ${r.url||''}`).join('\n')||'无外部文献记录';return `本草研习｜${ext?(c.disease?.label||c.name||'外部疾病'):'肺癌 EGFR'} 研究记录\n\n选择候选：${c.name||'未命名'}（${c.identifier||c.en||c.id||'无标识'}）\n来源：${c.source||'本地教学资料'}\n${ext?'状态：外部候选，未核验；不能据此得出临床疗效结论。':'样例论文：PMID '+c.pmid+' '+pubmed(c)}\n${ext?'外部候选引用：\n'+refs:'研究语境：'+(c.context||'')}\n我的判断：${state.reason||'未填写'}\n\n核验笔记：\n${ext?(records.map(r=>`${r.pmid||'无 PMID'}：${state.notes[r.pmid]||'未填写（摘要摘录不等于个人核验笔记）'}`).join('\n\n')||'未填写'):(candidates.map(x=>`${x.name} / PMID ${x.pmid}\n${state.notes[x.id]||'未填写'}`).join('\n\n'))}\n\n局限：${ext?'缺少对接、热度与过滤数据，不能排名。':'教学评分不作临床疗效判断。'}\n\n${ext?'不生成 EGFR 排名。':rankSummary()}\n导出时间：${new Date().toLocaleString('zh-CN')}`;}
function reportView(){const c=currentCandidate(),ext=c.origin==='research';return heading('LEARNING REPORT / 学习报告','写下你的判断','学生的本地报告草稿，可交给教师讨论。')+`
<div class="report"><span class="eyebrow">HERBLAB / ${ext?'RESEARCH RECORD':'CASE 01'}</span><h2>${esc(ext?(c.disease?.label||c.name||'外部疾病')+' 研究记录':'肺癌 EGFR 候选比较')}<br>教学报告</h2><div class="report-meta">${ext?'用户导入 / 外部检索，未经核验':'本地草稿 · 资料核验于 2026-09-26'}</div><h3>01 / 选择候选</h3><label>我想讨论的对象<select id="selected">${allSelectable().map(x=>`<option value="${x.id}" ${state.selected===x.id?'selected':''}>${esc(candidateLabel(x))}</option>`).join('')}</select></label><p>${ext?'外部候选引用：'+(c.snapshot?.records||[]).map(r=>`PMID ${esc(r.pmid||'无')}`).join('、')+'；候选未经核验，不能据此得出临床疗效结论。':`样例论文：<a href="${pubmed(c)}" target="_blank" rel="noopener noreferrer">PMID ${c.pmid}</a>`}</p><h3>02 / 我的依据和疑问</h3><label><textarea id="reason" placeholder="论文研究了什么？支持什么结论？还不能判断什么？">${esc(state.reason)}</textarea></label><h3>03 / ${ext?'数据边界':'双排序计算摘要'}</h3><pre class="rank-source">${esc(ext?'缺少对接、热度与过滤数据，不排名；不套用 EGFR 排名。':rankSummary())}</pre><h3>04 / 证据笔记完成情况</h3>${(ext?(c.snapshot?.records||[]).map(r=>({id:r.pmid,name:`PMID ${r.pmid}`})) :candidates).map(x=>{const ok=state.reviewed[x.id]&&(state.notes[x.id]||'').trim();return `<div class="feedback ${ok?'':'pending'}">${icon(ok?'circle-check':'circle-dashed')}<span>${esc(x.name)}：${ok?'已记录':'待补充'}</span></div>`;}).join('')}<p class="mini-note">完成情况由本地规则检查，不是 AI 评分；研究判断需教师结合原文审核。</p></div><div class="actionbar"><button data-next="evidence">${icon('arrow-left')}返回研读</button><button id="download" class="primary">${icon('download')}导出报告 .txt</button><button id="printReport">打印报告 / 保存 PDF</button></div>`;}
function completeReportText(){const c=currentCandidate();return `用户需求：${state.demand||'未填写'}\n\n本轮文献检索\n${c.origin==='research'?('文献来源：'+(c.snapshot?.source||'未填写')+'；化学线索来源：'+(c.source||'未填写')+'；查询：'+(c.snapshot?.query||'未记录')+'；获取时间：'+(c.snapshot?.retrievedAt||'未记录')+'；候选未核验'):(window.ResearchUI?ResearchUI.provenance():'未检索')}\n\n${reportText()}\n\n湿实验设计（待审核）\n${Object.entries({hypothesis:'待验证假设',model:'研究模型',controls:'对照设置',readouts:'观察指标',plan:'设计备注',resources:'资源',replicates:'重复',analysis:'分析',criteria:'判定标准'}).map(([k,v])=>`${v}：${state.experiment[k]||'未填写'}`).join('\n')}\n\n实际结果回填\n${Object.entries({observation:'观察',data:'原始数据位置',interpretation:'解释与局限',nextStep:'下一步'}).map(([k,v])=>`${v}：${state.result[k]||'未填写'}`).join('\n')}`;}
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
  if(!Array.isArray(c.snapshot.records)||c.snapshot.records.length>8||c.snapshot.records.some(r=>!plainObject(r)||typeof r.pmid!=='string'||!/^\d{1,12}$/.test(r.pmid)||typeof r.title!=='string'||(r.abstract!==undefined&&typeof r.abstract!=='string')))return false;
 }
 return Object.values(w.drafts).every(validDraft)&&(!w.activeResearchKey||!!w.externalCandidates[w.activeResearchKey]);
}
function validRecordState(s){return validDraft(s)&&typeof s.demand==='string'&&typeof s.selected==='string'&&validWorkspace(s.workspace)&&(['C001','C002','C003'].includes(s.selected)||Object.values(s.workspace.externalCandidates).some(c=>c.id===s.selected));}
function importWorkspace(file){if(!file||file.size>2*1024*1024){toast('文件需小于等于 2 MB');return;}const rd=new FileReader();rd.onload=()=>{try{const p=JSON.parse(rd.result);const s=p?.state;if(p?.schemaVersion!==1||p.kind!=='HerbWorkspaceRecord'||!validRecordState(s))throw new Error('结构无效');if(!confirm('导入将覆盖当前本地草稿，是否继续？'))return;state={...state,demand:s.demand,selected:typeof s.selected==='string'?s.selected:state.selected,reason:s.reason,notes:s.notes,reviewed:s.reviewed,experiment:{...blankExperiment(),...s.experiment},result:{...blankResult(),...s.result},workspace:s.workspace};state.workspace.importedFromUser=true;save();render();toast('已导入用户研究记录（不改变 ResearchUI 状态）');}catch(err){toast(`导入失败：${err.message||'结构无效'}`);}};rd.readAsText(file);}
function discussionOutline(){const vals={hypothesis:'待确认：该候选在指定模型中的可观察表型与机制边界。',model:'待确认：模型、适用范围与选择理由。',controls:'待确认：阳性、阴性和溶剂对照。',readouts:'待确认：表型与机制观察指标。',plan:'待确认：实验顺序、风险和导师审核事项。',resources:'待确认：材料、平台和共享资源。',replicates:'待确认：重复与批次安排。',analysis:'待确认：数据整理与统计方法。',criteria:'待确认：结果判定标准。'};for(const k of EXPERIMENT_FIELDS)if(!String(state.experiment[k]||'').trim())state.experiment[k]=vals[k];save();render();}
function resultView(){return heading('05 / 结果回填','记录实际观察，再整理报告','尚未开展实验时请留空；预测排名和 AI 回答不能作为实验结果。')+`
<section class="section flow-card"><div class="section-head"><h2>实验结果记录</h2><span class="pill neutral">当前浏览器保存</span></div><div class="form-grid">${[['observation','观察到什么','如尚未实验，请留空。'],['data','原始数据位置或编号','记录实验本或文件编号。'],['interpretation','结果解释与局限','结果支持什么？还有哪些其他解释？'],['nextStep','下一步验证','哪些问题需要重复或补充实验？']].map(([key,label,hint])=>`<label>${label}<textarea data-result="${key}" placeholder="${hint}">${esc(state.result[key])}</textarea></label>`).join('')}</div><p class="mini-note">本页不验证数据真实性。记录仅留在当前浏览器，导出后请自行保存。</p></section>
<section class="section flow-card"><div class="section-head"><h2>学习报告</h2><span class="pill neutral">可导出</span></div><label>我的证据判断<textarea id="reason" placeholder="论文支持什么，排序能说明什么，还有什么需要实验验证？">${esc(state.reason)}</textarea></label><pre class="rank-source">${esc(currentCandidate().origin==='research'?'缺少对接、热度与过滤数据，不排名；不套用 EGFR 排名。':rankSummary())}</pre><details><summary>打印预览</summary><pre id="printableReport">${esc(completeReportText())}</pre></details><div class="button-row"><button data-next="experiment">返回实验设计</button><button id="printReport">打印报告 / 保存 PDF</button><button id="download" class="primary">${icon('download')}导出完整报告 .txt</button><button id="exportRecord">导出研究记录 JSON</button><button id="importRecord">导入研究记录</button><input id="importFile" type="file" accept="application/json" hidden></div></section>`;}
function chatStatus(){if(location.protocol==='file:')return `<div class="chat-status warn">${icon('triangle-alert')}当前以文件方式打开。请访问 <a href="http://127.0.0.1:8787">http://127.0.0.1:8787</a>，并先运行项目根目录的“启动研学助手.cmd”。</div>`;if(state.chat.configured===true)return `<div class="chat-status ok">${icon('wifi')}智能体服务已配置</div>`;if(state.chat.configured===false)return `<div class="chat-status warn">${icon('triangle-alert')}智能体服务未配置，请检查服务端环境变量。</div>`;if(state.chat.configured==='unavailable')return `<div class="chat-status warn">${icon('triangle-alert')}暂时无法连接智能体服务，请确认服务已启动后重试。</div>`;return `<div class="chat-status">${icon('loader-circle')}正在检查智能体服务…</div>`;}
function assistantView(p){const tips={task:['需求边界','填写疾病并点击开始检索，可获取文献与待核验的化学实体线索。'],ranking:['解读候选','最匹配与非热门来自本地同一批候选数据；智能体不会自动获得排序结果。'],compare:['候选资料','核对分子身份与来源，再决定进入哪条路径。'],evidence:['核验文献','点开 PMID 核对论文，智能体回答也需要与原文比对。'],experiment:['方案讨论','先写假设、模型、对照和观察指标，再请导师核对。'],report:['结果核对','只填写实际获得的数据；尚未实验的字段可以留空。']}[p];const msgs=state.chat.messages.map(m=>`<div class="chat-message ${m.role==='user'?'user':'bot'}"><span class="chat-role">${m.role==='user'?'你':'研习助手'}</span><div class="chat-text">${esc(m.content)}</div></div>`).join('');const err=state.chat.error?`<div class="chat-error" role="alert">${esc(state.chat.error)}<button id="retryChat">重试</button></div>`:'';return `<div class="assistant-title">${icon('sparkles')}研习助手<small>AI 问答</small></div><div class="assistant-body"><div class="assistant-kicker">${icon('compass')}当前步骤</div><h3>${tips[0]}</h3><p>${tips[1]}</p>${window.ResearchUI?`<p class="mini-note">${esc(ResearchUI.scope())}</p>`:''}${chatStatus()}<div id="chatMessages" class="chat-messages">${msgs||`<div class="chat-empty">还没有提问。输入问题后，智能体会返回可核对的文字回答。</div>`}${state.chat.loading?`<div class="chat-message bot"><span class="chat-role">研习助手</span><div class="chat-text chat-loading">正在检索并整理回答…</div></div>`:''}</div>${err}<label class="chat-compose"><span>你的问题</span><textarea id="chatDraft" rows="4" placeholder="例如：两篇 EGFR 突变模型论文的证据边界有什么不同？">${esc(state.chat.draft)}</textarea></label><div class="chat-actions"><button id="clearChat">${icon('trash-2')}清空对话</button><button id="sendChat" class="primary" ${state.chat.loading?'disabled':''}>${icon('send')}${state.chat.loading?'发送中…':'发送'} <small>Ctrl+Enter</small></button></div>${p==='task'||p==='compare'?`<div class="molecule"><img src="quercetin.png" alt="槲皮素二维结构"><div class="molecule-label"><strong>槲皮素</strong><span>CID 5280343</span></div><p class="mini-note">结构示例 · PubChem</p></div>`:''}</div><a class="assistant-link" href="https://pubchem.ncbi.nlm.nih.gov/compound/5280343" target="_blank" rel="noopener noreferrer">查看结构来源 ${icon('arrow-up-right')}</a>`;}
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
function render(){const p=page();document.querySelector('#nav').innerHTML=steps.map(([key,i,label],n)=>`<a href="#${key}" class="${p===key||(p==='compare'&&key==='ranking')?'active':''}" ${p===key?'aria-current="step"':''}>${icon(i)}<span class="nav-copy"><strong>${label}</strong><small>${['明确问题与靶点','核对来源与证据','最匹配 / 非热门','写下验证方案','记录观察与结论'][n]}</small></span><span class="step">0${n+1}</span></a>`).join('');document.querySelector('#main').innerHTML=({task:taskView,compare:compareView,ranking:rankingView,evidence:evidenceView,experiment:experimentView,report:resultView})[p]();document.querySelector('#assistant').innerHTML=assistantView(p);if(window.lucide)lucide.createIcons();for(const id of ['chatDraft','clearChat','reset','askAgent']){const el=document.getElementById(id);if(el)el.disabled=!!state.chat.loading;}const log=document.getElementById('chatMessages');if(log)log.scrollTop=log.scrollHeight;}
document.addEventListener('click',async e=>{const next=e.target.closest('[data-next]');if(next)location.hash=next.dataset.next;
 if(!state.chat.loading&&e.target.closest('#reset')&&confirm('清除当前浏览器中的笔记和报告草稿？')){const link=state.agentUrl;state={...initial(),agentUrl:link};save();location.hash='task';render();toast('案例草稿已重置');}
 if(e.target.closest('#copyPrompt')){const prompt=document.querySelector('#samplePrompt').textContent.trim();try{await navigator.clipboard.writeText(prompt);toast('问题已复制');}catch{window.prompt('请复制这段问题：',prompt);}}
 if(!state.chat.loading&&e.target.closest('#askAgent')){state.chat.draft=document.querySelector('#samplePrompt')?.textContent.trim()||'';render();document.querySelector('#chatDraft')?.focus();}
 if(e.target.closest('#sendChat'))sendChat();
 if(e.target.closest('#retryChat'))sendChat();
 if(e.target.closest('#outline'))discussionOutline();
 if(e.target.closest('#askPlan')){state.chat.draft=`请讨论当前实验方案草稿，明确指出待核验处。候选：${currentCandidate().name||''}\n${JSON.stringify(state.experiment)}`;save();render();document.querySelector('#chatDraft')?.focus();}
 if(!state.chat.loading&&e.target.closest('#clearChat')){state.chat.messages=[];state.chat.error='';state.chat.draft='';save();render();document.querySelector('#chatDraft')?.focus();}
 if(e.target.closest('#download')){const url=URL.createObjectURL(new Blob(['\ufeff'+completeReportText()],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;const c=currentCandidate();a.download=`${(c.disease?.label||c.name||'研究记录').replace(/[\\/:*?"<>|]/g,'_')}研究记录.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('报告已导出');}
 if(e.target.closest('#printReport')){const pre=document.querySelector('#printableReport');if(pre){pre.textContent=completeReportText();pre.parentElement.open=true;}window.print();}
 if(e.target.closest('#exportRecord'))exportWorkspace();
 if(e.target.closest('#importRecord'))document.querySelector('#importFile')?.click();
});
document.addEventListener('input',e=>{const el=e.target;if(el.dataset.note)state.notes[el.dataset.note]=el.value;else if(el.dataset.experiment)state.experiment[el.dataset.experiment]=el.value;else if(el.dataset.result)state.result[el.dataset.result]=el.value;else if(el.id==='demand')state.demand=el.value;else if(el.id==='reason')state.reason=el.value;else if(el.id==='agentUrl')state.agentUrl=el.value;else if(el.id==='chatDraft'){state.chat.draft=el.value;try{localStorage.setItem('herblab-egfr-v1',JSON.stringify(state));}catch{}}else return;save();});
document.addEventListener('keydown',e=>{if(e.target.id==='chatDraft'&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();sendChat();}});
document.addEventListener('change',e=>{const el=e.target;if(el.dataset.reviewed){state.reviewed[el.dataset.reviewed]=el.checked;save();}if(el.id==='selected')selectCandidateId(el.value);if(el.id==='importFile')importWorkspace(el.files?.[0]);});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});render();checkHealth();

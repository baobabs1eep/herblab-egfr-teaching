// 本地教学页面。AI 问答通过同源 /api/chat 完成。
const candidates = [
  {id:'C001',name:'槲皮素',en:'Quercetin',cid:5280343,formula:'C15H10O7',pmid:'34572484',context:'EGFR C797S 耐药非小细胞肺癌的细胞和移植瘤模型',finding:'摘要提出 AXL 相关机制。',limit:'不能据此说已证实直接抑制 EGFR。',status:'文献支持 · 特定模型'},
  {id:'C002',name:'木犀草素',en:'Luteolin',cid:5280445,formula:'C15H10O6',pmid:'24471765',context:'EGFR L858R/T790M 耐药非小细胞肺癌的细胞和小鼠模型',finding:'摘要报告与突变 EGFR 降解及 Hsp90 相互作用有关。',limit:'结果仅适用于论文的实验条件，不能外推为临床疗效。',status:'文献支持 · 特定模型'},
  {id:'C003',name:'黄芩素',en:'Baicalein',cid:5281605,formula:'C15H10O5',pmid:'27586635',context:'非小细胞肺癌 H-460 细胞和小鼠模型',finding:'这篇摘要重点讨论 VEGF 等变化。',limit:'不能仅凭此文标为直接作用 EGFR 已验证；黄芩素与黄芩苷是不同分子。',status:'肺癌相关 · EGFR 待核验'}
];
const steps=[['task','clipboard-list','教学任务'],['compare','table-2','候选对比'],['ranking','list-ordered','双排序'],['evidence','book-open-text','证据研读'],['report','file-text','学习报告']];
const DEFAULT_AGENT_URL='https://yuanqi.tencent.com/webim/#/chat/vcaDuu?appid=2103722870126603328&experience=true';
const makeSessionId=()=>{try{return crypto.randomUUID();}catch{return 'herblab-'+Date.now()+'-'+Math.random().toString(16).slice(2);}};
const initial=()=>({selected:'C002',reason:'',notes:{},reviewed:{},agentUrl:DEFAULT_AGENT_URL,updated:'',chat:{messages:[],draft:'',userId:makeSessionId()}});
let state=initial();
try { const saved=JSON.parse(localStorage.getItem('herblab-egfr-v1')); if(saved&&typeof saved==='object') state={...state,...saved}; } catch {}
// 兼容尚未配置链接的旧草稿，保留学生笔记。
if(typeof state.agentUrl!=='string'||!state.agentUrl.trim()) state.agentUrl=DEFAULT_AGENT_URL;
if(!state.chat||typeof state.chat!=='object') state.chat=initial().chat;
if(!Array.isArray(state.chat.messages)) state.chat.messages=[];
if(typeof state.chat.draft!=='string') state.chat.draft='';
if(typeof state.chat.userId!=='string'||!state.chat.userId) state.chat.userId=makeSessionId();
state.chat.loading=false;
state.chat.error='';
state.chat.configured=undefined;
if(state.chat.messages.length&&state.chat.messages[state.chat.messages.length-1].role==='user'){
  state.chat.draft=state.chat.messages.pop().content||state.chat.draft;
}
let healthChecked=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=n=>`<i data-lucide="${n}"></i>`;
const pubmed=c=>`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`;
const pubchem=c=>`https://pubchem.ncbi.nlm.nih.gov/compound/${c.cid}`;
function save(){state.updated=new Date().toLocaleString('zh-CN');try{localStorage.setItem('herblab-egfr-v1',JSON.stringify({...state,chat:{messages:state.chat.messages,draft:state.chat.draft,userId:state.chat.userId}}));}catch{toast('当前浏览器未允许保存草稿');}}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.remove('show'),3000);}
function page(){const p=location.hash.slice(1);return steps.some(s=>s[0]===p)?p:'task';}
function heading(top,title,sub){return `<div class="page-heading"><span class="eyebrow">${top}</span><div class="heading-row"><h1>${title}</h1><span class="tag">教学案例 / 01</span></div><p class="sub">${sub}</p></div>`;}
function actions(note,next,label){return `<div class="actionbar"><span>${note}</span><button class="primary" data-next="${next}">${label}${icon('arrow-right')}</button></div>`;}
function taskView(){return heading('LEARNING BRIEF / 教学任务','从证据开始判断','肺癌 EGFR 候选比较 · 中药单体筛选研学助手')+`
<section class="section"><div class="section-head"><h2>本节目标</h2><span class="pill neutral">固定教学案例</span></div>
<p>阅读三种候选分子的样例论文，区分“肺癌相关”“涉及 EGFR 突变模型”与“直接作用 EGFR 已证实”。选择一条候选，写下依据和仍需核验的问题。</p>
<div class="stats"><div class="stat"><span>已核验候选</span><strong>03</strong><small>本地案例资料</small></div><div class="stat green"><span>样例论文</span><strong>03</strong><small>各一篇</small></div><div class="stat"><span>教学工作流</span><strong>01</strong><small>腾讯元器中已调试</small></div></div>
<div class="target-info">${icon('info')}<span>双排序已载入 EGFR 2ITW 同协议教学对接与统一检索数据。当前门槛 45 可展示三候选排名；参数未经科学校准，完整风险筛查尚未完成。请到“双排序”查看依据与参数。</span></div></section>
<section class="section"><div class="section-head"><h2>学习步骤</h2></div><ol class="plan"><li><span class="number">1</span><div><h3>比较候选与双排序</h3><p>核对分子身份，补齐统一计算数据后比较常规与冷门排名。</p></div>${icon('table-2')}</li><li><span class="number">2</span><div><h3>追问智能体</h3><p>在页面内提问，检索知识库并核对回答中的 PMID。</p></div>${icon('message-circle')}</li><li><span class="number">3</span><div><h3>写下判断</h3><p>记录证据和局限，导出报告供教师讨论。</p></div>${icon('file-text')}</li></ol></section>${actions('资料核验日期：2026-09-26','compare','查看候选')}`;}
function compareView(){return heading('CANDIDATE COMPARISON / 候选对比','三种候选，三种证据语境','逐条查看来源，再判断文献到底支持什么。')+`
<section class="section"><div class="section-head"><h2>候选资料</h2><small>PubChem + 对应 PubMed 摘要</small></div><div class="table-scroll"><table><thead><tr><th>候选</th><th>PubChem CID</th><th>分子式</th><th>样例文献</th><th>证据状态</th></tr></thead><tbody>${candidates.map(c=>`<tr><td><strong>${c.name}</strong><small>${c.en}</small></td><td><a href="${pubchem(c)}" target="_blank" rel="noopener noreferrer">${c.cid}</a></td><td>${c.formula}</td><td><a href="${pubmed(c)}" target="_blank" rel="noopener noreferrer">PMID ${c.pmid}</a></td><td><span class="pill ${c.id==='C003'?'warn':''}">${c.status}</span></td></tr>`).join('')}</tbody></table></div><p class="mini-note">一篇样例论文不等于该分子的文献总数。手机上可左右滑动表格。</p></section>
<section class="section"><div class="section-head"><h2>查看双排序</h2></div><p>检查统一对接、过滤和文献热度数据，比较常规与冷门排名。</p><button class="primary" data-next="ranking">进入双排序</button></section><section class="section"><div class="section-head"><h2>思考题</h2></div><div class="evidence-item"><h3>哪两篇论文涉及 EGFR 突变模型？</h3><p>它们报告的机制有何不同？为什么第三篇不能算直接作用 EGFR 的证据？</p><button class="primary" data-next="evidence">研读证据 ${icon('arrow-right')}</button></div></section>`;}
function evidenceView(){return heading('EVIDENCE REVIEW / 证据研读','把结论放回研究条件中','每条判断都有出处，也有不能外推的边界。')+candidates.map(c=>`
<article class="evidence-item"><div class="evidence-top"><div><h3>${c.name} <span class="sub">${c.en}</span></h3><p>${esc(c.context)}</p></div><span class="pill ${c.id==='C003'?'warn':''}">${c.status}</span></div>
<p><strong>摘要要点：</strong>${esc(c.finding)}</p><p><strong>判断边界：</strong>${esc(c.limit)}</p><div class="evidence-links"><a href="${pubmed(c)}" target="_blank" rel="noopener noreferrer">查看 PMID ${c.pmid} ${icon('external-link')}</a><a href="${pubchem(c)}" target="_blank" rel="noopener noreferrer">查看 PubChem ${icon('external-link')}</a></div>
<label>我的证据笔记<textarea data-note="${c.id}" placeholder="记录研究模型、结果、局限或追问…">${esc(state.notes[c.id]||'')}</textarea></label><label class="check-label"><input type="checkbox" data-reviewed="${c.id}" ${state.reviewed[c.id]?'checked':''}>我已阅读并记录这条资料</label></article>`).join('')+`
<section class="section"><div class="section-head"><h2>向智能体追问</h2></div><p>把这道问题送入右侧研习助手，回答会保留在当前学习工作台。</p><div class="prompt-box" id="samplePrompt">槲皮素与木犀草素的样例论文都涉及 EGFR 突变模型，它们报告的机制有什么不同？黄芩素为什么不能仅凭这篇论文标为 EGFR 已验证？请分别给出 PMID 和结论适用范围。</div><div class="button-row"><button id="copyPrompt">${icon('copy')}复制提问</button><button id="askAgent" class="primary">${icon('message-circle')}向智能体提问</button></div></section>${actions('笔记保存在当前浏览器','report','整理学习报告')}`;}
function reportText(){const c=candidates.find(x=>x.id===state.selected)||candidates[1];return `本草研习｜肺癌 EGFR 候选比较教学报告\n\n选择候选：${c.name}（${c.en}）\n样例论文：PMID ${c.pmid} ${pubmed(c)}\n研究语境：${c.context}\n我的判断：${state.reason||'未填写'}\n\n证据笔记：\n${candidates.map(x=>`${x.name} / PMID ${x.pmid}\n${state.notes[x.id]||'未填写'}`).join('\n\n')}\n\n局限：排序结果见以下记录；若数据缺失则不产生名次。教学评分不作临床疗效判断。\n\n${rankSummary()}\n导出时间：${new Date().toLocaleString('zh-CN')}`;}
function reportView(){const c=candidates.find(x=>x.id===state.selected)||candidates[1];return heading('LEARNING REPORT / 学习报告','写下你的判断','学生的本地报告草稿，可交给教师讨论。')+`
<div class="report"><span class="eyebrow">HERBLAB / CASE 01</span><h2>肺癌 EGFR 候选比较<br>教学报告</h2><div class="report-meta">本地草稿 · 资料核验于 2026-09-26</div><h3>01 / 选择候选</h3><label>我想讨论的分子<select id="selected">${candidates.map(x=>`<option value="${x.id}" ${state.selected===x.id?'selected':''}>${x.name} · PMID ${x.pmid}</option>`).join('')}</select></label><p>样例论文：<a href="${pubmed(c)}" target="_blank" rel="noopener noreferrer">PMID ${c.pmid}</a></p><h3>02 / 我的依据和疑问</h3><label><textarea id="reason" placeholder="论文研究了什么？支持什么结论？还不能判断什么？">${esc(state.reason)}</textarea></label><h3>03 / 双排序计算摘要</h3><pre class="rank-source">${esc(rankSummary())}</pre><h3>04 / 证据笔记完成情况</h3>${candidates.map(x=>{const ok=state.reviewed[x.id]&&(state.notes[x.id]||'').trim();return `<div class="feedback ${ok?'':'pending'}">${icon(ok?'circle-check':'circle-dashed')}<span>${x.name}：${ok?'已记录':'待补充'}</span></div>`;}).join('')}<p class="mini-note">完成情况由本地规则检查，不是 AI 评分；研究判断需教师结合原文审核。</p></div><div class="actionbar"><button data-next="evidence">${icon('arrow-left')}返回研读</button><button id="download" class="primary">${icon('download')}导出报告 .txt</button></div>`;}
function chatStatus(){if(location.protocol==='file:')return `<div class="chat-status warn">${icon('triangle-alert')}当前以文件方式打开。请访问 <a href="http://127.0.0.1:8787">http://127.0.0.1:8787</a>，并先运行项目根目录的“启动研学助手.cmd”。</div>`;if(state.chat.configured===true)return `<div class="chat-status ok">${icon('wifi')}智能体服务已配置</div>`;if(state.chat.configured===false)return `<div class="chat-status warn">${icon('triangle-alert')}智能体服务未配置，请检查服务端环境变量。</div>`;if(state.chat.configured==='unavailable')return `<div class="chat-status warn">${icon('triangle-alert')}暂时无法连接智能体服务，请确认服务已启动后重试。</div>`;return `<div class="chat-status">${icon('loader-circle')}正在检查智能体服务…</div>`;}
function assistantView(p){const tips={task:['教学目标','比较论文的研究对象、证据与适用范围。'],ranking:['解读排名','排名由本地规则计算。请结合下方来源和缺失状态解读，AI 不会自动获得你导入的数据。'],compare:['阅读提示','先点开 PMID，再判断哪篇更适合回答 EGFR 相关问题。'],evidence:['即时问答','把证据问题交给研习助手，并核对回答中的 PMID。'],report:['教师讨论','查看学生依据，核对来源与证据边界。']}[p];const msgs=state.chat.messages.map(m=>`<div class="chat-message ${m.role==='user'?'user':'bot'}"><span class="chat-role">${m.role==='user'?'你':'研习助手'}</span><div class="chat-text">${esc(m.content)}</div></div>`).join('');const err=state.chat.error?`<div class="chat-error" role="alert">${esc(state.chat.error)}<button id="retryChat">重试</button></div>`:'';return `<div class="assistant-title">${icon('sparkles')}研习助手<small>AI 问答</small></div><div class="assistant-body"><div class="assistant-kicker">${icon('compass')}当前步骤</div><h3>${tips[0]}</h3><p>${tips[1]}</p>${chatStatus()}<div id="chatMessages" class="chat-messages">${msgs||`<div class="chat-empty">还没有提问。输入问题后，智能体会返回可核对的文字回答。</div>`}${state.chat.loading?`<div class="chat-message bot"><span class="chat-role">研习助手</span><div class="chat-text chat-loading">正在检索并整理回答…</div></div>`:''}</div>${err}<label class="chat-compose"><span>你的问题</span><textarea id="chatDraft" rows="4" placeholder="例如：两篇 EGFR 突变模型论文的证据边界有什么不同？">${esc(state.chat.draft)}</textarea></label><div class="chat-actions"><button id="clearChat">${icon('trash-2')}清空对话</button><button id="sendChat" class="primary" ${state.chat.loading?'disabled':''}>${icon('send')}${state.chat.loading?'发送中…':'发送'} <small>Ctrl+Enter</small></button></div>${p==='task'||p==='compare'?`<div class="molecule"><img src="quercetin.png" alt="槲皮素二维结构"><div class="molecule-label"><strong>槲皮素</strong><span>CID 5280343</span></div><p class="mini-note">结构示例 · PubChem</p></div>`:''}</div><a class="assistant-link" href="https://pubchem.ncbi.nlm.nih.gov/compound/5280343" target="_blank" rel="noopener noreferrer">查看结构来源 ${icon('arrow-up-right')}</a>`;}
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
  const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({messages:state.chat.messages,user_id:state.chat.userId}),signal:controller.signal});
  let data={};try{data=await res.json();}catch{}
  if(!res.ok||typeof data.reply!=='string'||!data.reply.trim())throw new Error(typeof data.error==='string'?data.error:`请求失败（${res.status}）`);
  state.chat.messages.push({role:'assistant',content:data.reply});state.chat.draft='';state.chat.error='';
 }catch(err){
  state.chat.messages=prior;
  state.chat.error=err.name==='AbortError'?'请求超时，请重试。':(err.message||'暂时无法连接智能体，请稍后重试。');
 }finally{clearTimeout(timer);state.chat.loading=false;save();render();document.querySelector('#chatDraft')?.focus();}
}
function render(){const p=page();document.querySelector('#nav').innerHTML=steps.map(([key,i,label],n)=>`<a href="#${key}" class="${p===key?'active':''}" ${p===key?'aria-current="step"':''}>${icon(i)}${label}<span class="step">0${n+1}</span></a>`).join('');document.querySelector('#main').innerHTML=({task:taskView,compare:compareView,ranking:rankingView,evidence:evidenceView,report:reportView})[p]();document.querySelector('#assistant').innerHTML=assistantView(p);if(window.lucide)lucide.createIcons();for(const id of ['chatDraft','clearChat','reset','askAgent']){const el=document.getElementById(id);if(el)el.disabled=!!state.chat.loading;}const log=document.getElementById('chatMessages');if(log)log.scrollTop=log.scrollHeight;}
document.addEventListener('click',async e=>{const next=e.target.closest('[data-next]');if(next)location.hash=next.dataset.next;
 if(!state.chat.loading&&e.target.closest('#reset')&&confirm('清除当前浏览器中的笔记和报告草稿？')){const link=state.agentUrl;state={...initial(),agentUrl:link};save();location.hash='task';render();toast('案例草稿已重置');}
 if(e.target.closest('#copyPrompt')){const prompt=document.querySelector('#samplePrompt').textContent.trim();try{await navigator.clipboard.writeText(prompt);toast('问题已复制');}catch{window.prompt('请复制这段问题：',prompt);}}
 if(!state.chat.loading&&e.target.closest('#askAgent')){state.chat.draft=document.querySelector('#samplePrompt')?.textContent.trim()||'';render();document.querySelector('#chatDraft')?.focus();}
 if(e.target.closest('#sendChat'))sendChat();
 if(e.target.closest('#retryChat'))sendChat();
 if(!state.chat.loading&&e.target.closest('#clearChat')){state.chat.messages=[];state.chat.error='';state.chat.draft='';save();render();document.querySelector('#chatDraft')?.focus();}
 if(e.target.closest('#download')){const url=URL.createObjectURL(new Blob(['\ufeff'+reportText()],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='肺癌EGFR候选比较教学报告.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('报告已导出');}
});
document.addEventListener('input',e=>{const el=e.target;if(el.dataset.note)state.notes[el.dataset.note]=el.value;else if(el.id==='reason')state.reason=el.value;else if(el.id==='agentUrl')state.agentUrl=el.value;else if(el.id==='chatDraft'){state.chat.draft=el.value;try{localStorage.setItem('herblab-egfr-v1',JSON.stringify(state));}catch{}}else return;save();});
document.addEventListener('keydown',e=>{if(e.target.id==='chatDraft'&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();sendChat();}});
document.addEventListener('change',e=>{const el=e.target;if(el.dataset.reviewed){state.reviewed[el.dataset.reviewed]=el.checked;save();}if(el.id==='selected'){state.selected=el.value;save();render();}});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});render();checkHealth();

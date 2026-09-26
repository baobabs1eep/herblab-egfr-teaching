/* 可复现的教学排序规则；无网络、无隐式补值。浏览器与 Node 共用。 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HerbRanking=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION='herblab-ranking-0.1.0';
 const DEFAULTS=Object.freeze({strong:-12,weak:-4,minBase:50,bonus:10});
 const text=v=>typeof v==='string'&&!!v.trim();
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const date=v=>text(v)&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 function validate(data){
  if(!data||typeof data!=='object'||!data.metadata||typeof data.metadata!=='object'||!Array.isArray(data.candidates)||!data.candidates.length||data.candidates.length>5000)throw new Error('数据须包含 metadata 和 1–5000 条 candidates。');
  if(!text(data.metadata.version)||!text(data.metadata.target))throw new Error('请填写数据版本 version 和统一靶点 target。');
  const ids=new Set();
  for(const c of data.candidates){
   if(!c||!text(c.id)||!text(c.name)||ids.has(c.id))throw new Error('每条候选须有唯一 id 和 name。');ids.add(c.id);
   if(!['pass','fail','unknown'].includes(c.filter?.status))throw new Error(`${c.id} 的 filter.status 须为 pass、fail 或 unknown。`);
   if(!['verified','pending'].includes(c.identity?.status))throw new Error(`${c.id} 的 identity.status 须为 verified 或 pending。`);
   if(c.docking?.score!=null&&!finite(c.docking.score))throw new Error(`${c.id} 的 docking.score 须为数值或 null，不能填字符串。`);
   if(c.heat?.count!=null&&(!Number.isSafeInteger(c.heat.count)||c.heat.count<0))throw new Error(`${c.id} 的 heat.count 须为非负整数或 null。`);
  }
  return data;
 }
 function settings(input={}){const p={...DEFAULTS,...input};if(![p.strong,p.weak,p.minBase,p.bonus].every(finite)||!Number.isFinite(p.weak-p.strong)||p.strong>=p.weak||p.minBase<0||p.minBase>100||p.bonus<0||p.bonus>20)throw new Error('参数无效：强锚点须小于弱锚点，基础门槛 0–100，冷门加分上限 0–20。');return p;}
 function heatBin(n){return n===0?{label:'0',novelty:1}:n<10?{label:'1–9',novelty:.75}:n<100?{label:'10–99',novelty:.5}:n<1000?{label:'100–999',novelty:.25}:{label:'≥1000',novelty:0};}
 function ranked(rows,key){let prior=null,rank=0;return [...rows].sort((a,b)=>b[key]-a[key]||(a.id<b.id?-1:a.id>b.id?1:0)).map((r,i)=>{if(prior===null||r[key]!==prior)rank=i+1;prior=r[key];return {...r,rank};});}
 function compute(data,input={}){
  validate(data);const p=settings(input),m=data.metadata;
  const global=[];
  if(!text(m.protocol))global.push('统一对接协议及版本');
  if(!text(m.filterPolicy))global.push('统一硬过滤规则及版本');
  if(!text(m.heatDefinition))global.push('统一文献检索口径');
  if(!date(m.heatDate))global.push('有效的统一检索日期');
  const rows=data.candidates.map(c=>{
   const missing=[...global];
   if(c.identity.status!=='verified'||!text(c.identity.source))missing.push('分子身份与结构核验记录');
   if(c.filter.status==='unknown')missing.push('硬过滤结论');
   if(!text(c.filter.source))missing.push('硬过滤执行记录（含 ADMET 风险）');
   if(c.filter.policy!==m.filterPolicy||!text(c.filter.policy))missing.push('与统一规则一致的过滤版本');
   if(!finite(c.docking?.score))missing.push('对接分数');
   if(!text(c.docking?.source))missing.push('对接结果出处');
   if(c.docking?.protocol!==m.protocol||!text(c.docking?.protocol))missing.push('与统一协议一致的对接版本');
   if(c.docking?.target!==m.target)missing.push('与统一靶点一致的对接目标');
   if(c.heat?.count==null)missing.push('文献热度计数（未知不作 0）');
   if(!text(c.heat?.query)||!text(c.heat?.source))missing.push('可复核的检索式和计数出处');
   if(c.heat?.date!==m.heatDate||!date(c.heat?.date))missing.push('与统一日期一致的检索记录');
   const base=finite(c.docking?.score)&&text(m.protocol)&&c.docking.protocol===m.protocol&&c.docking.target===m.target&&text(c.docking.source)?(c.docking.score<=p.strong?100:c.docking.score>=p.weak?0:(p.weak-c.docking.score)/(p.weak-p.strong)*100):null;
   const excluded=c.filter.status==='fail';
   const below=base!==null&&base<p.minBase;
   const eligible=!excluded&&!missing.length&&!below;
   const bin=c.heat?.count==null?null:heatBin(c.heat.count);
   return {id:c.id,name:c.name,base,heat:c.heat?.count??null,bin:bin?.label??null,novelty:bin?.novelty??null,boost:eligible?p.bonus*bin.novelty:null,cold:eligible?base+p.bonus*bin.novelty:null,eligible,status:excluded?'过滤未通过':missing.length?'待补数据':below?'低于基础门槛':'可排序',missing,reason:c.filter.reason||'',evidence:c.evidence||'未填写',risk:c.risk||'未填写'};
  });
  const pool=rows.filter(r=>r.eligible), conventional=ranked(pool,'base'),cold=ranked(pool,'cold');
  const baseRanks=new Map(conventional.map(r=>[r.id,r.rank]));
  for(const r of cold)r.delta=baseRanks.get(r.id)-r.rank;
  return {engineVersion:VERSION,parameters:p,total:rows.length,eligible:pool.length,rows,conventional,cold};
 }
 return {VERSION,DEFAULTS,validate,settings,compute};
});

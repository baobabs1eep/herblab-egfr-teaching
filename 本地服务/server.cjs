'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = {};
const envFile = path.join(__dirname, '.env');
for (const line of (fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m) config[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
for (const key of ['PORT','HOST','PUBLIC_ORIGIN','PUBLIC_HOST','PUBLIC_SCHEME','DEMO_USER','DEMO_PASSWORD','YUANQI_APP_ID','YUANQI_APP_KEY']) {
  if (process.env[key] !== undefined) config[key] = process.env[key];
}
const port = Number(config.PORT || 8787);
const host = config.HOST || '127.0.0.1';
const publicMode = !['127.0.0.1','localhost','::1'].includes(host);
const proxyMode = !publicMode && !!config.PUBLIC_HOST;
if (config.PUBLIC_HOST && !/^[a-zA-Z0-9.-]+$/.test(config.PUBLIC_HOST)) throw new Error('PUBLIC_HOST 格式不正确。');
const publicScheme = config.PUBLIC_SCHEME || 'https';
if (!['http','https'].includes(publicScheme)) throw new Error('PUBLIC_SCHEME 格式不正确。');
const publicOrigin = config.PUBLIC_ORIGIN ? new URL(config.PUBLIC_ORIGIN).origin : config.PUBLIC_HOST ? `${publicScheme}://${config.PUBLIC_HOST}` : null;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为有效端口。');
if (publicMode && (!publicOrigin || !publicOrigin.startsWith('https://') || !config.DEMO_PASSWORD || config.DEMO_PASSWORD.length < 12)) throw new Error('公网模式必须设置 HTTPS 的 PUBLIC_ORIGIN 和至少 12 位的 DEMO_PASSWORD。');
if (proxyMode && (!publicOrigin.startsWith('https://') || new URL(publicOrigin).host !== config.PUBLIC_HOST)) throw new Error('反向代理模式必须设置匹配的 HTTPS 公网地址。');
const configured = !!config.YUANQI_APP_ID && !!config.YUANQI_APP_KEY && !/^(请|replace-with-)/i.test(config.YUANQI_APP_KEY);
const allowedHosts = publicMode || proxyMode ? [new URL(publicOrigin).host] : [`127.0.0.1:${port}`, `localhost:${port}`];
function authenticated(req) {
  if (!publicMode) return true;
  const value = req.headers.authorization || '';
  if (!value.startsWith('Basic ')) return false;
  let plain;
  try { plain = Buffer.from(value.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const given = Buffer.from(plain);
  const expected = Buffer.from(`${config.DEMO_USER || 'demo'}:${config.DEMO_PASSWORD}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
const root = path.resolve(__dirname, '../演示前端');
const assets = new Map([['/', ['index.html','text/html']], ['/index.html',['index.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/style.css',['style.css','text/css']], ['/lucide.min.js',['lucide.min.js','text/javascript']], ['/quercetin.png',['quercetin.png','image/png']]]);
for (const file of ['ranking.js','ranking-data.js','ranking-ui.js']) assets.set('/'+file,[file,'text/javascript']);
assets.set('/ranking.css',['ranking.css','text/css']);
let active = 0;
const perIp = new Map();
let daily = {day:new Date().toISOString().slice(0,10),count:0};
function rateLimited(req) {
  const peer = req.socket.remoteAddress;
  const ip = typeof req.headers['x-real-ip'] === 'string' ? req.headers['x-real-ip'] : peer;
  const now = Date.now(), recent=(perIp.get(ip)||[]).filter(t=>now-t<300000);
  if (perIp.size>2000) for (const [key,times] of perIp) if (!times.length||now-times[times.length-1]>300000) perIp.delete(key);
  if (daily.day!==new Date().toISOString().slice(0,10)) daily={day:new Date().toISOString().slice(0,10),count:0};
  if (recent.length>=12 || daily.count>=200) return true;
  recent.push(now);perIp.set(ip,recent);daily.count++;
  return false;
}
function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); }
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error('BODY_LIMIT'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server = http.createServer(async (req, res) => {
  // Bind and host restrictions prevent exposing the local key proxy to other websites.
  if (!allowedHosts.includes(req.headers.host)) return json(res,403,{error:'访问地址不正确。'});
  const route = new URL(req.url,'http://localhost').pathname;
  if (req.method === 'GET' && route === '/api/health') return json(res,200,{configured,service:publicMode?'herblab-public':'herblab-local'});
  if (!authenticated(req)) { res.writeHead(401,{'WWW-Authenticate':'Basic realm="HerbLab Demo"','Cache-Control':'no-store'}); return res.end('Authentication required'); }
  if (req.method === 'POST' && route === '/api/chat') {
    const expected = publicMode || proxyMode ? publicOrigin : `http://${req.headers.host}`;
    if (req.headers.origin && req.headers.origin !== expected) return json(res,403,{error:'请从本地研学页面发送问题。'});
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res,415,{error:'请求格式应为 JSON。'});
    if (!configured) return json(res,503,{error:'请填写本地服务 .env 中的元器密钥，然后重启服务。'});
    if (active >= 2) return json(res,429,{error:'正在处理其他问题，请稍后再试。'});
    let input;
    try { input = await body(req); } catch { return json(res,400,{error:'问题内容过长或格式不正确。'}); }
    const messages = input.messages;
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 39 || messages.length % 2 !== 1 || messages.some((m,i) => !m || m.role !== (i%2 ? 'assistant':'user') || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 12000)) return json(res,400,{error:'对话格式不正确，或内容过长。请清空对话后重试。'});
    if ((publicMode || proxyMode) && rateLimited(req)) return json(res,429,{error:'演示访问较多，请稍后再提问。'});
    const userId = typeof input.user_id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(input.user_id) ? input.user_id : 'herblab-demo';
    // 单工作流的开始节点可能只接收当前输入，将近期对话显式放入本轮问题。
    // 历史答复只用于理解追问，不作为新增文献证据。
    const current = messages[messages.length-1].content;
    const context = messages.slice(-7,-1).map(m => `${m.role==='user'?'学生':'助手'}：${m.content.slice(0,6000)}`).join('\n\n');
    const question = context ? `以下是同一学生的近期对话，仅用于理解本轮追问；历史回答不是新增文献证据，科学结论仍须以知识库为准。\n【近期对话】\n${context}\n【本轮学生问题】\n${current}\n请直接回答本轮问题。若只是要求复述前文信息，请准确引用前文，并区分引用与重新核验。` : current;
    active++;
    try {
      const upstream = await fetch('https://yuanqi.tencent.com/openapi/v1/agent/chat/completions', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${config.YUANQI_APP_KEY}`},
        body:JSON.stringify({assistant_id:config.YUANQI_APP_ID,user_id:userId,stream:false,messages:[{role:'user',content:[{type:'text',text:question}]}]}),
        signal:AbortSignal.timeout(90000)
      });
      let data; try { data = await upstream.json(); } catch { return json(res,502,{error:'元器返回了无法解析的结果，请稍后重试。'}); }
      if (!upstream.ok) {
        const error = [401,403].includes(upstream.status) ? '元器鉴权失败，请核对本地密钥和应用 API 权限。' : upstream.status===429 ? '元器当前限流或额度不足，请稍后重试并检查额度。' : `元器服务请求失败（HTTP ${upstream.status}），请稍后重试。`;
        return json(res,502,{error});
      }
      const choice = data.choices?.[0];
      if (choice?.moderation_level === '1' || choice?.moderation_level === '2' || choice?.finish_reason === 'sensitive') return json(res,422,{error:'元器未返回可展示的答复，请调整问题后重试。'});
      if (choice?.finish_reason === 'tool_fail') return json(res,502,{error:'元器工作流执行失败，请在元器中检查知识库或节点配置。'});
      const reply = choice?.message?.content;
      if (typeof reply !== 'string' || !reply.trim()) return json(res,502,{error:'元器未返回正文，请检查已发布工作流的回复节点及 API 配置。'});
      return json(res,200,{reply});
    } catch (err) {
      return json(res,502,{error:err.name==='TimeoutError' ? '元器回答超时，请缩短问题后重试。' : '无法连接元器，请检查本机网络后重试。'});
    } finally { active--; }
  }
  if (req.method !== 'GET' || !assets.has(route)) return json(res,404,{error:'页面不存在。'});
  const [file,type] = assets.get(route);
  try { const bytes = fs.readFileSync(path.join(root,file)); res.writeHead(200,{'Content-Type':type+(type.startsWith('image/')?'':'; charset=utf-8'),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(bytes); }
  catch { json(res,500,{error:'页面文件缺失。'}); }
});
server.on('error', err => { console.error(err.code==='EADDRINUSE'?'端口已占用：请检查是否已经启动研学助手。':'本地服务启动失败。'); process.exitCode=1; });
server.listen(port,host,()=>console.log(`研学助手已启动：${publicMode||proxyMode?publicOrigin:`http://127.0.0.1:${port}`} | API配置：${configured?'已填写':'待填写'}`));

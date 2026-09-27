'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');
const http = require('node:http');
const {spawn} = require('node:child_process');
const path = require('node:path');

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve,reject) => listener.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

function request(port,route,headers,method='GET',body='') {
  return new Promise((resolve,reject) => {
    const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers},res => {
      res.resume(); res.once('end',() => resolve(res.statusCode));
    });
    req.once('error',reject); req.end(body);
  });
}

test('public mode requires a password and an HTTPS origin', async () => {
  const port = await freePort();
  const proc = spawn(process.execPath,[path.join(__dirname,'server.cjs')],{env:{...process.env,HOST:'0.0.0.0',PORT:String(port),PUBLIC_ORIGIN:'http://demo.example.test',DEMO_PASSWORD:'short'},stdio:'ignore'});
  const code = await new Promise(resolve => proc.once('exit',resolve));
  assert.notEqual(code,0);
});

test('public mode blocks anonymous users, wrong host, and cross-origin chat', async () => {
  const port = await freePort();
  const proc = spawn(process.execPath,[path.join(__dirname,'server.cjs')],{env:{...process.env,HOST:'0.0.0.0',PORT:String(port),PUBLIC_ORIGIN:'https://demo.example.test',DEMO_USER:'student',DEMO_PASSWORD:'1234567890123456',YUANQI_APP_ID:'test',YUANQI_APP_KEY:'dummy'},stdio:'ignore'});
  try {
    let ready = false;
    for (let i=0;i<30;i++) {
      await new Promise(resolve => setTimeout(resolve,100));
      try { if (await request(port,'/api/health',{Host:'demo.example.test'})===200) {ready=true;break;} } catch {}
    }
    assert.equal(ready,true,'server did not start');
    const base={Host:'demo.example.test'};
    const auth='Basic '+Buffer.from('student:1234567890123456').toString('base64');
    assert.equal(await request(port,'/',base),401);
    assert.equal(await request(port,'/',{...base,Authorization:auth}),200);
    assert.equal(await request(port,'/',{Host:'other.example.test',Authorization:auth}),403);
    assert.equal(await request(port,'/api/chat',{...base,Authorization:auth,Origin:'https://other.example.test','Content-Type':'application/json'},'POST','{}'),403);
  } finally { proc.kill(); }
});

test('loopback proxy mode accepts the public host and rejects a foreign origin', async () => {
  const port = await freePort();
  const proc = spawn(process.execPath,[path.join(__dirname,'server.cjs')],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_HOST:'demo.example.test',PUBLIC_SCHEME:'https',YUANQI_APP_ID:'test',YUANQI_APP_KEY:'dummy'},stdio:'ignore'});
  try {
    let ready = false;
    for (let i=0;i<30;i++) {
      await new Promise(resolve => setTimeout(resolve,100));
      try { if (await request(port,'/api/health',{Host:'demo.example.test'})===200) {ready=true;break;} } catch {}
    }
    assert.equal(ready,true,'server did not start');
    assert.equal(await request(port,'/',{Host:'demo.example.test'}),200);
    assert.equal(await request(port,'/',{Host:'other.example.test'}),403);
    assert.equal(await request(port,'/api/chat',{Host:'demo.example.test',Origin:'https://other.example.test','Content-Type':'application/json'},'POST','{}'),403);
  } finally { proc.kill(); }
});

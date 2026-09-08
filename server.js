/* ============================================================
   时间胶囊 · 在线协作版 —— 后端服务（零依赖 Node.js）
   功能：轻量账号(空间码+昵称+口令) / 空间数据(JSON) /
        记忆胶囊(服务端权威时间锁) / 协作补充
   运行：node server.js  （默认端口 3000，可用 PORT 覆盖）
   ============================================================ */
'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const PORT=parseInt(process.env.PORT||'3000',10);
const ROOT=__dirname;
const PUB=path.join(ROOT,'public');
/* 数据目录：默认 ./data；部署到平台时可指定挂载的持久磁盘，如 DATA_DIR=/data */
const DATA_DIR=process.env.DATA_DIR?path.resolve(process.env.DATA_DIR):path.join(ROOT,'data');
const DB_FILE=path.join(DATA_DIR,'db.json');

for(const d of [PUB,DATA_DIR]){if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true})}

const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json;charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.webmanifest':'application/manifest+json;charset=utf-8'};

/* ---------- 持久化（单文件 + 原子写 + 写队列防并发损坏） ---------- */
let db=null;
function defaultDB(){return{users:[],sessions:[],spaces:{},data:{}}}
function loadDB(){
  try{db=JSON.parse(fs.readFileSync(DB_FILE,'utf8'))}catch(e){db=defaultDB()}
  if(!db.users)db.users=[];if(!db.sessions)db.sessions=[];if(!db.spaces)db.spaces={};if(!db.data)db.data={};
}
let wq=Promise.resolve();
function saveDB(){
  wq=wq.then(()=>new Promise((res,rej)=>{
    const tmp=DB_FILE+'.tmp';
    fs.writeFile(tmp,JSON.stringify(db),err=>{
      if(err){rej(err);return}
      fs.rename(tmp,DB_FILE,err2=>{err2?rej(err2):res()});
    });
  })).catch(e=>console.error('DB write failed:',e.message));
  return wq;
}
loadDB();

/* ---------- 工具 ---------- */
const now=()=>Date.now();
const uid=p=>p+'_'+now().toString(36)+Math.random().toString(36).slice(2,7);
const sha256=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
function makeToken(){return crypto.randomBytes(24).toString('hex')}
function niced(){const d=new Date();return (d.getMonth()+1)+'月'+d.getDate()+'日 '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}

function spaceObj(code){return db.spaces[code]||null}
function spaceData(code){
  if(!db.data[code]){db.data[code]={memories:[],capsules:[],links:[]}}
  if(!db.data[code].links)db.data[code].links=[];
  return db.data[code];
}
function findByItem(sd,id){
  let it=sd.memories.find(x=>x.id===id);
  if(it)return it;
  return sd.capsules.find(x=>x.id===id)||null;
}
function removeLinksFor(sd,id){
  const l=sd.links;for(let i=l.length-1;i>=0;i--){if(l[i].a===id||l[i].b===id)l.splice(i,1)}
}
function findUser(code,nick){
  return db.users.find(u=>u.space===code&&u.nick===nick)||null;
}
function authed(req){
  const t=req.headers['x-token']||'';
  const s=db.sessions.find(x=>x.token===t&&x.exp>now());
  if(!s)return null;
  return db.users.find(u=>u.id===s.uid)||null;
}

/* 胶囊视图：锁定内容不下发（服务端时间权威判定） */
function capView(c,nowMs){
  const locked=nowMs<c.unlockAt;
  const v={id:c.id,title:c.title,cat:c.cat||'胶囊',by:c.by,lat:c.lat,lng:c.lng,
    happenedAt:c.happenedAt||'',unlockAt:c.unlockAt,created:c.created,locked,
    unlockLeft:Math.max(0,c.unlockAt-nowMs),byMe:false};
  if(!locked){v.desc=c.desc||'';v.images=c.images||[];v.notes=c.notes||[]}
  return v;
}
function nowTxtLabel(ms){return Math.max(0,ms)}

/* ---------- HTTP 骨架 ---------- */
function send(res,code,obj){
  const body=JSON.stringify(obj);
  res.writeHead(code,{'Content-Type':'application/json;charset=utf-8',
    'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,x-token',
    'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'});
  res.end(body);
}
function readBody(req){
  return new Promise((res,rej)=>{
    const max=30*1024*1024;let size=0;const parts=[];
    req.on('data',ch=>{size+=ch.length;if(size>max){rej(new Error('too large'));req.destroy();return}parts.push(ch)});
    req.on('end',()=>{try{res(JSON.parse(Buffer.concat(parts).toString('utf8')||'{}'))}catch(e){rej(new Error('bad json'))}});
    req.on('error',rej);
  });
}

/* ---------- 业务处理 ---------- */
async function handleApi(req,res){
  const u=new URL(req.url,'http://x');
  const p=u.pathname;
  const m=req.method;
  const api=p.startsWith('/api/');
  if(!api)return false;

  /* CORS 预检 */
  if(m==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,x-token','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'});res.end();return true}

  if(m==='GET'&&p==='/api/ping'){send(res,200,{ok:true,serverTime:now(),secure:req.socket&&req.socket.encrypted?true:false});return true}
  if(p==='/api/create'&&m==='POST'){
    const b=await readBody(req);
    const code=String(b.code||'').trim().toUpperCase();
    const nick=String(b.nick||'').trim();
    const pass=String(b.pass||'');
    if(!/^[\u4e00-\u9fa5A-Za-z0-9]{1,12}$/.test(code))return send(res,400,{err:'空间码需为 1-12 位中文/字母/数字'});
    if(!nick||nick.length>12)return send(res,400,{err:'昵称不能为空且不超过12字'});
    if(pass.length<4)return send(res,400,{err:'口令至少4位'});
    if(db.spaces[code])return send(res,409,{err:'该空间码已被创建'});
    db.spaces[code]={name:String(b.name||'').trim()||code,created:now()};
    const salt=crypto.randomBytes(8).toString('hex');
    const user={id:uid('u'),nick,space:code,passSalt:salt,passHash:sha256(salt+pass),created:now()};
    db.users.push(user);
    spaceData(code);
    const token=makeToken();
    db.sessions.push({token,uid:user.id,exp:now()+30*864e5});
    await saveDB();
    return send(res,200,{token,user:{id:user.id,nick:user.nick,space:user.space},spaceName:code,serverTime:now()});
  }
  if(p==='/api/join'&&m==='POST'){
    const b=await readBody(req);
    const code=String(b.code||'').trim().toUpperCase();
    const nick=String(b.nick||'').trim();
    const pass=String(b.pass||'');
    if(!db.spaces[code])return send(res,404,{err:'没有找到这个空间，请核对空间码'});
    let user=findUser(code,nick);
    if(user){
      if(user.passHash!==sha256(user.passSalt+pass))return send(res,403,{err:'口令不对（此昵称已被注册）'});
    }else{
      if(!nick||nick.length>12||pass.length<4)return send(res,400,{err:'昵称/口令不合法'});
      const salt=crypto.randomBytes(8).toString('hex');
      user={id:uid('u'),nick,space:code,passSalt:salt,passHash:sha256(salt+pass),created:now()};
      db.users.push(user);
    }
    const token=makeToken();
    db.sessions.push({token,uid:user.id,exp:now()+30*864e5});
    await saveDB();
    return send(res,200,{token,user:{id:user.id,nick:user.nick,space:user.space},spaceName:db.spaces[code].name,serverTime:now()});
  }

  const me=authed(req);
  if(!me)return send(res,401,{err:'未登录或登录已过期'});

  if(p==='/api/me'&&m==='POST')return send(res,200,{user:{id:me.id,nick:me.nick,space:me.space},spaceName:db.spaces[me.space].name,serverTime:now()});

  if(p==='/api/members'&&m==='GET'){
    const ms=db.users.filter(u=>u.space===me.space).map(u=>({id:u.id,nick:u.nick}));
    return send(res,200,{members:ms,serverTime:now()});
  }
  if(p==='/api/space'&&m==='GET'){
    const sd=spaceData(me.space);
    const ms=db.users.filter(u=>u.space===me.space).map(u=>({id:u.id,nick:u.nick}));
    const nw=now();
    return send(res,200,{
      spaceName:db.spaces[me.space].name,
      members:ms,
      serverTime:nw,
      links:sd.links||[],
      memories:sd.memories,
      capsules:sd.capsules.map(c=>capView(c,nw))
    });
  }

  /* ---- 记忆点 ---- */
  if(p==='/api/memories'&&m==='POST'){
    const b=await readBody(req);
    if(!b.title||!String(b.title).trim())return send(res,400,{err:'请填写标题'});
    const sd=spaceData(me.space);
    const item={id:uid('m'),title:String(b.title).trim(),cat:b.cat||'日常',
      when:b.when||'',lat:num(b.lat),lng:num(b.lng),desc:String(b.desc||''),
      images:Array.isArray(b.images)?b.images:[],by:me.nick,
      notes:[],created:now(),updated:now()};
    sd.memories.push(item);
    await saveDB();
    return send(res,200,{item});
  }
  let mch=p.match(/^\/api\/memories\/([\w-]+)$/);
  if(mch&&m==='PUT'){
    const sd=spaceData(me.space);const it=sd.memories.find(x=>x.id===mch[1]);
    if(!it)return send(res,404,{err:'记忆不存在'});
    const b=await readBody(req);
    if(b.title!==undefined)it.title=String(b.title).trim();
    if(b.cat!==undefined)it.cat=b.cat;
    if(b.when!==undefined)it.when=b.when;
    if(b.desc!==undefined)it.desc=String(b.desc);
    if(b.images!==undefined)it.images=b.images;
    if(b.lat!==undefined)it.lat=num(b.lat);
    if(b.lng!==undefined)it.lng=num(b.lng);
    it.updated=now();
    await saveDB();
    return send(res,200,{item:it});
  }
  if(mch&&m==='DELETE'){
    const sd=spaceData(me.space);
    const i=sd.memories.findIndex(x=>x.id===mch[1]);
    if(i<0)return send(res,404,{err:'记忆不存在'});
    sd.memories.splice(i,1);
    removeLinksFor(sd,mch[1]);
    await saveDB();
    return send(res,200,{ok:true});
  }
  const mn=p.match(/^\/api\/memories\/([\w-]+)\/notes$/);
  if(mn&&m==='POST'){
    const sd=spaceData(me.space);const it=sd.memories.find(x=>x.id===mn[1]);
    if(!it)return send(res,404,{err:'记忆不存在'});
    const b=await readBody(req);
    const tx=String(b.text||'').trim();
    if(!tx)return send(res,400,{err:'内容为空'});
    it.notes=it.notes||[];
    it.notes.push({who:me.nick,text:tx,t:niced(),at:now()});
    await saveDB();
    return send(res,200,{notes:it.notes});
  }

  /* ---- 记忆胶囊（时间锁） ---- */
  if(p==='/api/capsules'&&m==='POST'){
    const b=await readBody(req);
    if(!b.title||!String(b.title).trim())return send(res,400,{err:'请填写胶囊标题'});
    let unlockAt=parseInt(b.unlockAt,10);
    if(!(unlockAt>0))return send(res,400,{err:'请设置有效的解锁时间'});
    const sd=spaceData(me.space);
    const item={id:uid('c'),title:String(b.title).trim(),cat:'胶囊',
      lat:num(b.lat),lng:num(b.lng),happenedAt:b.happenedAt||'',desc:String(b.desc||''),
      images:Array.isArray(b.images)?b.images:[],
      unlockAt,by:me.nick,notes:[],created:now()};
    sd.capsules.push(item);
    await saveDB();
    return send(res,200,{item:capView(item,now())});
  }
  let cch=p.match(/^\/api\/capsules\/([\w-]+)$/);
  if(cch&&m==='GET'){
    const sd=spaceData(me.space);const it=sd.capsules.find(x=>x.id===cch[1]);
    if(!it)return send(res,404,{err:'胶囊不存在'});
    const v=capView(it,now());
    if(v.locked)return send(res,423,{err:'记忆胶囊尚未到解锁时间',capsule:v});
    return send(res,200,{capsule:v});
  }
  if(cch&&m==='DELETE'){
    const sd=spaceData(me.space);
    const i=sd.capsules.findIndex(x=>x.id===cch[1]);
    if(i<0)return send(res,404,{err:'胶囊不存在'});
    sd.capsules.splice(i,1);
    removeLinksFor(sd,cch[1]);
    await saveDB();
    return send(res,200,{ok:true});
  }
  const cnotes=p.match(/^\/api\/capsules\/([\w-]+)\/notes$/);
  if(cnotes&&m==='POST'){
    const sd=spaceData(me.space);const it=sd.capsules.find(x=>x.id===cnotes[1]);
    if(!it)return send(res,404,{err:'胶囊不存在'});
    if(now()<it.unlockAt)return send(res,423,{err:'还未到解锁时间，不能查看或补充内容'});
    const b=await readBody(req);
    const tx=String(b.text||'').trim();
    if(!tx)return send(res,400,{err:'内容为空'});
    it.notes=it.notes||[];
    it.notes.push({who:me.nick,text:tx,t:niced(),at:now()});
    await saveDB();
    return send(res,200,{notes:it.notes});
  }

  /* ---- 记忆轨迹连线 ---- */
  if(p==='/api/links'&&m==='POST'){
    const b=await readBody(req);
    const a=String(b.a||''),bb=String(b.b||'');
    if(!a||!bb||a===bb)return send(res,400,{err:'需要两个不同的记忆点/胶囊'});
    const sd=spaceData(me.space);
    if(!findByItem(sd,a)||!findByItem(sd,bb))return send(res,404,{err:'关联的记忆不存在'});
    const dup=sd.links.find(l=>(l.a===a&&l.b===bb)||(l.a===bb&&l.b===a));
    if(dup)return send(res,200,{link:dup,dup:true});
    const link={id:uid('l'),a,b:bb,by:me.nick,at:now()};
    sd.links.push(link);
    await saveDB();
    return send(res,200,{link});
  }
  let lch=p.match(/^\/api\/links\/([\w-]+)$/);
  if(lch&&m==='DELETE'){
    const sd=spaceData(me.space);
    const i=sd.links.findIndex(x=>x.id===lch[1]);
    if(i<0)return send(res,404,{err:'连线不存在'});
    sd.links.splice(i,1);
    await saveDB();
    return send(res,200,{ok:true});
  }

  return send(res,404,{err:'接口不存在'});
}
function num(v){const n=parseFloat(v);return isFinite(n)?n:null}

/* ---------- 静态资源 ---------- */
function serveStatic(req,res,pathname){
  let fp=pathname==='/'?'/index.html':pathname;
  const full=path.normalize(path.join(PUB,fp));
  if(!full.startsWith(PUB))return send(res,403,{err:'forbidden'});
  fs.readFile(full,(err,buf)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/plain;charset=utf-8'});res.end('404 Not Found');return}
    res.writeHead(200,{'Content-Type':MIME[path.extname(full).toLowerCase()]||'application/octet-stream',
      'Cache-Control':'no-cache'});
    res.end(buf);
  });
}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://x');
    if(u.pathname.startsWith('/api/')){await handleApi(req,res);return}
    if(req.method==='GET')return serveStatic(req,res,u.pathname);
    res.writeHead(405);res.end('Method Not Allowed');
  }catch(e){
    if(e.message==='bad json'||e.message==='too large'){
      return send(res,400,{err:e.message==='too large'?'上传内容过大':'请求不是有效的JSON'});
    }
    console.error(e);
    try{send(res,500,{err:'服务器内部错误'})}catch(_){}
  }
});

/* ---------- 启动：HTTP（默认）/ HTTPS（TLS=1 且存在证书） ---------- */
const CERT_DIR=path.join(ROOT,'certs');
const KEY_FILE=path.join(CERT_DIR,'key.pem');
const CRT_FILE=path.join(CERT_DIR,'cert.pem');
const certExists=()=>fs.existsSync(KEY_FILE)&&fs.existsSync(CRT_FILE);
const wantTLS=process.env.TLS==='1';
const HTTP_REDIRECT_PORT=parseInt(process.env.HTTP_PORT||String(PORT+1),10);

if(wantTLS&&!certExists()){
  console.error('已设置 TLS=1 但缺少证书: '+CERT_DIR);
  console.error('请先运行:  openssl req -x509 -newkey rsa:2048 -nodes -days 365 \\');
  console.error('  -keyout certs/key.pem -out certs/cert.pem -subj "/CN=localhost" \\');
  console.error('  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"');
  process.exit(1);
}
if(wantTLS){
  const https=require('https');
  const tlsOpts={key:fs.readFileSync(KEY_FILE),cert:fs.readFileSync(CRT_FILE)};
  const hserver=https.createServer(tlsOpts,server._events.request);
  hserver.listen(PORT,()=>{
    console.log('时间胶囊在线版(HTTPS)已启动: https://localhost:'+PORT);
    console.log('数据文件:',DB_FILE);
  });
  /* HTTP 自动跳转 HTTPS（保证位置 API 走安全通道） */
  http.createServer((req,res)=>{
    const host=req.headers.host||('localhost:'+PORT);
    res.writeHead(301,{Location:'https://'+host+req.url,'Connection':'close'});
    res.end();
  }).listen(HTTP_REDIRECT_PORT,()=>{
    console.log('HTTP 跳转服务: http://localhost:'+HTTP_REDIRECT_PORT+' → https://localhost:'+PORT);
  });
}else{
  server.listen(PORT,()=>{
    console.log('时间胶囊在线版已启动: http://localhost:'+PORT);
    console.log('(定位建议启用 HTTPS：设置环境变量 TLS=1 并放置证书后重启)');
    console.log('数据文件:',DB_FILE);
  });
}

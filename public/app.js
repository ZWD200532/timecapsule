/* ============================================================
   时间胶囊 · 在线协作版 —— 前端逻辑（零依赖，无框架）
   ============================================================ */
'use strict';
(function(){
var $=function(s){return document.querySelector(s)};
var $$=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function ls(k,v){if(v===undefined){try{return localStorage.getItem(k)}catch(e){return null}}try{localStorage.setItem(k,v)}catch(e){}}
function toast(m){var t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(function(){t.classList.remove('on')},2600)}
function fmt(ms){ /* 剩余时长缩写 */
  ms=Math.max(0,ms);var s=Math.floor(ms/1000);
  if(s<60)return s+'秒';var m=Math.floor(s/60);
  if(m<60)return m+'分'+s%60+'秒';var h=Math.floor(m/60);
  if(h<24)return h+'时'+m%60+'分';var d=Math.floor(h/24);
  return d+'天'+h%24+'时';
}
function dt(v){if(!v)return'';var d=new Date(v);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function dshort(v){if(!v)return'';var d=new Date(v);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}

var S={token:ls('tc_tk')||'',user:null,spaceName:'',members:[],caps:[],mems:[],links:[],offset:0,clockT:null,view:'cap',mapPop:{lng:null,lat:null},mapSeen:false};

/* ---------- API ---------- */
async function api(p,m,body){
  var r=await fetch('/api'+p,{method:m,headers:{'Content-Type':'application/json',...(S.token?{'x-token':S.token}:{})},body:body?JSON.stringify(body):undefined});
  var j={};try{j=await r.json()}catch(e){}
  if(r.status===401){logout();throw new Error('登录已过期')}
  if(r.status>=400){var msg=(j&&j.err)||('请求失败('+r.status+')');var e=new Error(msg);e.capsule=j&&j.capsule;throw e}
  return j;
}
function logout(){
  S.token='';ls('tc_tk','');ls('tc_u','');
  location.reload();
}

/* ---------- 登录 ---------- */
var authMode='create';
function setAuthMode(m){
  authMode=m;
  $('#tCreate').classList.toggle('on',m==='create');
  $('#tJoin').classList.toggle('on',m==='join');
  $('#formCreate').hidden=(m!=='create');
  $('#formJoin').hidden=(m!=='join');
  $('#authErr').textContent='';
}
function bindLogin(){
  $('#tCreate').onclick=function(){setAuthMode('create')};
  $('#tJoin').onclick=function(){setAuthMode('join')};
  $('#authGo').onclick=async function(){
    var body,code;
    if(authMode==='create'){
      code=$('#cCode').value.trim().toUpperCase();
      body={code:code,nick:$('#cNick').value.trim(),pass:$('#cPass').value};
      var nm=$('#cName').value.trim();if(nm)body.name=nm;
    }else{
      code=$('#jCode').value.trim().toUpperCase();
      body={code:code,nick:$('#jNick').value.trim(),pass:$('#jPass').value};
    }
    if(!body.nick){err('请填写昵称');return}
    if(!body.pass||body.pass.length<4){err('口令至少 4 位');return}
    try{
      var j=await api('/'+(authMode==='create'?'create':'join'),'POST',body);
      S.token=j.token;S.user=j.user;
      ls('tc_tk',j.token);ls('tc_u',JSON.stringify(j.user));
      enter();
    }catch(e){err(e.message)}
  };
  function err(m){$('#authErr').textContent=m}
  $$('#formCreate input,#formJoin input').forEach(function(i){i.onkeydown=function(e){if(e.key==='Enter')$('#authGo').click()}});
}

/* ---------- 进入主界面 ---------- */
function enter(){
  $('#login').style.display='none';
  $('#app').hidden=false;
  $('#navCap').classList.add('on');
  loadAll();
  S.clockT=setInterval(function(){
    var d=new Date(Date.now()+S.offset);
    $('#clock').textContent=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');
  },1000);
  setInterval(function(){loadAll(true)},30000);   /* 每 30s 静默同步 */
  setInterval(refreshCd,1000);
}
async function loadAll(silent){
  try{
    var j=await api('/space','GET');
    S.spaceName=j.spaceName;S.members=j.members;S.caps=j.capsules;S.mems=j.memories;S.links=j.links||[];
    S.offset=j.serverTime-Date.now();
    renderHead();renderCaps();renderMems();
    if(S.view==='map')refreshMapViews(false);
  }catch(e){if(!silent)toast(e.message)}
}

/* ---------- 顶栏 ---------- */
function renderHead(){
  $('#spName').textContent=S.spaceName||'…';
  var me=S.user&&S.user.nick;
  $('#members').innerHTML=S.members.map(function(m){
    return'<i'+(m.nick===me?' class="me"':'')+'>'+esc(m.nick)+'</i>';
  }).join('');
  $('#lockNote').textContent=S.caps.filter(function(c){return c.locked}).length
    ?'有 '+S.caps.filter(function(c){return c.locked}).length+' 枚胶囊在等待开启'
    :'';
}

/* ---------- 记忆胶囊 ---------- */
function switchV(){
  var m=(S.view==='map');
  $('#capView').hidden=S.view!=='cap';
  $('#memView').hidden=S.view!=='mem';
  $('#mapView').hidden=!m;
  $('#navCap').classList.toggle('on',S.view==='cap');
  $('#navMem').classList.toggle('on',S.view==='mem');
  $('#navMap').classList.toggle('on',m);
  $('#fabCap').hidden=S.view!=='cap';
  $('#fabMem').hidden=S.view!=='mem';
  if(m)enterMapView();
}
function capCard(c){
  var locked=c.locked;
  var th='';
  if(!locked&&c.images&&c.images[0])th='<img src="'+c.images[0]+'" alt="">';
  var cd=locked
    ?'<div class="cd wait">开启倒计时 <b data-cd="'+c.id+'"></b></div>'
    :'<div class="cd open" style="color:#5eead4">已于 '+esc(dt(c.unlockAt))+' 开启</div>';
  var ds=c.desc?('<div class="desc">'+esc(c.desc)+'</div>'):'';
  return'<div class="capCard'+(locked?' locked':'')+'" data-id="'+c.id+'">'
    +'<div class="thumb">'+th+'</div>'
    +'<div class="bd"><h3>'+esc(c.title)+'<span class="badge '+(locked?'wait':'open')+'">'+(locked?'锁定中':'已开启')+'</span></h3>'
    +'<div class="meta"><span>'+esc(dshort(c.happenedAt)||'—')+' 的记忆</span><span>封存于 '+esc(dt(c.unlockAt))+'</span></div>'
    +ds+cd+'<div class="who">by '+esc(c.by)+'</div></div></div>';
}
function renderCaps(){
  var el=$('#capList');if(!el)return;
  var open=S.caps.filter(function(c){return!c.locked});
  var wait=S.caps.filter(function(c){return c.locked});
  $('#capCount').innerHTML='<b>'+S.caps.length+'</b> 枚胶囊 · '+open.length+' 已开启 / '+wait.length+' 封存中';
  var html='';
  if(!S.caps.length){
    html='<div class="empty"><div class="big">还没有记忆胶囊</div>把一段回忆、一份惊喜封存起来，设定一个未来的开启时间。</div>';
  }else{
    if(wait.length){html+='<div class="secT">封存中 · 期待开启</div>'+wait.map(capCard).join('')}
    if(open.length){html+='<div class="secT" style="margin-top:18px">已开启 · 可以回看</div>'+open.map(capCard).join('')}
  }
  el.innerHTML=html;
  $$('#capList .capCard').forEach(function(card){
    card.onclick=function(){openCap(card.dataset.id)};
  });
  refreshCd();
}

/* 倒计时刷新：到点自动开锁 */
function refreshCd(){
  var now=Date.now()+S.offset;
  $$('[data-cd]').forEach(function(n){
    var c=S.caps.find(function(x){return x.id===n.dataset.cd});
    if(!c)return;
    var left=c.unlockAt-now;
    n.textContent=left>0?fmt(left):'正在开启…';
  });
  var due=S.caps.filter(function(c){return c.locked&&c.unlockAt<=now});
  if(due.length){loadAll(true);toast('有记忆胶囊已到开启时间');}
}

/* 胶囊详情 */
async function openCap(id){
  var c=S.caps.find(function(x){return x.id===id});
  if(!c)return;
  if(c.locked)return openLocked(c);
  try{
    var j=await api('/capsules/'+id,'GET');
    showCapOpen(j.capsule);
  }catch(e){
    if(e.capsule&&e.capsule.locked){loadAll(true);return openLocked(e.capsule)}
    toast(e.message);
  }
}
function openLocked(c){
  modal('封存的胶囊',
    '<div class="lockView">'
    +'<div class="ring"><div class="cd" data-lc="'+c.id+'">'+fmt(c.unlockAt-(Date.now()+S.offset))+'</div></div>'
    +'<h3 style="font-size:18px">'+esc(c.title)+'</h3>'
    +'<div class="sub">by '+esc(c.by)+' · 封存于 '+esc(dt(c.unlockAt))+'</div>'
    +'<div class="sub">这段记忆发生：'+esc(dshort(c.happenedAt)||'—')+'</div>'
    +'<div class="lockTip">这枚胶囊还没有到开启的时间。<br>内容被时间锁住，现在谁也无法偷看——<br>到了那一刻，它会在大家面前自动打开。</div>'
    +'</div>',
    '<button id="mX">好的，静静等待</button>');
  bindModalClose();
  var tk=setInterval(function(){
    var n=$('#mRoot [data-lc]');if(!n){clearInterval(tk);return}
    var left=c.unlockAt-(Date.now()+S.offset);
    if(left<=0){
      clearInterval(tk);n.textContent='开！';
      setTimeout(function(){closeModal();loadAll(true);openCap(c.id)},600);
    }else n.textContent=fmt(left);
  },1000);
}
function showCapOpen(c){
  var notes=(c.notes||[]).map(function(n){return noteHtml(n)}).join('');
  var imgs=c.images&&c.images.length?'<div class="imgs">'+c.images.map(function(s,i){return'<div class="tile" data-lb="'+i+'"><img src="'+s+'" alt=""></div>'}).join('')+'</div>':'';
  var body='<div class="kv" style="color:var(--dim);font-size:12px;display:flex;gap:12px;flex-wrap:wrap">'
    +'<span>by '+esc(c.by)+'</span><span>封存于 '+esc(dt(c.unlockAt))+'</span><span>记忆发生 '+esc(dshort(c.happenedAt)||'—')+'</span></div>'
    +'<div class="descBody" style="margin-top:8px">'+esc(c.desc||'')+'</div>'
    +imgs
    +'<div class="secT">朋友们已写下 '+(c.notes||[]).length+' 条回望</div>'+notes;
  modal(esc(c.title),body,
    '<button class="ghost" data-note>写回望</button>'
    +'<div style="flex:1"></div>'
    +'<button class="danger" data-del>删除</button>'
    +'<button class="pri" id="mX">关闭</button>',true);
  bindModalClose();
  bindLightbox(c.images||[]);
  $('#mRoot [data-note]').onclick=function(){addNote('capsule',c.id)};
  $('#mRoot [data-del]').onclick=function(){
    confirmDlg('删除这枚胶囊？内容将永久消失。',function(){delItem('capsules',c.id)});
  };
}
function noteHtml(n){
  return'<div class="note"><div class="who"><span>'+esc(n.who)+'<span class="when"> · '+esc(n.t||'')+'</span></span></div><p>'+esc(n.text)+'</p></div>';
}
function addNote(kind,id){
  var p=kind==='capsule'?(S.caps.find(function(x){return x.id===id})):(S.mems.find(function(x){return x.id===id}));
  modal('写下回望','<div class="lbl">你记得的是…</div><textarea id="nText" style="min-height:110px;resize:vertical" placeholder="在大家的共同记忆上，补上你的那一块"></textarea>',
    '<button id="mX">取消</button><button class="pri" id="nOk">写下</button>');
  bindModalClose();
  $('#nOk').onclick=async function(){
    var tx=$('#nText').value.trim();
    if(!tx){toast('写点什么吧');return}
    try{
      await api('/'+kind+'s/'+id+'/notes','POST',{text:tx});
      closeModal();loadAll(true);toast('已写下回望');
    }catch(e){toast(e.message)}
  };
}

/* ============================================================
   记忆地图（高德）
   ============================================================ */
var MAP_PENDING=null;
function colorOf(cat){
  return cat==='美食'?'#fbbf24':cat==='学习'?'#34d399':cat==='重要'?'#fb7185':cat==='旅行'?'#60a5fa':cat==='纪念'?'#c084fc':'#22d3ee';
}
function mapItems(){
  var arr=[];
  S.mems.forEach(function(m){if(isFinite(m.lat)&&isFinite(m.lng))arr.push({id:m.id,kind:'mem',title:m.title,lat:m.lat,lng:m.lng,cat:m.cat,color:colorOf(m.cat)})});
  S.caps.forEach(function(c){if(isFinite(c.lat)&&isFinite(c.lng))arr.push({id:c.id,kind:'cap',title:c.title,lat:c.lat,lng:c.lng,locked:c.locked})});
  return arr;
}
function showMapErr(msg){
  var el=$('#mapErr');el.hidden=false;
  el.innerHTML='<div class="box"><h3>地图加载失败</h3><p>'+esc(msg)
    +'<br><br>请检查：① 高德 Key/安全密钥是否正确；② 域名白名单已清空或包含当前网址；③ 网络可访问高德服务器。设置生效通常需 1-5 分钟。</p>'
    +'<button class="pri" id="mapRetry" style="margin-top:14px">重新加载地图</button></div>';
  $('#mapRetry').onclick=function(){MAP_PENDING=null;enterMapView()};
}
function ensureMap(){
  if(!MAP_PENDING){
    MAP_PENDING=new Promise(function(res){
      MAP.setCfg({
        onMarker:onMarkerTap,
        onEmpty:onMapEmpty,
        onHint:function(t){toast(t)},
        onLinkDone:onLinkDone
      });
      MAP.init('amap',function(){res(true)},function(e){showMapErr(e&&e.message||'未知错误');res(false)});
    });
  }
  return MAP_PENDING;
}
async function enterMapView(){
  hideMapPopup();
  $('#mapErr').hidden=true;
  var ok=await ensureMap();
  if(!ok)return;
  resetLinkUi();
  var items=mapItems();
  refreshMapViews(!S.mapSeen);
  S.mapSeen=S.mapSeen||!!items.length;
  MAP.resize();
}
function refreshMapViews(forceFit){
  if(!MAP.mapReady())return;
  var items=mapItems();
  MAP.show(items,S.links||[],!!forceFit);
}
function onMarkerTap(it){
  hideMapPopup();
  if(it.kind==='cap')openCap(it.id);
  else openMem(it.id);
}
function onMapEmpty(lng,lat){
  S.mapPop={lng:lng,lat:lat};
  $('#mpCoord').textContent='经度 '+lng.toFixed(5)+' · 纬度 '+lat.toFixed(5);
  $('#mapPopup').hidden=false;
}
function hideMapPopup(){$('#mapPopup').hidden=true}
function resetLinkUi(){
  var b=$('#mtLink');
  if(b){b.classList.remove('on');b.textContent='轨迹连线'}
  var h=$('#mapHint2');
  if(h)h.textContent='点击地图空白处可标记新记忆的地点；点击标记查看详情';
}
async function onLinkDone(a,b){
  resetLinkUi();
  try{
    await api('/links','POST',{a:a,b:b});
    await loadAll(true);
    toast('已串联成一段记忆轨迹');
  }catch(e){toast(e.message)}
}

/* 新建胶囊：ilat/ilng 为地图点选坐标 */
function newCapDlg(ilat,ilng){
  hideMapPopup();
  var unlock=new Date(Date.now()+10*60000);
  var def=unlock.toISOString().slice(0,16);
  var latV=isFinite(ilat)?(' value="'+ilat+'"'):'';
  var lngV=isFinite(ilng)?(' value="'+ilng+'"'):'';
  modal('封存一枚记忆胶囊',
    '<div class="lbl">胶囊标题 *</div><input id="nTitle" maxlength="30" placeholder="给未来的你们留个引子">'
    +'<div class="lbl">这段记忆发生在 <span style="color:var(--dim)">（事件日期）</span></div><input type="date" id="nWhen">'
    +'<div class="lbl">胶囊内容 <span style="color:var(--dim)">（到点才能查看）</span></div>'
    +'<textarea id="nDesc" style="min-height:96px;resize:vertical" placeholder="写点什么给未来的自己和朋友…文字、感受、提醒都行"></textarea>'
    +'<div class="lbl">配图（可选，最多 2 张，自动压缩）</div>'
    +'<div class="imgs" id="nImgs"><button id="nAddImg" class="pri" style="width:auto;padding:6px 14px">添加图片</button></div>'
    +'<input type="file" id="nFile" accept="image/*" multiple hidden>'
    +'<div class="lbl">开启时间 * <span style="color:#ffd76a">（到这一刻才会解锁）</span></div>'
    +'<input type="datetime-local" id="nUnlock" value="'+def+'">'
    +'<div class="lbl">所在地坐标 '+(isFinite(ilat)?'<span style="color:#22d3ee">已从地图点选</span>':'<span style="color:var(--dim)">（也可到记忆地图上点选）</span>')+'</div>'
    +'<div style="display:flex;gap:8px"><input id="nLat" placeholder="纬度 lat"'+latV+'><input id="nLng" placeholder="经度 lng"'+lngV+'></div>'
    +'<div class="lbl" style="color:#ffd76a">开启时间未到前，内容将严格锁定——连创建人也无法提前查看。</div>',
    '<button id="mX">取消</button><button class="pri" id="nOk">封存这枚胶囊</button>',true);
  bindModalClose();
  var imgs=[];
  $('#nAddImg').onclick=function(){$('#nFile').click()};
  $('#nFile').onchange=function(){
    Array.prototype.slice.call(this.files).slice(0,2-imgs.length).forEach(function(f){
      compress(f,function(url){imgs.push(url);var t=document.createElement('div');t.className='tile';
        t.innerHTML='<img src="'+url+'" alt=""><button class="x" style="position:absolute;top:0;right:0;background:rgba(0,0,0,.7);border:none;color:#fff;padding:0 6px">×</button>';
        t.onclick=function(e){if(e.target.tagName==='BUTTON'){imgs.splice(imgs.indexOf(url),1);t.remove();$('#nAddImg').style.display=imgs.length>=2?'none':'inline-block'}};
        $('#nImgs').appendChild(t);
        $('#nAddImg').style.display=imgs.length>=2?'none':'inline-block';
      });
    });
    this.value='';
  };
  $('#nOk').onclick=async function(){
    var title=$('#nTitle').value.trim();
    var un=$('#nUnlock').value;
    if(!title){toast('请填写胶囊标题');return}
    if(!un){toast('请选择开启时间');return}
    var unlockAt=new Date(un).getTime();
    if(!(unlockAt>0)){toast('请选择开启时间');return}
    var isPast=unlockAt<=Date.now();
    var lat=parseFloat($('#nLat').value),lng=parseFloat($('#nLng').value);
    try{
      await api('/capsules','POST',{title:title,happenedAt:$('#nWhen').value,desc:$('#nDesc').value.trim(),
        unlockAt:unlockAt,images:imgs,lat:isFinite(lat)?lat:null,lng:isFinite(lng)?lng:null});
      closeModal();await loadAll(true);
      if(S.view==='map'){refreshMapViews(true)}
      toast(isPast?'胶囊已补录并立即开启':'胶囊已封存，等待开启的那一天');
    }catch(e){toast(e.message)}
  };
}

/* ---------- 记忆点（共同编辑的普通记忆） ---------- */
function memCard(m){
  var n=(m.notes||[]).length;
  var th='';
  if(m.images&&m.images[0])th='<div class="thumb"><img src="'+m.images[0]+'" alt=""></div>';
  else th='<div class="thumb" style="font-size:20px;color:var(--acc)">◆</div>';
  return'<div class="capCard tlCard" style="--cc:'+(m.cat==='美食'?'#fbbf24':m.cat==='学习'?'#34d399':m.cat==='重要'?'#fb7185':'#22d3ee')+'" data-id="'+m.id+'">'
    +th
    +'<div class="bd"><h3>'+esc(m.title)+'<span class="who" style="font-weight:400"> by '+esc(m.by||'')+'</span></h3>'
    +'<div class="meta"><span>'+esc(m.when||'')+'</span><span>'+esc(m.cat||'日常')+'</span></div>'
    +'<div class="desc">'+esc(m.desc||'')+'</div>'
    +'<div class="meta" style="margin-top:6px"><span>'+((m.images||[]).length)+' 图</span><span>'+n+' 条补充</span></div></div></div>';
}
function renderMems(){
  var el=$('#memList');if(!el)return;
  var list=S.mems.slice().sort(function(a,b){return String(a.when||'').localeCompare(String(b.when||''))||a.id.localeCompare(b.id)});
  $('#memCount').innerHTML='<b>'+list.length+'</b> 段共同记忆';
  var html='';
  if(!list.length)html='<div class="empty"><div class="big">还没有记忆点</div>记录一件一起经历的小事，大家都可以补充当时各自的视角。</div>';
  else html=list.map(memCard).join('');
  el.innerHTML=html;
  $$('#memList .capCard').forEach(function(card){card.onclick=function(){openMem(card.dataset.id)}});
}
async function openMem(id){
  var m=S.mems.find(function(x){return x.id===id});
  if(!m)return;
  var notes=(m.notes||[]).map(noteHtml).join('');
  var imgs=m.images&&m.images.length?'<div class="imgs">'+m.images.map(function(s,i){return'<div class="tile" data-lb="'+i+'"><img src="'+s+'" alt=""></div>'}).join('')+'</div>':'';
  var body='<div class="kv" style="color:var(--dim);font-size:12px;display:flex;gap:12px;flex-wrap:wrap">'
    +'<span>'+esc(m.cat||'日常')+'</span><span>'+esc(m.when||'')+'</span><span>by '+esc(m.by||'')+'</span></div>'
    +'<div class="descBody" style="margin-top:8px">'+esc(m.desc||'')+'</div>'
    +imgs
    +'<div class="secT">朋友们的补充 '+(m.notes||[]).length+' 条</div>'+notes;
  modal(esc(m.title),body,
    '<button class="ghost" data-note>写回望</button>'
    +'<div style="flex:1"></div>'
    +'<button class="danger" data-del>删除</button>'
    +'<button class="pri" id="mX">关闭</button>',true);
  bindModalClose();
  bindLightbox(m.images||[]);
  $('#mRoot [data-note]').onclick=function(){addNote('memorie',id)};
  $('#mRoot [data-del]').onclick=function(){confirmDlg('删除这条记忆？',function(){delItem('memories',id)})};
}
async function delItem(kind,id){
  try{await api('/'+kind+'/'+id,'DELETE');closeModal();loadAll(true);toast('已删除')}catch(e){toast(e.message)}
}
/* 新建记忆点：ilat/ilng 为地图点选坐标 */
function newMemDlg(ilat,ilng){
  hideMapPopup();
  var chips=['日常','旅行','美食','学习','重要'];
  var ch=chips.map(function(c){return'<button class="cchip'+(c==='日常'?' on':'')+'" data-c="'+c+'">'+c+'</button>'}).join('');
  var latV=isFinite(ilat)?(' value="'+ilat+'"'):'';
  var lngV=isFinite(ilng)?(' value="'+ilng+'"'):'';
  modal('记录一段共同记忆',
    '<div class="lbl">标题 *</div><input id="nTitle" maxlength="30" placeholder="这件事叫什么">'
    +'<div class="lbl">发生日期</div><input type="date" id="nWhen">'
    +'<div class="lbl">分类</div><div class="cchips" style="display:flex;gap:6px;flex-wrap:wrap">'+ch+'</div>'
    +'<div class="lbl">细节</div><textarea id="nDesc" style="min-height:110px;resize:vertical" placeholder="那天发生了什么？谁说了什么？…"></textarea>'
    +'<div class="lbl">图片（可选，最多 3 张）</div>'
    +'<div class="imgs" id="nImgs"><button id="nAddImg" class="pri" style="width:auto;padding:6px 14px">添加图片</button></div>'
    +'<input type="file" id="nFile" accept="image/*" multiple hidden>'
    +'<div class="lbl">所在地坐标 '+(isFinite(ilat)?'<span style="color:#22d3ee">已从地图点选</span>':'<span style="color:var(--dim)">（也可到记忆地图上点选）</span>')+'</div>'
    +'<div style="display:flex;gap:8px"><input id="nLat" placeholder="纬度"'+latV+'><input id="nLng" placeholder="经度"'+lngV+'></div>',
    '<button id="mX">取消</button><button class="pri" id="nOk">保存记忆</button>',true);
  bindModalClose();
  var imgs=[],cat='日常';
  $$('#mRoot .cchip').forEach(function(b){
    b.onclick=function(){$$('#mRoot .cchip').forEach(function(o){o.classList.remove('on')});b.classList.add('on');cat=b.dataset.c};
  });
  $('#nAddImg').onclick=function(){$('#nFile').click()};
  $('#nFile').onchange=function(){
    Array.prototype.slice.call(this.files).slice(0,3-imgs.length).forEach(function(f){
      compress(f,function(url){imgs.push(url);var t=document.createElement('div');t.className='tile';
        t.innerHTML='<img src="'+url+'" alt=""><button class="x" style="position:absolute;top:0;right:0;background:rgba(0,0,0,.7);border:none;color:#fff;padding:0 6px">×</button>';
        t.onclick=function(e){if(e.target.tagName==='BUTTON'){imgs.splice(imgs.indexOf(url),1);t.remove();$('#nAddImg').style.display=imgs.length>=3?'none':'inline-block'}};
        $('#nImgs').appendChild(t);
        $('#nAddImg').style.display=imgs.length>=3?'none':'inline-block';
      });
    });
    this.value='';
  };
  $('#nOk').onclick=async function(){
    var title=$('#nTitle').value.trim();
    if(!title){toast('请填写标题');return}
    var lat=parseFloat($('#nLat').value),lng=parseFloat($('#nLng').value);
    try{
      await api('/memories','POST',{title:title,cat:cat,when:$('#nWhen').value,desc:$('#nDesc').value.trim(),
        images:imgs,lat:isFinite(lat)?lat:null,lng:isFinite(lng)?lng:null});
      closeModal();await loadAll(true);
      if(S.view==='map'){refreshMapViews(true)}
      toast('已记录');
    }catch(e){toast(e.message)}
  };
}

/* ---------- 通用 UI ---------- */
function modal(title,body,foot,wide){
  $('#mRoot').innerHTML='<div class="modal'+(wide?'':'')+'" style="'+(wide?'width:min(640px,100%)':'')+'">'
    +'<div class="mh"><h3>'+title+'</h3><button class="x" data-x>×</button></div>'
    +'<div class="mb">'+body+'</div>'
    +(foot?'<div class="mf">'+foot+'</div>':'')
    +'</div>';
  $('#mRoot').classList.add('on');
  $('#mRoot .modal').onclick=function(e){e.stopPropagation()};
}
function bindModalClose(){
  var x=$('#mRoot [data-x]');if(x)x.onclick=closeModal;
  $('#mRoot').onclick=function(e){if(e.target===$('#mRoot'))closeModal()};
  var m=$('#mRoot #mX');if(m)m.onclick=closeModal;
}
function closeModal(){$('#mRoot').classList.remove('on');$('#mRoot').innerHTML=''}
function confirmDlg(msg,cb){
  modal('确认操作','<p style="line-height:1.8;color:var(--fg)">'+esc(msg)+'</p>',
    '<button id="mX">取消</button><button class="pri danger" style="background:linear-gradient(135deg,#b91c1c,#7f1d1d);border:none" id="cOk">确认</button>');
  bindModalClose();
  $('#cOk').onclick=function(){closeModal();cb()};
}
function bindLightbox(imgs){
  var lb=$('#lb');
  $$('#mRoot .tile[data-lb]').forEach(function(t){
    t.onclick=function(){
      var i=parseInt(t.dataset.lb,10);
      $('#lbImg').src=imgs[i];lb.classList.add('on');
    };
  });
  $('#lb').onclick=function(){lb.classList.remove('on')};
}
function compress(f,cb){
  var rd=new FileReader();
  rd.onload=function(){
    var img=new Image();
    img.onload=function(){
      var M=1100,w=img.width,h=img.height,s=Math.max(w,h)/M;
      if(s>1){w=Math.round(w/s);h=Math.round(h/s)}
      var cv=document.createElement('canvas');cv.width=w;cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      var isP=f.type==='image/png';
      cb(cv.toDataURL(isP?'image/png':'image/jpeg',isP?undefined:0.78));
    };
    img.src=rd.result;
  };
  rd.readAsDataURL(f);
}

/* ---------- 启动 ---------- */
function boot(){
  TCBG.init();
  TCBG.attachBtn($('#demoBtn'));
  TCBG.attachWeatherBtn($('#wBtn'));
  $('#wBtn').onclick=function(){TCBG.nextWeather()};
  $('#demoBtn').onclick=function(){TCBG.toggleDemo()};
  $('#outBtn').onclick=function(){logout()};
  $('#navCap').onclick=function(){S.view='cap';switchV()};
  $('#navMem').onclick=function(){S.view='mem';switchV()};
  $('#navMap').onclick=function(){S.view='map';switchV()};
  $('#fabCap').onclick=function(){newCapDlg()};
  $('#fabMem').onclick=function(){newMemDlg()};

  /* 地图工具 */
  var linkOn=false;
  function syncLinkBtn(){
    linkOn=MAP.isPick();
    $('#mtLink').classList.toggle('on',linkOn);
    $('#mtLink').textContent=linkOn?'取消连线':'轨迹连线';
    $('#mapHint2').textContent=linkOn?'连线模式：依次点击两个标记（记忆点或胶囊），串联成一段轨迹'
      :'点击地图空白处可标记新记忆的地点；点击标记查看详情';
  }
  $('#mtLink').onclick=async function(){
    var ok=await ensureMap();
    if(!ok)return;
    MAP.togglePick();syncLinkBtn();
    if(linkOn)toast('连线模式：点击第一个标记');
  };
  $('#mtLocate').onclick=async function(){
    var ok=await ensureMap();
    if(!ok)return;
    /* 位置 API 要求安全上下文：localhost 可直用，局域网/公网需 HTTPS */
    if(!window.isSecureContext&&!/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)){
      toast('浏览器定位需要 HTTPS 加密通道。请启用 TLS 后用 https://'+location.host+' 访问');
      return;
    }
    MAP.locate(function(){toast('已定位到你的位置')},function(m){toast(m)});
  };
  $('#mpMem').onclick=function(){
    if(S.mapPop.lng!=null)newMemDlg(S.mapPop.lat,S.mapPop.lng);
  };
  $('#mpCap').onclick=function(){
    if(S.mapPop.lng!=null)newCapDlg(S.mapPop.lat,S.mapPop.lng);
  };
  $('#mpClose').onclick=hideMapPopup;
  bindLogin();
  if(S.token){
    api('/me','POST').then(function(){
      S.user=S.user||JSON.parse(ls('tc_u')||'null');
      enter();
    }).catch(function(){});
  }
}
document.addEventListener('DOMContentLoaded',boot);
})();

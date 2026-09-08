/* ============================================================
   记忆地图（高德 JS API 2.0）
   Key / 安全密钥配置在文首；生产环境建议改用 serviceHost 代理
   依赖容器 <div id="amap">
   API: MAP.init(cfg,ok,err)→Promise; MAP.show(items,links,fit);
        MAP.togglePick(); MAP.cancelPick(); MAP.isPick();
        MAP.locate(ok,err); MAP.resize(); MAP.mapReady()
   回调: cfg.onMarker(item) cfg.onEmpty(lng,lat) cfg.onHint(msg)
        cfg.onLinkDone(a,b)
   图层采用“增量同步”：每 30s 拉取只增删差异，避免整层重建
   ============================================================ */
(function(){
'use strict';
var AMAP_KEY='bd740dd146a034549ecf1a4547cb8d52';
var AMAP_SC ='aa80170cb1283dd8b511e604db61fa63';

var SCRIPT_OK=false,loadP=null;
var map=null,container=null,mapReady=false;
var marks={};      /* id -> {ref,item,html} */
var linesMap={};   /* id -> {ref,a,b} */
var pick={on:false,a:null};
var cfg={};

function loadAMap(){
  if(window.AMap&&SCRIPT_OK)return Promise.resolve(window.AMap);
  if(loadP)return loadP;
  window._AMapSecurityConfig={securityJsCode:AMAP_SC};
  loadP=new Promise(function(res,rej){
    var s=document.createElement('script');
    s.src='https://webapi.amap.com/maps?v=2.0&key='+AMAP_KEY;
    s.onload=function(){if(window.AMap){SCRIPT_OK=true;res(window.AMap)}else rej(new Error('高德脚本加载异常'))};
    s.onerror=function(){rej(new Error('无法连接高德服务器，请检查网络与域名白名单'))};
    document.head.appendChild(s);
    setTimeout(function(){if(!window.AMap)rej(new Error('高德地图加载超时'))},20000);
  });
  return loadP;
}
function savedView(){
  try{var o=JSON.parse(localStorage.getItem('tc_mapview')||'null');return o}catch(e){return null}
}
function storeView(){
  if(!map)return;
  try{localStorage.setItem('tc_mapview',JSON.stringify({lng:map.getCenter().getLng(),lat:map.getCenter().getLat(),z:map.getZoom()}))}catch(e){}
}
var fitTry=0;
function fitAll(){
  if(!map)return;
  var c;
  try{c=map.getCenter&&map.getCenter()}catch(e){c=null}
  var ok=mapReady&&c&&isFinite(c.getLng())&&isFinite(c.getLat())&&(map.getSize&&map.getSize().width>0);
  if(!ok){
    /* 地图尚未完成初始化(如瓦片/样式加载中)，稍后重试 */
    if(fitTry<30){fitTry++;setTimeout(fitAll,400)}
    return;
  }
  fitTry=0;
  var arr=[];
  Object.keys(marks).forEach(function(k){arr.push(marks[k].ref)});
  if(!arr.length)return;
  try{
    if(arr.length===1){
      var one=marks[Object.keys(marks)[0]];
      if(isFinite(one.item.lng)&&isFinite(one.item.lat))map.setZoomAndCenter(14,[one.item.lng,one.item.lat]);
    }else{map.setFitView(arr,false,90,90)}
  }catch(e){console.error('fit err',e)}
}
function escAttr(s){return String(s==null?'':s).replace(/[<>&"]/g,'')}
function markerHtml(it){
  var locked=it.kind==='cap'&&it.locked;
  var inner=it.kind==='cap'
    ?'<span class="pill"></span>'+(locked?'<span class="bar"></span>':'')
    :'<span class="dot"></span>';
  var col=it.kind==='cap'?(locked?'#94a3b8':'#22d3ee'):(it.color||'#22d3ee');
  return '<div class="mk'+(locked?' locked':'')+'" style="color:'+col+'">'
    +'<div class="pin">'+inner+'<span class="arr"></span></div>'
    +'<div class="lbl">'+escAttr(it.title)+'</div></div>';
}
function applyPickCls(){
  Object.keys(marks).forEach(function(k){
    var m=marks[k];var el=m.ref.getContent&&m.ref.getContent();
    if(el&&el.classList)el.classList.toggle('pick',!!(pick.a&&pick.a.id===k));
  });
}
function markerTap(it,m){
  if(pick.on){pickStep(it,m);return}
  if(cfg.onMarker){cfg.onMarker(it)}
}
function pickStep(it,m){
  if(!pick.a){
    pick.a={id:it.id};applyPickCls();
    cfg.onHint&&cfg.onHint('已选「'+it.title+'」，再点另一个标记完成连线');
  }else if(pick.a.id===it.id){
    cfg.onHint&&cfg.onHint('同一个点，请再选另一个');
  }else{
    var a=pick.a.id,b=it.id;
    pick.on=false;pick.a=null;applyPickCls();
    cfg.onLinkDone&&cfg.onLinkDone(a,b);
  }
}
function setPickMode(on){
  pick.on=!!on;
  if(!on)pick.a=null;
  applyPickCls();
}

/* ---------- 增量同步图层 ---------- */
function safe(fn){try{fn()}catch(e){console.error('地图图层单项异常(已跳过):',e&&e.message)}}
function addMarker(it){
  safe(function(){
    var m=new AMap.Marker({
      position:[it.lng,it.lat],
      content:markerHtml(it),
      offset:new AMap.Pixel(-17,-40),
      zIndex:it.kind==='cap'?30:20
    });
    m.setMap(map);
    m.on('click',function(){markerTap(it,m)});
    marks[it.id]={ref:m,item:it,html:markerHtml(it)};
    if(pick.a&&pick.a.id===it.id)applyPickCls();
  });
}
function addLine(lk,a,b){
  safe(function(){
    var pl=new AMap.Polyline({
      path:[[a.lng,a.lat],[b.lng,b.lat]],
      strokeColor:'#ffd76a',strokeWeight:3,strokeOpacity:.85,
      strokeStyle:'dashed',strokeDasharray:[6,8],zIndex:10,lineJoin:'round'
    });
    pl.setMap(map);
    pl.on('click',function(){cfg.onLink&&cfg.onLink(lk)});
    linesMap[lk.id]={ref:pl,a:a,b:b};
  });
}
function removeMark(id){var o=marks[id];if(o){safe(function(){o.ref.setMap(null)});delete marks[id]}}
function removeLine(id){var o=linesMap[id];if(o){safe(function(){o.ref.setMap(null)});delete linesMap[id]}}

function sync(items,links){
  if(!map)return;
  var have={};
  /* 连线层（先画到最底层） */
  var idx={};
  items.forEach(function(i){idx[i.id]=i});
  links.forEach(function(lk){
    var a=idx[lk.a],b=idx[lk.b];
    if(!a||!b||!isFinite(a.lat)||!isFinite(a.lng)||!isFinite(b.lat)||!isFinite(b.lng))return;
    have['l:'+lk.id]=1;
    var ex=linesMap[lk.id];
    if(ex){
      if(ex.a.id!==a.id||ex.b.id!==b.id){ex.a=a;ex.b=b;safe(function(){ex.ref.setPath([[a.lng,a.lat],[b.lng,b.lat]])})}
    }else addLine(lk,a,b);
  });
  /* 标记层 */
  items.forEach(function(it){
    if(!isFinite(it.lat)||!isFinite(it.lng))return;
    have['m:'+it.id]=1;
    var ex=marks[it.id];
    if(!ex){addMarker(it);return}
    var h=markerHtml(it);
    if(h!==ex.html){ex.html=h;ex.item=it;safe(function(){ex.ref.setContent(h)})}
    else{ex.item=it}
    var p=ex.ref.getPosition&&ex.ref.getPosition();
    if(p&&(Math.abs(p.getLng()-it.lng)>1e-9||Math.abs(p.getLat()-it.lat)>1e-9)){
      safe(function(){ex.ref.setPosition([it.lng,it.lat])})
    }
  });
  /* 清理消失的 */
  Object.keys(linesMap).forEach(function(id){if(!have['l:'+id])removeLine(id)});
  Object.keys(marks).forEach(function(id){if(!have['m:'+id])removeMark(id)});
  if(pick.a&&!marks[pick.a.id])pick.a=null;
}

var MAP=window.MAP={};
MAP.init=function(c,onReady,onErr){
  container=c;
  return loadAMap().then(function(){
    if(!map){
      var sv=savedView();
      map=new AMap.Map(container,{
        center:sv?[sv.lng,sv.lat]:[116.3974,39.9093],
        zoom:sv?sv.z:11,
        viewMode:'2D',
        mapStyle:'amap://styles/dark',
        resizeEnable:true
      });
      map.on('click',function(e){
        if(pick.on)return;
        cfg.onEmpty&&cfg.onEmpty(e.lnglat.getLng(),e.lnglat.getLat());
      });
      map.on('moveend',storeView);map.on('zoomend',storeView);
      map.on('complete',function(){
        mapReady=true;
        safe(function(){map.resize&&map.resize()});
        fitTry=0;storeView();
      });
      /* 兜底：15 秒后若仍未 complete 仍放行交互（部分网络瓦片慢） */
      setTimeout(function(){if(!mapReady){mapReady=true;safe(function(){map.resize&&map.resize()})}},15000);
    }
    if(onReady)onReady();
    return map;
  },function(e){
    loadP=null;SCRIPT_OK=false;
    if(onErr)onErr(e);else throw e;
    return null;
  });
};
MAP.show=function(items,links,fit){
  sync(items||[],links||[]);
  if(fit)fitAll();
};
MAP.togglePick=function(){setPickMode(!pick.on);return pick.on};
MAP.cancelPick=function(){setPickMode(false)};
MAP.isPick=function(){return pick.on};
MAP.locate=function(ok,err){
  if(!map)return;
  if(!navigator.geolocation){err&&err('浏览器不支持定位');return}
  navigator.geolocation.getCurrentPosition(function(pos){
    map.setZoomAndCenter(15,[pos.coords.longitude,pos.coords.latitude]);
    ok&&ok();
  },function(){err&&err('定位失败：请允许浏览器位置权限(需 http/https 环境)')},{timeout:6000});
};
MAP.resize=function(){if(map)safe(function(){map.resize&&map.resize()})};
MAP.mapReady=function(){return !!map};
MAP.setCfg=function(c){cfg=c||{}};
})();

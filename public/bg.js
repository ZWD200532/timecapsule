/* ============================================================
   光影背景引擎 v3.1（赛博朋克 × 城中村）
   - 按真实时刻的昼夜光影（黎明/正午/黄昏/霓虹夜）
   - 多层城中村剪影：握手楼/民宅/塔楼 + 水箱/天线/烟囱 + 视差伪3D
   - 天气联动：晴 / 多云 / 阴 / 雨 / 雪 / 雾（云层/粒子/雾气/地面反光/室内灯联动）
   - 性能：DPR 钳制≤2、粒子与窗户自适应、隐藏自动暂停
   API: TCBG.init() setDemo(b) isDemo() toggleDemo() attachBtn(b)
        TCBG.setWeather(w) nextWeather() weatherLabel() attachWeatherBtn(b)
   ============================================================ */
(function(){
'use strict';
var cv=document.getElementById('bg');
var ctx=cv.getContext('2d');
var W=0,H=0;
var DEMO=false,demoT=13;
var paused=false;

/* 天气 */
var WEATHERS=['sunny','cloudy','overcast','rain','snow','fog'];
var WLABEL={sunny:'晴',cloudy:'多云',overcast:'阴',rain:'雨',snow:'雪',fog:'雾'};
var weather='sunny';
try{var _wv=localStorage.getItem('tc_weather');if(WLABEL[_wv])weather=_wv}catch(e){}

var mouse={x:0,y:0},cur={x:0,y:0};
var seed=20260907;
function rnd(){seed=(seed*16807)%2147483647;return seed/2147483647}
function clamp(v,a,b){return v<a?a:(v>b?b:v)}
function mix(a,b,k){return a+(b-a)*k}
function hourNow(){return DEMO?demoT:(new Date().getHours()+new Date().getMinutes()/60)}

/* ---------- 调色 ---------- */
var N={top:[3,6,15],mid:[10,18,36],low:[26,38,68],haze:[46,60,96]};
var D={top:[52,110,200],mid:[122,170,240],low:[196,224,252],haze:[180,210,248]};
var E={top:[30,52,120],mid:[150,90,120],low:[255,160,110],haze:[255,190,130]};
var GRAY=[118,132,156];
function lc(c1,c2,k){return[Math.round(mix(c1[0],c2[0],k)),Math.round(mix(c1[1],c2[1],k)),Math.round(mix(c1[2],c2[2],k))]}
function skyBase(e){
  var d=clamp(e,0,1);
  var top=N.top,mid=N.mid,low=N.low,haze=N.haze;
  if(d>0.01){top=lc(N.top,D.top,d);mid=lc(N.mid,D.mid,d);low=lc(N.low,D.low,d);haze=lc(N.haze,D.haze,d)}
  var warm=clamp(.16-Math.abs(e),0,1);warm=warm*warm/.16*.9;
  if(warm>0){
    low=lc(low,E.low,warm*.9);haze=lc(haze,E.haze,warm*.9);
    mid=lc(mid,E.mid,warm*.6);top=lc(top,E.top,warm*.4);
  }
  return{top:top,mid:mid,low:low,haze:haze,d:d,warm:warm};
}
function weatherFx(w){
  var o={sky:0,sat:0,lit:0,cold:0};
  if(w==='cloudy'){o.sat=.18;o.sky=-.04}
  else if(w==='overcast'){o.sat=.32;o.sky=-.30;o.lit=.10}
  else if(w==='rain'){o.sat=.34;o.sky=-.42;o.lit=.34}
  else if(w==='snow'){o.sat=.20;o.sky=-.26;o.lit=.22;o.cold=.35}
  else if(w==='fog'){o.sat=.24;o.sky=-.12}
  return o;
}
/* 城市数据 */
var layers=[],signs=[],clouds=[],rain=[],snow=[];

function mkLayer(baseH,hLo,hHi,kindHi,extra){
  var a=[],x=-W*.3;
  while(x<W*1.3){
    var i=a.length,bw;
    if(i%3===0)bw=30+rnd()*42;      /* 握手楼 */
    else if(i%3===1)bw=52+rnd()*62; /* 民宅 */
    else bw=88+rnd()*92;            /* 楼宇 */
    var bh=baseH+hLo+rnd()*(hHi-hLo);
    if(i%5===0)bh*=1.55;            /* 偶有高层 */
    var kind=Math.floor(rnd()*6);
    var cw=clamp(Math.floor(bw/15),2,10);
    var b={x:x,w:bw,h:Math.max(10,Math.round(bh)),kind:kind,cw:cw,
      tint:Math.round((rnd()-.5)*22),seeded:rnd()*9};
    var rows=clamp(Math.floor(bh/15),1,22);
    b.rows=rows;
    b.lit=[];for(var k=0;k<cw*rows;k++)b.lit.push(rnd());
    a.push(b);
    x+=b.w*(0.58+0.55*rnd());
    void kindHi;void extra;
  }
  return a;
}
function mkSigns(){
  var a=[];var n=5+Math.floor(rnd()*5);
  for(var i=0;i<n;i++)a.push({
    x:30+rnd()*(W-60),y:10+rnd()*(H*.38),
    w:20+rnd()*96,h:7+rnd()*12,ph:rnd()*9,
    c:[rnd()<.5?34:217,rnd()<.5?211:39,rnd()<.5?246:120],ver:rnd()<.3
  });
  return a;
}
function mkWeatherData(){
  var big=W*H;
  var rainN=Math.round(clamp(big/36000,70,320));
  var snowN=Math.round(clamp(big/26000,60,220));
  rain=[];snow=[];
  for(var i=0;i<rainN;i++)rain.push({x:rnd(),y:rnd(),len:8+rnd()*11,sp:340+rnd()*300});
  for(var j=0;j<snowN;j++)snow.push({x:rnd(),y:rnd(),s:1.1+rnd()*2.2,ph:rnd()*7});
  clouds=[];
  for(var c=0;c<12;c++)clouds.push({x:rnd(),y:rnd()*.5,sc:.55+rnd()*.7,sp:.003+rnd()*.004,a:.35+rnd()*.35});
}
function rebuild(){
  layers=[mkLayer(26,20,120,0,0),mkLayer(42,50,230,0,0),mkLayer(60,110,380,0,0)];
  signs=mkSigns();
  mkWeatherData();
}
function resize(){
  var dpr=Math.min(window.devicePixelRatio||1,2);
  W=window.innerWidth;H=window.innerHeight;
  cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);
  cv.style.width=W+'px';cv.style.height=H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  rebuild();
}

/* 主绘制 */
function C(c){return'rgb('+c[0]+','+c[1]+','+c[2]+')'}
function draw(t){
  if(!W)return;
  var e=Math.sin(((hourNow()-6)/12)*Math.PI);
  var P=skyBase(e);
  var fx=weatherFx(weather);
  var light=clamp(P.d+fx.sky,0,1);
  var grayK=clamp(fx.sat+Math.max(0,-fx.sky)*.55,0,1);
  var top=lc(P.top,GRAY,grayK),mid=lc(P.mid,GRAY,grayK*.7),low=lc(P.low,GRAY,grayK*.55);
  if(fx.cold>0){top=lc(top,[170,192,230],fx.cold*.5);low=lc(low,[185,208,235],fx.cold*.3)}

  /* 天空 */
  var g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,C(top));g.addColorStop(.5,C(mid));g.addColorStop(.86,C(low));
  g.addColorStop(1,C(lc(low,[8,10,20],.55)));
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

  /* 星空：晴/雪 夜空可见 */
  if(light<.45&&(weather==='sunny'||weather==='snow')){
    var sn=Math.round(clamp(W*H/9000,50,170));
    ctx.fillStyle='#cfe2ff';
    for(var i=0;i<sn;i++){
      var sx=(i*7919)%W, sy=(i*104729)%Math.max(1,Math.floor(H*.5));
      var a=(.45-light)*(.35+.65*Math.abs(Math.sin(t*.001+i*2.7)));
      if(a<.05)continue;
      ctx.globalAlpha=a;ctx.fillRect(sx,sy,1.5,1.5);
    }
    ctx.globalAlpha=1;
  }

  /* 太阳/月亮（阴雨被云遮） */
  var vis=1-(weather==='overcast'?.82:weather==='rain'?.9:weather==='cloudy'?.45:weather==='fog'?.9:0);
  var cx=W*(.16+.68*clamp((hourNow()-6)/12,0,1)),cy=H*(.86-e*.62);
  if(vis>0&&e>-.06){
    ctx.globalAlpha=vis;
    var rg=ctx.createRadialGradient(cx,cy,8,cx,cy,150);
    rg.addColorStop(0,'rgba(255,238,190,.45)');rg.addColorStop(1,'rgba(255,238,190,0)');
    ctx.fillStyle=rg;ctx.beginPath();ctx.arc(cx,cy,150,0,7);ctx.fill();
    ctx.fillStyle=P.warm>.3?'#ffc98a':'#fff3b0';
    ctx.beginPath();ctx.arc(cx,cy,24,0,7);ctx.fill();
    ctx.globalAlpha=1;
  }else if(vis>0){
    var mx=W*(.16+.68*clamp((hourNow()-18)/12,0,1)),my=H*(.6+.2*(1-Math.abs(e)));
    ctx.globalAlpha=vis;
    ctx.fillStyle='rgba(226,236,252,.9)';
    ctx.beginPath();ctx.arc(mx,my,16,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(mx-6,my-4,12,0,7);ctx.fill();
    ctx.fillStyle='rgba(13,17,35,.92)';
    ctx.beginPath();ctx.arc(mx-5,my-3,12,0,7);ctx.fill();
    ctx.globalAlpha=1;
  }

  drawClouds(t);

  /* 城市地平线辉光 */
  var y0=H*.56;
  var hg=ctx.createLinearGradient(0,y0-30,0,y0+40);
  hg.addColorStop(0,'rgba(0,0,0,0)');
  var gc=P.warm>.3?P.haze:(light>.6?P.haze:[140,92,220]);
  var ga=(P.warm>.3?.5:clamp(.15+light*.6,0,.8))*(weather==='fog'?.5:1);
  hg.addColorStop(.5,'rgba('+gc[0]+','+gc[1]+','+gc[2]+','+ga+')');
  hg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=hg;ctx.fillRect(0,y0-30,W,70);

  var cfgL=[
    {base:H*.88,tint:lc([20,28,48],[70,96,150],light),al:.55},
    {base:H*.95,tint:lc([11,17,33],[44,66,108],light),al:.85},
    {base:H*1.0,tint:[3,5,11],al:1}
  ];
  drawCity(cfgL[0],0,light,t);
  drawCity(cfgL[1],1,light,t);
  drawCity(cfgL[2],2,light,t);

  /* 雨夜地面与反光已含于各层招牌下方；再加整体湿润反光带 */
  if(weather==='rain'){
    var gr2=ctx.createLinearGradient(0,H-46,0,H);
    gr2.addColorStop(0,'rgba(120,150,210,0)');
    gr2.addColorStop(.5,'rgba(120,150,210,.10)');
    gr2.addColorStop(1,'rgba(90,120,190,.16)');
    ctx.fillStyle=gr2;ctx.fillRect(0,H-46,W,46);
  }
  if(weather==='snow')drawSnow(t);
  if(weather==='rain')drawRain(t);
  if(weather==='fog')drawFog(t);
}
function drawClouds(t){
  var cnt=weather==='sunny'?0:weather==='fog'?0:weather==='cloudy'?4:weather==='overcast'?7:weather==='rain'?8:weather==='snow'?5:0;
  if(!cnt)return;
  var dark=weather==='overcast'?.8:weather==='rain'?.9:weather==='snow'?.55:.25;
  var ct=lc([170,180,200],[72,82,96],dark);
  ctx.fillStyle=C(ct);
  for(var i=0;i<cnt;i++){
    var cd=clouds[i];
    var x=((cd.x*W+t*cd.sp*10)*(1))%(W+340)-170;
    var y=H*cd.y+30;
    var sc=cd.sc;
    ctx.globalAlpha=cd.a*(weather==='overcast'?1:.8)*(0.7+0.3*Math.sin(t*.0009+i));
    ctx.beginPath();
    ctx.ellipse(x,y,95*sc,20*sc,0,0,7);
    ctx.ellipse(x+46*sc,y-9*sc,58*sc,15*sc,0,0,7);
    ctx.ellipse(x-50*sc,y-4*sc,52*sc,14*sc,0,0,7);
    ctx.fill();
  }
  ctx.globalAlpha=1;
}
function drawCity(nt,li,light,t){
  var arr=layers[li];
  ctx.save();
  ctx.globalAlpha=nt.al;
  ctx.translate(cur.x*(li===0?-9:li===1?-3:5),0);
  if(weather==='fog'&&li===0)ctx.globalAlpha*=0.3;
  for(var i=0;i<arr.length;i++){
    var b=arr[i];
    if(b.x+b.w<-50||b.x>W+50)continue;
    var col=b.tint;
    var base=nt.base;
    var top=Math.floor(base-b.h);
    var cl=[nt.tint[0]+col,nt.tint[1]+col,nt.tint[2]+col];
    cl[0]=clamp(cl[0],0,255);cl[1]=clamp(cl[1],0,255);cl[2]=clamp(cl[2],0,255);
    ctx.fillStyle=C(cl);
    ctx.fillRect(b.x,top,b.w,b.h);
    /* 屋顶 */
    var rl=[cl[0]*1.15,cl[1]*1.15,cl[2]*1.2];
    ctx.fillStyle=C([Math.min(255,rl[0]),Math.min(255,rl[1]),Math.min(255,rl[2])]);
    var k=b.kind;
    if(k===0){ctx.fillRect(b.x+b.w*.28,top-5,b.w*.44,6)}
    else if(k===1){ctx.fillRect(b.x+b.w*.42,top-9,b.w*.2,10);ctx.fillRect(b.x+b.w*.46,top-18,2,10);ctx.fillRect(b.x+b.w*.5,top-28,1.5,10)}
    else if(k===2){ctx.fillRect(b.x+b.w*.5-8,top-15,17,17);ctx.fillRect(b.x+b.w*.5-2.5,top-26,5,12)}
    else if(k===3){ctx.fillRect(b.x+b.w*.12,top-3,b.w*.5,4);ctx.fillRect(b.x+b.w*.5,top-9,b.w*.3,7)}
    else if(k===4){ctx.fillRect(b.x+b.w*.2,top-8,b.w*.45,9);ctx.fillRect(b.x+b.w*.4,top-20,2,12)}
    else{ctx.fillRect(b.x+b.w*.3,top-12,b.w*.32,14)}
    /* 侧暗 */
    ctx.fillStyle='rgba(0,0,12,.17)';
    ctx.fillRect(b.x+b.w*.72,top,b.w*.28,b.h);
    /* 楼层线 */
    var step=Math.max(11,Math.round(b.h/16));
    ctx.strokeStyle='rgba(0,0,12,.14)';
    ctx.lineWidth=1;
    for(var y=top+step;y<base;y+=step){ctx.beginPath();ctx.moveTo(b.x,y);ctx.lineTo(b.x+b.w,y);ctx.stroke()}
    /* 窗（只近两层；数量自适应） */
    if(li>=1&&b.w>24){
      var litK=clamp(1-light*1.7,0,1)+fxLit(weather);
      litK=clamp(litK,0,1);
      if(litK>.02){
        var rowsFit=clamp(Math.floor((b.h-6)/step),1,14);
        var cw=b.cw,colw=b.w/cw,rowh=step;
        var offT=top+5;
        var idx=0,total=b.cw*b.rows;
        for(var rr=0;rr<rowsFit&&idx<total;rr++){
          for(var cc=0;cc<cw;cc++,idx++){
            var lv=b.lit[idx];
            if(lv>litK)continue;
            if(Math.sin(t*.004+idx*5.1+rr*8.3+cc*2.9)<-0.75)continue;
            var wl=Math.floor(4+lv*10);
            ctx.fillStyle='rgba('+wl+','+Math.min(255,wl+18)+','+Math.min(255,wl-12<0?0:wl-12)+',.9)';
            ctx.fillRect(b.x+4+cc*colw,offT+rr*rowh,Math.max(2.5,colw-6),Math.max(2.5,rowh-4));
          }
        }
      }
    }
    /* 雪顶 */
    if(weather==='snow'){
      ctx.fillStyle='rgba(238,244,255,.45)';
      ctx.fillRect(b.x,top-2,b.w,3);
      if(k===2){ctx.fillRect(b.x+b.w*.5-9,top-15,18,3)}
      if(k===0||k===3){ctx.fillRect(b.x+b.w*.28,top-5,b.w*.44,3)}
    }
  }
  if(li===2)drawSignsAt(t,light);
  ctx.restore();
}
function fxLit(w){return w==='rain'?.35:w==='overcast'?.12:w==='snow'?.22:w==='cloudy'?.05:0}
function drawSignsAt(t,light){
  var nA=(1-light)*.85+.05;
  if(nA<=.06)return;
  for(var i=0;i<signs.length;i++){
    var s=signs[i];
    var on=Math.sin(t*.004+s.ph)>-0.45;
    var fl=on?(.65+.35*Math.sin(t*.011+s.ph*2)):.15;
    ctx.save();
    ctx.shadowColor='rgb('+s.c[0]+','+s.c[1]+','+s.c[2]+')';
    ctx.shadowBlur=15;
    ctx.globalAlpha=Math.min(.95,nA)*fl;
    ctx.fillStyle='rgb('+s.c[0]+','+s.c[1]+','+s.c[2]+')';
    if(s.ver){ctx.beginPath();ctx.roundRect(s.x,s.y,s.h,s.w*1.5,3);ctx.fill()}
    else{ctx.beginPath();ctx.roundRect(s.x,s.y,s.w,s.h,3);ctx.fill()}
    ctx.shadowBlur=0;
    ctx.fillStyle='rgba(255,255,255,.85)';
    ctx.globalAlpha=Math.min(.95,nA)*fl*.9;
    if(s.ver){ctx.fillRect(s.x+2,s.y+2,Math.max(1,s.h-4),3)}
    else{ctx.fillRect(s.x+3,s.y+2,Math.max(1,s.w*.3),Math.max(1,s.h-4))}
    ctx.restore();
  }
}
function drawRain(t){
  ctx.strokeStyle='rgba(175,202,235,.36)';
  ctx.lineWidth=1;
  ctx.beginPath();
  for(var i=0;i<rain.length;i++){
    var r=rain[i];
    var y=(r.y*H+t*r.sp/60)%(H+40);
    if(y>H+20)continue;
    var x=r.x*W;
    ctx.moveTo(x,y);ctx.lineTo(x-r.len*.16,y+r.len);
  }
  ctx.stroke();
}
function drawSnow(t){
  ctx.fillStyle='rgba(240,246,255,.85)';
  for(var i=0;i<snow.length;i++){
    var s=snow[i];
    var y=(s.y*H+t*.4*s.s)%(H+8);
    var x=s.x*W+Math.sin(t*.0016+s.ph)*W*.02;
    if(y>H)continue;
    ctx.beginPath();ctx.arc(x,y,s.s,0,7);ctx.fill();
  }
}
function drawFog(t){
  var g=ctx.createLinearGradient(0,H*.22,0,H*.95);
  g.addColorStop(0,'rgba(208,218,230,0)');
  g.addColorStop(.5,'rgba(208,218,230,.20)');
  g.addColorStop(1,'rgba(208,218,230,.04)');
  ctx.fillStyle=g;ctx.fillRect(0,H*.22,W,H*.73);
  for(var i=0;i<4;i++){
    ctx.fillStyle='rgba(195,205,220,.03)';
    ctx.fillRect(0,H*(.3+i*.14),W,H*.06);
  }
}

/* ---------- 主循环 ---------- */
var raf=null;
function frame(t){
  try{
    if(!paused){cur.x=mix(cur.x,mouse.x,.05);cur.y=mix(cur.y,mouse.y,.05);draw(t)}
  }catch(e){console.error('bg 渲染异常:',e)}
  if(DEMO)demoT=(demoT+24/20*(1/60))%24;
  raf=requestAnimationFrame(frame);
}
window.addEventListener('mousemove',function(e){
  if(W){mouse.x=(e.clientX/W)*2-1;mouse.y=(e.clientY/H)*2-1}
});
window.addEventListener('resize',function(){resize()});
document.addEventListener('visibilitychange',function(){paused=document.hidden});

var TCBG=window.TCBG={};
TCBG.init=function(){resize();if(!raf)raf=requestAnimationFrame(frame)};
TCBG.setDemo=function(on){DEMO=!!on};
TCBG.isDemo=function(){return DEMO};
TCBG.toggleDemo=function(){DEMO=!DEMO;TCBG._bt&&(TCBG._bt.textContent=DEMO?'回到实时':'光影演示');return DEMO};
TCBG.attachBtn=function(b){TCBG._bt=b;b.textContent=DEMO?'回到实时':'光影演示'};
TCBG.weather=weather;
TCBG.setWeather=function(w){
  if(!WLABEL[w])return weather;
  weather=w;TCBG.weather=w;
  try{localStorage.setItem('tc_weather',w)}catch(e){}
  mkWeatherData();
  TCBG._wb&&(TCBG._wb.textContent='天气·'+WLABEL[w]);
  return w;
};
TCBG.nextWeather=function(){var i=WEATHERS.indexOf(weather);return TCBG.setWeather(WEATHERS[(i+1)%WEATHERS.length])};
TCBG.weatherLabel=function(){return WLABEL[weather]||''};
TCBG.attachWeatherBtn=function(b){TCBG._wb=b;b.textContent='天气·'+WLABEL[weather]};
})();

/* 临时 API 冒烟测试脚本 */
const B='http://localhost:3000/api';
let pass=0,fail=0;
function ok(name,cond,extra){if(cond){pass++;console.log('PASS',name)}else{fail++;console.log('FAIL',name,extra||'')}}
async function api(method,path,body,token){
  const r=await fetch(B+path,{method,headers:{'Content-Type':'application/json','Connection':'close',...(token?{'x-token':token}:'')},body:body?JSON.stringify(body):undefined});
  let j=null;try{j=await r.json()}catch(e){}
  return {s:r.status,j};
}
(async()=>{
  const p=await api('GET','/ping');
  ok('ping',p.s===200&&p.j.serverTime>0);
  const c=await api('POST','/create',{code:'TST01',nick:'阿明',pass:'1234'});
  ok('创建空间',c.s===200&&c.j.token&&c.j.spaceName==='TST01',JSON.stringify(c.j).slice(0,120));
  const tokA=c.j.token;
  const dup=await api('POST','/create',{code:'TST01',nick:'阿明',pass:'1234'});
  ok('重复创建409',dup.s===409);
  const j2=await api('POST','/join',{code:'TST01',nick:'阿青',pass:'5678'});
  ok('加入空间',j2.s===200&&j2.j.token);
  const tokB=j2.j.token;
  const bad=await api('POST','/join',{code:'TST01',nick:'阿青',pass:'wrong'});
  ok('错误口令403',bad.s===403);
  const noauth=await api('GET','/space');
  ok('未登录401',noauth.s===401);
  const empty=await api('GET','/space',null,tokA);
  ok('空空间',empty.s===200&&empty.j.capsules.length===0);
  /* 锁定胶囊：未来解锁 */
  const fut=Date.now()+6e5;
  const cap1=await api('POST','/capsules',{title:'生日惊喜',lat:22.54,lng:114.06,happenedAt:'2023-06-05',desc:'藏了很久的秘密',unlockAt:fut,images:[]},tokA);
  ok('创建胶囊',cap1.s===200&&cap1.j.item.locked===true);
  const cid1=cap1.j.item.id;
  const sp=await api('GET','/space',null,tokB);
  const v=sp.j.capsules.find(x=>x.id===cid1);
  ok('列表锁定不泄密',v&&v.locked===true&&v.desc===undefined&&v.images===undefined,JSON.stringify(v));
  const one=await api('GET','/capsules/'+cid1,null,tokB);
  ok('未到点详情423',one.s===423);
  const nt=await api('POST','/capsules/'+cid1+'/notes',{text:'偷看'},tokB);
  ok('锁定胶囊禁补充423',nt.s===423);
  /* 已解锁胶囊：过去时间 */
  const past=Date.now()-6e5;
  const cap2=await api('POST','/capsules',{title:'已开启的旧时光',lat:31.23,lng:121.47,happenedAt:'2020-09-01',desc:'可以看到的内容',unlockAt:past,images:[]},tokA);
  ok('创建已解锁胶囊',cap2.s===200&&cap2.j.item.locked===false&&cap2.j.item.desc==='可以看到的内容');
  const cid2=cap2.j.item.id;
  const one2=await api('GET','/capsules/'+cid2,null,tokB);
  ok('到点详情200含内容',one2.s===200&&one2.j.capsule.desc==='可以看到的内容');
  const nt2=await api('POST','/capsules/'+cid2+'/notes',{text:'记得那天'},tokB);
  ok('解锁后可补充',nt2.s===200&&nt2.j.notes.length===1);
  /* 记忆点与补充 */
  const mem=await api('POST','/memories',{title:'第一次见面',cat:'日常',when:'2020-09-01',lat:31.2,lng:121.5,desc:'操场',images:[]},tokB);
  ok('创建记忆点',mem.s===200&&mem.j.item.id);
  const memNt=await api('POST','/memories/'+mem.j.item.id+'/notes',{text:'我作证'},tokA);
  ok('记忆点补充',memNt.s===200&&memNt.j.notes.length===1);
  /* 轨迹连线 */
  const ml=await api('POST','/links',{a:mem.j.item.id,b:cid2},tokA);
  ok('创建连线',ml.s===200&&!!ml.j.link&&!!ml.j.link.id,JSON.stringify(ml.j));
  const mlDup=await api('POST','/links',{a:mem.j.item.id,b:cid2},tokB);
  ok('重复连线去重',mlDup.s===200&&mlDup.j.dup===true);
  const spL=await api('GET','/space',null,tokA);
  ok('space返回连线',spL.s===200&&spL.j.links&&spL.j.links.length===1);
  const dl=await api('DELETE','/links/'+ml.j.link.id,null,tokB);
  ok('删除连线',dl.s===200&&(await api('GET','/space',null,tokA)).j.links.length===0);
  const mb=await api('GET','/members',null,tokA);
  ok('成员列表2人',mb.s===200&&mb.j.members.length===2);
  const del=await api('DELETE','/capsules/'+cid2,null,tokA);
  ok('删除胶囊',del.s===200);
  console.log('----',pass,'passed,',fail,'failed');
  process.exitCode=fail?1:0;
})().catch(e=>{console.error('ERR',e);process.exitCode=2});

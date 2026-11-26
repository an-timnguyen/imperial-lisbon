// Imperial: UI and price logic. Data access lives in store.js.
import { start, writeMine, writeMod, moderatorSignIn, moderatorSignOut } from "./store.js";
const AREAS=["Baixa & Rossio","Chiado","Bairro Alto","Cais do Sodré","Príncipe Real","Alfama","Graça","Mouraria & Intendente","Arroios","Penha de França","Marvila","Santos & Alcântara","Belém","Campo de Ourique","Avenidas Novas","Outra Banda"];
const KINDS=["Tasca / café","Bar","Craft beer","Rooftop","Quiosque"];
const SIZES=[[20,"Imperial · 20 cl"],[25,"Mini bottle · 25 cl"],[33,"Bottle · 33 cl"],[40,"Caneca · 40 cl"],[50,"Caneca · 50 cl"],[57,"Pint · 57 cl"]];
const DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const FRESH=180*864e5, MAX_ITEMS=300, MIN_PER=0.75, MAX_PER=25, COOLDOWN=10*60e3;
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const eur=n=>new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR"}).format(n);
const sizeName=cl=>(SIZES.find(s=>s[0]===cl)||[cl,cl+" cl"])[1];
const per=p=>p.eur/p.cl*50;
const okP=p=>p&&typeof p.eur==="number"&&p.eur>0&&typeof p.cl==="number"&&p.cl>0;
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
const rid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);

/* Data lives in Firestore; see store.js for the layout. */
let seedVenues=[],userDocs=new Map(),mod={hiddenReports:[],hiddenUsers:[],hiddenVenues:[]};
let venues=[],reports=[];
let uid=null,canWrite=null,isOwner=false,connected=false;
let st={sort:"cheap",area:"",q:"",hh:false,open:null};
try{const s=JSON.parse(localStorage.getItem("imperial-ui")||"{}");Object.assign(st,{sort:s.sort||"cheap",area:s.area||"",hh:!!s.hh})}catch(e){}
const saveUi=()=>{try{localStorage.setItem("imperial-ui",JSON.stringify({sort:st.sort,area:st.area,hh:st.hh}))}catch(e){}};

function lisbonNow(){const p={};for(const x of new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Lisbon",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()))p[x.type]=x.value;return{day:DAYS.indexOf(p.weekday)+1,hm:p.hour+":"+p.minute}}
function hhActive(h){if(!h||!Array.isArray(h.days))return false;const n=lisbonNow();return h.days.includes(n.day)&&n.hm>=h.from&&n.hm<h.to}
function dayText(d){if(!Array.isArray(d)||!d.length)return"";const s=[...d].sort((a,b)=>a-b);const runs=[];let a=s[0],b=s[0];for(const x of s.slice(1)){if(x===b+1)b=x;else{runs.push([a,b]);a=b=x}}runs.push([a,b]);return runs.map(([a,b])=>a===b?DAYS[a-1]:DAYS[a-1]+(b-a>1?"–":", ")+DAYS[b-1]).join(", ")}
function ago(t){if(!t)return"";const d=Math.floor((Date.now()-t)/864e5);return d<=0?"today":d===1?"yesterday":d<30?d+" days ago":d<365?Math.floor(d/30)+" mo ago":Math.floor(d/365)+" yr ago"}
const arr=x=>Array.isArray(x)?x:[];

/* Merge everything into venues + reports, applying moderation and sanity checks */
function rebuild(){
  const hu=new Set(arr(mod.hiddenUsers)),hr=new Set(arr(mod.hiddenReports)),hv=new Set(arr(mod.hiddenVenues));
  const byKey=new Map(),alias=new Map();venues=[];
  const addV=(v,by)=>{if(typeof v.name!=="string"||!v.name.trim()||!AREAS.includes(v.area)||hv.has(v.id))return;
    const k=norm(v.name)+"|"+v.area;
    if(byKey.has(k)){alias.set(v.id,byKey.get(k));return}
    byKey.set(k,v.id);venues.push({id:v.id,name:v.name.trim().slice(0,80),area:v.area,kind:KINDS.includes(v.kind)?v.kind:"Bar",beer:v.beer,est:v.est,by,at:v.at||0})};
  seedVenues.forEach(v=>addV(v,null));
  const users=[...userDocs.entries()].filter(([u])=>!hu.has(u));
  users.flatMap(([u,d])=>arr(d.venues).map(v=>[u,v])).sort((a,b)=>(a[1].at||0)-(b[1].at||0)).forEach(([u,v])=>addV(v,u));
  const ids=new Set(venues.map(v=>v.id));
  reports=[];
  for(const[u,d]of users)for(const r of arr(d.items)){
    if(!okP(r)||typeof r.id!=="string"||hr.has(r.id))continue;
    const p=per(r);if(p<MIN_PER||p>MAX_PER)continue;
    const venue=alias.get(r.venue)||r.venue;if(!ids.has(venue))continue;
    if(typeof r.at!=="number"||r.at>Date.now()+864e5)continue;
    reports.push({...r,venue,by:u});
  }
}

function median(xs){const s=[...xs].sort((a,b)=>per(a)-per(b));return s[Math.floor((s.length-1)/2)]}
function model(){
  return venues.map(v=>{
    const rs=reports.filter(r=>r.venue===v.id).sort((a,b)=>b.at-a.at);
    // regular price: each person's latest non-happy-hour report counts once
    const seen=new Set(),latestPer=[];for(const r of rs)if(!r.hh&&!seen.has(r.by)){seen.add(r.by);latestPer.push(r)}
    const fresh=latestPer.filter(r=>Date.now()-r.at<FRESH).slice(0,3);
    let reg=null;
    if(fresh.length){const m=median(fresh);reg={eur:m.eur,cl:m.cl,beer:m.beer,at:fresh[0].at,n:fresh.length}}
    else if(latestPer.length){const r=latestPer[0];reg={eur:r.eur,cl:r.cl,beer:r.beer,at:r.at,n:1,old:true}}
    else if(okP(v.est)){reg={eur:v.est.eur,cl:v.est.cl,beer:v.beer,est:true}}
    // happy hour: latest happy-hour report wins
    const h=rs.find(r=>r.hh&&Array.isArray(r.days)&&r.days.length&&/^\d\d:\d\d$/.test(r.from||"")&&/^\d\d:\d\d$/.test(r.to||""));
    const hhp=h?{eur:h.eur,cl:h.cl,beer:h.beer,days:h.days,from:h.from,to:h.to,at:h.at}:null,live=hhp&&hhActive(hhp);
    const use=st.hh&&live?{...hhp,isHH:true}:reg||(hhp?{...hhp,isHH:true}:null);
    return{...v,rs,reg,hhp,live,use};
  }).filter(v=>v.use);
}
function view(){
  const q=norm(st.q);
  let m=model().filter(v=>(!st.area||v.area===st.area)&&(!q||norm([v.name,v.area,v.kind,v.use.beer,v.beer].join(" ")).includes(q)));
  if(st.hh)m=m.filter(v=>v.live);
  if(st.sort==="new")m.sort((a,b)=>((b.rs[0]||{}).at||0)-((a.rs[0]||{}).at||0));
  else m.sort((a,b)=>st.sort==="dear"?per(b.use)-per(a.use):per(a.use)-per(b.use));
  return m;
}
function render(){
  const all=model(),m=view();
  const pers=all.map(v=>per(v.reg||v.use)).sort((a,b)=>a-b);
  const med=pers.length?pers[Math.floor((pers.length-1)/2)]:null;
  $("stats").textContent=`${all.length} bars · ${reports.length} reports · median ${med?eur(med):"–"} per 0,5 L`;
  const now=all.map(v=>({v,p:v.live?v.hhp:v.reg})).filter(x=>x.p).sort((a,b)=>per(a.p)-per(b.p))[0];
  if(now){$("nowPrice").textContent=eur(now.p.eur);$("nowWhere").textContent=`${now.v.name}, ${now.v.area}`;
    $("nowSub").textContent=`${sizeName(now.p.cl)}${now.v.live?" · happy hour":""}${!now.v.live&&now.p.est?" · estimate":""}`;}
  const counts={};all.forEach(v=>counts[v.area]=(counts[v.area]||0)+1);
  $("area").innerHTML=[["","All Lisbon"],...AREAS.filter(a=>counts[a]).map(a=>[a,a+" ("+counts[a]+")"])].map(([k,l])=>`<option value="${esc(k)}"${st.area===k?" selected":""}>${esc(l)}</option>`).join("");
  ["cheap","dear","new"].forEach((k,i)=>$(["sCheap","sDear","sNew"][i]).setAttribute("aria-pressed",st.sort===k));
  $("hhNow").setAttribute("aria-pressed",st.hh);
  if(!m.length){$("board").innerHTML=`<li class="empty">${st.hh?"No happy hours running right now. Turn the toggle off to see regular prices.":venues.length?"Nothing matches. Try another area or search term.":"No prices yet."}</li>`}
  else $("board").innerHTML=m.map((v,i)=>{
    const u=v.use,open=st.open===v.id;
    const tags=(u.est?`<span class="tag">est.</span>`:"")+(u.old?`<span class="tag">old</span>`:"")+(v.hhp?`<span class="tag hh">${v.live?"happy hour now":"happy hour"}</span>`:"");
    const hist=v.rs.slice(0,8).map(r=>{const mine=r.by===uid;
      return`<li>${esc(eur(r.eur))} · ${esc(sizeName(r.cl))}${r.beer?" · "+esc(r.beer):""}${r.hh?" · happy hour "+esc(dayText(r.days))+" "+esc(r.from)+"–"+esc(r.to):""} <span class="note">${esc(ago(r.at))}${mine?" · you":""}</span>
      ${mine?` <button class="mini" data-del="${esc(r.id)}">Delete</button>`:""}${isOwner&&!mine?` <button class="mini" data-hide="${esc(r.id)}">Hide</button> <button class="mini" data-ban="${esc(r.by)}">Hide all by this person</button>`:""}</li>`}).join("");
    const regLine=v.reg?(v.reg.est?`Estimate ${esc(eur(v.reg.eur))} for ${esc(sizeName(v.reg.cl))}. Nobody has reported a price yet.`:`${esc(eur(v.reg.eur))} for ${esc(sizeName(v.reg.cl))}, ${v.reg.old?"last reported "+esc(ago(v.reg.at))+" (over six months ago)":`median of ${v.reg.n} recent report${v.reg.n>1?"s":""}`}.`):"";
    return`<li class="item"><button data-open="${esc(v.id)}" aria-expanded="${open}">
      <span class="rank">${i+1}</span>
      <span><span class="name">${esc(v.name)}</span>${tags}<br><span class="meta">${esc(v.area)} · ${esc(v.kind||"Bar")}${u.beer?" · "+esc(u.beer):""}</span></span>
      <span class="pr"><span class="price">${esc(eur(u.eur))}</span><br><span class="per">${esc(u.cl+" cl")} · ${esc(eur(per(u)))}/0,5 L</span></span>
    </button>${open?`<div class="detail">
      ${regLine?`<div>${regLine}</div>`:""}
      ${v.hhp?`<div>Happy hour ${esc(dayText(v.hhp.days))} ${esc(v.hhp.from)}–${esc(v.hhp.to)}: ${esc(eur(v.hhp.eur))} for ${esc(sizeName(v.hhp.cl))}.</div>`:""}
      ${hist?`<ul>${hist}</ul>`:""}
      <div class="acts">${v.reg&&!v.reg.est&&canWrite!==false?`<button data-confirm="${esc(v.id)}">Still ${esc(eur(v.reg.eur))}</button> · `:""}<button data-report="${esc(v.id)}">${v.reg&&!v.reg.est?"Different price":"Report the price"}</button>${isOwner?` · <button class="mini" data-hidev="${esc(v.id)}">Hide bar</button>`:""}</div>
    </div>`:""}</li>`}).join("");
  $("foot").textContent=m.length?`Lisbon time ${lisbonNow().hm}.`:"";
}
function say(t,ms){const b=$("banner");b.hidden=false;b.textContent=t;clearTimeout(say.t);if(ms)say.t=setTimeout(()=>b.hidden=true,ms)}

function writeErr(x){
  console.error(x);
  if(x&&x.code==="permission-denied")return"That save was refused. Reload the page and try again.";
  if(x&&x.code==="resource-exhausted")return"Too many saves at once. Wait a moment and try again.";
  if(x&&x.code==="unauthenticated")return"Still connecting. Try again in a second.";
  return"Couldn't save just now. Try again in a moment.";
}
function recentMine(vid){const d=userDocs.get(uid);return arr(d&&d.items).find(r=>r.venue===vid&&Date.now()-r.at<COOLDOWN)}

// events
$("q").addEventListener("input",e=>{st.q=e.target.value;render()});
$("sCheap").onclick=()=>{st.sort="cheap";saveUi();render()};$("sDear").onclick=()=>{st.sort="dear";saveUi();render()};$("sNew").onclick=()=>{st.sort="new";saveUi();render()};
$("hhNow").onclick=()=>{st.hh=!st.hh;saveUi();render()};
$("area").addEventListener("change",e=>{st.area=e.target.value;saveUi();render()});
$("board").addEventListener("click",async e=>{
  const t=e.target.closest("button");if(!t)return;const ds=t.dataset;
  if(ds.report){openForm(ds.report);return}
  if(ds.confirm){
    if(!ready())return;const v=model().find(x=>x.id===ds.confirm);if(!v||!v.reg)return;
    if(recentMine(v.id)){say("You reported this bar a few minutes ago. Thanks!",4000);return}
    t.disabled=true;
    try{await writeMine(n=>n.items.push({id:rid(),venue:v.id,eur:v.reg.eur,cl:v.reg.cl,beer:v.reg.beer||null,hh:false,at:Date.now()}));say("Thanks, price confirmed.",3000)}catch(x){say(writeErr(x))}
    return}
  if(ds.del){t.disabled=true;try{await writeMine(n=>{n.items=n.items.filter(r=>r.id!==ds.del)})}catch(x){say(writeErr(x))}return}
  if(ds.hide){try{await writeMod(n=>{if(!n.hiddenReports.includes(ds.hide))n.hiddenReports.push(ds.hide)})}catch(x){say(writeErr(x))}return}
  if(ds.ban){try{await writeMod(n=>{if(!n.hiddenUsers.includes(ds.ban))n.hiddenUsers.push(ds.ban)})}catch(x){say(writeErr(x))}return}
  if(ds.hidev){try{await writeMod(n=>{if(!n.hiddenVenues.includes(ds.hidev))n.hiddenVenues.push(ds.hidev)});st.open=null}catch(x){say(writeErr(x))}return}
  if(ds.open){st.open=st.open===ds.open?null:ds.open;render()}
});
setInterval(render,60000);

// form
$("fArea").innerHTML=AREAS.map(a=>`<option>${esc(a)}</option>`).join("");
$("fKind").innerHTML=KINDS.map(a=>`<option>${esc(a)}</option>`).join("");
$("fSize").innerHTML=SIZES.map(([c,l])=>`<option value="${c}">${esc(l)}</option>`).join("");
let days=[1,2,3,4,5];
const drawDays=()=>$("fDays").innerHTML=DAYS.map((d,i)=>`<button type="button" data-d="${i+1}" aria-pressed="${days.includes(i+1)}">${d}</button>`).join("");
$("fDays").addEventListener("click",e=>{const b=e.target.closest("[data-d]");if(!b)return;const d=+b.dataset.d;days=days.includes(d)?days.filter(x=>x!==d):[...days,d];drawDays()});
$("fHH").onchange=()=>{$("hhBox").hidden=!$("fHH").checked};
$("fVenue").onchange=()=>{const n=$("fVenue").value==="__new";$("newV").hidden=!n;$("newV").style.display=n?"grid":"none"};
function ready(){
  if(!uid){say("Still connecting. Try again in a second.",3000);return false}
  return true;
}
function openForm(vid){
  if(!ready())return;
  const vs=[...venues].sort((a,b)=>a.name.localeCompare(b.name,"pt"));
  $("fVenue").innerHTML=`<option value="__new">+ A bar that isn't listed</option>`+vs.map(v=>`<option value="${esc(v.id)}">${esc(v.name)} · ${esc(v.area)}</option>`).join("");
  $("fVenue").value=vid||(vs[0]?vs[0].id:"__new");$("fVenue").onchange();
  const v=model().find(x=>x.id===vid);if(v&&v.reg){$("fSize").value=String(v.reg.cl);if(v.reg.beer)$("fBeer").value=v.reg.beer}
  $("fEur").value="";$("fName").value="";$("fHH").checked=false;$("hhBox").hidden=true;$("fErr").textContent="";days=[1,2,3,4,5];drawDays();
  $("dlg").showModal();setTimeout(()=>$("fEur").focus(),30);
}
$("addBtn").onclick=()=>openForm(st.open);
$("fCancel").onclick=()=>$("dlg").close();
$("f").addEventListener("submit",async e=>{
  e.preventDefault();const err=$("fErr");err.textContent="";
  const price=Math.round(parseFloat(String($("fEur").value).replace(",","."))*100)/100;const cl=+$("fSize").value;
  if(!(price>0)){err.textContent="Enter the price you paid.";return}
  const p=price/cl*50;
  if(p<MIN_PER||p>MAX_PER){err.textContent=`That works out to ${eur(p)} per half litre, which looks off. Check the price and the serve size.`;return}
  let vid=$("fVenue").value;const isNew=vid==="__new";const name=$("fName").value.trim().replace(/\s+/g," ");
  if(isNew&&name.length<2){err.textContent="Give the bar a name.";return}
  if(isNew){const dup=venues.find(v=>norm(v.name)===norm(name)&&v.area===$("fArea").value);if(dup){vid=dup.id}}
  const hh=$("fHH").checked;
  if(hh&&(!days.length||!($("fFrom").value<$("fTo").value))){err.textContent="Pick the happy-hour days, and a start time before the end time.";return}
  if(!isNew&&!hh&&recentMine(vid)){err.textContent="You reported this bar a few minutes ago. Delete that report first if it was wrong.";return}
  $("fSave").disabled=true;
  try{
    const now=Date.now(),beer=$("fBeer").value;let newId=null;
    if(isNew&&vid==="__new"){newId="u-"+rid();vid=newId}
    await writeMine(n=>{
      if(newId)n.venues.push({id:newId,name:name.slice(0,80),area:$("fArea").value,kind:$("fKind").value,beer,at:now});
      const r={id:rid(),venue:vid,eur:price,cl,beer,hh,at:now};
      if(hh)Object.assign(r,{days:[...days].sort((a,b)=>a-b),from:$("fFrom").value,to:$("fTo").value});
      n.items.push(r);
    });
    $("dlg").close();st.open=vid;say("Thanks, your price is on the board.",3000);render();
  }catch(x){err.textContent=writeErr(x)}finally{$("fSave").disabled=false}
});

// data
render();
const timer=setTimeout(()=>{if(!connected)say("Live prices can't be reached yet. Check your connection.")},10000);
const upd=()=>{connected=true;clearTimeout(timer);if($("banner").textContent.startsWith("Live prices"))$("banner").hidden=true;rebuild();render()};
start({
  onVenues:v=>{seedVenues=v;upd()},
  onReports:m=>{userDocs=m;upd()},
  onMod:d=>{mod={hiddenReports:arr(d.hiddenReports),hiddenUsers:arr(d.hiddenUsers),hiddenVenues:arr(d.hiddenVenues)};upd()},
  onSession:s=>{uid=s.uid;isOwner=s.isAdmin;canWrite=true;
    $("modBtn").textContent=s.isAnonymous?"Moderator sign-in":s.isAdmin?"Sign out (moderator)":"Sign out (not a moderator)";render()},
  onError:e=>{console.error(e);say("The price board lost its connection. Reload the page to try again.")},
});
$("modBtn").onclick=async()=>{try{if(isOwner||!$("modBtn").textContent.startsWith("Moderator"))await moderatorSignOut();else await moderatorSignIn()}catch(e){console.error(e);say("Sign-in didn't work. Check that Google sign-in is enabled in Firebase.",5000)}};

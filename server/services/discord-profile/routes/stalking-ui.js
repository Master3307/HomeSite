const STALKING_UI_CSS_URL =
  "https://github.com/Master3307/HomeSite/raw/refs/heads/master/src/styles/main.css";
const DEFAULT_USER_ID = "1233908962550616085";
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
export function registerStalkingUiRoute(app) {
  app.get("/stalker-ui", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = req.query.user === undefined ? DEFAULT_USER_ID : req.query.user;
    if (typeof id !== "string" || !/^\d{17,20}$/.test(id)) {
      return res.status(400).json({ error: "Invalid Discord user ID." });
    }
    res.type("html").send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Discord presence history</title>
<style>
:root{--bg-primary:#150a24;--bg-secondary:#63369e;--text-primary:#eee;--text-secondary:#c0bfe6;--accent:#3d29d4;--border:#47405b;--link:#00d5ff}
:root[data-theme="light"]{--bg-primary:#b28ee1;--bg-secondary:#8452c5;--border:#e6e0f6}
*{box-sizing:border-box}body{margin:0;min-height:100vh;color:var(--text-primary);background:linear-gradient(var(--bg-secondary),var(--bg-primary)) fixed;font-family:system-ui,sans-serif}
.card{width:95%;max-width:1100px;margin:18px auto;padding:26px;background:#ffffff04;border-radius:13px;backdrop-filter:blur(13px);box-shadow:0 10px 30px #00000024,inset 0 1px #ffffff0c}
button{padding:10px 16px;border:0;border-radius:13px;background:var(--accent);color:var(--text-primary);font:inherit;cursor:pointer}a{color:var(--link)}
</style>
<link rel="stylesheet" href="${esc(STALKING_UI_CSS_URL)}">
<style>
.stalking-ui{padding:24px 0 40px;line-height:1.5}.stalking-ui .card{width:calc(100% - 32px);max-width:1100px;margin:18px auto;text-align:left}
.stalking-ui h1,.stalking-ui h2,.stalking-ui p{margin:0}.stalking-ui h1{font-size:clamp(1.6rem,4vw,2.4rem)}.stalking-ui h2{font-size:1.15rem}
.stalking-ui .muted{color:var(--text-secondary);font-size:.85rem;overflow-wrap:anywhere}.stalking-ui .toolbar,.stalking-ui .controls,.stalking-ui .pills{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.stalking-ui .toolbar{justify-content:space-between}
.stalking-ui label{display:flex;align-items:center;gap:8px;font-size:.85rem}.stalking-ui input[type="text"],.stalking-ui select{padding:10px;border:1px solid var(--border);border-radius:13px;background:var(--bg-primary);color:var(--text-primary);font:inherit;min-width:0}.stalking-ui input[type="text"]{max-width:230px;width:100%}
.stalking-ui button:disabled{opacity:.55;cursor:wait}.stalking-ui .notice{margin-top:14px}.stalking-ui .message{margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:13px;background:#ffffff08}.stalking-ui .error{color:#ffb7bd;overflow-wrap:anywhere}
.stalking-ui .profile-card{padding:0;overflow:hidden}.stalking-ui .banner{width:100%;height:clamp(130px,24vw,230px);object-fit:cover;display:block}.stalking-ui .profile-body{padding:26px}.stalking-ui .profile-main{display:flex;align-items:center;gap:24px}.stalking-ui .avatar-wrap{position:relative;width:120px;height:120px;flex:0 0 auto}.stalking-ui .avatar,.stalking-ui .avatar-fallback{width:120px;height:120px;border-radius:50%;object-fit:cover;background:var(--bg-primary)}.stalking-ui .avatar-fallback{display:grid;place-items:center;font-size:2.5rem}.stalking-ui .avatar{position:absolute;inset:0}.stalking-ui .decoration{position:absolute;width:146px;height:146px;top:-13px;left:-13px;pointer-events:none}.stalking-ui .profile-info{min-width:0}.stalking-ui .profile-info h2{font-size:1.8rem;overflow-wrap:anywhere}.stalking-ui .profile-info p,.stalking-ui .pills{margin-top:10px}
.stalking-ui .status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;width:calc(100% - 32px);max-width:1100px;margin:18px auto}.stalking-ui .status-grid .card{width:100%;margin:0;padding:22px 18px}
.stalking-ui .pill{display:inline-flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--border);border-radius:999px;background:#ffffff08;font-size:.82rem;white-space:nowrap}.stalking-ui .dot{width:9px;height:9px;border-radius:50%;background:#9297a1}.stalking-ui .dot[data-status="online"]{background:#43d997}.stalking-ui .dot[data-status="idle"]{background:#f4c35a}.stalking-ui .dot[data-status="dnd"]{background:#ff626e}.stalking-ui .dot[data-status="unknown"]{background:#b292e6}
.stalking-ui dl{display:grid;grid-template-columns:minmax(100px,.8fr) minmax(0,1.2fr);gap:12px;margin:16px 0 0;font-size:.85rem}.stalking-ui dt{color:var(--text-secondary)}.stalking-ui dd{margin:0;overflow-wrap:anywhere}.stalking-ui time{display:block;font-variant-numeric:tabular-nums}.stalking-ui .relative{display:block;font-size:.75rem;color:var(--text-secondary)}
.stalking-ui .history-wrap{overflow:auto;margin-top:18px}.stalking-ui table{width:100%;min-width:650px;border-collapse:collapse;font-size:.85rem}.stalking-ui th,.stalking-ui td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--border);vertical-align:top}.stalking-ui th{color:var(--text-secondary);font-weight:500}.stalking-ui [hidden]{display:none!important}
@media(max-width:760px){.stalking-ui .status-grid{grid-template-columns:1fr}.stalking-ui .card{padding:22px 18px}.stalking-ui .profile-card{padding:0}}@media(max-width:500px){.stalking-ui .profile-main{flex-direction:column;align-items:flex-start}}
</style></head><body><main class="stalking-ui">
<header class="card"><div class="toolbar"><h1>Discord presence</h1><div class="controls">
<button id="refresh">Refresh</button><label><input id="auto" type="checkbox" checked> Auto refresh</label>
<label>Theme <select id="theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label></div></div>
<form id="lookup" class="controls notice"><label for="user-id">Discord ID</label><input id="user-id" name="user" type="text" inputmode="numeric" pattern="[0-9]{17,20}" maxlength="20" required value="${id}"><button>Open</button><button id="directory-button" type="button">Tracked users · owner only</button></form>
<div id="directory" class="notice" hidden><label>Tracked user <select id="directory-select"><option value="">Select a user</option></select></label></div>
<p id="directory-message" class="muted notice" role="status"></p>
<p id="monitoring" class="message" role="status">Loading tracker…</p><p id="error" class="error notice" role="alert" hidden></p>
<div class="toolbar notice"><p id="updated" class="muted"></p><div class="controls"><a id="state-link">State JSON</a><a id="history-link">History JSON</a></div></div></header>
<section class="card profile-card"><div id="profile"><div class="profile-body">Loading profile…</div></div></section>
<section class="card" id="overall"></section><section class="status-grid"><article class="card" id="desktop"></article><article class="card" id="mobile"></article><article class="card" id="web"></article></section>
<section class="card"><div class="toolbar"><div><h2>Status history</h2><p id="history-summary" class="muted"></p></div><div class="controls">
<label>Scope <select id="scope"><option value="all">All scopes</option><option value="overall">Overall</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="web">Web</option><option value="monitoring">Monitoring</option></select></label>
<label>Status <select id="status"><option value="all">All statuses</option><option value="online">Online</option><option value="idle">AFK / Idle</option><option value="dnd">Do not disturb</option><option value="offline">Offline</option><option value="unknown">Unknown</option></select></label></div></div>
<div class="history-wrap"><table><thead><tr><th>Observed at</th><th>Scope</th><th>Event / transition</th><th>Source</th><th>Guild</th></tr></thead><tbody id="history-body"></tbody></table></div>
<div class="toolbar notice"><p id="history-count" class="muted"></p><button id="more" hidden>Load more</button></div>
<p class="muted notice">Times use your browser's timezone. Timestamps are tracker observations, not user interaction. Unknown means no usable observation. Source changes and connection gaps are not proof of a user status change. Offline does not distinguish invisible status.</p></section>
</main><script>
(() => {
  "use strict";
  const USER_ID = "${id}", PROFILE_MS = 300000;
  const base = new URL(location.href); base.pathname = base.pathname.replace(/\\/$/, ""); base.search = ""; base.hash = "";
  const ids = ["refresh","auto","theme","lookup","user-id","directory-button","directory","directory-select","directory-message","monitoring","error","updated","state-link","history-link","profile","overall","desktop","mobile","web","history-summary","scope","status","history-body","history-count","more"];
  const e = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const labels = {online:"Online",idle:"AFK / Idle",dnd:"Do not disturb",offline:"Offline",unknown:"Unknown"};
  const eventLabels = {tracker_started:"Tracker started",tracker_stopped:"Tracker stopped",monitoring_connected:"Monitoring connected",monitoring_gap:"Monitoring gap",observation_source_changed:"Observation source changed",membership_removed:"Membership removed"};
  const dates = new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"medium"});
  const relative = new Intl.RelativeTimeFormat(undefined,{numeric:"auto"});
  let state=null, profile=null, profileError="", profileAttempt=0, profileRetry=0, events=[], visible=100, loading=false;
  function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}
  function url(route, withUser=true){const u=new URL("./"+route,base);if(withUser)u.searchParams.set("user",USER_ID);return u;}
  function date(v){if(!v)return "Not available";const d=new Date(v);return Number.isFinite(d.getTime())?dates.format(d):"Not available";}
  function time(v){const ms=Date.parse(v);if(!v||!Number.isFinite(ms))return '<span class="muted">Not observed</span>';const sec=(ms-Date.now())/1000;let text="";for(const [unit,size] of [["day",86400],["hour",3600],["minute",60],["second",1]]){if(Math.abs(sec)>=size||unit==="second"){text=relative.format(Math.round(sec/size),unit);break;}}return '<time title="'+esc(v)+'">'+esc(date(v))+'</time><span class="relative">'+esc(text)+'</span>';}
  function badge(v){const s=Object.hasOwn(labels,v)?v:"unknown";return '<span class="pill"><span class="dot" data-status="'+s+'"></span>'+labels[s]+'</span>';}
  function image(v,cls,alt){if(typeof v!=="string"||!v)return "";try{const u=new URL(v,base);if(!["https:","http:"].includes(u.protocol))return "";return '<img class="'+cls+'" src="'+esc(u.href)+'" alt="'+esc(alt)+'" referrerpolicy="no-referrer">';}catch{return "";}}
  function renderProfile(){const user=profile?.user??state?.user??{};const name=user.global_name||user.username||"Tracked user";const avatar=user.avatar;const username=user.username?"@"+user.username:"Profile unavailable";e.profile.innerHTML=image(user.banner,"banner","Profile banner")+'<div class="profile-body"><div class="profile-main"><div class="avatar-wrap"><div class="avatar-fallback">'+esc(Array.from(name)[0]??"?")+'</div>'+image(avatar,"avatar",name+" avatar")+image(user.avatar_decoration,"decoration","")+'</div><div class="profile-info"><div class="controls"><h2>'+esc(name)+'</h2>'+badge(state?.overall?.status)+'</div><p class="muted">'+esc(username)+'</p><p class="muted">User '+USER_ID+'</p><div class="pills">'+(user.bot?'<span class="pill">Bot</span>':"")+(profile?.guild?.name?'<span class="pill">'+esc(profile.guild.name)+'</span>':"")+(user.created_at?'<span class="pill">Created '+esc(date(user.created_at))+'</span>':"")+'</div><p class="muted">Tracking guild: '+esc(state?.guild_id??"Unavailable")+'</p><p class="error">'+esc(profileError)+'</p><div class="controls notice"><a href="'+esc(url(USER_ID+"-ui",false).href)+'">Full user profile</a><a href="'+esc(url(USER_ID,false).href)+'">User JSON</a></div></div></div></div>';e.profile.querySelectorAll("img").forEach(img=>img.addEventListener("error",()=>img.hidden=true,{once:true}));}
  function record(element,title,data){const fields=[["Status observed since","status_since"],["Last observed","last_observed_at"],["Last seen","last_seen_at"],["Last online","last_online_at"],["Last AFK / Idle","last_afk_at"],["Last DND","last_dnd_at"],["Offline transition","offline_since"],["Offline observed since","offline_observed_since"]];element.innerHTML='<div class="toolbar"><h2>'+title+'</h2>'+badge(data?.status)+'</div><dl>'+fields.map(([label,key])=>'<dt>'+label+'</dt><dd>'+time(data?.[key])+'</dd>').join("")+'</dl>';}
  function renderState(){const t=state.tracking??{};e.monitoring.textContent=[t.connected?"Gateway observation available":"Monitoring unavailable",t.membership_verified?"Shared membership verified":"Membership not verified",t.presence_available?"Presence available":"Presence unknown",t.last_error?.message??""].filter(Boolean).join(" · ");e.updated.innerHTML='Snapshot updated: '+time(state.updated_at)+'<span class="relative">Last Gateway event: '+esc(date(t.last_gateway_event_at))+'</span>';record(e.overall,"Overall",state.overall);for(const p of ["desktop","mobile","web"])record(e[p],p==="web"?"Web browser":p[0].toUpperCase()+p.slice(1),state.clients?.[p]);renderProfile();}
  function renderHistory(){const filtered=events.filter(v=>(e.scope.value==="all"||(e.scope.value==="monitoring"?v.type!=="status_change":v.scope===e.scope.value))&&(e.status.value==="all"||(v.type==="status_change"&&v.to===e.status.value)));const rows=filtered.slice(0,visible);e["history-body"].innerHTML=rows.length?rows.map(v=>'<tr><td>'+time(v.at)+'</td><td>'+esc(v.scope??"monitoring")+'</td><td>'+(v.type==="status_change"?badge(v.from)+' → '+badge(v.to):esc(eventLabels[v.type]??v.type))+'</td><td>'+esc(v.source)+'</td><td>'+esc(v.guild_id??"—")+'</td></tr>').join(""):'<tr><td colspan="5" class="muted">No matching history entries.</td></tr>';e["history-count"].textContent="Showing "+rows.length+" of "+filtered.length+" matching entries · newest first";e.more.hidden=rows.length>=filtered.length;}
  async function fetchJson(u){const c=new AbortController();const timer=setTimeout(()=>c.abort(),65000);try{const r=await fetch(u,{credentials:"same-origin",cache:"no-store",signal:c.signal});let data;try{data=await r.json();}catch{throw new Error("API returned non-JSON (HTTP "+r.status+")");}if(!r.ok){const error=new Error(data.error??("HTTP "+r.status));error.retry=Number(r.headers.get("Retry-After"))||0;throw error;}return data;}finally{clearTimeout(timer);}}
  async function refresh(forceProfile=false){if(loading)return;loading=true;e.refresh.disabled=true;e.refresh.textContent="Refreshing…";const errors=[];try{const results=await Promise.allSettled([fetchJson(url("stalking")),fetchJson(url("stalking-history"))]);if(results[0].status==="fulfilled"){state=results[0].value;renderState();}else errors.push("State: "+results[0].reason.message);if(results[1].status==="fulfilled"){const h=results[1].value;events=[...(h.events??[])].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));e["history-summary"].textContent="Rolling "+h.retention_days+"-day history · "+events.length+" entries";renderHistory();}else errors.push("History: "+results[1].reason.message);if(state&&Date.now()>=profileRetry&&(forceProfile||Date.now()-profileAttempt>=PROFILE_MS)){profileAttempt=Date.now();try{profile=await fetchJson(url(USER_ID,false));profileError="";}catch(error){profileError="Profile lookup: "+error.message;if(error.retry)profileRetry=Date.now()+error.retry*1000;}renderProfile();}e.error.hidden=!errors.length;e.error.textContent=errors.join(" · ")+(errors.length?" — previous data may be stale.":"");}catch(error){e.error.hidden=false;e.error.textContent=error.message;}finally{loading=false;e.refresh.disabled=false;e.refresh.textContent="Refresh";}}
  function applyTheme(v){if(v==="system")delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=v;try{localStorage.setItem("stalking-ui-theme",v);}catch{}}
  let theme="dark";try{const v=localStorage.getItem("stalking-ui-theme");if(["dark","light","system"].includes(v))theme=v;}catch{}e.theme.value=theme;applyTheme(theme);e.theme.addEventListener("change",()=>applyTheme(e.theme.value));
  e["state-link"].href=url("stalking").href;e["history-link"].href=url("stalking-history").href;
  e.lookup.addEventListener("submit",event=>{event.preventDefault();const id=e["user-id"].value.trim();if(!/^\\d{17,20}$/.test(id))return;const u=url("stalking-ui",false);u.searchParams.set("user",id);location.assign(u);});
  e["directory-button"].addEventListener("click",async()=>{e["directory-button"].disabled=true;e["directory-message"].textContent="Checking account access…";try{const data=await fetchJson(url("stalking-users",false));e["directory-select"].innerHTML='<option value="">Select a user</option>'+(data.users??[]).map(v=>'<option value="'+esc(v.user_id)+'">'+esc(v.user?.global_name||v.user?.username||v.user_id)+' · '+esc(v.status)+' · '+esc(v.user_id)+'</option>').join("");e.directory.hidden=false;e["directory-message"].textContent=data.count+" tracked users";}catch(error){e.directory.hidden=true;e["directory-message"].textContent=error.message+" Log in through your site using the owner account.";}finally{e["directory-button"].disabled=false;}});
  e["directory-select"].addEventListener("change",()=>{const id=e["directory-select"].value;if(!id)return;const u=url("stalking-ui",false);u.searchParams.set("user",id);location.assign(u);});
  e.refresh.addEventListener("click",()=>void refresh(true));e.auto.addEventListener("change",()=>{if(e.auto.checked)void refresh();});for(const f of ["scope","status"])e[f].addEventListener("change",()=>{visible=100;renderHistory();});e.more.addEventListener("click",()=>{visible+=100;renderHistory();});
  setInterval(()=>{if(e.auto.checked&&!document.hidden)void refresh();},10000);document.addEventListener("visibilitychange",()=>{if(!document.hidden&&e.auto.checked)void refresh();});void refresh();
})();
</script></body></html>`);
  });
}

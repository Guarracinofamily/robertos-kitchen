
const SUPABASE_URL = 'https://zrpglswalgjbtghudmhu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpycGdsc3dhbGdqYnRnaHVkbWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTIyMjQsImV4cCI6MjA5NjQ4ODIyNH0.pfABN-so4xINK7nHxXUlVeTO4g0h0l6ILHVwpoKrbds';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const DEV_READ_ONLY = false;

const PASS_KEY = 'pass';
const REPORT_KEY = 'reports';
const CHECK_KEY = 'checks';
const HOME_KEY = 'home';
const DASHBOARD_KEY = 'dashboard';
const REPORTS_KEY = 'reports_module';
const ORDER_KEY = 'order_inventory';
const RECIPES_KEY = 'recipes';
const TODAY = new Date().toISOString().split('T')[0];
const CHECK_STORAGE_KEY = 'robertos-chef-checks-' + TODAY;
const ORDER_STORAGE_PREFIX = 'robertos-order-list-';

let STATIONS = [];
let state = {};
let chefChecks = [];
let orderQuantities = {};
let activeOrderDate = TODAY;
let activeRecipeId = null;
let activeCheckStation = null;
let activeStation = PASS_KEY;
let activeFilter = null;
let undoStack = null;
let undoTimer = null;
let realtimeChannel = null;
let saving = false;

// â”€â”€ INIT â”€â”€
async function init() {
  setDate();
  await loadPrepList();
  await loadTodayStatus();
  loadChefChecks();
  loadOrderQuantities();
  if (!DEV_READ_ONLY) subscribeRealtime();
  populateSelects();
  openHome();
  document.getElementById('loading').classList.add('hidden');
  const legacyReportDate=document.getElementById('report-date');
  if(legacyReportDate)legacyReportDate.value = TODAY;
}

// â”€â”€ LOAD PREP LIST FROM SUPABASE â”€â”€
async function loadPrepList() {
  const { data: stationsData } = await sb.from('stations').select('*').eq('active', true).order('sort_order');
  const { data: subsectionsData } = await sb.from('subsections').select('*').eq('active', true).order('sort_order');
  const { data: dishesData } = await sb.from('dishes').select('*').eq('active', true).order('sort_order');
  const { data: componentsData } = await sb.from('dish_components').select('*').eq('active', true).order('sort_order');

  STATIONS = stationsData.map(st => ({
    key: st.key,
    label: st.label,
    subsections: subsectionsData
      .filter(ss => ss.station_key === st.key)
      .map(ss => ({
        key: ss.key,
        label: ss.label,
        dishes: dishesData
          .filter(d => d.station_key === st.key && d.subsection_key === ss.key)
          .map(d => ({
            id: d.id,
            name: d.name,
            extra: false,
            items: componentsData.filter(c => c.dish_id === d.id).map(c => c.name)
          }))
      }))
  }));
}

// â”€â”€ LOAD TODAY'S STATUS â”€â”€
async function loadTodayStatus() {
  const { data } = await sb.from('prep_status').select('*').eq('service_date', TODAY);
  if (data) {
    data.forEach(row => {
      const id = mkId(row.station_key, row.subsection_key, row.dish_name, row.component_name);
      state[id] = row.status;
    });
  }
}

// â”€â”€ REALTIME SYNC â”€â”€
function subscribeRealtime() {
  realtimeChannel = sb.channel('prep_status_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'prep_status', filter: `service_date=eq.${TODAY}` },
      payload => {
        const r = payload.new || payload.old;
        if (!r) return;
        const id = mkId(r.station_key, r.subsection_key, r.dish_name, r.component_name);
        const newStatus = payload.eventType === 'DELETE' ? 'none' : r.status;
        if (state[id] !== newStatus) {
          state[id] = newStatus;
          flashSync();
          if (activeStation === PASS_KEY) renderPassView();
          else { renderCounter(); updateRowUI(id, newStatus); applyFilter(); renderTabs(); }
        }
      })
    .subscribe(status => {
      document.getElementById('realtime-dot').classList.toggle('live', status === 'SUBSCRIBED');
    });
}

function flashSync() {
  const el = document.getElementById('sync-flash');
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 500);
}

// â”€â”€ CHEF CHECKLIST STORAGE â”€â”€
function loadChefChecks(){
  try{chefChecks=JSON.parse(localStorage.getItem(CHECK_STORAGE_KEY)||'[]');}
  catch(e){chefChecks=[];}
}
function saveChefChecks(){
  localStorage.setItem(CHECK_STORAGE_KEY,JSON.stringify(chefChecks));
}
function orderStorageKey(date){return ORDER_STORAGE_PREFIX + date;}
function loadOrderQuantities(){
  try{orderQuantities=JSON.parse(localStorage.getItem(orderStorageKey(activeOrderDate))||'{}');}
  catch(e){orderQuantities={};}
}
function saveOrderQuantities(){
  localStorage.setItem(orderStorageKey(activeOrderDate),JSON.stringify(orderQuantities));
}

// â”€â”€ SAVE STATUS TO SUPABASE â”€â”€
async function saveStatus(stKey, ssKey, dishName, component, newStatus, prevStatus) {
  if (DEV_READ_ONLY) return;
  const row = { service_date: TODAY, station_key: stKey, subsection_key: ssKey, dish_name: dishName, component_name: component, status: newStatus, updated_at: new Date().toISOString() };
  await sb.from('prep_status').upsert(row, { onConflict: 'service_date,station_key,subsection_key,dish_name,component_name' });
  await sb.from('prep_status_log').insert({ service_date: TODAY, station_key: stKey, subsection_key: ssKey, dish_name: dishName, component_name: component, status: newStatus, previous_status: prevStatus });
}

function mkId(stk, ssk, dn, item) { return `${stk}||${ssk}||${dn}||${item}`; }
function parseId(id) { const [stk,ssk,dn,...rest] = id.split('||'); return {stk,ssk,dn,item:rest.join('||')}; }

// â”€â”€ COUNTS â”€â”€
function allCounts() {
  const c={sos:0,bu:0,ok:0,none:0,total:0};
  STATIONS.forEach(st=>st.subsections.forEach(ss=>ss.dishes.forEach(d=>d.items.forEach(i=>{const s=state[mkId(st.key,ss.key,d.name,i)]||'none';c[s]++;c.total++;}))));
  return c;
}
function stationCounts(st) {
  const c={sos:0,bu:0,ok:0,none:0};
  st.subsections.forEach(ss=>ss.dishes.forEach(d=>d.items.forEach(i=>{c[state[mkId(st.key,ss.key,d.name,i)]||'none']++;})));
  return c;
}
function allCheckCounts(){
  const c={ok:0,review:0,discard:0,none:0,total:0};
  STATIONS.forEach(st=>{
    const sc=checkCounts(st.key);
    c.ok+=sc.ok;c.review+=sc.review;c.discard+=sc.discard;c.none+=sc.none;
  });
  c.total=c.ok+c.review+c.discard+c.none;
  return c;
}
function stationReadiness(st){
  const c=stationCounts(st), total=c.sos+c.bu+c.ok+c.none;
  return total?Math.round(c.ok/total*100):0;
}
function prepRows(){
  const rows=[];
  STATIONS.forEach(st=>st.subsections.forEach(ss=>ss.dishes.forEach(d=>d.items.forEach(item=>{
    const id=mkId(st.key,ss.key,d.name,item);
    rows.push({type:'Prep',date:TODAY,stationKey:st.key,station:st.label,subsection:ss.label,dish:d.name,item,status:state[id]||'none',note:''});
  }))));
  return rows;
}
function checklistRows(){
  return chefChecks.map(c=>({type:'Chef check',date:TODAY,stationKey:c.stationKey,station:stationLabel(c.stationKey),subsection:subsectionLabel(c.stationKey,c.subsectionKey),dish:c.dish,item:c.item,status:c.status,note:c.note||''}));
}
function currentReportRows(){
  return [...prepRows(),...checklistRows()];
}
function criticalRows(){
  return currentReportRows().filter(r=>['sos','bu','review','discard'].includes(r.status));
}

// â”€â”€ TABS â”€â”€
function renderTabs() {
  const tabs=[{key:PASS_KEY,label:'The Pass',pass:true},...STATIONS];
  document.getElementById('section-tabs').innerHTML=tabs.map(t=>{
    if(t.pass){const c=allCounts();const sb=c.sos>0?`<span class="stab-badge tb-sos">${c.sos}</span>`:'';return `<button class="stab pass-tab${activeStation===PASS_KEY?' active':''}" onclick="switchStation('${PASS_KEY}')">${t.label}${sb}</button>`;}
    
    const c=stationCounts(t);
    const sb2=c.sos>0?`<span class="stab-badge tb-sos">${c.sos}</span>`:'';
    const bb=c.bu>0?`<span class="stab-badge tb-bu">${c.bu}</span>`:'';
    return `<button class="stab${activeStation===t.key?' active':''}" onclick="switchStation('${t.key}')">${t.label}${sb2}${bb}</button>`;
  }).join('');
}

// â”€â”€ PASS VIEW â”€â”€
function renderPassView() {
  const c=allCounts();
  const pct=(v)=>c.total?Math.round(v/c.total*100):0;
  const stationRows=STATIONS.map(st=>{
    const sc=stationCounts(st);
    const combined=[];
    st.subsections.forEach(ss=>ss.dishes.forEach(d=>d.items.forEach(item=>{
      const s=state[mkId(st.key,ss.key,d.name,item)]||'none';
      if(s==='sos'||s==='bu')combined.push({item,dish:d.name,type:s});
    })));
    const badges=`${sc.sos>0?`<span class="pass-badge pb-sos">${sc.sos} SOS</span>`:''}${sc.bu>0?`<span class="pass-badge pb-bu">${sc.bu} BU</span>`:''}${sc.ok>0?`<span class="pass-badge pb-ok">${sc.ok} OK</span>`:''}${combined.length===0&&sc.none===0?`<span class="pb-all-ok">All clear</span>`:''}`;
    const rows=combined.length>0?combined.map(x=>`<div class="pass-sos-item"><div class="pass-sos-dot dot-${x.type}"></div><span class="pass-sos-text">${x.item}</span><span class="pass-sos-dish">${x.dish}</span></div>`).join(''):`<div class="pass-empty">${sc.none>0?`${sc.none} items pending check`:'All items accounted for'}</div>`;
    return `<div class="pass-station-card"><div class="pass-station-header"><span class="pass-station-name">${st.label}</span><div class="pass-station-badges">${badges}</div></div><div class="pass-station-body"><div class="pass-sos-list">${rows}</div></div></div>`;
  }).join('');
  document.getElementById('pass-view').innerHTML=`
    <div class="pass-hero">
      <div class="pass-hero-card c-sos"><span class="pass-hero-num">${c.sos}</span><span class="pass-hero-label">SOS</span></div>
      <div class="pass-hero-card c-bu"><span class="pass-hero-num">${c.bu}</span><span class="pass-hero-label">Backup</span></div>
      <div class="pass-hero-card c-ok"><span class="pass-hero-num">${c.ok}</span><span class="pass-hero-label">OK</span></div>
      <div class="pass-hero-card c-pending"><span class="pass-hero-num">${c.none}</span><span class="pass-hero-label">Pending</span></div>
    </div>
    <div class="pass-progress-section">
      <div class="pass-progress-label"><span>Overall kitchen readiness</span><span>${c.total>0?Math.round(c.ok/c.total*100):0}% ready</span></div>
      <div class="pass-progress-track"><div class="pass-progress-ok" style="width:${pct(c.ok)}%"></div><div class="pass-progress-bu" style="width:${pct(c.bu)}%"></div><div class="pass-progress-sos" style="width:${pct(c.sos)}%"></div></div>
    </div>
    <div style="height:18px"></div>
    <div class="pass-section-title">Station by station</div>
    <div class="pass-station-grid">${stationRows}</div>`;
}

// â”€â”€ CHEF CHECKLIST VIEW â”€â”€
function renderCheckView(){
  if(!activeCheckStation&&STATIONS.length)activeCheckStation=STATIONS[0].key;
  const st=STATIONS.find(s=>s.key===activeCheckStation)||STATIONS[0];
  if(!st){document.getElementById('check-view').innerHTML='';return;}
  const stOptions=STATIONS.map(x=>`<option value="${x.key}"${x.key===st.key?' selected':''}>${x.label}</option>`).join('');
  const total=checkCounts(st.key);
  const body=st.subsections.map(ss=>`
    <div class="subsec-title">${ss.label}<div class="subsec-line"></div></div>
    ${ss.dishes.map(dish=>`
      <div class="check-dish-block">
        <div class="check-dish-label">${dish.name}</div>
        ${dish.items.map(item=>renderCheckItem(st.key,ss.key,dish.name,item)).join('')}
      </div>`).join('')}
  `).join('');
  document.getElementById('check-view').innerHTML=`
    <div class="check-toolbar">
      <div class="check-field"><div class="check-label">Station to inspect</div><select class="check-select" id="check-station" onchange="switchCheckStation(this.value)">${stOptions}</select></div>
      <div class="check-card-meta">${total.ok} OK · ${total.review} To check · ${total.discard} Discard · ${total.none} not checked</div>
      <button class="check-reset" onclick="resetChefChecklist()">Reset checklist</button>
    </div>
    ${body}`;
}
function checkStatusLabel(status){return {ok:'OK',review:'To check',discard:'Discard'}[status]||'To check';}
function stationLabel(key){const st=STATIONS.find(s=>s.key===key);return st?st.label:key;}
function subsectionLabel(stKey,ssKey){const st=STATIONS.find(s=>s.key===stKey);const ss=st&&st.subsections.find(s=>s.key===ssKey);return ss?ss.label:ssKey;}
function checkId(stKey,ssKey,dish,item){return mkId(stKey,ssKey,dish,item);}
function getChefCheck(id){return chefChecks.find(c=>c.id===id);}
function checkCounts(stKey){
  const c={ok:0,review:0,discard:0,none:0};
  const st=STATIONS.find(s=>s.key===stKey);if(!st)return c;
  st.subsections.forEach(ss=>ss.dishes.forEach(d=>d.items.forEach(item=>{
    const chk=getChefCheck(checkId(st.key,ss.key,d.name,item));
    c[chk?chk.status:'none']++;
  })));
  return c;
}
function renderCheckItem(stKey,ssKey,dish,item){
  const id=checkId(stKey,ssKey,dish,item);
  const chk=getChefCheck(id);
  const status=chk?chk.status:'none';
  const esc=id.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const noteId='note-'+encodeURIComponent(id);
  return `<div class="check-prep-row">
    <div class="check-prep-main">
      <div class="check-prep-name">${item}</div>
      ${chk&&chk.note?`<div class="check-prep-note">${chk.note}</div>`:''}
    </div>
    <div class="check-command-btns">
      <button class="check-command ok${status==='ok'?' active':''}" onclick="setItemCheck('${esc}','ok')">OK</button>
      <button class="check-command review${status==='review'?' active':''}" onclick="setItemCheck('${esc}','review')">To check</button>
      <button class="check-command discard${status==='discard'?' active':''}" onclick="setItemCheck('${esc}','discard')">Discard</button>
      <button class="check-note-btn" onclick="showItemCheckNote('${noteId}')">Note</button>
    </div>
  </div>
  <div class="check-note-panel" id="${noteId}">
    <textarea class="check-note-input" id="${noteId}-input" placeholder="Chef note...">${chk&&chk.note?chk.note:''}</textarea>
    <button class="check-note-save" onclick="saveItemCheckNote('${esc}','${noteId}')">Save</button>
    <button class="check-note-cancel" onclick="hideItemCheckNote('${noteId}')">Cancel</button>
  </div>`;
}
function switchCheckStation(stKey){activeCheckStation=stKey;renderCheckView();}
function setItemCheck(id,status){
  const existing=getChefCheck(id);
  if(existing&&existing.status===status&&!existing.note)chefChecks=chefChecks.filter(c=>c.id!==id);
  else{
    const p=parseId(id);
    const now=new Date();
    const payload={id,stationKey:p.stk,subsectionKey:p.ssk,dish:p.dn,item:p.item,status,note:existing?existing.note:'',createdAt:now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})};
    if(existing)Object.assign(existing,payload);
    else chefChecks.unshift(payload);
  }
  saveChefChecks();renderTabs();renderCheckView();
}
function showItemCheckNote(noteId){
  const panel=document.getElementById(noteId);
  if(panel)panel.classList.add('visible');
}
function hideItemCheckNote(noteId){
  const panel=document.getElementById(noteId);
  if(panel)panel.classList.remove('visible');
}
function saveItemCheckNote(id,noteId){
  const p=parseId(id);
  const existing=getChefCheck(id);
  const input=document.getElementById(noteId+'-input');
  const note=input?input.value:'';
  const now=new Date();
  if(existing){existing.note=note.trim();existing.createdAt=now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
  else chefChecks.unshift({id,stationKey:p.stk,subsectionKey:p.ssk,dish:p.dn,item:p.item,status:'review',note:note.trim(),createdAt:now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})});
  saveChefChecks();renderTabs();renderCheckView();
}
function addChefCheck(){
  const now=new Date();
  chefChecks.unshift({id:'manual-'+Date.now(),stationKey:activeCheckStation||STATIONS[0].key,subsectionKey:'manual',dish:'Manual check',item:'Manual check',note:'',status:'review',createdAt:now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})});
  saveChefChecks();
  renderTabs();
  renderCheckView();
}
function removeChefCheck(id){
  chefChecks=chefChecks.filter(c=>c.id!==id);
  saveChefChecks();
  renderTabs();
  if(activeStation===CHECK_KEY)renderCheckView();
  else renderContent();
}
function resetChefChecklist(){
  if(!confirm('Reset all chef checklist checks for today?'))return;
  chefChecks=[];
  saveChefChecks();
  renderTabs();
  renderCheckView();
}
function renderStationChecks(stKey){
  const checks=chefChecks.filter(c=>c.stationKey===stKey);
  if(!checks.length)return '';
  return `<div class="station-checks">
    <div class="station-checks-head">Chef checklist for this station</div>
    <div class="station-checks-body">
      ${checks.map(c=>`<div class="station-check-item">
        <span class="check-badge ${c.status}">${checkStatusLabel(c.status)}</span>
        <div class="check-card-main">
          <div class="check-card-title">${c.item}</div>
          <div class="check-card-meta">${subsectionLabel(c.stationKey,c.subsectionKey)} · ${c.dish||'Mise en place'} · ${c.createdAt}</div>
          ${c.note?`<div class="check-card-note">${c.note}</div>`:''}
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

// â”€â”€ DASHBOARD â”€â”€
function statusLabel(s){return {none:'Pending',sos:'SOS',bu:'Backup',ok:'OK',review:'To check',discard:'Discard'}[s]||s;}
function renderDashboard(){
  const prep=allCounts();
  const checks=allCheckCounts();
  const ready=prep.total?Math.round(prep.ok/prep.total*100):0;
  const critical=criticalRows();
  const stationMeters=STATIONS.map(st=>{
    const c=stationCounts(st), total=c.sos+c.bu+c.ok+c.none||1;
    return `<div class="station-meter">
      <div class="station-meter-name">${st.label}</div>
      <div class="meter-track">
        <div class="meter-ok" style="width:${Math.round(c.ok/total*100)}%"></div>
        <div class="meter-bu" style="width:${Math.round(c.bu/total*100)}%"></div>
        <div class="meter-sos" style="width:${Math.round(c.sos/total*100)}%"></div>
      </div>
      <div class="meter-pct">${stationReadiness(st)}%</div>
    </div>`;
  }).join('');
  const criticalList=critical.length?critical.slice(0,18).map(r=>`
    <div class="critical-item">
      <span class="check-badge ${r.status==='sos'?'discard':r.status==='bu'?'review':r.status}">${statusLabel(r.status)}</span>
      <div>
        <div class="critical-text">${r.item}</div>
        <div class="critical-meta">${r.type} · ${r.station} · ${r.dish}</div>
        ${r.note?`<div class="check-card-note">${r.note}</div>`:''}
      </div>
    </div>`).join(''):`<div class="report-no-data">No critical items at the moment</div>`;
  document.getElementById('dashboard-view').innerHTML=`
    <div class="ops-title">Dashboard</div>
    <div class="ops-subtitle">${TODAY} · Live kitchen overview</div>
    <div class="ops-grid">
      <div class="ops-card dark"><div class="ops-num">${ready}%</div><div class="ops-label">Prep readiness</div></div>
      <div class="ops-card"><div class="ops-num">${prep.sos}</div><div class="ops-label">SOS prep items</div></div>
      <div class="ops-card"><div class="ops-num">${checks.review}</div><div class="ops-label">Chef to check</div></div>
      <div class="ops-card"><div class="ops-num">${checks.discard}</div><div class="ops-label">Chef discard</div></div>
    </div>
    <div class="ops-two">
      <div class="ops-panel">
        <div class="ops-panel-head">Station readiness</div>
        <div class="ops-panel-body">${stationMeters}</div>
      </div>
      <div class="ops-panel">
        <div class="ops-panel-head">Needs attention</div>
        <div class="ops-panel-body"><div class="critical-list">${criticalList}</div></div>
      </div>
    </div>`;
}

// â”€â”€ REPORTS â”€â”€
function renderReports(){
  const stationOptions=['<option value="">All stations</option>',...STATIONS.map(st=>`<option value="${st.key}">${st.label}</option>`)].join('');
  document.getElementById('reports-view').innerHTML=`
    <div class="ops-title">Reports</div>
    <div class="ops-subtitle">Filter by date, station, item, and status</div>
    <div class="report-filter-panel">
      <div class="report-filter-grid">
        <div class="check-field"><div class="check-label">Single date</div><input class="check-input" id="report-single-date" type="date" value="${TODAY}"></div>
        <div class="check-field"><div class="check-label">From</div><input class="check-input" id="report-from-date" type="date"></div>
        <div class="check-field"><div class="check-label">To</div><input class="check-input" id="report-to-date" type="date"></div>
        <div class="check-field"><div class="check-label">Station</div><select class="check-select" id="report-station">${stationOptions}</select></div>
        <div class="check-field"><div class="check-label">Status</div><select class="check-select" id="report-status"><option value="">All</option><option value="sos">SOS</option><option value="bu">Backup</option><option value="ok">OK</option><option value="none">Pending</option><option value="review">To check</option><option value="discard">Discard</option></select></div>
        <div class="check-field"><div class="check-label">Item / dish</div><input class="check-input" id="report-search" placeholder="Ricciola, dill, pasta..."></div>
      </div>
      <div style="height:10px"></div>
      <button class="report-btn" onclick="applyReports()">Apply filters</button>
    </div>
    <div id="reports-content"></div>`;
  applyReports();
}
function dateInReportRange(date,single,from,to){
  if(single)return date===single;
  if(from&&date<from)return false;
  if(to&&date>to)return false;
  return true;
}
function applyReports(){
  const single=document.getElementById('report-single-date')?.value||TODAY;
  const from=document.getElementById('report-from-date')?.value||'';
  const to=document.getElementById('report-to-date')?.value||'';
  const station=document.getElementById('report-station')?.value||'';
  const status=document.getElementById('report-status')?.value||'';
  const search=(document.getElementById('report-search')?.value||'').toLowerCase();
  const rows=currentReportRows().filter(r=>{
    const dateOk=dateInReportRange(r.date,from||to?'':single,from,to);
    const stationOk=!station||r.stationKey===station;
    const statusOk=!status||r.status===status;
    const text=(r.station+' '+r.subsection+' '+r.dish+' '+r.item+' '+r.note).toLowerCase();
    return dateOk&&stationOk&&statusOk&&(!search||text.includes(search));
  });
  const prepCount=rows.filter(r=>r.type==='Prep').length;
  const checkCount=rows.filter(r=>r.type==='Chef check').length;
  const table=rows.length?`<div class="report-table">
    <div class="report-row head"><div>Type</div><div>Station</div><div>Item</div><div>Status</div><div>Date</div></div>
    ${rows.map(r=>`<div class="report-row">
      <div>${r.type}</div>
      <div>${r.station}</div>
      <div><div class="report-cell-main">${r.item}</div><div class="critical-meta">${r.dish} · ${r.subsection}${r.note?' · '+r.note:''}</div></div>
      <div><span class="check-badge ${r.status==='sos'?'discard':r.status==='bu'?'review':r.status}">${statusLabel(r.status)}</span></div>
      <div>${r.date}</div>
    </div>`).join('')}
  </div>`:`<div class="report-no-data">No records match these filters</div>`;
  document.getElementById('reports-content').innerHTML=`
    <div class="ops-grid">
      <div class="ops-card dark"><div class="ops-num">${rows.length}</div><div class="ops-label">Matching records</div></div>
      <div class="ops-card"><div class="ops-num">${prepCount}</div><div class="ops-label">Prep records</div></div>
      <div class="ops-card"><div class="ops-num">${checkCount}</div><div class="ops-label">Chef checks</div></div>
      <div class="ops-card"><div class="ops-num">${rows.filter(r=>['sos','review','discard'].includes(r.status)).length}</div><div class="ops-label">Needs attention</div></div>
    </div>
    ${table}`;
}

// â”€â”€ ORDER INVENTORY â”€â”€
function orderItems(){return Array.isArray(window.ORDER_ITEMS)?window.ORDER_ITEMS:[];}
function orderCategories(){
  return [...new Set(orderItems().map(i=>i.category||'Market List'))].sort();
}
function orderRowsFiltered(){
  const q=(document.getElementById('order-search')?.value||'').toLowerCase();
  const cat=document.getElementById('order-category')?.value||'';
  const only=document.getElementById('order-only')?.checked||false;
  return orderItems().filter(i=>{
    const qty=Number(orderQuantities[i.article]||0);
    const text=(i.article+' '+i.name+' '+i.unit+' '+i.category).toLowerCase();
    return (!q||text.includes(q))&&(!cat||i.category===cat)&&(!only||qty>0);
  });
}
function orderTotals(){
  let lines=0,total=0;
  orderItems().forEach(i=>{
    const qty=Number(orderQuantities[i.article]||0), price=Number(i.price||0);
    if(qty>0){lines++;total+=qty*price;}
  });
  return {lines,total};
}
function money(v){return 'AED '+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}
function orderedLines(){
  return orderItems().filter(i=>Number(orderQuantities[i.article]||0)>0).map(i=>{
    const qty=Number(orderQuantities[i.article]||0), price=Number(i.price||0);
    return {...i,qty,lineTotal:qty*price};
  });
}
function renderOrderInventory(){
  const cats=['<option value="">All categories</option>',...orderCategories().map(c=>`<option value="${c}">${c}</option>`)].join('');
  document.getElementById('order-view').innerHTML=`
    <div class="ops-title">Order Inventory</div>
    <div class="ops-subtitle">${activeOrderDate} · prices from latest inventory file</div>
    <div class="order-toolbar">
      <div class="order-filter-grid">
        <div class="check-field"><div class="check-label">Order date</div><input class="check-input" id="order-date" type="date" value="${activeOrderDate}" onchange="changeOrderDate(this.value)"></div>
        <div class="check-field"><div class="check-label">Search item</div><input class="check-input" id="order-search" placeholder="Beef, tomato, flour..." oninput="renderOrderRows()"></div>
        <div class="check-field"><div class="check-label">Category</div><select class="check-select" id="order-category" onchange="renderOrderRows()">${cats}</select></div>
        <label class="check-label" style="display:flex;gap:7px;align-items:center;height:37px"><input id="order-only" type="checkbox" onchange="renderOrderRows()"> Ordered only</label>
        <button class="check-reset" onclick="resetOrderList()">Reset order</button>
      </div>
      <div class="order-actions">
        <button class="report-btn" onclick="showOrderedOnly()">Show ordered list</button>
        <button class="report-btn" onclick="printOrderList()">Print ordered</button>
        <button class="report-btn" onclick="emailOrderList()">Email ordered</button>
      </div>
    </div>
    <div id="order-summary"></div>
    <div id="order-content"></div>`;
  renderOrderRows();
}
function renderOrderRows(){
  const rows=orderRowsFiltered();
  const totals=orderTotals();
  document.getElementById('order-summary').innerHTML=`
    <div class="ops-grid">
      <div class="ops-card dark"><div class="ops-num">${money(totals.total)}</div><div class="ops-label">Total order value</div></div>
      <div class="ops-card"><div class="ops-num">${totals.lines}</div><div class="ops-label">Ordered lines</div></div>
      <div class="ops-card"><div class="ops-num">${orderItems().length}</div><div class="ops-label">Inventory items</div></div>
      <div class="ops-card"><div class="ops-num">${rows.length}</div><div class="ops-label">Visible rows</div></div>
    </div>`;
  const table=rows.length?`<div class="order-table">
    <div class="order-row head"><div>Article</div><div>Item</div><div>Unit</div><div>Price</div><div>Qty</div><div>Total</div><div>Action</div></div>
    ${rows.slice(0,350).map(i=>{
      const qty=Number(orderQuantities[i.article]||0), total=qty*Number(i.price||0);
      return `<div class="order-row">
        <div>${i.article}</div>
        <div><div class="order-name">${i.name}</div><div class="order-meta">${i.category||'Market List'}</div></div>
        <div>${i.unit||''}</div>
        <div class="order-money">${money(i.price)}</div>
        <div><input class="order-qty" type="number" min="0" step="0.01" value="${qty||''}" onchange="setOrderQty('${i.article}',this.value)"></div>
        <div class="order-money">${money(total)}</div>
        <div>${qty>0?`<button class="check-remove" onclick="clearOrderItem('${i.article}')">Clear</button>`:''}</div>
      </div>`;
    }).join('')}
  </div>`:`<div class="report-no-data">No inventory items match these filters</div>`;
  document.getElementById('order-content').innerHTML=table+(rows.length>350?`<div class="report-no-data">Showing first 350 rows. Use search or category to narrow the list.</div>`:'');
}
function setOrderQty(article,value){
  const qty=Number(value||0);
  if(qty>0)orderQuantities[article]=qty;
  else delete orderQuantities[article];
  saveOrderQuantities();
  renderOrderRows();
}
function clearOrderItem(article){
  delete orderQuantities[article];
  saveOrderQuantities();
  renderOrderRows();
}
function changeOrderDate(date){
  if(!date)return;
  activeOrderDate=date;
  loadOrderQuantities();
  renderOrderInventory();
}
function showOrderedOnly(){
  const cb=document.getElementById('order-only');
  if(cb)cb.checked=true;
  renderOrderRows();
}
function orderText(){
  const lines=orderedLines(), totals=orderTotals();
  const rows=lines.map(i=>`${i.qty} ${i.unit||''} - ${i.name} (${i.article}) @ ${money(i.price)} = ${money(i.lineTotal)}`);
  return [`Roberto's Kitchen Order`, `Date: ${activeOrderDate}`, `Lines: ${lines.length}`, `Total: ${money(totals.total)}`, '', ...rows].join('\\n');
}
function printOrderList(){
  const lines=orderedLines();
  if(!lines.length){alert('No ordered items to print.');return;}
  const totals=orderTotals();
  const rows=lines.map(i=>`<tr><td>${i.article}</td><td>${i.name}</td><td>${i.unit||''}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.lineTotal)}</td></tr>`).join('');
  const w=window.open('','_blank');
  if(!w)return;
  w.document.write(`<html><head><title>Roberto's Kitchen Order ${activeOrderDate}</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#2a1a10}h1{font-family:Georgia,serif;color:#410207}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #cfc0ad;padding:8px;text-align:left}th{background:#410207;color:#f5ede0}.total{font-size:20px;margin:12px 0;color:#410207}</style></head><body><h1>Roberto's Kitchen Order</h1><div>Date: ${activeOrderDate}</div><div class="total">Total: ${money(totals.total)}</div><table><thead><tr><th>Article</th><th>Item</th><th>Unit</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  w.document.close();w.focus();w.print();
}
function emailOrderList(){
  const lines=orderedLines();
  if(!lines.length){alert('No ordered items to email.');return;}
  const subject=encodeURIComponent(`Roberto's Kitchen Order ${activeOrderDate}`);
  const body=encodeURIComponent(orderText());
  window.location.href=`mailto:?subject=${subject}&body=${body}`;
}
function resetOrderList(){
  if(!confirm('Reset all order quantities for '+activeOrderDate+'?'))return;
  orderQuantities={};
  saveOrderQuantities();
  renderOrderInventory();
}

// â”€â”€ RECIPES â”€â”€
function recipeItems(){return Array.isArray(window.RECIPES)?window.RECIPES:[];}
function escHtml(v){return String(v??'').replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
function recipeQualityLabel(q){
  return {good:'Full recipe',ingredients_only:'Ingredients only',needs_cleanup:'Needs cleanup',menu_text:'Menu text'}[q]||q;
}
function recipeOptions(field,label){
  return [`<option value="">All ${label}</option>`,...[...new Set(recipeItems().map(r=>r[field]||'Unsorted'))].sort().map(v=>`<option value="${escHtml(v)}">${escHtml(v)}</option>`)].join('');
}
function recipeRowsFiltered(){
  const q=(document.getElementById('recipe-search')?.value||'').toLowerCase();
  const menu=document.getElementById('recipe-menu')?.value||'';
  const station=document.getElementById('recipe-station')?.value||'';
  const quality=document.getElementById('recipe-quality')?.value||'';
  return recipeItems().filter(r=>{
    const text=[r.title,r.sourceFile,r.menu,r.category,r.station,(r.ingredients||[]).join(' '),(r.method||[]).join(' ')].join(' ').toLowerCase();
    return (!q||text.includes(q))&&(!menu||r.menu===menu)&&(!station||r.station===station)&&(!quality||r.quality===quality);
  });
}
function renderRecipes(){
  document.getElementById('recipes-view').innerHTML=`
    <div class="ops-title">Recipes</div>
    <div class="ops-subtitle">${recipeItems().length} extracted recipe records · searchable library</div>
    <div class="order-toolbar">
      <div class="report-filter-grid">
        <div class="check-field"><div class="check-label">Search recipe</div><input class="check-input" id="recipe-search" placeholder="Ricciola, basil oil, tiramisu..." oninput="renderRecipeRows()"></div>
        <div class="check-field"><div class="check-label">Menu</div><select class="check-select" id="recipe-menu" onchange="renderRecipeRows()">${recipeOptions('menu','menus')}</select></div>
        <div class="check-field"><div class="check-label">Station</div><select class="check-select" id="recipe-station" onchange="renderRecipeRows()">${recipeOptions('station','stations')}</select></div>
        <div class="check-field"><div class="check-label">Status</div><select class="check-select" id="recipe-quality" onchange="renderRecipeRows()"><option value="">All statuses</option><option value="good">Full recipe</option><option value="ingredients_only">Ingredients only</option><option value="needs_cleanup">Needs cleanup</option><option value="menu_text">Menu text</option></select></div>
      </div>
    </div>
    <div class="recipe-layout">
      <div id="recipe-list" class="recipe-list"></div>
      <div id="recipe-detail" class="recipe-detail"></div>
    </div>`;
  renderRecipeRows();
}
function renderRecipeRows(){
  const rows=recipeRowsFiltered();
  if(!rows.find(r=>r.id===activeRecipeId))activeRecipeId=rows[0]?.id||null;
  const list=rows.length?rows.slice(0,220).map(r=>`
    <button class="recipe-row${r.id===activeRecipeId?' active':''}" onclick="selectRecipe('${r.id}')">
      <div class="recipe-title">${escHtml(r.title)}</div>
      <div class="recipe-meta">${escHtml(r.menu)} · ${escHtml(r.category)} · ${escHtml(r.station)}</div>
      <span class="recipe-quality ${escHtml(r.quality)}">${recipeQualityLabel(r.quality)}</span>
    </button>`).join(''):`<div class="recipe-empty">No recipes match these filters</div>`;
  document.getElementById('recipe-list').innerHTML=list+(rows.length>220?`<div class="recipe-empty">Showing first 220 recipes. Use search or filters to narrow the list.</div>`:'');
  renderRecipeDetail();
}
function selectRecipe(id){
  activeRecipeId=id;
  renderRecipeRows();
}
function renderRecipeDetail(){
  const el=document.getElementById('recipe-detail');
  const r=recipeItems().find(x=>x.id===activeRecipeId);
  if(!r){el.innerHTML='<div class="recipe-empty">Select a recipe to view details</div>';return;}
  const ingredients=(r.ingredients||[]).length?(r.ingredients||[]).map(x=>`<li>${escHtml(x)}</li>`).join(''):'<li>Ingredient detail needs cleanup from source file.</li>';
  const method=(r.method||[]).length?(r.method||[]).map(x=>`<li>${escHtml(x)}</li>`).join(''):'<li>Method not available in extracted sheet yet.</li>';
  const notes=(r.notes||[]).length?`<div style="grid-column:1/-1"><div class="recipe-section-title">Notes</div><ul>${r.notes.map(x=>`<li>${escHtml(x)}</li>`).join('')}</ul></div>`:'';
  el.innerHTML=`
    <div class="recipe-detail-head">
      <div class="recipe-detail-title">${escHtml(r.title)}</div>
      <div class="recipe-detail-meta">${escHtml(r.menu)} · ${escHtml(r.category)} · ${escHtml(r.station)} · ${recipeQualityLabel(r.quality)}</div>
    </div>
    <div class="recipe-detail-body">
      <div><div class="recipe-section-title">Ingredients</div><ul>${ingredients}</ul></div>
      <div><div class="recipe-section-title">Method</div><ol>${method}</ol></div>
      ${notes}
    </div>
    <div class="recipe-source">Source: ${escHtml(r.sourceFile)} · ${escHtml(r.relativePath)}</div>`;
}

// â”€â”€ REPORT VIEW â”€â”€
async function loadReport() {
  const date = document.getElementById('report-date').value;
  if (!date) return;
  const el = document.getElementById('report-content');
  el.innerHTML = '<div class="report-no-data">Loading...</div>';
  const { data: logs } = await sb.from('prep_status_log').select('*').eq('service_date', date).order('logged_at', {ascending: false});
  if (!logs || logs.length === 0) { el.innerHTML = `<div class="report-no-data">No data recorded for ${date}</div>`; return; }

  // Get final status per item (latest log entry wins)
  const finalStatus = {};
  [...logs].reverse().forEach(l => {
    const key = `${l.station_key}||${l.subsection_key}||${l.dish_name}||${l.component_name}`;
    finalStatus[key] = l.status;
  });

  const counts = {sos:0,bu:0,ok:0,none:0};
  Object.values(finalStatus).forEach(s=>counts[s]++);
  const total = Object.values(counts).reduce((a,b)=>a+b,0);

  // Per station breakdown
  const byStation = {};
  Object.entries(finalStatus).forEach(([key, status]) => {
    const [stk,ssk,dn,comp] = key.split('||');
    if (!byStation[stk]) byStation[stk] = {};
    if (!byStation[stk][dn]) byStation[stk][dn] = {sos:0,bu:0,ok:0,none:0,items:[]};
    byStation[stk][dn][status]++;
    if (status === 'sos' || status === 'bu') byStation[stk][dn].items.push({comp, status});
  });

  const stationBlocks = STATIONS.map(st => {
    if (!byStation[st.key]) return '';
    const dishes = byStation[st.key];
    const stCounts = {sos:0,bu:0,ok:0};
    Object.values(dishes).forEach(d=>{stCounts.sos+=d.sos;stCounts.bu+=d.bu;stCounts.ok+=d.ok;});
    const dishRows = Object.entries(dishes).map(([dname, dc]) => {
      const badges = `${dc.sos>0?`<span class="rsc-badge rsc-sos">${dc.sos} SOS</span>`:''}${dc.bu>0?`<span class="rsc-badge rsc-bu">${dc.bu} BU</span>`:''}${dc.ok>0?`<span class="rsc-badge rsc-ok">${dc.ok} OK</span>`:''}`;
      return `<div class="report-dish-row"><span class="report-dish-name">${dname}</span><div class="report-dish-badges">${badges}</div></div>`;
    }).join('');
    return `<div class="report-station-block"><div class="report-station-header"><span class="report-station-name">${st.label}</span><div class="report-station-counts">${stCounts.sos>0?`<span class="rsc-badge rsc-sos">${stCounts.sos} SOS</span>`:''}${stCounts.bu>0?`<span class="rsc-badge rsc-bu">${stCounts.bu} BU</span>`:''}${stCounts.ok>0?`<span class="rsc-badge rsc-ok">${stCounts.ok} OK</span>`:''}
    </div></div>${dishRows}</div>`;
  }).join('');

  el.innerHTML = `
    <div class="report-summary">
      <div class="report-card c-sos"><span class="report-card-num">${counts.sos}</span><span class="report-card-label">SOS</span></div>
      <div class="report-card c-bu"><span class="report-card-num">${counts.bu}</span><span class="report-card-label">Backup</span></div>
      <div class="report-card c-ok"><span class="report-card-num">${counts.ok}</span><span class="report-card-label">OK</span></div>
      <div class="report-card c-total"><span class="report-card-num">${total}</span><span class="report-card-label">Total</span></div>
    </div>
    ${stationBlocks || '<div class="report-no-data">No station data found</div>'}`;
}

// â”€â”€ COUNTER â”€â”€
function renderCounter() {
  const st=STATIONS.find(s=>s.key===activeStation);
  if(!st)return;
  const c=stationCounts(st);
  const total=c.sos+c.bu+c.ok+c.none;
  document.getElementById('sec-counter').innerHTML=[
    {cls:'c-sos',key:'sos',num:c.sos,label:'SOS'},
    {cls:'c-bu',key:'bu',num:c.bu,label:'Backup'},
    {cls:'c-ok',key:'ok',num:c.ok,label:'OK'},
    {cls:'c-pending',key:'none',num:c.none,label:'Pending'},
  ].map(card=>`<div class="sc-card ${card.cls}${activeFilter===card.key?' filter-active':''}" onclick="toggleFilter('${card.key}')"><span class="sc-num">${card.num}</span><span class="sc-label">${card.label}</span></div>`).join('');
  document.getElementById('foot-label').textContent=`${st.label} · ${total} items total`;
  const fb=document.getElementById('filter-bar');
  if(activeFilter){fb.classList.add('visible');document.getElementById('filter-label-text').textContent={sos:'SOS only',bu:'Backup only',ok:'OK only',none:'Pending only'}[activeFilter];}
  else fb.classList.remove('visible');
}

function applyFilter() {
  const st=STATIONS.find(s=>s.key===activeStation);
  if(!st)return;
  st.subsections.forEach(ss=>ss.dishes.forEach(dish=>{
    let vis=false;
    dish.items.forEach(item=>{
      const id=mkId(st.key,ss.key,dish.name,item);
      const show=!activeFilter||(state[id]||'none')===activeFilter;
      const row=document.getElementById('pr-'+encodeURIComponent(id));
      if(row)row.classList.toggle('hidden-row',!show);
      if(show)vis=true;
    });
    const db=document.getElementById('db-'+st.key+'-'+ss.key+'-'+dish.name.replace(/[^a-z0-9]/gi,'_'));
    if(db)db.classList.toggle('hidden-block',!vis);
  }));
}

function toggleFilter(k){activeFilter=activeFilter===k?null:k;renderCounter();applyFilter();}
function clearFilter(){activeFilter=null;renderCounter();applyFilter();}

// â”€â”€ CONTENT â”€â”€
function renderContent() {
  const st=STATIONS.find(s=>s.key===activeStation);
  if(!st){document.getElementById('content').innerHTML='';return;}
  document.getElementById('content').innerHTML=renderStationChecks(st.key)+st.subsections.map(ss=>`
    <div class="subsec-title">${ss.label}<div class="subsec-line"></div></div>
    ${ss.dishes.map(dish=>{
      const dk='db-'+st.key+'-'+ss.key+'-'+dish.name.replace(/[^a-z0-9]/gi,'_');
      const eS=st.key.replace(/'/g,"\\'"),eSS=ss.key.replace(/'/g,"\\'"),eDN=dish.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const did='dc-'+st.key+'-'+ss.key+'-'+dish.name.replace(/[^a-z0-9]/gi,'_');
      const mid='mv-'+st.key+'-'+ss.key+'-'+dish.name.replace(/[^a-z0-9]/gi,'_');
      const stationOptions=STATIONS.map(x=>`<option value="${x.key}"${x.key===st.key?' selected':''}>${x.label}</option>`).join('');
      const subsectionOptions=st.subsections.map(x=>`<option value="${x.key}"${x.key===ss.key?' selected':''}>${x.label}</option>`).join('');
      return `<div class="dish-block" id="${dk}">
        <div class="dish-label">
          <span class="dish-name-text">${dish.name}${dish.extra?'<span class="dish-extra-tag"> · EXTRA</span>':''}</span>
          <div class="dish-actions" id="${mid}-actions">
            <button class="dish-move-btn" onclick="showMovePanel('${mid}','${did}')">Move dish</button>
            <button class="dish-delete-btn" id="${did}-btn" onclick="showDishConfirm('${did}','${eS}','${eSS}','${eDN}')">Remove dish</button>
            <div class="dish-confirm-row" id="${did}-confirm">
              <span class="dish-confirm-label">Remove entire dish?</span>
              <button class="dish-confirm-yes" onclick="deleteDish('${eS}','${eSS}','${eDN}','${did}')">Yes, remove</button>
              <button class="dish-confirm-no" onclick="cancelDishConfirm('${did}')">Cancel</button>
            </div>
          </div>
        </div>
        <div class="dish-move-panel" id="${mid}">
          <span class="dish-move-label">Move to</span>
          <select class="dish-move-select" id="${mid}-station" onchange="updateMoveSubsections('${mid}')">${stationOptions}</select>
          <select class="dish-move-select" id="${mid}-subsection">${subsectionOptions}</select>
          <button class="dish-move-yes" onclick="moveDish('${eS}','${eSS}','${eDN}','${mid}')">Move</button>
          <button class="dish-move-no" onclick="cancelMovePanel('${mid}')">Cancel</button>
          <div class="dish-move-note" id="${mid}-note"></div>
        </div>
        ${dish.items.map((item,idx)=>{
          const id=mkId(st.key,ss.key,dish.name,item);
          const s=state[id]||'none';
          const esc=id.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          const bc=s==='none'?'sbtn-none':'sbtn-colored';
          const ikey='ic-'+encodeURIComponent(id);
          return `<div class="prep-row status-${s}" id="pr-${encodeURIComponent(id)}">
            <span class="prep-name">${item}</span>
            <div class="row-right">
              <div class="item-confirm-inline" id="${ikey}">
                <span class="ic-label">Remove?</span>
                <button class="ic-yes" onclick="deleteItem('${esc}','${eS}','${eSS}','${eDN}',${idx},'${ikey}')">Yes</button>
                <button class="ic-no" onclick="cancelItemConfirm('${ikey}','${encodeURIComponent(id)}')">No</button>
              </div>
              <div class="status-btns" id="sb-${encodeURIComponent(id)}">
                <button class="sbtn ${bc}${s==='sos'?' active-sos':''}" onclick="setS('${esc}','sos')">SOS</button>
                <button class="sbtn ${bc}${s==='bu'?' active-bu':''}" onclick="setS('${esc}','bu')">BU</button>
                <button class="sbtn ${bc}${s==='ok'?' active-ok':''}" onclick="setS('${esc}','ok')">OK</button>
              </div>
              <button class="item-del-btn" id="idb-${encodeURIComponent(id)}" onclick="showItemConfirm('${ikey}','${encodeURIComponent(id)}')" aria-label="Remove item" title="Remove item">X</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}
  `).join('');
  applyFilter();
}

// â”€â”€ UPDATE SINGLE ROW WITHOUT FULL RE-RENDER (for realtime) â”€â”€
function updateRowUI(id, s) {
  const row = document.getElementById('pr-'+encodeURIComponent(id));
  if (!row) return;
  row.className='prep-row status-'+s;
  const bc=s==='none'?'sbtn-none':'sbtn-colored';
  const btns=row.querySelectorAll('.sbtn');
  if(btns[0]){btns[0].className=`sbtn ${bc}`+(s==='sos'?' active-sos':'');btns[1].className=`sbtn ${bc}`+(s==='bu'?' active-bu':'');btns[2].className=`sbtn ${bc}`+(s==='ok'?' active-ok':'');}
}

// â”€â”€ SET STATUS â”€â”€
async function setS(id, val) {
  const prev = state[id]||'none';
  const newVal = prev===val?'none':val;
  state[id]=newVal;
  updateRowUI(id, newVal);
  renderTabs();renderCounter();applyFilter();
  const {stk,ssk,dn,item}=parseId(id);
  await saveStatus(stk,ssk,dn,item,newVal,prev);
}

// â”€â”€ MOVE DISH â”€â”€
function showMovePanel(mid,did){
  const panel=document.getElementById(mid);
  const actions=document.getElementById(mid+'-actions');
  const confirm=document.getElementById(did+'-confirm');
  const deleteBtn=document.getElementById(did+'-btn');
  if(confirm)confirm.classList.remove('visible');
  if(deleteBtn)deleteBtn.style.display='';
  if(panel)panel.classList.add('visible');
  if(actions)actions.style.display='none';
}
function cancelMovePanel(mid){
  const panel=document.getElementById(mid);
  const actions=document.getElementById(mid+'-actions');
  if(panel)panel.classList.remove('visible');
  if(actions)actions.style.display='';
}
function updateMoveSubsections(mid){
  const stationKey=document.getElementById(mid+'-station').value;
  const st=STATIONS.find(s=>s.key===stationKey);
  const select=document.getElementById(mid+'-subsection');
  if(!st||!select)return;
  select.innerHTML=st.subsections.map(ss=>`<option value="${ss.key}">${ss.label}</option>`).join('');
}
async function persistMoveDish(dish, fromStKey, fromSsKey, toStKey, toSsKey, savedState){
  if(DEV_READ_ONLY)return;
  if(dish.id)await sb.from('dishes').update({station_key:toStKey,subsection_key:toSsKey}).eq('id',dish.id);
  const oldRows=Object.entries(savedState).map(([component,status])=>({
    service_date:TODAY,station_key:toStKey,subsection_key:toSsKey,dish_name:dish.name,component_name:component,status,updated_at:new Date().toISOString()
  }));
  if(oldRows.length)await sb.from('prep_status').upsert(oldRows,{onConflict:'service_date,station_key,subsection_key,dish_name,component_name'});
  await sb.from('prep_status').delete().eq('service_date',TODAY).eq('station_key',fromStKey).eq('subsection_key',fromSsKey).eq('dish_name',dish.name);
}
async function moveDish(fromStKey,fromSsKey,dishName,mid){
  const toStKey=document.getElementById(mid+'-station').value;
  const toSsKey=document.getElementById(mid+'-subsection').value;
  const note=document.getElementById(mid+'-note');
  if(fromStKey===toStKey&&fromSsKey===toSsKey){cancelMovePanel(mid);return;}
  const fromSt=STATIONS.find(s=>s.key===fromStKey);
  const fromSs=fromSt&&fromSt.subsections.find(s=>s.key===fromSsKey);
  const toSt=STATIONS.find(s=>s.key===toStKey);
  const toSs=toSt&&toSt.subsections.find(s=>s.key===toSsKey);
  if(!fromSt||!fromSs||!toSt||!toSs)return;
  if(toSs.dishes.find(d=>d.name===dishName)){
    if(note){note.textContent=`"${dishName}" already exists in ${toSs.label}.`;note.style.display='block';}
    return;
  }
  const idx=fromSs.dishes.findIndex(d=>d.name===dishName);
  if(idx===-1)return;
  const dish=fromSs.dishes.splice(idx,1)[0];
  const savedState={};
  dish.items.forEach(item=>{
    const oldId=mkId(fromStKey,fromSsKey,dish.name,item);
    const newId=mkId(toStKey,toSsKey,dish.name,item);
    savedState[item]=state[oldId]||'none';
    state[newId]=savedState[item];
    delete state[oldId];
    const existingCheck=getChefCheck(oldId);
    if(existingCheck){
      existingCheck.id=newId;
      existingCheck.stationKey=toStKey;
      existingCheck.subsectionKey=toSsKey;
    }
  });
  toSs.dishes.push(dish);
  saveChefChecks();
  await persistMoveDish(dish,fromStKey,fromSsKey,toStKey,toSsKey,savedState);
  undoStack={type:'move',fromStKey,fromSsKey,toStKey,toSsKey,dishName:dish.name,idx};
  activeFilter=null;
  switchStation(toStKey);
  showUndo(`"${dish.name}" moved to ${toSt.label} / ${toSs.label}`);
}

// â”€â”€ DELETE DISH â”€â”€
function showDishConfirm(did,stKey,ssKey,dishName){document.getElementById(did+'-btn').style.display='none';document.getElementById(did+'-confirm').classList.add('visible');}
function cancelDishConfirm(did){document.getElementById(did+'-btn').style.display='';document.getElementById(did+'-confirm').classList.remove('visible');}
function deleteDish(stKey,ssKey,dishName,did){
  const st=STATIONS.find(s=>s.key===stKey);const ss=st.subsections.find(s=>s.key===ssKey);
  const di=ss.dishes.findIndex(d=>d.name===dishName);if(di===-1)return;
  const removed=ss.dishes.splice(di,1)[0];
  const savedState={};removed.items.forEach(item=>{const id=mkId(stKey,ssKey,dishName,item);savedState[item]=state[id]||'none';delete state[id];});
  undoStack={type:'dish',stKey,ssKey,dish:removed,idx:di,savedState};
  showUndo(`"${dishName}" removed`);renderTabs();renderCounter();renderContent();
}

// â”€â”€ DELETE ITEM â”€â”€
function showItemConfirm(ikey,encId){document.getElementById(ikey).classList.add('visible');document.getElementById('sb-'+encId).style.display='none';document.getElementById('idb-'+encId).style.display='none';}
function cancelItemConfirm(ikey,encId){document.getElementById(ikey).classList.remove('visible');document.getElementById('sb-'+encId).style.display='';document.getElementById('idb-'+encId).style.display='';}
function deleteItem(id,stKey,ssKey,dishName,idx,ikey){
  const st=STATIONS.find(s=>s.key===stKey);const ss=st.subsections.find(s=>s.key===ssKey);const dish=ss.dishes.find(d=>d.name===dishName);
  if(!dish)return;const itemName=dish.items[idx];const savedStatus=state[id]||'none';delete state[id];dish.items.splice(idx,1);
  if(dish.items.length===0){const di=ss.dishes.findIndex(d=>d.name===dishName);const rd=ss.dishes.splice(di,1)[0];undoStack={type:'dish',stKey,ssKey,dish:rd,idx:di,savedState:{}};}
  else undoStack={type:'item',stKey,ssKey,dishName,itemName,idx,savedStatus};
  showUndo(`"${itemName}" removed`);renderTabs();renderCounter();renderContent();
}

// â”€â”€ UNDO â”€â”€
function showUndo(msg){
  if(undoTimer)clearTimeout(undoTimer);
  document.getElementById('undo-msg').textContent=msg;
  document.getElementById('undo-toast').classList.add('visible');
  undoTimer=setTimeout(()=>{document.getElementById('undo-toast').classList.remove('visible');undoStack=null;},6000);
}
async function undoDelete(){
  if(!undoStack)return;clearTimeout(undoTimer);document.getElementById('undo-toast').classList.remove('visible');
  const u=undoStack;undoStack=null;
  if(u.type==='move'){
    const fromSt=STATIONS.find(s=>s.key===u.fromStKey),toSt=STATIONS.find(s=>s.key===u.toStKey);
    const fromSs=fromSt&&fromSt.subsections.find(s=>s.key===u.fromSsKey),toSs=toSt&&toSt.subsections.find(s=>s.key===u.toSsKey);
    if(fromSs&&toSs){
      const di=toSs.dishes.findIndex(d=>d.name===u.dishName);
      if(di!==-1){
        const dish=toSs.dishes.splice(di,1)[0];
        const savedState={};
        dish.items.forEach(item=>{
          const oldId=mkId(u.toStKey,u.toSsKey,dish.name,item);
          const newId=mkId(u.fromStKey,u.fromSsKey,dish.name,item);
          savedState[item]=state[oldId]||'none';
          state[newId]=savedState[item];
          delete state[oldId];
        });
        fromSs.dishes.splice(Math.min(u.idx,fromSs.dishes.length),0,dish);
        await persistMoveDish(dish,u.toStKey,u.toSsKey,u.fromStKey,u.fromSsKey,savedState);
        switchStation(u.fromStKey);
        return;
      }
    }
  }
  const st=STATIONS.find(s=>s.key===u.stKey);const ss=st.subsections.find(s=>s.key===u.ssKey);
  if(u.type==='dish'){ss.dishes.splice(u.idx,0,u.dish);u.dish.items.forEach(item=>{state[mkId(u.stKey,u.ssKey,u.dish.name,item)]=u.savedState[item]||'none';});}
  else{const dish=ss.dishes.find(d=>d.name===u.dishName);if(dish){dish.items.splice(u.idx,0,u.itemName);state[mkId(u.stKey,u.ssKey,u.dishName,u.itemName)]=u.savedStatus||'none';}}
  renderTabs();renderCounter();renderContent();
}

// â”€â”€ APP PAGES â”€â”€
function hideAllPages(){
  ['home-view','pass-view','report-view','dashboard-view','reports-view','order-view','recipes-view','check-view','content','legend-bar','sec-counter-wrap','add-section-wrap'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.style.display='none';
  });
  document.getElementById('section-tabs').style.display='none';
  document.querySelector('.footer-bar').style.display='none';
}
function openHome(){
  activeStation=HOME_KEY;
  hideAllPages();
  document.getElementById('home-view').style.display='block';
  document.getElementById('foot-label').textContent='Kitchen App';
}
function openPrep(key){
  document.getElementById('section-tabs').style.display='flex';
  document.querySelector('.footer-bar').style.display='flex';
  renderTabs();
  switchStation(key||PASS_KEY);
}
function openChecklist(){
  activeStation=CHECK_KEY;
  hideAllPages();
  document.getElementById('check-view').style.display='block';
  document.querySelector('.footer-bar').style.display='flex';
  document.getElementById('foot-label').textContent='Chef Checklist';
  renderCheckView();
}
function openDashboard(){
  activeStation=DASHBOARD_KEY;
  hideAllPages();
  document.getElementById('dashboard-view').style.display='block';
  document.querySelector('.footer-bar').style.display='flex';
  document.getElementById('foot-label').textContent='Dashboard';
  renderDashboard();
}
function openReports(){
  activeStation=REPORTS_KEY;
  hideAllPages();
  document.getElementById('reports-view').style.display='block';
  document.querySelector('.footer-bar').style.display='flex';
  document.getElementById('foot-label').textContent='Reports';
  renderReports();
}
function openOrderInventory(){
  activeStation=ORDER_KEY;
  hideAllPages();
  document.getElementById('order-view').style.display='block';
  document.querySelector('.footer-bar').style.display='flex';
  document.getElementById('foot-label').textContent='Order Inventory';
  renderOrderInventory();
}
function openRecipes(){
  activeStation=RECIPES_KEY;
  hideAllPages();
  document.getElementById('recipes-view').style.display='block';
  document.querySelector('.footer-bar').style.display='flex';
  document.getElementById('foot-label').textContent='Recipes';
  renderRecipes();
}

// â”€â”€ SWITCH STATION â”€â”€
function switchStation(key){
  if(key===CHECK_KEY){openChecklist();return;}
  activeStation=key;activeFilter=null;
  const isPass=key===PASS_KEY;
  ['home-view','pass-view','report-view','dashboard-view','reports-view','order-view','recipes-view','check-view','content','legend-bar','sec-counter-wrap','add-section-wrap'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.style.display='none';
  });
  document.getElementById('section-tabs').style.display='flex';
  document.querySelector('.footer-bar').style.display='flex';
  if(isPass){
    var pv=document.getElementById('pass-view');if(pv)pv.style.display='block';
    document.getElementById('foot-label').textContent='The Pass · All stations';
    renderPassView();
  } else {
    var show={'content':'block','legend-bar':'flex','sec-counter-wrap':'block','add-section-wrap':'block'};
    Object.keys(show).forEach(function(id){var el=document.getElementById(id);if(el)el.style.display=show[id];});
    document.getElementById('foot-label').textContent='';
    var ss=document.getElementById('add-dish-section');if(ss)ss.value=key;
    updateSubsectionSelect();renderCounter();renderContent();
  }
  renderTabs();
}
function populateSelects(){
  if(!STATIONS.length)return;
  const stSel=document.getElementById('add-dish-section');
  if(!stSel)return;
  stSel.innerHTML=STATIONS.map(s=>`<option value="${s.key}">${s.label}</option>`).join('');
  stSel.value=activeStation!==PASS_KEY?activeStation:STATIONS[0].key;
  stSel.onchange=updateSubsectionSelect;updateSubsectionSelect();
}
function updateSubsectionSelect(){
  const stKey=document.getElementById('add-dish-section').value;
  const st=STATIONS.find(s=>s.key===stKey);
  if(!st)return;
  document.getElementById('add-dish-subsection').innerHTML=st.subsections.map(ss=>`<option value="${ss.key}">${ss.label}</option>`).join('');
}
async function addDish(){
  const nameEl=document.getElementById('add-dish-name'),itemsEl=document.getElementById('add-dish-items');
  const stKey=document.getElementById('add-dish-section').value,ssKey=document.getElementById('add-dish-subsection').value;
  const noteEl=document.getElementById('add-note'),name=nameEl.value.trim();
  if(!name){noteEl.style.display='block';noteEl.textContent='Please enter a dish or prep name.';return;}
  const items=itemsEl.value.trim()?itemsEl.value.trim().split('\n').map(i=>i.trim()).filter(i=>i):['Prepare as needed'];
  const st=STATIONS.find(s=>s.key===stKey),ss=st.subsections.find(s=>s.key===ssKey);
  if(ss.dishes.find(d=>d.name===name)){noteEl.style.display='block';noteEl.textContent=`"${name}" already exists.`;return;}
  if (DEV_READ_ONLY) {
    ss.dishes.push({id:'dev-'+Date.now(),name,items,extra:true});
    items.forEach(item=>{state[mkId(stKey,ssKey,name,item)]='none';});
  } else {
    const {data:dish} = await sb.from('dishes').insert({station_key:stKey,subsection_key:ssKey,name,sort_order:ss.dishes.length+1,active:true}).select().single();
    if(dish){
      const comps=items.map((c,i)=>({dish_id:dish.id,name:c,sort_order:i+1,active:true}));
      await sb.from('dish_components').insert(comps);
      ss.dishes.push({id:dish.id,name,items,extra:true});
      items.forEach(item=>{state[mkId(stKey,ssKey,name,item)]='none';});
    }
  }
  nameEl.value='';itemsEl.value='';noteEl.style.display='block';noteEl.textContent=`"${name}" added.`;
  setTimeout(()=>{noteEl.style.display='none';},3000);
  if(activeStation!==stKey)switchStation(stKey);else{renderTabs();renderCounter();renderContent();}
}

async function resetAll(){
  Object.keys(state).forEach(k=>state[k]='none');
  activeFilter=null;
  if (!DEV_READ_ONLY) await sb.from('prep_status').delete().eq('service_date',TODAY);
  renderTabs();
  if(activeStation===PASS_KEY)renderPassView();
  else{renderCounter();renderContent();}
}

function setDate(){
  const d=new Date();
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('hdr-date').textContent=days[d.getDay()]+' '+d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear();
}

init();


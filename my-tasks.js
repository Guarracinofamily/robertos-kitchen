// ══════════════════════════════════════════════════════════════════════════
// MY TASKS MODULE — Francesco's personal task list (private view)
//
//   • my_tasks = one row per task, owned by a single user key
//   • Tabs: Today / Tomorrow / All / Done
//   • Priority shows as a coloured left bar (p1 pomodoro, p2 oro, p3 oliva)
//   • PIN-gated: this is a personal list, not a shared kitchen tool
//
// Written to be updated by Claude (via Supabase) as well as by hand here.
// Same visual language as the rest of the app — sabbia/vino, serif titles.
// ══════════════════════════════════════════════════════════════════════════

const MT_KEY   = 'my_tasks';
const MT_PIN   = '3105';           // personal view passcode
const MT_OWNER = 'francesco';      // owner key on every row
const MT_UNLOCK_MS = 12 * 60 * 60 * 1000;   // stay unlocked half a day

let mtRows      = [];
let mtTab       = 'today';
let mtChannel   = null;
let mtUnlocked  = false;

function mtEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── dates ──────────────────────────────────────────────────────────────────
function mtToday(){ return (typeof TODAY!=='undefined' && TODAY) ? TODAY : new Date().toISOString().slice(0,10); }
function mtShift(iso, days){
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}
function mtDayLabel(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
}
function mtTimeLabel(r){
  if(!r.due_time) return '—';
  return r.due_time.slice(0,5);
}

// ── data ───────────────────────────────────────────────────────────────────
async function mtLoad(){
  const res = await sb.from('my_tasks')
    .select('*')
    .eq('owner', MT_OWNER)
    .order('due_date', { ascending:true, nullsFirst:false })
    .order('due_time', { ascending:true, nullsFirst:true });
  mtRows = res.data || [];
}

function mtSubscribe(){
  if(mtChannel) return;
  mtChannel = sb.channel('my-tasks-rt')
    .on('postgres_changes', { event:'*', schema:'public', table:'my_tasks' }, async () => {
      await mtLoad();
      if(document.getElementById('mytasks-view').style.display === 'block') mtRender();
    })
    .subscribe();
}

async function mtToggleDone(id){
  const row = mtRows.find(r => r.id === id);
  if(!row) return;
  const next = !row.done;
  row.done = next;                       // optimistic
  mtRender();
  await sb.from('my_tasks').update({
    done: next,
    done_at: next ? new Date().toISOString() : null
  }).eq('id', id);
  await mtLoad(); mtRender();
}

async function mtAdd(){
  const title = prompt('Task:');
  if(!title || !title.trim()) return;
  const when = prompt('When?  today / tomorrow / YYYY-MM-DD  (blank = no date)', 'today');
  let due = null;
  if(when && when.trim()){
    const w = when.trim().toLowerCase();
    if(w === 'today')          due = mtToday();
    else if(w === 'tomorrow')  due = mtShift(mtToday(), 1);
    else if(/^\d{4}-\d{2}-\d{2}$/.test(w)) due = w;
  }
  const time = prompt('Time?  e.g. 15:00  (blank = none)', '');
  await sb.from('my_tasks').insert({
    owner: MT_OWNER,
    title: title.trim(),
    due_date: due,
    due_time: (time && /^\d{1,2}:\d{2}$/.test(time.trim())) ? time.trim() : null,
    priority: 3,
    done: false
  });
  await mtLoad(); mtRender();
}

async function mtEditNote(id){
  const row = mtRows.find(r => r.id === id);
  if(!row) return;
  const note = prompt('Note:', row.note || '');
  if(note === null) return;
  await sb.from('my_tasks').update({ note: note.trim() || null }).eq('id', id);
  await mtLoad(); mtRender();
}

// ── filtering ──────────────────────────────────────────────────────────────
function mtVisible(){
  const t = mtToday(), tm = mtShift(t, 1);
  if(mtTab === 'done')     return mtRows.filter(r => r.done);
  const open = mtRows.filter(r => !r.done);
  if(mtTab === 'today')    return open.filter(r => r.due_date && r.due_date <= t);
  if(mtTab === 'tomorrow') return open.filter(r => r.due_date === tm);
  return open;
}

function mtGroups(){
  const t = mtToday(), tm = mtShift(t, 1);
  const list = mtVisible();
  if(mtTab === 'today')    return [{ label:'Today',    sub:mtDayLabel(t),  items:list }];
  if(mtTab === 'tomorrow') return [{ label:'Tomorrow', sub:mtDayLabel(tm), items:list }];
  if(mtTab === 'done')     return [{ label:'Done',     sub:'',             items:list }];

  const overdue = list.filter(r => r.due_date && r.due_date <  t);
  const today   = list.filter(r => r.due_date === t);
  const tomo    = list.filter(r => r.due_date === tm);
  const later   = list.filter(r => r.due_date && r.due_date >  tm);
  const undated = list.filter(r => !r.due_date);
  return [
    { label:'Overdue',  sub:'',              items:overdue, hot:true },
    { label:'Today',    sub:mtDayLabel(t),   items:today },
    { label:'Tomorrow', sub:mtDayLabel(tm),  items:tomo },
    { label:'Later',    sub:'',              items:later },
    { label:'No date',  sub:'',              items:undated }
  ].filter(g => g.items.length);
}

// ── render ─────────────────────────────────────────────────────────────────
function mtRow(r){
  const p = 'p' + (r.priority || 3);
  const tags = [];
  if(r.kind)  tags.push(`<span class="mt-chip">${mtEsc(r.kind)}</span>`);
  if(r.tag)   tags.push(`<span class="mt-chip ghost">${mtEsc(r.tag)}</span>`);
  return `
  <div class="mt-row ${p}${r.done ? ' done' : ''}">
    <button class="mt-tick" onclick="mtToggleDone('${r.id}')">${r.done ? '&#10003;' : ''}</button>
    <div class="mt-mid" onclick="mtEditNote('${r.id}')">
      <div class="mt-name">${mtEsc(r.title)}</div>
      ${r.note ? `<div class="mt-note">${mtEsc(r.note)}</div>` : ''}
      ${tags.length ? `<div class="mt-tags">${tags.join('')}</div>` : ''}
    </div>
    <div class="mt-when">${mtTimeLabel(r)}<small>${r.due_date ? mtDayLabel(r.due_date).split(' ').slice(1).join(' ') : 'no date'}</small></div>
  </div>`;
}

function mtRender(){
  const host = document.getElementById('mytasks-view');
  const t = mtToday();
  const open   = mtRows.filter(r => !r.done);
  const urgent = open.filter(r => r.priority === 1).length;
  const week   = open.filter(r => r.due_date && r.due_date >= t && r.due_date <= mtShift(t, 6)).length;

  const tabs = [['today','Today'],['tomorrow','Tomorrow'],['all','All'],['done','Done']]
    .map(([k,l]) => `<button class="mt-tab${mtTab===k?' on':''}" onclick="mtSetTab('${k}')">${l}</button>`).join('');

  const body = mtGroups().map(g => `
    <div class="mt-band">
      <span class="mt-band-t${g.hot?' hot':''}">${g.label}</span>
      <span class="mt-band-line"></span>
      <span class="mt-band-c">${g.sub}${g.sub && g.items.length ? ' · ' : ''}${g.items.length ? g.items.length + ' items' : ''}</span>
    </div>
    ${g.items.map(mtRow).join('')}
  `).join('') || `<div class="mt-empty">Nothing here.</div>`;

  host.innerHTML = `${MT_STYLE}
    <div class="mt-tabs">${tabs}</div>
    <div class="mt-counters">
      <div class="mt-sc hot"><div class="mt-sc-n">${urgent}</div><div class="mt-sc-l">Urgent</div></div>
      <div class="mt-sc"><div class="mt-sc-n">${open.length}</div><div class="mt-sc-l">Open</div></div>
      <div class="mt-sc"><div class="mt-sc-n">${week}</div><div class="mt-sc-l">This week</div></div>
    </div>
    ${body}
    <button class="mt-add" onclick="mtAdd()">+ Add task</button>
    <div class="mt-foot">Updated automatically each morning · 07:00</div>`;
}

function mtSetTab(k){ mtTab = k; mtRender(); }

// ── entry point ────────────────────────────────────────────────────────────
function mtCheckUnlock(){
  if(mtUnlocked) return true;
  try{
    const until = parseInt(localStorage.getItem('mt_unlock_until') || '0', 10);
    if(until && Date.now() < until){ mtUnlocked = true; return true; }
  }catch(e){}
  const code = prompt('Passcode:');
  if(code === MT_PIN){
    mtUnlocked = true;
    try{ localStorage.setItem('mt_unlock_until', String(Date.now() + MT_UNLOCK_MS)); }catch(e){}
    return true;
  }
  if(code !== null) alert('Incorrect passcode.');
  return false;
}

async function openMyTasks(){
  if(!mtCheckUnlock()) return;
  activeStation = MT_KEY;
  hideAllPages();
  const host = document.getElementById('mytasks-view');
  host.style.display = 'block';
  document.querySelector('.footer-bar').style.display = 'flex';
  document.getElementById('foot-label').textContent = 'My Tasks';
  host.innerHTML = `${MT_STYLE}<div class="ops-title">My Tasks</div><div class="ops-subtitle">Loading…</div>`;
  await mtLoad();
  mtSubscribe();
  mtRender();
}

// ══ styles ═══════════════════════════════════════════════════════════════════
const MT_STYLE = `<style id="mt-style">
.mt-tabs{display:flex;gap:6px;margin:2px 0 16px;overflow-x:auto}
.mt-tab{background:none;border:none;border-bottom:3px solid transparent;color:var(--vino-light);font-family:var(--font-sans);font-size:12px;font-weight:600;letter-spacing:.6px;padding:8px 12px;cursor:pointer;white-space:nowrap;text-transform:uppercase}
.mt-tab.on{color:var(--vino);border-bottom-color:var(--vino)}

.mt-counters{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px}
.mt-sc{border-radius:4px;padding:12px 8px;display:flex;flex-direction:column;align-items:center;gap:3px;background:var(--sabbia-light);border:1px solid var(--sabbia-dark)}
.mt-sc-n{font-family:var(--font-serif);font-size:28px;line-height:1;color:var(--vino)}
.mt-sc-l{font-size:9px;letter-spacing:1.4px;text-transform:uppercase;color:var(--vino-light);font-weight:600}
.mt-sc.hot .mt-sc-n{color:var(--pomodoro)}

.mt-band{display:flex;align-items:center;gap:10px;margin:26px 0 10px}
.mt-band-t{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--vino-light);font-weight:600}
.mt-band-t.hot{color:var(--pomodoro)}
.mt-band-line{flex:1;height:1px;background:var(--sabbia-dark)}
.mt-band-c{font-size:11px;color:var(--vino-light)}

.mt-row{background:var(--cream);border:1px solid var(--sabbia-dark);border-left:6px solid var(--sabbia-dark);border-radius:0 10px 10px 0;padding:13px 15px;margin-bottom:9px;display:flex;gap:13px;align-items:flex-start}
.mt-row.p1{border-left-color:var(--pomodoro)}
.mt-row.p2{border-left-color:var(--oro)}
.mt-row.p3{border-left-color:var(--oliva)}
.mt-row.done{opacity:.45}
.mt-row.done .mt-name{text-decoration:line-through}

.mt-tick{width:22px;height:22px;border:1.5px solid var(--sabbia-dark);border-radius:4px;background:transparent;flex:0 0 auto;margin-top:2px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--oliva);font-size:14px;font-weight:700;line-height:1}
.mt-row.done .mt-tick{background:var(--oliva);border-color:var(--oliva);color:#fff}

.mt-mid{flex:1;min-width:0;cursor:pointer}
.mt-name{font-family:var(--font-serif);font-size:20px;color:var(--vino);line-height:1.15}
.mt-note{font-size:12px;color:var(--vino-light);margin-top:4px;line-height:1.45}
.mt-tags{margin-top:7px;display:flex;gap:6px;flex-wrap:wrap}
.mt-chip{display:inline-block;background:var(--vino);color:var(--cream);font-size:9px;letter-spacing:1.4px;text-transform:uppercase;padding:3px 9px;border-radius:20px}
.mt-chip.ghost{background:transparent;color:var(--vino-light);border:1px solid var(--sabbia-dark)}

.mt-when{font-family:var(--font-serif);font-size:19px;color:var(--vino);flex:0 0 62px;text-align:right;line-height:1.1}
.mt-when small{display:block;font-family:var(--font-sans);font-size:9px;letter-spacing:1.2px;text-transform:uppercase;color:var(--vino-light);margin-top:2px}

.mt-empty{background:var(--sabbia-light);border:1px dashed var(--sabbia-dark);border-radius:6px;padding:18px;text-align:center;color:var(--vino-light);font-size:13px}
.mt-add{margin-top:20px;width:100%;background:var(--vino);color:var(--cream);border:none;border-radius:6px;padding:14px;font-family:var(--font-sans);font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;cursor:pointer}
.mt-foot{text-align:center;font-size:11px;color:var(--vino-light);margin-top:16px;letter-spacing:.5px}
</style>`;

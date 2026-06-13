// ════════════════════════════════════════════════════════════
// COSEC-SYNC — Supabase Edge Function
// Pulls daily attendance from the Matrix COSEC API (face recognition
// terminals) and upserts first-in / last-out per employee into the
// `attendance` table. Credentials live in function secrets, never
// in the app or this repo.
//
// Deploy name: cosec-sync
// Secrets required (Edge Functions → cosec-sync → Secrets):
//   COSEC_URL   = http://skelmore.fortiddns.com:8000/cosec/api.svc/v2/attendance-daily?action=get
//   COSEC_USER  = <api username>
//   COSEC_PASS  = <api password>
//
// Call patterns:
//   POST /functions/v1/cosec-sync                 → throttled sync (skips if <5 min since last)
//   POST /functions/v1/cosec-sync?force=1         → sync now
//   POST /functions/v1/cosec-sync?debug=1         → sync now + return raw COSEC response (first 4000 chars)
// ════════════════════════════════════════════════════════════

import { createClient } from "jsr:@supabase/supabase-js@2";

const THROTTLE_MS = 5 * 60 * 1000;

function dubaiNow(): Date {
  // Dubai = UTC+4, no DST
  return new Date(Date.now() + 4 * 60 * 60 * 1000);
}
function dubaiToday(): string {
  return dubaiNow().toISOString().substring(0, 10);
}

// Extract all HH:MM occurrences from a string
function extractTimes(s: string): string[] {
  const out: string[] = [];
  const re = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1].padStart(2, "0") + ":" + m[2]);
  }
  return out;
}

// Normalise a date string from COSEC (dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd) → yyyy-mm-dd
function normDate(s: string): string | null {
  if (!s) return null;
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  return null;
}

interface Rec { emp_id: string; att_date: string; times: string[] }

// Parse the COSEC response into records, tolerating JSON, XML, or delimited text
function parseCosec(raw: string): Rec[] {
  const recs: Rec[] = [];
  const today = dubaiToday();
  raw = raw.trim();

  // ── JSON ──
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const j = JSON.parse(raw);
      const arr = Array.isArray(j) ? j
        : Array.isArray(j["attendance-daily"]) ? j["attendance-daily"]
        : Array.isArray(j.data) ? j.data
        : Array.isArray(j.records) ? j.records : [j];
      for (const o of arr) {
        if (typeof o !== "object" || !o) continue;
        let id = "", date: string | null = null;
        const times: string[] = [];
        for (const [k, v] of Object.entries(o)) {
          const key = k.toLowerCase().replace(/[^a-z]/g, "");
          const val = String(v ?? "");
          if (!id && (key === "userid" || key === "user" || key === "empid" || key === "employeeid" || key === "id")) id = val.trim();
          else if (!date && (key.includes("date"))) date = normDate(val);
          else times.push(...extractTimes(val));
        }
        if (id) recs.push({ emp_id: id, att_date: date || today, times });
      }
      return recs;
    } catch (_) { /* fall through */ }
  }

  // ── XML ──
  if (raw.startsWith("<")) {
    const blocks = raw.match(/<(?:row|record|attendance[^>\s]*)\b[\s\S]*?<\/(?:row|record|attendance[^>\s]*)>/gi) || [raw];
    for (const b of blocks) {
      const idm = b.match(/<\s*(?:userid|user_id|empid|employee_id)\s*>\s*([^<]+)</i);
      const dm = b.match(/<\s*[^>]*date[^>]*>\s*([^<]+)</i);
      if (!idm) continue;
      const stripped = b.replace(/<\s*[^>]*date[^>]*>[^<]*<\/[^>]+>/gi, "");
      recs.push({ emp_id: idm[1].trim(), att_date: (dm && normDate(dm[1])) || today, times: extractTimes(stripped) });
    }
    return recs;
  }

  // ── Delimited text (header line + rows) ──
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 1) return recs;
  const delims = ["|", "\t", ";", ","];
  let delim = "|";
  let best = 0;
  for (const d of delims) {
    const c = lines[0].split(d).length;
    if (c > best) { best = c; delim = d; }
  }
  const header = lines[0].split(delim).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const idIdx = header.findIndex((h) => h === "userid" || h === "user" || h === "empid" || h === "employeeid");
  const dateIdx = header.findIndex((h) => h.includes("date"));
  const startRow = idIdx >= 0 ? 1 : 0;
  for (let i = startRow; i < lines.length; i++) {
    const cells = lines[i].split(delim);
    let id: string, date: string | null = null;
    let timeSrc: string[];
    if (idIdx >= 0) {
      id = (cells[idIdx] || "").trim();
      if (dateIdx >= 0) date = normDate(cells[dateIdx] || "");
      timeSrc = cells.filter((_, ci) => ci !== idIdx && ci !== dateIdx);
    } else {
      // no header — assume first numeric-ish cell is the user id
      id = (cells[0] || "").trim();
      timeSrc = cells.slice(1);
    }
    if (!id || !/\d/.test(id)) continue;
    const times: string[] = [];
    for (const c of timeSrc) times.push(...extractTimes(c));
    recs.push({ emp_id: id, att_date: date || today, times });
  }
  return recs;
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const debug = url.searchParams.get("debug") === "1";

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    // Throttle
    const { data: state } = await sb.from("cosec_sync_state").select("*").eq("id", 1).maybeSingle();
    if (!force && !debug && state?.last_sync) {
      const age = Date.now() - new Date(state.last_sync).getTime();
      if (age < THROTTLE_MS) {
        return json({ ok: true, skipped: true, last_sync: state.last_sync, last_status: state.last_status });
      }
    }

    const cosecUrl = Deno.env.get("COSEC_URL");
    const user = Deno.env.get("COSEC_USER");
    const pass = Deno.env.get("COSEC_PASS");
    if (!cosecUrl || !user || !pass) {
      return json({ ok: false, error: "Missing COSEC_URL / COSEC_USER / COSEC_PASS secrets" }, 500);
    }

    const res = await fetch(cosecUrl, {
      headers: { Authorization: "Basic " + btoa(user + ":" + pass) },
      signal: AbortSignal.timeout(20000),
    });
    const raw = await res.text();

    if (!res.ok) {
      await sb.from("cosec_sync_state").upsert({
        id: 1, last_sync: new Date().toISOString(),
        last_status: "HTTP " + res.status, last_raw: raw.substring(0, 4000),
      });
      return json({ ok: false, error: "COSEC HTTP " + res.status, raw: debug ? raw.substring(0, 4000) : undefined }, 502);
    }

    const recs = parseCosec(raw);
    let upserted = 0;
    if (recs.length) {
      const rows = recs.map((r) => {
        const sorted = [...r.times].sort();
        return {
          emp_id: r.emp_id.replace(/^0+(?=\d{3})/, (m) => m), // keep leading zeros as-is
          att_date: r.att_date,
          first_in: sorted[0] || null,
          last_out: sorted.length > 1 ? sorted[sorted.length - 1] : null,
          punch_count: sorted.length,
          punches: sorted,
          synced_at: new Date().toISOString(),
        };
      });
      const up = await sb.from("attendance").upsert(rows, { onConflict: "emp_id,att_date" });
      if (up.error) throw new Error("Upsert failed: " + up.error.message);
      upserted = rows.length;
    }

    const status = "ok: " + recs.length + " records, " + upserted + " upserted";
    await sb.from("cosec_sync_state").upsert({
      id: 1, last_sync: new Date().toISOString(),
      last_status: status,
      last_raw: (recs.length ? "" : "UNPARSED → ") + raw.substring(0, 4000),
    });

    return json({
      ok: true, records: recs.length, upserted,
      sample: recs.slice(0, 3),
      raw: debug ? raw.substring(0, 4000) : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("cosec_sync_state").upsert({
      id: 1, last_sync: new Date().toISOString(), last_status: "error: " + msg,
    }).then(() => {}, () => {});
    return json({ ok: false, error: msg }, 500);
  }
});

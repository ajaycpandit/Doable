// Supabase Edge Function: fetches each of a household's saved external
// calendar feeds (Google's "secret address in iCal format" or Apple's
// "Public Calendar" link) and caches their events for read-only display
// on the Doable calendar. Only Doable's own frontend calls this (with the
// signed-in user's session) — deploy WITHOUT --no-verify-jwt, unlike
// ical-feed, since there's no need for outside callers here.
//
// Deploy: supabase functions deploy sync-external-calendar

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Minimal ICS parser covering what Google/Apple exports actually contain
// for this use case. Deliberately does NOT expand RRULE (recurring
// events) — a recurring event will appear once, on its original date.
function parseIcsEvents(ics: string): Array<{ uid: string; title: string; date: string; time: string | null }> {
  const events: Array<{ uid: string; title: string; date: string; time: string | null }> = [];
  const blocks = ics.split("BEGIN:VEVENT").slice(1);

  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0];
    const lines = body.split(/\r\n|\n|\r/).map((l) => l.trimEnd());

    // Unfold lines: a line starting with a space/tab continues the previous line
    const unfolded: string[] = [];
    for (const line of lines) {
      if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
        unfolded[unfolded.length - 1] += line.slice(1);
      } else {
        unfolded.push(line);
      }
    }

    let uid = "";
    let title = "";
    let date = "";
    let time: string | null = null;

    for (const line of unfolded) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const keyPart = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1);
      const key = keyPart.split(";")[0];

      if (key === "UID") uid = value;
      else if (key === "SUMMARY") title = value.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").replace(/\\\\/g, "\\");
      else if (key === "DTSTART") {
        const isDateOnly = keyPart.includes("VALUE=DATE") && !keyPart.includes("VALUE=DATE-TIME");
        const digits = value.replace(/[^0-9T]/g, "");
        if (isDateOnly || digits.length === 8) {
          date = `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`;
        } else {
          date = `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`;
          const t = digits.split("T")[1];
          if (t && t.length >= 6) time = `${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`;
        }
      }
    }

    if (uid && date) events.push({ uid, title: title || "(untitled event)", date, time });
  }

  return events;
}

Deno.serve(async (req) => {
  try {
    // A body with household_id syncs just that household (used by the
    // "Sync now" button). No household_id (or an empty body, as the
    // scheduled cron job sends) means sync every household's calendars —
    // this is what makes background auto-sync possible.
    let household_id: string | undefined;
    try {
      const body = await req.json();
      household_id = body?.household_id;
    } catch { /* empty body from cron is fine */ }

    const supabase = createClient(supabaseUrl, serviceKey);

    const calQuery = supabase.from("external_calendars").select("*");
    const { data: calendars, error: calErr } = household_id
      ? await calQuery.eq("household_id", household_id)
      : await calQuery;

    if (calErr) return new Response(JSON.stringify({ error: calErr.message }), { status: 500 });

    const results: Array<{ label: string; ok: boolean; count?: number; error?: string }> = [];

    for (const cal of calendars || []) {
      try {
        const fetchUrl = cal.feed_url.replace(/^webcal:\/\//i, "https://");
        const resp = await fetch(fetchUrl);
        if (!resp.ok) throw new Error(`Feed returned HTTP ${resp.status}`);
        const text = await resp.text();
        const events = parseIcsEvents(text);

        for (const ev of events) {
          await supabase.from("external_events").upsert({
            external_calendar_id: cal.id,
            household_id: cal.household_id,
            uid: ev.uid,
            title: ev.title,
            event_date: ev.date,
            event_time: ev.time,
          }, { onConflict: "external_calendar_id,uid" });
        }

        await supabase.from("external_calendars").update({
          last_synced_at: new Date().toISOString(), last_sync_error: null,
        }).eq("id", cal.id);

        results.push({ label: cal.label, ok: true, count: events.length });
      } catch (e) {
        await supabase.from("external_calendars").update({
          last_synced_at: new Date().toISOString(), last_sync_error: String(e),
        }).eq("id", cal.id);
        results.push({ label: cal.label, ok: false, error: String(e) });
      }
    }

    return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});

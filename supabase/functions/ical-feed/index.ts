// Supabase Edge Function: serves a household's tasks as a standard .ics
// feed, so any calendar app (Google, Apple, Outlook) can subscribe to it
// directly by URL. Deploy with: supabase functions deploy ical-feed --no-verify-jwt
// (--no-verify-jwt is required — calendar apps can't send an auth header,
// so this function checks its own token in the query string instead.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function icsEscape(s: string): string {
  return (s || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function toIcsDate(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

// due_time is "HH:MM:SS" (or null). Combines with due_date into a floating
// local date-time for DTSTART. Floating (no Z, no TZID) means each calendar
// app shows it at that clock time in whatever timezone the viewer is in —
// simplest option, and fine for a household where everyone's in one place.
function toIcsDateTime(isoDate: string, time: string): string {
  const hhmmss = time.length === 5 ? time + ":00" : time;
  return toIcsDate(isoDate) + "T" + hhmmss.replaceAll(":", "");
}

const REMIND_TO_TRIGGER: Record<string, string> = {
  "5m": "-PT5M", "30m": "-PT30M", "1h": "-PT1H", "2h": "-PT2H", "1d": "-P1D",
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const household = url.searchParams.get("household");
  const token = url.searchParams.get("token");

  if (!household || !token) {
    return new Response("Missing household or token parameter", { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: hh, error: hhErr } = await supabase
    .from("households")
    .select("id, name, calendar_token")
    .eq("id", household)
    .single();

  if (hhErr || !hh || hh.calendar_token !== token) {
    return new Response("Not found", { status: 404 });
  }

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, notes, due_date, due_time, status, assigned_to, remind_before")
    .eq("household_id", household)
    .not("due_date", "is", null);

  const { data: members } = await supabase
    .from("members")
    .select("id, display_name")
    .eq("household_id", household);

  const nameById: Record<string, string> = {};
  (members || []).forEach((m: any) => { nameById[m.id] = m.display_name; });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Household Tasks//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEscape(hh.name)} Tasks`,
  ];

  (tasks || []).forEach((t: any) => {
    const who = t.assigned_to ? (nameById[t.assigned_to] || "Someone") : "Unassigned";
    const hasTime = !!t.due_time;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${t.id}@household-tasks`);
    lines.push(`DTSTAMP:${stamp}`);
    if (hasTime) {
      lines.push(`DTSTART:${toIcsDateTime(t.due_date, t.due_time)}`);
      lines.push("DURATION:PT30M");
    } else {
      lines.push(`DTSTART;VALUE=DATE:${toIcsDate(t.due_date)}`);
    }
    lines.push(`SUMMARY:${icsEscape(t.title)}${t.status === "done" ? " (done)" : ""}`);
    lines.push(`DESCRIPTION:${icsEscape((t.notes ? t.notes + " — " : "") + "assigned to " + who)}`);
    const trigger = REMIND_TO_TRIGGER[t.remind_before];
    if (trigger && t.status !== "done") {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${icsEscape(t.title)}`);
      lines.push(`TRIGGER:${trigger}`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
});

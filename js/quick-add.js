const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const $ = (sel) => document.querySelector(sel);

let household = null;
let members = [];
let selectedWhen = "today";

function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

async function init() {
  const { data: { user } } = await sb.auth.getUser();
  $("#qa-loading").classList.add("hidden");

  if (!user) { $("#qa-signedout").classList.remove("hidden"); return; }

  const { data: myMember } = await sb.from("members").select("*").eq("auth_user_id", user.id).maybeSingle();
  if (!myMember) { $("#qa-signedout").classList.remove("hidden"); return; }

  const { data: hh } = await sb.from("households").select("*").eq("id", myMember.household_id).single();
  household = hh;

  const { data: mems } = await sb.from("members").select("*").eq("household_id", hh.id).order("created_at");
  members = mems || [];

  const lastActiveId = localStorage.getItem("active_member_" + hh.id) || myMember.id;
  const select = $("#qa-assignee");
  select.innerHTML = members.map(m => `<option value="${m.id}" ${m.id === lastActiveId ? "selected" : ""}>${m.display_name}</option>`).join("");

  $("#qa-subtitle").textContent = `Adding to ${hh.name}`;
  $("#qa-form").classList.remove("hidden");
  $("#qa-input").focus();
}

document.querySelectorAll(".qa-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".qa-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    selectedWhen = chip.dataset.when;
  });
});

$("#qa-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#qa-input").value.trim();
  if (!title) return;

  let due_date = null;
  if (selectedWhen === "today") due_date = daysFromNow(0);
  else if (selectedWhen === "tomorrow") due_date = daysFromNow(1);

  const assigned_to = $("#qa-assignee").value || null;

  const { error } = await sb.from("tasks").insert({
    household_id: household.id, title, category: "chore",
    assigned_to, created_by: assigned_to, due_date, recurrence: "none",
    remind_before: "none", points: 10,
  });

  const confirm = $("#qa-confirm");
  if (error) {
    confirm.style.color = "#A32D2D";
    confirm.textContent = "Couldn't add task — try again.";
  } else {
    confirm.style.color = "var(--success)";
    confirm.textContent = `Added "${title}"`;
    $("#qa-input").value = "";
    $("#qa-input").focus();
  }
  setTimeout(() => { confirm.textContent = ""; }, 2500);
});

init();

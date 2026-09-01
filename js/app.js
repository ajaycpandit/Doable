const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const COLORS = ["#7F77DD", "#D85A30", "#1D9E75", "#D4537E", "#378ADD", "#EF9F27"];
const THEMES = [
  { id: "bold", label: "Bold", dot: "#D85A30" },
  { id: "minimal", label: "Minimal", dot: "#2C2C2A" },
  { id: "playful", label: "Playful", dot: "#7F77DD" },
  { id: "dark", label: "Dark", dot: "#1D9E75" },
  { id: "pastel", label: "Pastel", dot: "#D4537E" },
  { id: "ocean", label: "Ocean", dot: "#378ADD" },
];

let state = {
  authUser: null,
  household: null,
  members: [],
  activeMemberId: null,
  tasks: [],
  history: [],
  tab: "home",
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

function show(idToShow) {
  ["auth-view", "app-view"].forEach(id => $("#" + id).classList.toggle("hidden", id !== idToShow));
}

function applyTheme(themeId) {
  document.body.dataset.theme = themeId || "bold";
}

// ---------------- Auth ----------------

$("#tab-signin").addEventListener("click", () => setAuthMode("signin"));
$("#tab-signup").addEventListener("click", () => setAuthMode("signup"));
$("#tab-join").addEventListener("click", () => setAuthMode("join"));

function setAuthMode(mode) {
  ["signin", "signup", "join"].forEach(m => {
    $("#tab-" + m).classList.toggle("active", m === mode);
    $("#" + m + "-form").classList.toggle("hidden", m !== mode);
  });
}

$("#signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#signin-email").value.trim();
  const password = $("#signin-password").value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return authError("#signin-error", error.message);
});

$("#signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#signup-email").value.trim();
  const password = $("#signup-password").value;
  const householdName = $("#signup-household").value.trim();
  const yourName = $("#signup-name").value.trim();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return authError("#signup-error", error.message);
  const userId = data.user?.id;
  if (!userId) return authError("#signup-error", "Check your email to confirm your account, then sign in.");
  const { data: hh, error: hhErr } = await sb.from("households").insert({ name: householdName }).select().single();
  if (hhErr) return authError("#signup-error", hhErr.message);
  const { error: memErr } = await sb.from("members").insert({
    household_id: hh.id, auth_user_id: userId, display_name: yourName || "Parent",
    avatar_color: COLORS[0], is_kid: false,
  });
  if (memErr) return authError("#signup-error", memErr.message);
  await boot();
});

$("#join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#join-email").value.trim();
  const password = $("#join-password").value;
  const yourName = $("#join-name").value.trim();
  const code = $("#join-code").value.trim();
  const { data: hh, error: hhErr } = await sb.from("households").select("*").eq("invite_code", code).single();
  if (hhErr || !hh) return authError("#join-error", "Invite code not found.");
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return authError("#join-error", error.message);
  const userId = data.user?.id;
  if (!userId) return authError("#join-error", "Check your email to confirm your account, then sign in.");
  const { error: memErr } = await sb.from("members").insert({
    household_id: hh.id, auth_user_id: userId, display_name: yourName || "Parent",
    avatar_color: COLORS[1], is_kid: false,
  });
  if (memErr) return authError("#join-error", memErr.message);
  await boot();
});

function authError(sel, msg) { const n = $(sel); n.textContent = msg; n.classList.remove("hidden"); }

$("#signout-btn").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

// ---------------- Boot / data loading ----------------

async function boot() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { show("auth-view"); return; }
  state.authUser = user;

  const { data: myMember } = await sb.from("members").select("*").eq("auth_user_id", user.id).maybeSingle();
  if (!myMember) { show("auth-view"); return; }

  const { data: hh } = await sb.from("households").select("*").eq("id", myMember.household_id).single();
  state.household = hh;

  const { data: members } = await sb.from("members").select("*").eq("household_id", hh.id).order("created_at");
  state.members = members || [];
  state.activeMemberId = localStorage.getItem("active_member_" + hh.id) || myMember.id;

  applyTheme(currentMember()?.theme);
  $("#household-name").textContent = hh.name;
  $("#invite-code").textContent = hh.invite_code;

  await loadTasks();
  await loadHistory();
  renderAll();
  show("app-view");
}

function currentMember() { return state.members.find(m => m.id === state.activeMemberId); }

async function loadTasks() {
  const { data } = await sb.from("tasks").select("*").eq("household_id", state.household.id)
    .order("due_date", { ascending: true, nullsFirst: false });
  state.tasks = data || [];
}

async function loadHistory() {
  const { data } = await sb.from("task_history").select("*").eq("household_id", state.household.id)
    .order("occurred_at", { ascending: false }).limit(60);
  state.history = data || [];
}

// ---------------- Member switcher ----------------

function renderMemberRow() {
  const row = $("#member-row");
  row.innerHTML = "";
  state.members.forEach(m => {
    const chip = el(`<div class="member-chip ${m.id === state.activeMemberId ? "active" : ""}">
      <div class="avatar" style="background:${m.avatar_color}">${initials(m.display_name)}</div>
      <span>${escapeHtml(m.display_name)}</span></div>`);
    chip.addEventListener("click", () => trySwitch(m));
    row.appendChild(chip);
  });
  const addChip = el(`<div class="member-chip" style="opacity:1"><div class="avatar" style="background:var(--card-bg);color:var(--text-primary);border:1px dashed var(--card-border)">+</div><span>Add</span></div>`);
  addChip.addEventListener("click", openAddMemberModal);
  row.appendChild(addChip);
}

function initials(name) { return (name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase(); }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function trySwitch(member) {
  if (member.id === state.activeMemberId) return;
  if (member.pin) { openPinModal(member); } else { setActiveMember(member.id); }
}

function setActiveMember(id) {
  state.activeMemberId = id;
  localStorage.setItem("active_member_" + state.household.id, id);
  applyTheme(currentMember()?.theme);
  renderAll();
}

function openPinModal(member) {
  let entered = "";
  const backdrop = el(`<div class="modal-backdrop"><div class="modal-sheet">
    <h3>Enter PIN for ${escapeHtml(member.display_name)}</h3>
    <div class="pin-dots">${"0000".split("").map(() => `<div class="pin-dot"></div>`).join("")}</div>
    <div class="pin-pad">${[1,2,3,4,5,6,7,8,9,"","0","del"].map(k => `<button class="pin-key" data-k="${k}">${k === "del" ? "&larr;" : k}</button>`).join("")}</div>
    <button class="btn btn-secondary" id="pin-cancel">Cancel</button>
  </div></div>`);
  document.body.appendChild(backdrop);
  const dots = () => backdrop.querySelectorAll(".pin-dot");
  backdrop.querySelectorAll(".pin-key").forEach(btn => {
    const k = btn.dataset.k;
    if (k === "") return;
    btn.addEventListener("click", () => {
      if (k === "del") { entered = entered.slice(0, -1); }
      else if (entered.length < 4) { entered += k; }
      dots().forEach((d, i) => d.classList.toggle("filled", i < entered.length));
      if (entered.length === 4) {
        if (entered === member.pin) { backdrop.remove(); setActiveMember(member.id); }
        else { entered = ""; dots().forEach(d => d.classList.remove("filled")); backdrop.style.animation = "none"; }
      }
    });
  });
  backdrop.querySelector("#pin-cancel").addEventListener("click", () => backdrop.remove());
}

function openAddMemberModal() {
  const colorSwatches = COLORS.map(c => `<button type="button" class="pin-key color-swatch" data-c="${c}" style="background:${c};height:36px"></button>`).join("");
  const backdrop = el(`<div class="modal-backdrop"><div class="modal-sheet">
    <h3>Add a household member</h3>
    <form id="add-member-form">
      <label>Name</label><input type="text" id="am-name" required>
      <label>Color</label><div class="pin-pad">${colorSwatches}</div>
      <label style="margin-top:14px"><input type="checkbox" id="am-kid" style="width:auto"> Kid profile</label>
      <label>PIN (optional, 4 digits — recommended for kids)</label><input type="text" id="am-pin" maxlength="4" pattern="[0-9]{4}">
      <button class="btn" type="submit">Add member</button>
      <button class="btn btn-secondary" type="button" id="am-cancel">Cancel</button>
    </form>
  </div></div>`);
  document.body.appendChild(backdrop);
  let chosenColor = COLORS[state.members.length % COLORS.length];
  backdrop.querySelectorAll(".color-swatch").forEach(sw => sw.addEventListener("click", () => {
    chosenColor = sw.dataset.c;
    backdrop.querySelectorAll(".color-swatch").forEach(s => s.style.outline = "none");
    sw.style.outline = "2px solid var(--text-primary)";
  }));
  backdrop.querySelector("#am-cancel").addEventListener("click", () => backdrop.remove());
  backdrop.querySelector("#add-member-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#am-name").value.trim();
    const isKid = $("#am-kid").checked;
    const pin = $("#am-pin").value.trim();
    await sb.from("members").insert({
      household_id: state.household.id, display_name: name, avatar_color: chosenColor,
      is_kid: isKid, pin: pin || null,
    });
    const { data: members } = await sb.from("members").select("*").eq("household_id", state.household.id).order("created_at");
    state.members = members || [];
    backdrop.remove();
    renderAll();
  });
}

// ---------------- Tasks ----------------

function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

function nextDueDate(current, recurrence) {
  const d = current ? new Date(current + "T00:00:00") : new Date();
  if (recurrence === "daily") { d.setDate(d.getDate() + 1); }
  else if (recurrence === "weekly") { d.setDate(d.getDate() + 7); }
  else if (recurrence === "weekdays") {
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  }
  return d.toISOString().slice(0, 10);
}

async function completeTask(task) {
  const actor = currentMember();
  await sb.from("tasks").update({ status: "done", completed_at: new Date().toISOString(), completed_by: actor.id }).eq("id", task.id);
  await sb.from("members").update({ points: (actor.points || 0) + task.points }).eq("id", actor.id);
  await sb.from("task_history").insert({
    household_id: state.household.id, task_id: task.id, title: task.title,
    member_id: actor.id, member_name: actor.display_name, action: "completed", points: task.points,
  });
  if (task.recurrence !== "none") {
    await sb.from("tasks").insert({
      household_id: state.household.id, title: task.title, notes: task.notes, category: task.category,
      assigned_to: task.assigned_to, created_by: task.created_by,
      due_date: nextDueDate(task.due_date, task.recurrence), recurrence: task.recurrence, points: task.points,
    });
  }
  actor.points = (actor.points || 0) + task.points;
  await loadTasks(); await loadHistory(); renderAll();
}

async function deleteTask(task) {
  await sb.from("tasks").delete().eq("id", task.id);
  await loadTasks(); renderAll();
}

function taskRow(task) {
  const assignee = state.members.find(m => m.id === task.assigned_to);
  const isDone = task.status === "done";
  const row = el(`<div class="card task-row">
    <div class="check ${isDone ? "done" : ""}">${isDone ? "&#10003;" : ""}</div>
    <div style="flex:1">
      <div class="task-title ${isDone ? "done" : ""}">${escapeHtml(task.title)}</div>
      <div class="task-meta">${assignee ? escapeHtml(assignee.display_name) : "Unassigned"}${task.due_date ? " &middot; " + fmtDate(task.due_date) : ""}${task.recurrence !== "none" ? " &middot; " + task.recurrence : ""}</div>
    </div>
    ${!isDone ? `<div class="task-pts">+${task.points}</div>` : ""}
    <button class="icon-btn task-actions" title="Delete" style="width:28px;height:28px;font-size:13px">&times;</button>
  </div>`);
  if (!isDone) row.querySelector(".check").addEventListener("click", () => completeTask(task));
  row.querySelector(".task-actions").addEventListener("click", () => { if (confirm("Delete this task?")) deleteTask(task); });
  return row;
}

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " (overdue)";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderTasks() {
  const pending = state.tasks.filter(t => t.status === "pending");
  const doneToday = state.tasks.filter(t => t.status === "done" && t.completed_at && t.completed_at.slice(0,10) === new Date().toISOString().slice(0,10));

  const mineFirst = [...pending].sort((a, b) => {
    const am = a.assigned_to === state.activeMemberId ? 0 : 1;
    const bm = b.assigned_to === state.activeMemberId ? 0 : 1;
    return am - bm;
  });

  const list = $("#task-list");
  list.innerHTML = "";
  if (mineFirst.length === 0) list.appendChild(el(`<div class="empty-note">No open tasks. Add one below.</div>`));
  mineFirst.forEach(t => list.appendChild(taskRow(t)));

  const doneList = $("#done-list");
  doneList.innerHTML = "";
  if (doneToday.length === 0) doneList.appendChild(el(`<div class="empty-note">Nothing completed today yet.</div>`));
  doneToday.forEach(t => doneList.appendChild(taskRow(t)));

  // stat strip: today's streak + open count
  const streak = computeStreak();
  $("#stat-streak").textContent = streak + (streak === 1 ? " day" : " days");
  $("#stat-open").textContent = pending.length;
}

function computeStreak() {
  const days = new Set(state.history.filter(h => h.action === "completed").map(h => h.occurred_at.slice(0,10)));
  let streak = 0;
  let cursor = new Date();
  while (true) {
    const iso = cursor.toISOString().slice(0,10);
    if (days.has(iso)) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else if (streak === 0 && iso === new Date().toISOString().slice(0,10)) { cursor.setDate(cursor.getDate() - 1); continue; }
    else break;
  }
  return streak;
}

$("#add-task-btn").addEventListener("click", openAddTaskModal);

function openAddTaskModal() {
  const options = state.members.map(m => `<option value="${m.id}">${escapeHtml(m.display_name)}</option>`).join("");
  const backdrop = el(`<div class="modal-backdrop"><div class="modal-sheet">
    <h3>New task</h3>
    <form id="add-task-form">
      <label>Title</label><input type="text" id="at-title" required>
      <label>Notes (optional)</label><textarea id="at-notes"></textarea>
      <label>Category</label><select id="at-category"><option value="chore">Chore</option><option value="task">Task</option></select>
      <label>Assign to</label><select id="at-assignee"><option value="">Unassigned</option>${options}</select>
      <label>Due date</label><input type="date" id="at-due" value="${daysFromNow(0)}">
      <label>Repeats</label><select id="at-recurrence">
        <option value="none">Doesn't repeat</option><option value="daily">Daily</option>
        <option value="weekdays">Weekdays</option><option value="weekly">Weekly</option></select>
      <label>Points</label><input type="text" id="at-points" value="10">
      <button class="btn" type="submit">Add task</button>
      <button class="btn btn-secondary" type="button" id="at-cancel">Cancel</button>
    </form>
  </div></div>`);
  document.body.appendChild(backdrop);
  backdrop.querySelector("#at-cancel").addEventListener("click", () => backdrop.remove());
  backdrop.querySelector("#add-task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const points = parseInt($("#at-points").value, 10) || 10;
    await sb.from("tasks").insert({
      household_id: state.household.id, title: $("#at-title").value.trim(), notes: $("#at-notes").value.trim() || null,
      category: $("#at-category").value, assigned_to: $("#at-assignee").value || null, created_by: state.activeMemberId,
      due_date: $("#at-due").value || null, recurrence: $("#at-recurrence").value, points,
    });
    backdrop.remove();
    await loadTasks(); renderAll();
  });
}

// ---------------- Leaderboard / history / settings ----------------

function renderLeaderboard() {
  const box = $("#leaderboard");
  box.innerHTML = "";
  const sorted = [...state.members].sort((a, b) => (b.points || 0) - (a.points || 0));
  sorted.forEach((m, i) => {
    box.appendChild(el(`<div class="leader-row">
      <div class="rank">${i + 1}</div>
      <div class="avatar" style="background:${m.avatar_color};width:30px;height:30px;font-size:12px">${initials(m.display_name)}</div>
      <div class="name">${escapeHtml(m.display_name)}</div>
      <div class="pts">${m.points || 0} pts</div>
    </div>`));
  });
}

function renderHistory() {
  const box = $("#history-list");
  box.innerHTML = "";
  if (state.history.length === 0) box.appendChild(el(`<div class="empty-note">No activity yet.</div>`));
  state.history.forEach(h => {
    const when = new Date(h.occurred_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    box.appendChild(el(`<div class="card" style="padding:10px 14px">
      <div style="font-size:13px"><strong>${escapeHtml(h.member_name || "Someone")}</strong> completed <strong>${escapeHtml(h.title)}</strong> ${h.points ? `(+${h.points} pts)` : ""}</div>
      <div class="task-meta">${when}</div>
    </div>`));
  });
}

function renderThemeGrid() {
  const grid = $("#theme-grid");
  grid.innerHTML = "";
  const me = currentMember();
  THEMES.forEach(t => {
    const sw = el(`<div class="theme-swatch ${me?.theme === t.id ? "active" : ""}">
      <div class="swatch-dot" style="background:${t.dot}"></div>${t.label}</div>`);
    sw.addEventListener("click", async () => {
      await sb.from("members").update({ theme: t.id }).eq("id", me.id);
      me.theme = t.id;
      applyTheme(t.id);
      renderThemeGrid();
    });
    grid.appendChild(sw);
  });
}

// ---------------- Tabs ----------------

$$(".tabbar .tab-btn").forEach(btn => btn.addEventListener("click", () => {
  state.tab = btn.dataset.tab;
  renderAll();
}));

$("#settings-btn").addEventListener("click", () => { state.tab = "settings"; renderAll(); });

function renderAll() {
  renderMemberRow();
  $$(".tabbar .tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
  ["home", "history", "settings"].forEach(t => $("#panel-" + t).classList.toggle("hidden", t !== state.tab));
  if (state.tab === "home") { renderTasks(); renderLeaderboard(); }
  if (state.tab === "history") renderHistory();
  if (state.tab === "settings") renderThemeGrid();
}

// ---------------- Init ----------------

sb.auth.onAuthStateChange((_event, _session) => { boot(); });
boot();

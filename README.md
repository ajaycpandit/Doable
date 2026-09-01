# Household Tasks

A multi-user household task manager: chores, recurring tasks, due dates,
per-person assignment, points, a leaderboard, streaks, completion history,
and a 6-style theme picker. Vanilla JS + Supabase (Postgres + Auth) — same
stack pattern as your Shvaan Pet Care app. No server to run; free tier
covers a household easily.

## 1. Create a Supabase project

1. Go to https://supabase.com, sign in, click "New project".
2. Once it's ready, open **SQL Editor** → **New query**, paste the
   contents of `schema.sql`, and run it. This creates the tables and
   row-level-security policies (each household can only see its own data).
3. Open **Project Settings → API**. Copy the **Project URL** and the
   **anon public** key.

## 2. Configure the app

Open `js/config.js` and paste in your values:

```js
window.SUPABASE_URL = "https://xxxxxxxx.supabase.co";
window.SUPABASE_ANON_KEY = "eyJ...";
```

The anon key is safe to ship in a static frontend — it's constrained by
the row-level-security policies in `schema.sql`, not a secret admin key.

## 3. Turn off email confirmation (optional, recommended for a household app)

Supabase requires email confirmation by default, which is annoying for
kid profiles that share the household login flow. In your Supabase
project: **Authentication → Providers → Email → toggle off "Confirm
email"**. If you'd rather keep it on, everyone just needs to click the
confirmation link the first time they sign up.

## 4. Deploy

Any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages).
For GitHub Pages, same as Shvaan:

```bash
git init
git add .
git commit -m "Household tasks app"
git branch -M main
git remote add origin https://github.com/<you>/household-tasks.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Deploy from branch → main → /(root)**.

## How it works

- **One login per household** — sign up once (creates a household +
  your member profile). A second adult can join with the household's
  invite code (shown in Settings) using their own email/password.
- **Kid profiles** live inside the household without their own login —
  add them from the `+` chip in the member row, optionally with a 4-digit
  PIN. Tapping a profile with a PIN prompts for it before switching.
- **Recurring tasks**: when a `daily` / `weekly` / `weekdays` task is
  completed, the app automatically creates the next occurrence.
- **Points & leaderboard**: completing a task adds its points to whoever
  is the active profile at the time.
- **Streak**: counts consecutive days with at least one completed task,
  household-wide.
- **Themes**: 6 built-in styles (Bold, Minimal, Playful, Dark, Pastel,
  Ocean) saved per member — everyone in the house can have their own.
  To add a 7th, add a `body[data-theme="yourname"] { ... }` block to
  `css/styles.css` and an entry to the `THEMES` array in `js/app.js`.

## Notes / honest caveats

- This is a solid working MVP, not a hardened production app — there's
  no rate limiting, password reset UI (Supabase handles the email flow
  if you enable it), or offline support.
- The PIN is stored in plain text in the `members` table. Fine for a
  household chore app; don't reuse a real password as a kid's PIN.
- If you want push notifications or a mobile home-screen icon, this can
  be extended into a PWA — say the word and I'll add a manifest + service
  worker.

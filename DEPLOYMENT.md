# AI Balance Supply — deployment

The website code in this repo holds **no planning data**. All data (the 6 workbook
sheets plus the factory master: capacity, yield, holidays) lives in Supabase and
is only sent to users who log in and are listed in `supply_members`.
That is why this repo can be public.

## Pieces

| Part | What it does | Where |
|---|---|---|
| GitHub (this repo) | Website code | `public/`, `scripts/`, `vercel.json` |
| Vercel | Hosts the site, redeploys on every push to `main` | runs `node scripts/build.mjs` |
| Supabase | Login + data + saved plans | `supabase/migrations/*.sql` |

## First-time setup

1. **Supabase**: create a project. In SQL Editor run, in order:
   1. `supabase/migrations/202609250001_supply_backend.sql`
   2. `supabase/seed_baseline.private.sql` (generated locally, never committed)
   3. `supabase/add_members.sql` (edit the emails first)
2. **Supabase → Authentication → URL Configuration**: set Site URL to the Vercel URL.
3. **Vercel**: import this repo, then add Environment Variables
   `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (Supabase → Project Settings → API).
   Never use a `sb_secret_` / service_role key here. Redeploy.

## Updating to a new prototype version or new data

```
python3 scripts/prepare_source.py "factory_planning_v20 (1).html"
```

- `public/index.html` changes → commit and push (safe, no data).
- `supabase/seed_baseline.private.sql` is regenerated → run it in Supabase SQL Editor.
  It overwrites the `baseline` and `master` datasets.

## Never commit

The source `factory_planning_v20*.html`, `*.private.sql`, `result/`, any `.xlsx`/`.csv`.
`.gitignore` blocks these; check `git status` before every commit anyway.

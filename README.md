# College Timetable Generator (v0.1)

React (Vite) frontend · FastAPI backend · Supabase (Postgres) storage.

On one page you enter the working days, periods per day and lunch break, then:

- subjects (periods per week, and whether each is a lab)
- which subjects each teacher can teach
- how many divisions, classrooms and labs there are

The app generates a clash-free timetable. One dropdown switches the view
between any division, teacher or room.

**Design write-up:** see [APPROACH.md](APPROACH.md).

## Rules the generator never breaks

| Rule | Where it is enforced |
|---|---|
| A division has one class per period | solver (bitmask per division) + verifier + DB unique key |
| A teacher is in one place per period | solver (bitmask per teacher) + verifier + DB unique key |
| A room hosts one class per period | solver (bitmask per room) + verifier + DB unique key |
| Lab subjects only in laboratories, theory only in classrooms | solver picks rooms by type + verifier |
| Every subject gets exactly its weekly workload | solver places exactly `workload / block` sessions + verifier |
| No dead end near the end | prechecks + most-constrained-first + forward checking + repair (below) |
| Lab blocks: consecutive periods, same room, never across the break | solver + verifier |

### How it avoids getting stuck at the end

1. **Prechecks** (`validator.py`) reject impossible inputs before any search, with a
   plain-English reason: a division needing more periods than the week has, a
   subject nobody can teach, teachers over capacity, too few labs for the lab blocks, etc.
2. **Most-constrained first**: at every step the solver schedules the subject with
   the least slack (possible slots minus sessions still needed), so scarce labs and
   busy teachers are placed while there is still room.
3. **Forward checking**: after every placement it re-checks that every unfinished
   subject, division, teacher and room type can still fit what is left. If not, it
   undoes that choice at once instead of discovering the dead end later.
4. **Restarts + conflict-directed repair**: if backtracking runs long, it switches to
   a repair search that never tolerates a clash, only moves sessions around.
5. **Independent verifier** (`verifier.py`) re-checks the finished timetable from
   scratch. If it ever found a problem, the API would not return the timetable as valid.

If no timetable exists, the API says so and names the bottleneck ("Labs 100% booked";
"Teacher T2 100% booked") instead of returning a broken timetable.

## Project layout

```
backend/
  app/
    main.py        FastAPI routes
    models.py      request/response models (Pydantic)
    validator.py   input checks, teacher assignment, feasibility prechecks
    solver.py      constraint solver
    verifier.py    independent rule checker
    service.py     validate -> solve -> verify
    db.py          Supabase persistence (REST API via httpx)
    config.py      settings from .env
  samples/sample_input.json
  tests/test_timetable.py
frontend/
  src/App.jsx, src/components/SetupForm.jsx, TimetableView.jsx, src/lib/form.js, src/api.js, src/styles.css
supabase/schema.sql   database tables, constraints, RLS
render.yaml           backend deployment (Render Blueprint)
APPROACH.md           approach, assumptions, architecture, trade-offs, validation
```

## Run locally

### 1. Supabase (database)

1. Create a free project at supabase.com. Pick the region closest to your users (e.g. Mumbai).
2. Dashboard → **SQL Editor** → **New query** → paste all of `supabase/schema.sql` → **Run**.
3. Dashboard → **Project Settings → API Keys**. Copy:
   - the **Project URL** (`https://xxxx.supabase.co`, also under Project Settings → Data API)
   - a **secret key** (`sb_secret_...`). The legacy **service_role** key (`eyJ...`) also works.

Saving is optional. Without Supabase the app still generates timetables; the
"Save" controls are simply hidden.

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then paste your Supabase URL and key
uvicorn app.main:app --reload      # http://127.0.0.1:8000  (API docs at /docs)
pytest -q                          # 16 tests
```

Check it at http://127.0.0.1:8000/api/health. `"storage": "supabase"` means the database is connected.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

In development, Vite forwards `/api` to the backend on port 8000.

## Deploy (free): Supabase + Render + Vercel

Do the Supabase steps above first. Then:

### A. Push to GitHub

```bash
git init && git add . && git commit -m "Timetable generator v0.1"
# Create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/timetable-generator.git
git branch -M main && git push -u origin main
```

`.gitignore` already keeps `.env` files out of the repo. **Never commit your secret key.**

### B. Backend on Render

1. render.com → sign in with GitHub → **New → Blueprint** → select the repo.
   Render reads `render.yaml`: Python 3.11, root `backend/`, and health check `/api/health`.
2. Fill in the values it asks for:
   - `SUPABASE_URL`: your project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: your secret key
   - `CORS_ORIGINS`: leave empty for now (you'll add the Vercel URL in step D)
3. **Apply**. When it's live, open `https://<your-service>.onrender.com/api/health`.
   You should see `{"ok":true,"storage":"supabase"}`.

### C. Frontend on Vercel

1. vercel.com → **Add New → Project** → import the repo.
2. **Root Directory:** `frontend`. The framework (Vite) is detected automatically.
3. **Environment Variables:** `VITE_API_URL` = `https://<your-service>.onrender.com` (no trailing slash).
4. **Deploy**. You get a URL like `https://timetable-generator.vercel.app`.

### D. Connect them

1. Render → your service → **Environment** → set `CORS_ORIGINS` to your Vercel URL
   (e.g. `https://timetable-generator.vercel.app`) → **Save**. Render redeploys.
2. If your Vercel project isn't named `timetable-generator`, change `CORS_ORIGIN_REGEX`
   the same way, or delete it.
3. Open the Vercel URL → **Try an example** → **Generate timetable** → **Save**.
   Check that the rows appear in Supabase → **Table Editor → timetables**.

### Troubleshooting

| Symptom | Fix |
|---|---|
| "Can't reach the server" / CORS error in the browser console | `CORS_ORIGINS` on Render must exactly match the Vercel URL: `https`, no trailing slash. |
| First load is slow | Render's free plan sleeps after inactivity; the first request wakes it (up to about a minute). Open the site yourself before a demo. |
| Save fails with 401 "Invalid API key" | Some new projects have had trouble with `sb_secret_` keys. Use the legacy `service_role` key instead (API Keys → Legacy tab). |
| Save fails with 404 / "relation does not exist" | `schema.sql` wasn't run in this Supabase project. |
| Supabase project paused | Free projects pause after about a week without activity. Restore it from the dashboard. |
| Vercel still calls the old API URL | `VITE_` variables are baked in at build time. Redeploy after changing them. |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{ ok, storage: "supabase" \| "off" }` |
| GET | `/api/sample` | example input (4 divisions, 9 subjects incl. 3 labs) |
| POST | `/api/validate` | prechecks only |
| POST | `/api/generate?save=true` | generate (and save if Supabase is configured) |
| GET / POST | `/api/timetables` | list / save |
| GET / DELETE | `/api/timetables/{id}` | open / delete |

`status` in the result is `ok`, `invalid` (input can't work, see `errors`) or
`infeasible` (passes the prechecks but no clash-free arrangement exists).

## Security note

The service_role key bypasses Row Level Security, so it lives only in
`backend/.env` and never goes to the browser. RLS is enabled with no public
policies, so the tables can't be read with the public anon key. There is no
login in v0.1: anyone who can reach the backend can generate, save and delete.
Add Supabase Auth before deploying publicly.

## Ideas for v0.2

- Lab batches (B1/B2/B3 of a division in different labs at the same time)
- Teacher unavailable slots and preferred free days
- Per-division subject lists and workloads in the UI (the API already supports
  `divisions[].subjects`)
- Manual drag-and-drop edits, re-verified on drop
- Excel/PDF export

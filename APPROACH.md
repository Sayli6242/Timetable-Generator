# Approach Note: Intelligent Timetable Generator (Assignment 3)

## 1. Problem understanding

A college has to fit many divisions, subjects, teachers and rooms into a fixed
weekly grid of days × periods. Doing it by hand is slow, and it goes wrong in
predictable ways:

- a teacher is booked in two divisions at the same time,
- two divisions are given the same room,
- a practical ends up in a lecture hall,
- a subject gets more or fewer periods than its syllabus workload,
- the timetable looks almost done, but the last few classes won't fit anywhere.

The last point matters most. A "greedy" generator that places classes one by
one fills the easy slots first and then gets stuck at the end. So the real
problem is not "fill a grid" but **"find an arrangement that satisfies every rule,
or prove there isn't one and tell the user why."**

## 2. Users and workflow

**Primary user:** the timetable coordinator or HOD who prepares the timetable
each semester. They know the subjects, workloads, faculty and rooms, but not how
the scheduling works inside.

The UI is deliberately two screens, so a coordinator needs no training.

1. **Setup (one page):**
   - **Week:** working days, periods per day, lunch break.
   - **Subjects:** name, periods per week, and a "Lab?" tick. Labs run as 2-period blocks.
   - **Teachers:** tap the subjects each teacher can teach.
   - **Divisions, classrooms and labs:** each has a "How many?" box and name fields.

   A live line shows "each division needs X of Y periods." The first blocking problem
   (e.g. "There are lab subjects but no laboratories") appears next to the Generate
   button, and the button stays disabled until it's fixed.
2. **Result:** one dropdown switches between any division, teacher or room. The grid shows
   subject plus teacher/room (or division), lab blocks span their periods, and lunch is marked.
   Actions: Download (CSV), Print, Save.
3. **Saved:** list, reopen or delete saved timetables.

Extra options exist in the API but are kept out of the UI for simplicity: a teacher's
daily maximum, lab block lengths other than 2, fixed teacher assignments, per-division
subject lists and the solver time limit.

## 3. Assumptions

| # | Assumption | Why |
|---|---|---|
| A1 | Every division takes every subject with the same weekly workload. | Typical for one year of one programme. The API already accepts a per-division subject list. |
| A2 | A lab subject is taught in blocks of consecutive periods (default 2), all in one lab room, never across the lunch break. | That's how practicals run. |
| A3 | Each division–subject pair has **one** teacher for the whole week. | Students expect the same faculty for a subject. |
| A4 | The user says which subjects a teacher *can* teach; the system chooses *who* teaches which division and balances the load. | Coordinators know qualifications; balancing load by hand is the tedious part. |
| A5 | A whole division attends a lab together (no batches). | Keeps v1 simple. Batches are the top item for the next version. |
| A6 | Rooms have two types: classroom and laboratory. Capacity isn't modelled. | Enough for the "lab only in a lab" rule. Capacity is an easy addition. |
| A7 | A subject's sessions are spread across the week: at most ⌈sessions ÷ days⌉ per day. | Avoids three Maths lectures on Monday. |
| A8 | No login in v1. | Prototype scope. Supabase Auth is the natural next step. |

## 4. Architecture

```
React (Vite) on Vercel ──HTTPS/JSON──▶ FastAPI on Render ──REST──▶ Supabase Postgres
  one-page form, live checks             validate → plan → solve        timetables (jsonb)
  division/teacher/room view             → verify → save                timetable_entries (rows)
```

- **Frontend (React):** form state, instant input checks, timetable grid views. It has no
  database access and no secrets.
- **Backend (FastAPI):** all scheduling logic, and the only component holding the Supabase key.
  - `validator.py`: input checks, teacher assignment, feasibility prechecks
  - `solver.py`: the search
  - `verifier.py`: independent re-check of the finished timetable
  - `db.py`: persistence
- **Database (Supabase Postgres):**
  - `timetables` stores the full input and result as JSON, so a timetable reopens exactly as generated.
  - `timetable_entries` stores one row per class, so it can be queried with SQL.

## 5. How the generator works

### 5.1 Rules it must never break

1. A division has at most one class per period.
2. A teacher teaches at most one class per period.
3. A room hosts at most one class per period.
4. Lab subjects only in laboratories; theory only in classrooms.
5. Every division–subject gets **exactly** its weekly workload.
6. Lab blocks use consecutive periods on one day, in one room, not across the break.
7. A teacher's optional daily maximum is respected.

### 5.2 Pipeline

1. **Validate and precheck (before any search).**
   - Structure: duplicate names, unknown subjects, a lab workload that isn't a multiple of its block.
   - Capacity per division, per teacher and per room type. Labs are counted in whole blocks per
     half-day, because a block can't straddle the break.
   - Teacher assignment: the hardest pairs go first (fewest qualified teachers, heaviest workload),
     and each goes to the qualified teacher with the lowest share of their capacity used.

   Most impossible inputs are caught here in milliseconds, with a message naming the cause.

2. **Solve: backtracking search designed not to get stuck at the end.**
   - **Bitmask occupancy:** each division, teacher and room has one integer whose bits are the
     week's periods. Checking a slot against all three rules is a few bitwise operations.
   - **Most-constrained first:** at each step it schedules the subject with the **least slack**
     (slots still possible minus sessions still needed). Scarce labs and busy teachers are placed
     while there's still room.
   - **Forward checking:** after every placement it re-checks that every unfinished subject,
     division, teacher and room type can still fit what it has left. If one can't, it undoes
     that placement immediately instead of finding the dead end twenty steps later.
     *This is what stops the "impossible near the end" failure.*
   - **Restarts, then repair:** if the search runs long, it restarts with a different tie-break
     order. After that it switches to conflict-directed repair: move a class to the slot that
     clashes with the fewest others, un-place those, and retry them. It never keeps a clash.
   - **Polish:** a final hill-climb reduces idle gaps in division and teacher days. Every move
     is re-checked against the hard rules.

3. **Verify independently.** `verifier.py` shares no code with the solver. It re-reads the plain
   list of entries and re-tests every rule from scratch. If it finds any problem, the API
   refuses to call the timetable valid.

4. **Database as the final guard.** Unique keys on (timetable, division, day, period),
   (timetable, teacher, day, period) and (timetable, room, day, period) mean even a buggy
   client can't store a clash.

### 5.3 Impossible or conflicting constraints: how users are told

The result has one of three statuses, each explained in plain language:

| Status | Meaning | Example message |
|---|---|---|
| `invalid` | The input can't work, found before solving | "Division 'SE-A' needs 45 periods a week but only 42 exist (6 days × 7 periods)." · "No teacher can teach 'Economics'." · "14 lab sessions of 2 periods are needed but 1 lab can host only 12 such sessions a week." |
| `infeasible` | Passes every capacity check, yet no clash-free arrangement exists | "Every arrangement was tried and none satisfies all the rules. Bottlenecks: Teacher T2 100% booked; Labs 100% booked." It also lists which sessions couldn't be placed. |
| `ok` | Timetable found and independently verified | Also shows non-blocking notes, e.g. "Division 'SE-A' will have 15 free periods a week." |

The system **never returns a partial or clashing timetable as if it were valid.** It also
suggests fixes: add a teacher or room, reduce a workload, add a day or a period.

Why two failure types? If no teacher or division has more classes than there are periods,
the lectures can always be arranged (König's edge-colouring theorem), so the capacity
prechecks are complete for plain lectures. Lab blocks and scarce labs break that guarantee,
which is why an `infeasible` case can still slip past the prechecks. The test suite includes
a hand-verified example of this (see §6).

## 6. Validation

- **16 automated tests** (`backend/tests`, run with `pytest`):
  - one per rule: division, teacher and room clashes; lab only in a lab; exact workload; lab blocks
  - a **100%-full week** (every period of every division used), the hardest case for getting stuck
  - a **planted clash** added to a finished timetable, to prove the verifier catches it
  - rejected inputs: overloaded division, labs without a laboratory, a subject with no teacher
  - a small case that is **provably impossible** but passes every precheck: one lab forces two
    divisions' practicals into opposite halves of the day, which leaves teacher T2 busy exactly
    when division X still needs them. The solver reports `infeasible` instead of faking a result.
  - API tests, including saving to Supabase against a mocked REST endpoint
- **Randomised stress test:** 36 generated colleges (2–8 divisions, 5–6 days, 6–8 periods,
  1–3 labs) at 80%, 95% and 100% weekly fill. Every feasible one solved and passed the
  verifier. The only rejections were inputs with too few labs, and each came with a correct message.
- **Browser end-to-end test** (Playwright): fill form → generate → switch views → save → reopen
  from the saved list → delete. Checked the overload guard, no console errors, and phone width.
- **Performance:** the 4-division example college (92 sessions, 3 labs) solves in about 0.25 s locally.

## 7. Edge cases handled

- Duplicate names; a teacher or division referencing an unknown subject
- A lab whose weekly periods aren't a multiple of its block length
- A lab block longer than the longest run of periods without a break
- Lab subjects with no laboratory, or theory subjects with no classroom
- A division's total workload exceeding the week
- A subject nobody can teach; every qualified teacher already at full capacity
- A teacher's daily maximum making their weekly load impossible
- A lunch break set at or after the last period (ignored, with a note)
- A subject with more sessions than working days (allowed, with a note that it repeats on some days)
- Teachers left with no classes (note)
- Search time limit reached: a clear message rather than a hang
- Saving fails (Supabase down or misconfigured): the timetable is still shown with a
  "generated but not saved" notice. A half-written save is rolled back.
- Supabase not configured at all: generation still works and the save controls are hidden.
- Server asleep on free hosting: the UI says it's waking up.

## 8. Key engineering decisions and trade-offs

| Decision | Alternative | Why this choice |
|---|---|---|
| Custom backtracking + forward checking + repair, in pure Python | Google OR-Tools CP-SAT | No heavy native dependency, runs on a free 512 MB host, and every rule is readable in one file. CP-SAT would scale further and optimise soft goals better; the solver sits behind one function, so it can be swapped later. |
| Separate verifier | Trust the solver | A solver bug should never reach a user as a "valid" timetable. |
| Supabase Postgres | SQLite | Free hosts wipe local disk on restart or redeploy, which would delete a SQLite file. Managed Postgres keeps data safe and adds unique constraints and RLS. |
| Backend talks to Supabase; browser never does | Browser uses Supabase directly | The scheduling rules and the secret key stay on the server, RLS blocks public access, and there's a single source of truth. |
| Store the full input and result as JSON **and** one row per class | Only one of the two | JSON makes reopening exact; rows make SQL queries and DB-level clash constraints possible. |
| System assigns teachers from "can teach" lists | User assigns every pair | Less data entry, balanced load, and an explicit "who teaches what" table for review. The API also accepts fixed assignments. |
| Plain `def` endpoint for generation | `async def` | The solver is CPU-bound; FastAPI runs a plain `def` in a worker thread, so the server stays responsive. |

## 9. Limitations and next steps

1. **Lab batches**: B1/B2/B3 of one division in different labs at the same time.
2. **Teacher unavailability and preferences**: e.g. no first period on Saturday.
3. **Manual edits**: drag a class to another slot, re-verified on drop, and "lock" cells
   before regenerating.
4. **Per-division subjects and electives** in the UI (the backend already supports them).
5. **Room capacity** and division size.
6. **Login and roles** (Supabase Auth): a coordinator edits, faculty and students view.
7. **Better day balance**: some days are currently lighter than others. Add it as a soft goal
   (CP-SAT would suit this).

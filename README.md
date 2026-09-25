# College Timetable Generator (v0.1)

A constraint-aware college timetable generator built with React, FastAPI, and optional Supabase/Postgres persistence.

## Overview

The application helps an administrator configure a weekly college timetable and generate a schedule for multiple divisions, subjects, faculty members, classrooms, and laboratories.

The application can generate timetables without Supabase. When Supabase is configured, generated timetables can also be saved and retrieved.

## Features

- Configure working days and time slots.
- Configure lunch or break periods.
- Add subjects and weekly workload.
- Mark subjects as theory or laboratory subjects.
- Define which subjects each teacher can teach.
- Configure the number of divisions, classrooms, and laboratories.
- Generate a weekly timetable.
- Prevent division, teacher, and room conflicts.
- Assign laboratory subjects only to laboratories.
- Assign theory subjects only to classrooms.
- Schedule lab blocks as consecutive periods when configured.
- View the timetable by division, teacher, or room.
- Validate impossible or incomplete input.
- Save and retrieve generated timetables when Supabase is configured.

## Scope of v0.1

This prototype focuses on weekly timetable generation and hard-constraint validation.

The following are outside the scope of v0.1:

- Authentication and user management.
- Teacher unavailable-slot preferences.
- Manual drag-and-drop editing.
- Lab batches such as B1/B2/B3.
- Excel or PDF export.
- Advanced timetable optimization.

These can be added in a future version.

## Technology Stack

- Frontend: React with Vite
- Backend: FastAPI
- Validation and models: Pydantic
- Database: Supabase PostgreSQL, optional
- Database access: Supabase REST API through `httpx`
- Testing: Pytest
- Deployment: Vercel for frontend and Render for backend

## Application Flow

```text
Administrator enters configuration
              ↓
React sends configuration to FastAPI
              ↓
FastAPI validates the input
              ↓
Solver generates a timetable
              ↓
Independent verifier checks the result
              ↓
React displays the timetable
              ↓
Optional: result is saved in Supabase
```

## Inputs

The administrator provides:

- Working days.
- Periods and their timings.
- Break or lunch periods.
- Divisions.
- Subjects.
- Weekly workload for each subject.
- Whether a subject is theory or practical.
- Teachers and the subjects they can teach.
- Number of classrooms.
- Number of laboratories.

### Workload assumption

The workload is provided by the administrator. The system does not calculate workload from semester duration or credits.

In v0.1, the configured subject workload is applied to every division. Per-division subject lists and workloads are planned for a future version.

### Teacher assignment assumption

The system does not automatically assign a second teacher because more teachers are available than subjects. Teacher-subject relationships are provided explicitly. Different divisions may use different qualified teachers for the same subject.

## Hard Constraints

The generator is designed to enforce the following constraints:

| Constraint | Validation |
|---|---|
| One class per division per period | Solver, verifier, and database uniqueness rules |
| One class per teacher per period | Solver, verifier, and database uniqueness rules |
| One class per room per period | Solver, verifier, and database uniqueness rules |
| Laboratory subjects use laboratories | Solver and verifier |
| Theory subjects use classrooms | Solver and verifier |
| Every subject receives its configured workload | Solver and verifier |
| Break slots cannot contain classes | Solver and verifier |
| Lab blocks use consecutive periods | Solver and verifier |

## Scheduling Approach

The scheduler works with complete class sessions. Each session contains:

```text
Division + Subject + Teacher + Room + Day + Period
```

Before placing a session, the application checks whether:

- The division is free.
- The teacher is free.
- The room is free.
- The room type is suitable.
- The selected slot is not a break.
- The subject still has remaining workload.

The solver uses:

1. Input prechecks for obviously impossible configurations.
2. Most-constrained-first ordering for scarce subjects, teachers, and rooms.
3. Forward checking after every placement.
4. Backtracking and retries when a placement creates a dead end.
5. An independent verifier that checks the completed timetable from scratch.

If a valid timetable cannot be created, the API returns an `infeasible` result with an explanation instead of returning a timetable containing conflicts.

## Impossible Input Handling

The application reports useful errors for cases such as:

- A division requires more periods than are available in the week.
- A subject has no eligible teacher.
- A teacher has insufficient capacity.
- There are not enough laboratories for required lab sessions.
- A lab subject has no available laboratory.
- The required workload cannot fit around breaks.
- A room or teacher is overbooked.

The API uses these result statuses:

```text
ok          Timetable generated and verified
invalid     Input is incomplete or invalid
infeasible  Input is valid, but no conflict-free timetable was found
```

## Project Structure

```text
backend/
  app/
    main.py          FastAPI routes
    models.py        Request and response models
    validator.py     Input validation and feasibility checks
    solver.py        Timetable generation logic
    verifier.py      Independent timetable verification
    service.py       Validate → solve → verify workflow
    db.py            Optional Supabase persistence
    config.py        Environment configuration
  samples/
    sample_input.json
  tests/
    test_timetable.py

frontend/
  src/
    App.jsx
    components/
      SetupForm.jsx
      TimetableView.jsx
    lib/
      form.js
    api.js
    styles.css

supabase/
  schema.sql

render.yaml
APPROACH.md
VALIDATION.md
AI_USAGE_REPORT.md
```

## Run Locally Without Supabase

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate

# Windows PowerShell:
# .venv\Scripts\Activate.ps1

pip install -r requirements.txt
uvicorn app.main:app --reload
```

The backend runs at:

```text
http://127.0.0.1:8000
```

API documentation is available at:

```text
http://127.0.0.1:8000/docs
```

Health check:

```text
http://127.0.0.1:8000/api/health
```

Without Supabase, the health response should show storage as `off`.

### Frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend normally runs at:

```text
http://localhost:5173
```

## Run Tests

From the backend directory:

```bash
pytest -q
```

## Optional Supabase Persistence

Supabase is optional for timetable generation. It is used only to save and retrieve generated timetable data.

### Setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run the complete contents of `supabase/schema.sql`.
4. Copy the Supabase project URL.
5. Create a backend-only secret key or use the legacy service-role key.
6. Copy the environment template:

```bash
cd backend
cp .env.example .env
```

7. Add the values to `backend/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-backend-only-key
CORS_ORIGINS=http://localhost:5173
```

8. Restart the backend.

The health endpoint should then report:

```json
{"ok": true, "storage": "supabase"}
```

### Security

The Supabase secret or service-role key is backend-only. Never place it in frontend code, commit it to GitHub, or include it in the submission email.

The `.env` file must be included in `.gitignore`.

This prototype has no login system. Anyone who can access the backend can use the available API operations. Authentication and role-based access are planned for a future production version.

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Check backend and storage status |
| GET | `/api/sample` | Return example input |
| POST | `/api/validate` | Validate input without generating |
| POST | `/api/generate?save=true` | Generate and optionally save a timetable |
| GET | `/api/timetables` | List saved timetables |
| POST | `/api/timetables` | Save a timetable |
| GET | `/api/timetables/{id}` | Open a saved timetable |
| DELETE | `/api/timetables/{id}` | Delete a saved timetable |

## Validation

The following cases were tested:

- Valid timetable generation.
- Division conflict prevention.
- Teacher conflict prevention.
- Room conflict prevention.
- Laboratory room requirement.
- Theory-room requirement.
- Break-slot exclusion.
- Exact subject workload.
- Missing teacher assignment.
- No suitable laboratory.
- Workload greater than available capacity.
- Infeasible scheduling input.
- Independent verification of generated output.

Detailed test steps are available in `VALIDATION.md`.

## AI Usage

AI-assisted development was used during the project. AI helped with project scaffolding, implementation suggestions, debugging, and test-case suggestions.

The generated output was reviewed and tested manually. An incorrect automatic second-teacher rule was identified during testing and removed because the number of available teachers should not automatically determine how many teachers teach a subject.

Full details are available in `AI_USAGE_REPORT.md`.

## Design Documents

- `APPROACH.md` — product decisions, architecture, assumptions, and trade-offs.
- `VALIDATION.md` — validation steps and edge cases.
- `AI_USAGE_REPORT.md` — AI tools, prompts, generated code, corrections, and validation.

## Future Improvements

- Authentication and role-based access.
- Per-division subject workloads.
- Teacher unavailable slots and preferences.
- Manual timetable editing with re-verification.
- Lab batches.
- Excel and PDF export.
- Better optimization for balanced daily schedules.
- PostgreSQL migration for larger multi-user deployments.

## Submission

Candidate: Sayli Patil

Assignment: Assignment 3 — Intelligent Timetable Generator

This repository was prepared for the Edumerge Solutions pre-drive product engineering assignment.

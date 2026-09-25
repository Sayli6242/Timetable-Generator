"""One test per rule the timetable must never break, plus API tests.

Run from backend/:  pytest -q
"""
import json
from collections import Counter, defaultdict
from pathlib import Path

import httpx
import pytest

from app.models import Entry, SubjectType, TimetableInput
from app.service import generate
from app.verifier import verify

SAMPLE = json.loads((Path(__file__).parent.parent / "samples" / "sample_input.json").read_text())


@pytest.fixture(scope="module")
def solved():
    inp = TimetableInput(**SAMPLE)
    res = generate(inp)
    assert res.status == "ok", res.errors
    return inp, res


def full_week_input():
    """Every division's week is 100% full, the hardest case for running out of room at the end."""
    subjects = [
        {"name": "Maths", "weekly_workload": 6},
        {"name": "Physics", "weekly_workload": 5},
        {"name": "Chemistry", "weekly_workload": 5},
        {"name": "English", "weekly_workload": 4},
        {"name": "Mechanics", "weekly_workload": 4},
        {"name": "Physics Lab", "type": "LAB", "weekly_workload": 2, "block_length": 2},
        {"name": "Chem Lab", "type": "LAB", "weekly_workload": 2, "block_length": 2},
    ]  # 28 periods a week = 4 days x 7 periods: no free slot at all
    teachers = []
    for s in subjects:
        for k in range(2):
            teachers.append({"name": f"{s['name']} T{k + 1}", "subjects": [s["name"]]})
    return TimetableInput(
        working_days=["Mon", "Tue", "Wed", "Thu"],
        periods_per_day=7,
        break_after_periods=[4],
        subjects=subjects,
        teachers=teachers,
        rooms=[{"name": f"C{i}", "type": "CLASSROOM"} for i in range(4)] + [
            {"name": "Lab A", "type": "LAB"}, {"name": "Lab B", "type": "LAB"}],
        divisions=[{"name": d} for d in ("A", "B", "C", "D")],
        options={"seed": 3, "time_limit_seconds": 20},
    )


# ------------------------------------------------------------ the six rules
def test_no_division_gets_two_subjects_in_one_period(solved):
    _, res = solved
    c = Counter((e.division, e.day, e.period) for e in res.entries)
    assert max(c.values()) == 1


def test_no_teacher_in_two_places_at_once(solved):
    _, res = solved
    c = Counter((e.teacher, e.day, e.period) for e in res.entries)
    assert max(c.values()) == 1


def test_no_room_double_booked(solved):
    _, res = solved
    c = Counter((e.room, e.day, e.period) for e in res.entries)
    assert max(c.values()) == 1


def test_labs_only_in_laboratories_and_theory_only_in_classrooms(solved):
    inp, res = solved
    room_type = {r.name: r.type.value for r in inp.rooms}
    for e in res.entries:
        want = "LAB" if e.subject_type == SubjectType.LAB else "CLASSROOM"
        assert room_type[e.room] == want, e


def test_every_subject_gets_exactly_its_workload(solved):
    inp, res = solved
    got = Counter((e.division, e.subject) for e in res.entries)
    for d in inp.divisions:
        for s in inp.subjects:
            assert got[(d.name, s.name)] == s.weekly_workload


def test_fully_packed_week_still_completes():
    inp = full_week_input()
    res = generate(inp)
    assert res.status == "ok", [e.message for e in res.errors]
    assert len(res.entries) == len(inp.divisions) * len(inp.working_days) * inp.periods_per_day
    assert res.verification == []


# ------------------------------------------------------------ supporting rules
def test_lab_blocks_are_consecutive_and_do_not_cross_break(solved):
    inp, res = solved
    blocks = defaultdict(list)
    for e in res.entries:
        blocks[e.block_id].append(e)
    for es in blocks.values():
        if es[0].subject_type != SubjectType.LAB:
            continue
        ps = sorted(e.period for e in es)
        assert ps == list(range(ps[0], ps[0] + len(ps)))
        assert len({(e.day, e.room, e.teacher) for e in es}) == 1
        assert not any(ps[0] <= b < ps[-1] for b in inp.break_after_periods)


def test_each_division_subject_keeps_one_teacher(solved):
    _, res = solved
    teachers = defaultdict(set)
    for e in res.entries:
        teachers[(e.division, e.subject)].add(e.teacher)
    assert all(len(t) == 1 for t in teachers.values())


def test_verifier_catches_a_planted_clash(solved):
    inp, res = solved
    entries = list(res.entries)
    a = entries[0]
    # Put another division's class in the same room at the same time.
    other = next(e for e in entries if e.division != a.division and e.subject_type == a.subject_type)
    entries.append(Entry(**{**other.model_dump(), "day": a.day, "period": a.period, "room": a.room}))
    codes = {i.code for i in verify(inp, entries, {(x.division, x.subject): x.teacher for x in res.teacher_assignments})}
    assert "ROOM_CLASH" in codes and "WORKLOAD_MISMATCH" in codes


# ------------------------------------------------------------ bad inputs
def test_overloaded_division_rejected_before_solving():
    data = {**SAMPLE, "periods_per_day": 4}  # 24 slots, 27 periods needed
    res = generate(TimetableInput(**data))
    assert res.status == "invalid"
    assert any(e.code == "DIVISION_OVERLOADED" for e in res.errors)


def test_lab_subject_with_no_laboratory_rejected():
    data = {**SAMPLE, "rooms": [r for r in SAMPLE["rooms"] if r["type"] != "LAB"]}
    res = generate(TimetableInput(**data))
    assert res.status == "invalid"
    assert any(e.code == "NO_ROOM_OF_TYPE" for e in res.errors)


def test_subject_without_teacher_rejected():
    data = {**SAMPLE, "teachers": [t for t in SAMPLE["teachers"] if "Economics" not in t["subjects"]]}
    res = generate(TimetableInput(**data))
    assert any(e.code == "NO_TEACHER" for e in res.errors)


def test_impossible_combination_reported_not_faked():
    """Passes every precheck but has no solution: one lab forces X's and Y's labs into
    opposite halves of the day, and then T2 is busy whenever X still needs subject A."""
    inp = TimetableInput(
        working_days=["Mon"], periods_per_day=4,
        subjects=[{"name": "L", "type": "LAB", "weekly_workload": 2, "block_length": 2},
                  {"name": "A", "weekly_workload": 1}, {"name": "B", "weekly_workload": 1}],
        teachers=[{"name": "T1", "subjects": ["L", "A", "B"]}, {"name": "T2", "subjects": ["L", "A", "B"]}],
        rooms=[{"name": "R0"}, {"name": "R1"}, {"name": "Lab1", "type": "LAB"}],
        divisions=[{"name": "X"}, {"name": "Y"}],
        assignments=[
            {"division": "X", "subject": "L", "teacher": "T1"},
            {"division": "X", "subject": "A", "teacher": "T2"},
            {"division": "X", "subject": "B", "teacher": "T1"},
            {"division": "Y", "subject": "L", "teacher": "T2"},
            {"division": "Y", "subject": "A", "teacher": "T2"},
            {"division": "Y", "subject": "B", "teacher": "T1"},
        ],
        options={"time_limit_seconds": 5},
    )
    res = generate(inp)
    assert res.status == "infeasible"
    assert res.entries == []
    assert res.errors[0].code == "NO_SOLUTION"


# ------------------------------------------------------------ API
@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app import main
    from app.config import Settings

    main.app.dependency_overrides.clear()
    yield TestClient(main.app), main, Settings
    main.app.dependency_overrides.clear()


def test_api_generate_without_supabase(client):
    tc, main, Settings = client
    main.app.dependency_overrides[main.get_settings] = lambda: Settings(supabase_url="", supabase_service_role_key="")
    r = tc.post("/api/generate?save=true", json=SAMPLE)
    body = r.json()
    assert r.status_code == 200 and body["status"] == "ok"
    assert body["saved"] is None and "not configured" in body["save_error"]
    assert tc.get("/api/timetables").status_code == 503


def test_api_rejects_malformed_input(client):
    tc, *_ = client
    r = tc.post("/api/generate", json={**SAMPLE, "periods_per_day": 0})
    assert r.status_code == 422


def test_api_saves_to_supabase(client):
    tc, main, Settings = client
    calls = []

    def handler(req: httpx.Request):
        calls.append((req.method, req.url.path, json.loads(req.content or b"null")))
        assert req.headers["apikey"] == "secret"
        # A new-style (non-JWT) secret key must not be sent as a Bearer token.
        assert "authorization" not in req.headers
        if req.url.path.endswith("/timetables") and req.method == "POST":
            return httpx.Response(201, json=[{"id": "11111111-1111-1111-1111-111111111111",
                                             "name": "SE Computer - Sem III", "status": "ok",
                                             "created_at": "2026-09-25T00:00:00Z"}])
        return httpx.Response(201)

    settings = Settings(supabase_url="https://x.supabase.co", supabase_service_role_key="secret")
    store = main.SupabaseStore(settings, client=httpx.Client(transport=httpx.MockTransport(handler)))
    main.app.dependency_overrides[main.get_store] = lambda: store
    body = tc.post("/api/generate?save=true", json=SAMPLE).json()
    assert body["saved"]["id"].startswith("1111")
    paths = [c[1] for c in calls]
    assert paths == ["/rest/v1/timetables", "/rest/v1/timetable_entries"]
    assert len(calls[1][2]) == len(body["entries"])

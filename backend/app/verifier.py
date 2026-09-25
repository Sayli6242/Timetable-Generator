"""Independent check of a finished timetable.

This deliberately shares no logic with the solver: it re-reads the plain list
of entries and tests every hard rule from scratch. If the solver ever had a
bug, the verifier would catch it and the API would refuse to return the
timetable as valid.
"""
from __future__ import annotations

from collections import Counter, defaultdict

from .models import REQUIRED_ROOM, Entry, Issue, SubjectType, TimetableInput


def verify(inp: TimetableInput, entries: list[Entry], assignments: dict[tuple[str, str], str]) -> list[Issue]:
    issues: list[Issue] = []
    add = lambda code, msg: issues.append(Issue(code=code, message=msg))

    days = set(inp.working_days)
    subjects = {s.name: s for s in inp.subjects}
    rooms = {r.name: r for r in inp.rooms}
    teachers = {t.name: t for t in inp.teachers}

    div_slot, teacher_slot, room_slot = defaultdict(list), defaultdict(list), defaultdict(list)
    for e in entries:
        if e.day not in days or not 1 <= e.period <= inp.periods_per_day:
            add("OUT_OF_GRID", f"{e.division} {e.subject} is placed at {e.day} P{e.period}, outside the timetable.")
        div_slot[(e.division, e.day, e.period)].append(e)
        teacher_slot[(e.teacher, e.day, e.period)].append(e)
        room_slot[(e.room, e.day, e.period)].append(e)

        subj, room = subjects.get(e.subject), rooms.get(e.room)
        if subj is None or room is None:
            add("UNKNOWN_REFERENCE", f"Entry references unknown subject '{e.subject}' or room '{e.room}'.")
            continue
        # For THEORY_AND_LAB subjects the entry carries the effective type (THEORY or LAB).
        if room.type != REQUIRED_ROOM[e.subject_type]:
            add("ROOM_TYPE_MISMATCH",
                f"{e.subject} ({e.subject_type.value.lower()}) for {e.division} is in {e.room}, a {room.type.value.lower()}, "
                f"on {e.day} P{e.period}.")
        teacher = teachers.get(e.teacher)
        if teacher is None or e.subject not in teacher.subjects:
            add("TEACHER_NOT_QUALIFIED", f"{e.teacher} is teaching {e.subject}, which is not one of their subjects.")
        expected = assignments.get((e.division, e.subject))
        if expected and expected != e.teacher:
            add("WRONG_TEACHER", f"{e.division} {e.subject} is taught by {e.teacher} instead of {expected}.")

    for (d, day, p), es in div_slot.items():
        if len(es) > 1:
            add("DIVISION_CLASH", f"Division {d} has {len(es)} classes on {day} P{p}: {', '.join(e.subject for e in es)}.")
    for (t, day, p), es in teacher_slot.items():
        if len(es) > 1:
            add("TEACHER_CLASH", f"{t} is teaching {len(es)} divisions on {day} P{p}: {', '.join(e.division for e in es)}.")
    for (r, day, p), es in room_slot.items():
        if len(es) > 1:
            add("ROOM_CLASH", f"{r} is booked by {len(es)} divisions on {day} P{p}: {', '.join(e.division for e in es)}.")

    # Workload: exactly the weekly periods, no more, no less.
    got = Counter((e.division, e.subject) for e in entries)
    for d in inp.divisions:
        for s in (d.subjects or [s.name for s in inp.subjects]):
            want = subjects[s].weekly_workload
            if got[(d.name, s)] != want:
                add("WORKLOAD_MISMATCH", f"{d.name} has {got[(d.name, s)]} period(s) of {s}; the workload is {want}.")
    for (d, s), n in got.items():
        if s in subjects and any(x.name == d for x in inp.divisions):
            div = next(x for x in inp.divisions if x.name == d)
            if div.subjects and s not in div.subjects:
                add("WORKLOAD_MISMATCH", f"{d} has {n} period(s) of {s}, which it does not take.")

    # Lab blocks: consecutive periods, same day, same room and teacher, no break inside.
    blocks = defaultdict(list)
    for e in entries:
        blocks[e.block_id].append(e)
    brks = [b for b in inp.break_after_periods if 0 < b < inp.periods_per_day]
    for bid, es in blocks.items():
        subj = subjects.get(es[0].subject)
        if subj is None:
            continue
        # For THEORY_AND_LAB, use the entry's subject_type to pick the right block size.
        want = subj.block_length if es[0].subject_type == SubjectType.LAB else 1
        periods = sorted(e.period for e in es)
        same = len({(e.division, e.day, e.room, e.teacher, e.subject) for e in es}) == 1
        consecutive = periods == list(range(periods[0], periods[0] + len(periods)))
        crosses_break = any(periods[0] <= b < periods[-1] for b in brks)
        if len(es) != want or not same or not consecutive or crosses_break:
            e = es[0]
            add("BROKEN_BLOCK",
                f"{e.subject} for {e.division} on {e.day} should be one block of {want} consecutive period(s) "
                f"in one room{' not crossing any break' if brks else ''}; got periods {periods}.")

    # Teacher daily maximum.
    per_day = Counter((e.teacher, e.day) for e in entries)
    for (t, day), n in per_day.items():
        mx = teachers[t].max_periods_per_day if t in teachers else None
        if mx and n > mx:
            add("TEACHER_DAILY_MAX", f"{t} teaches {n} periods on {day}; their maximum is {mx}.")

    return issues

"""Input validation, teacher assignment and feasibility checks.

Everything here runs *before* the search. Most impossible inputs are caught
here with a clear message, instead of the solver grinding for seconds and
then reporting a vague failure.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from .models import (
    REQUIRED_ROOM,
    Assignment,
    Issue,
    RoomType,
    SubjectType,
    TimetableInput,
)


@dataclass
class Task:
    """All sessions of one subject for one division (they are interchangeable)."""
    division: str
    subject: str
    subject_type: SubjectType
    teacher: str
    room_type: RoomType
    block: int   # periods per session
    count: int   # sessions per week

    @property
    def periods(self) -> int:
        return self.block * self.count


@dataclass
class Plan:
    tasks: list[Task] = field(default_factory=list)
    assignments: list[Assignment] = field(default_factory=list)
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)


def day_segments(periods: int, break_after_periods: list[int]) -> list[int]:
    """Lengths of the uninterrupted runs of periods in a day."""
    breaks = sorted(b for b in break_after_periods if 0 < b < periods)
    if not breaks:
        return [periods]
    result, prev = [], 0
    for b in breaks:
        result.append(b - prev)
        prev = b
    result.append(periods - prev)
    return result


def _dupes(names: list[str]) -> list[str]:
    return [n for n, c in Counter(n.strip().lower() for n in names).items() if c > 1]


def build_plan(inp: TimetableInput) -> Plan:
    plan = Plan()
    err = lambda code, msg: plan.errors.append(Issue(code=code, message=msg))
    warn = lambda code, msg: plan.warnings.append(Issue(code=code, message=msg))

    days, P = len(inp.working_days), inp.periods_per_day
    segments = day_segments(P, inp.break_after_periods)
    for b in inp.break_after_periods:
        if b >= P:
            warn("BREAK_IGNORED", f"Break after period {b} is at or beyond the last period ({P}), so it was ignored.")

    # ---------- structural checks ----------
    for label, names in (
        ("working day", inp.working_days),
        ("subject", [s.name for s in inp.subjects]),
        ("room", [r.name for r in inp.rooms]),
        ("teacher", [t.name for t in inp.teachers]),
        ("division", [d.name for d in inp.divisions]),
    ):
        for d in _dupes(names):
            err("DUPLICATE_NAME", f"Duplicate {label} name: '{d}'. Names must be unique.")

    subjects = {s.name: s for s in inp.subjects}
    teachers = {t.name: t for t in inp.teachers}

    for t in inp.teachers:
        for s in t.subjects:
            if s not in subjects:
                err("UNKNOWN_SUBJECT", f"Teacher '{t.name}' lists unknown subject '{s}'.")
    for d in inp.divisions:
        for s in d.subjects:
            if s not in subjects:
                err("UNKNOWN_SUBJECT", f"Division '{d.name}' lists unknown subject '{s}'.")

    for s in inp.subjects:
        b = s.effective_block
        if s.type == SubjectType.LAB:
            if s.weekly_workload % b:
                err("LAB_BLOCK_MISMATCH",
                    f"Lab '{s.name}' has workload {s.weekly_workload}, which is not a multiple of its block length {b}.")
            if b > max(segments):
                err("LAB_BLOCK_TOO_LONG",
                    f"Lab '{s.name}' needs {b} consecutive periods, but the longest run without a break is {max(segments)}.")
        elif s.type == SubjectType.THEORY_AND_LAB:
            if not s.theory_workload or not s.lab_workload:
                err("MIXED_WORKLOAD_MISSING",
                    f"'{s.name}' is Theory+Lab but is missing theory_workload or lab_workload.")
            else:
                if s.lab_workload % s.block_length:
                    err("LAB_BLOCK_MISMATCH",
                        f"Lab part of '{s.name}' has workload {s.lab_workload}, which is not a multiple of block length {s.block_length}.")
                if s.block_length > max(segments):
                    err("LAB_BLOCK_TOO_LONG",
                        f"Lab part of '{s.name}' needs {s.block_length} consecutive periods, but the longest run without a break is {max(segments)}.")
        # With at most ceil(count/days) sessions of a subject per day, a subject can
        # still always fit its workload, so we only warn when it must repeat daily.
        sessions = s.weekly_workload // b if b else s.weekly_workload
        if sessions > days:
            warn("SUBJECT_REPEATS_IN_DAY",
                 f"'{s.name}' has {sessions} sessions a week over {days} days, so some days will have it more than once.")

    rooms_by_type = defaultdict(list)
    for r in inp.rooms:
        rooms_by_type[r.type].append(r.name)

    if plan.errors:
        return plan

    # ---------- per-division demand ----------
    div_subjects: dict[str, list[str]] = {}
    for d in inp.divisions:
        chosen = d.subjects or [s.name for s in inp.subjects]
        div_subjects[d.name] = chosen
        total = sum(subjects[s].weekly_workload for s in chosen)
        if total > days * P:
            err("DIVISION_OVERLOADED",
                f"Division '{d.name}' needs {total} periods a week but only {days * P} exist "
                f"({days} days x {P} periods).")
        elif total < days * P:
            warn("FREE_PERIODS", f"Division '{d.name}' will have {days * P - total} free period(s) a week.")

    # ---------- teacher assignment ----------
    qualified = defaultdict(list)
    for t in inp.teachers:
        for s in t.subjects:
            qualified[s].append(t.name)

    def capacity(tname: str) -> int:
        mpd = teachers[tname].max_periods_per_day
        return days * min(P, mpd) if mpd else days * P

    load: dict[str, int] = defaultdict(int)
    fixed = {}
    for a in inp.assignments:
        if a.division not in div_subjects:
            err("BAD_ASSIGNMENT", f"Assignment refers to unknown division '{a.division}'."); continue
        if a.subject not in subjects:
            err("BAD_ASSIGNMENT", f"Assignment refers to unknown subject '{a.subject}'."); continue
        if a.teacher not in teachers:
            err("BAD_ASSIGNMENT", f"Assignment refers to unknown teacher '{a.teacher}'."); continue
        if a.subject not in teachers[a.teacher].subjects:
            err("TEACHER_NOT_QUALIFIED", f"'{a.teacher}' is assigned '{a.subject}' but does not list it as a subject.")
        fixed[(a.division, a.subject)] = a.teacher
        load[a.teacher] += subjects[a.subject].weekly_workload

    pairs = [(d, s) for d, subs in div_subjects.items() for s in subs if (d, s) not in fixed]
    # Hardest first: fewest qualified teachers, then heaviest workload.
    pairs.sort(key=lambda p: (len(qualified[p[1]]), -subjects[p[1]].weekly_workload))
    chosen_teacher = dict(fixed)
    for d, s in pairs:
        cands = qualified[s]
        if not cands:
            err("NO_TEACHER", f"No teacher can teach '{s}'. Add it to at least one teacher's subjects.")
            continue
        w = subjects[s].weekly_workload
        fits = [t for t in cands if load[t] + w <= capacity(t)]
        if not fits:
            err("TEACHERS_OVERLOADED",
                f"Every teacher of '{s}' is full. Assigning it for division '{d}' would exceed their weekly capacity; "
                f"add another teacher for '{s}'.")
            continue
        # Spread the load: pick the teacher with the lowest share of their capacity used.
        t = min(fits, key=lambda t: (load[t] / capacity(t), t))
        chosen_teacher[(d, s)] = t
        load[t] += w

    for t, l in load.items():
        if l > capacity(t):
            err("TEACHER_OVERLOADED", f"'{t}' would teach {l} periods a week but can teach at most {capacity(t)}.")
    for t in inp.teachers:
        if load[t.name] == 0:
            warn("IDLE_TEACHER", f"'{t.name}' was not assigned any classes.")

    if plan.errors:
        return plan

    # ---------- tasks ----------
    for (d, s), t in chosen_teacher.items():
        subj = subjects[s]
        if subj.type == SubjectType.THEORY_AND_LAB:
            # Split into separate theory and lab tasks so each goes to the right room type.
            plan.tasks.append(Task(d, s, SubjectType.THEORY, t, RoomType.CLASSROOM, 1, subj.theory_workload))
            plan.tasks.append(Task(d, s, SubjectType.LAB, t, RoomType.LAB, subj.block_length, subj.lab_workload // subj.block_length))
        else:
            b = subj.effective_block
            plan.tasks.append(Task(d, s, subj.type, t, REQUIRED_ROOM[subj.type], b, subj.weekly_workload // b))
        plan.assignments.append(Assignment(division=d, subject=s, teacher=t))
    plan.assignments.sort(key=lambda a: (a.division, a.subject))

    # ---------- room capacity ----------
    for rtype in RoomType:
        demand_tasks = [tk for tk in plan.tasks if tk.room_type == rtype]
        if not demand_tasks:
            continue
        nrooms = len(rooms_by_type[rtype])
        label = "laboratory" if rtype == RoomType.LAB else "classroom"
        if nrooms == 0:
            names = sorted({tk.subject for tk in demand_tasks})
            err("NO_ROOM_OF_TYPE", f"No {label} exists, but {', '.join(names)} need one.")
            continue
        demand = sum(tk.periods for tk in demand_tasks)
        supply = nrooms * days * P
        if demand > supply:
            err("ROOMS_INSUFFICIENT",
                f"{label.capitalize()}s are needed for {demand} periods a week but {nrooms} {label}(s) offer only {supply}.")
        # Blocks can't straddle the break, so each room fits fewer long blocks per day.
        for b in sorted({tk.block for tk in demand_tasks if tk.block > 1}):
            blocks = sum(tk.count for tk in demand_tasks if tk.block == b)
            per_room_day = sum(seg // b for seg in segments)
            if blocks > nrooms * days * per_room_day:
                err("LAB_SLOTS_INSUFFICIENT",
                    f"{blocks} lab sessions of {b} periods are needed but {nrooms} lab(s) can host only "
                    f"{nrooms * days * per_room_day} such sessions a week.")
        util = demand / supply
        if util > 0.9:
            warn("ROOMS_TIGHT", f"{label.capitalize()}s are {util:.0%} booked; generation may be slow or fail.")

    return plan

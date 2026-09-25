"""validate -> plan -> solve -> verify, in one call."""
from __future__ import annotations

from collections import defaultdict

from .models import GenerateResult, Issue, RoomType, TimetableInput
from .solver import Solver
from .validator import build_plan
from .verifier import verify


def validate(inp: TimetableInput) -> GenerateResult:
    plan = build_plan(inp)
    return GenerateResult(
        status="invalid" if plan.errors else "ok",
        teacher_assignments=plan.assignments,
        errors=plan.errors,
        warnings=plan.warnings,
    )


def generate(inp: TimetableInput) -> GenerateResult:
    plan = build_plan(inp)
    if plan.errors:
        return GenerateResult(status="invalid", errors=plan.errors, warnings=plan.warnings)

    outcome = Solver(inp, plan.tasks).solve()
    if outcome.entries is None:
        errors = [Issue(code="NO_SOLUTION", message=_explain_failure(inp, plan.tasks, outcome))]
        for u in outcome.unplaced[:10]:
            errors.append(Issue(
                code="UNPLACED",
                message=f"{u['division']}: {u['sessions_missing']} session(s) of {u['subject']} "
                        f"({u['teacher']}) could not be placed.",
            ))
        return GenerateResult(status="infeasible", errors=errors, warnings=plan.warnings,
                              teacher_assignments=plan.assignments, stats=outcome.stats)

    assigned = {(a.division, a.subject): a.teacher for a in plan.assignments}
    problems = verify(inp, outcome.entries, assigned)
    return GenerateResult(
        status="ok" if not problems else "invalid",
        entries=outcome.entries,
        teacher_assignments=plan.assignments,
        warnings=plan.warnings,
        errors=problems,
        verification=problems,
        stats=outcome.stats,
    )


def _explain_failure(inp: TimetableInput, tasks, outcome) -> str:
    days, P = len(inp.working_days), inp.periods_per_day
    slots = days * P
    lines = []
    load = defaultdict(int)
    for t in tasks:
        load[("teacher", t.teacher)] += t.periods
        load[("division", t.division)] += t.periods
        load[("type", t.room_type)] += t.periods
    rooms = defaultdict(int)
    for r in inp.rooms:
        rooms[r.type] += 1
    tight = []
    for (kind, key), n in load.items():
        cap = slots * (rooms[key] if kind == "type" else 1)
        if cap and n / cap >= 0.85:
            name = {RoomType.LAB: "Labs", RoomType.CLASSROOM: "Classrooms"}.get(key, key) if kind == "type" else f"{kind.capitalize()} {key}"
            tight.append((n / cap, f"{name} {n / cap:.0%} booked"))
    tight.sort(reverse=True)
    if outcome.stats.get("exhausted"):
        lines.append("Every arrangement was tried (keeping each subject spread across the week) "
                     "and none satisfies all the rules.")
    else:
        lines.append(f"No valid timetable was found within {inp.options.time_limit_seconds:g} seconds.")
    if tight:
        lines.append("Bottlenecks: " + "; ".join(m for _, m in tight[:4]) + ".")
    lines.append("Try adding a teacher or room, reducing a workload, or adding a working day or period.")
    return " ".join(lines)

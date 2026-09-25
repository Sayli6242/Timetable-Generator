"""Constraint-satisfaction timetable solver.

The week is a grid of slots, numbered ``day * periods_per_day + period``.
Occupancy for each division, teacher and room is stored as a Python int used
as a bitmask (bit i set = slot i taken), so checking every clash for every
possible slot is a handful of bitwise operations.

Hard constraints enforced during the search:
  * a division has at most one class per slot
  * a teacher teaches at most one class per slot
  * a room hosts at most one class per slot
  * lab subjects only go in lab rooms, theory subjects only in classrooms
  * every division-subject gets exactly its weekly workload
  * lab blocks use consecutive periods on one day, without crossing the break
  * a subject appears at most ceil(sessions / days) times a day (spreads it out)
  * a teacher's optional daily maximum is respected

How it avoids getting stuck near the end:
  * Most-constrained first: at every step it schedules the subject with the
    least spare room, i.e. (slots still possible) - (sessions still needed).
  * Forward checking: after every placement it recomputes that spare room for
    every unfinished subject and for every division, teacher and room type.
    The moment anything goes negative it undoes the last choice instead of
    carrying on into a dead end.
  * Randomised restarts: if a search runs too long it restarts with a new
    random tie-break order, until the time limit.
"""
from __future__ import annotations

import math
import random
import sys
import time
from collections import defaultdict
from dataclasses import dataclass

from .models import Entry, RoomType, TimetableInput
from .validator import Task, day_segments

sys.setrecursionlimit(20000)


@dataclass
class SolveOutcome:
    entries: list[Entry] | None
    stats: dict
    unplaced: list[dict]


class _Timeout(Exception):
    pass


class Solver:
    def __init__(self, inp: TimetableInput, tasks: list[Task]):
        self.inp = inp
        self.tasks = tasks
        self.D = len(inp.working_days)
        self.P = inp.periods_per_day
        self.N = self.D * self.P
        self.ALL = (1 << self.N) - 1
        self.day_mask = [((1 << self.P) - 1) << (d * self.P) for d in range(self.D)]

        # Valid start slots for a block of length b (stays inside the day and
        # does not cross the break).
        segs = day_segments(self.P, inp.break_after_periods)
        self.valid_start: dict[int, int] = {}
        for b in {t.block for t in tasks}:
            m = 0
            for d in range(self.D):
                start = 0
                for seg in segs:
                    for p in range(start, start + seg - b + 1):
                        m |= 1 << (d * self.P + p)
                    start += seg
            self.valid_start[b] = m

        self.divisions = sorted({t.division for t in tasks})
        self.teachers = sorted({t.teacher for t in tasks})
        self.rooms = [r.name for r in inp.rooms]
        self.rooms_of_type: dict[RoomType, list[int]] = defaultdict(list)
        for i, r in enumerate(inp.rooms):
            self.rooms_of_type[r.type].append(i)
        self.tmax = {t.name: t.max_periods_per_day for t in inp.teachers}

        # Each division gets a "home" classroom it prefers, so its timetable
        # doesn't jump between rooms without reason.
        cls = self.rooms_of_type[RoomType.CLASSROOM]
        self.home_room = {d: (cls[i % len(cls)] if cls else None) for i, d in enumerate(self.divisions)}

        self.type_has_blocks = {rt: any(t.block > 1 for t in tasks if t.room_type == rt) for rt in RoomType}

        # At most ceil(sessions/days) sessions of a subject per day.
        self.cap = [math.ceil(t.count / self.D) for t in tasks]

    # ------------------------------------------------------------------ utils
    @staticmethod
    def _runs(free: int, b: int) -> int:
        """Bits i such that slots i..i+b-1 are all free."""
        c = free
        for i in range(1, b):
            c &= free >> i
        return c

    def _day_counts(self, mask: int) -> list[int]:
        P, full = self.P, (1 << self.P) - 1
        return [((mask >> (d * P)) & full).bit_count() for d in range(self.D)]

    # ------------------------------------------------------------------ state
    def _reset(self):
        self.div_busy = defaultdict(int)
        self.teacher_busy = defaultdict(int)
        self.room_busy = [0] * len(self.rooms)
        self.subj_day = [[0] * self.D for _ in self.tasks]
        self.teacher_day = defaultdict(lambda: [0] * self.D)
        self.remaining = [t.count for t in self.tasks]
        self.div_need = defaultdict(int)
        self.teacher_need = defaultdict(int)
        self.type_need = defaultdict(int)
        for t in self.tasks:
            self.div_need[t.division] += t.periods
            self.teacher_need[t.teacher] += t.periods
            self.type_need[t.room_type] += t.periods
        self.placed: list[tuple[int, int, int]] = []  # (task, start slot, room)

    def _candidates(self, i: int) -> int:
        t = self.tasks[i]
        free = self.ALL & ~self.div_busy[t.division] & ~self.teacher_busy[t.teacher]
        starts = self._runs(free, t.block) & self.valid_start[t.block]
        if not starts:
            return 0
        room_ok = 0
        for r in self.rooms_of_type[t.room_type]:
            room_ok |= self._runs(self.ALL & ~self.room_busy[r], t.block)
        starts &= room_ok
        tmax = self.tmax.get(t.teacher)
        tday = self.teacher_day[t.teacher]
        for d in range(self.D):
            if self.subj_day[i][d] >= self.cap[i] or (tmax and tday[d] + t.block > tmax):
                starts &= ~self.day_mask[d]
        return starts

    def _upper_bound(self, i: int, starts: int) -> int:
        """Most sessions of task i that could still be placed (optimistic)."""
        cap = self.cap[i]
        return sum(min(cap - used, n) for used, n in zip(self.subj_day[i], self._day_counts(starts)))

    def _aggregate_ok(self) -> bool:
        """Can every division, teacher and room type still fit its remaining load?"""
        for d, need in self.div_need.items():
            if need > (self.ALL & ~self.div_busy[d]).bit_count():
                return False
        for t, need in self.teacher_need.items():
            if not need:
                continue
            free_days = self._day_counts(self.ALL & ~self.teacher_busy[t])
            tmax = self.tmax.get(t)
            if tmax:
                room = sum(min(f, max(0, tmax - used)) for f, used in zip(free_days, self.teacher_day[t]))
            else:
                room = sum(free_days)
            if need > room:
                return False
        for rtype, need in self.type_need.items():
            if need > sum((self.ALL & ~self.room_busy[r]).bit_count() for r in self.rooms_of_type[rtype]):
                return False
        return True

    def _apply(self, i: int, s: int, r: int, sign: int):
        t = self.tasks[i]
        bits = ((1 << t.block) - 1) << s
        d = s // self.P
        if sign > 0:
            self.div_busy[t.division] |= bits
            self.teacher_busy[t.teacher] |= bits
            self.room_busy[r] |= bits
        else:
            self.div_busy[t.division] &= ~bits
            self.teacher_busy[t.teacher] &= ~bits
            self.room_busy[r] &= ~bits
        self.subj_day[i][d] += sign
        self.teacher_day[t.teacher][d] += sign * t.block
        self.remaining[i] -= sign
        self.div_need[t.division] -= sign * t.block
        self.teacher_need[t.teacher] -= sign * t.block
        self.type_need[t.room_type] -= sign * t.block

    def _room_options(self, i: int, s: int) -> list[int]:
        """Rooms to try for a session starting at slot s, best first.

        When a room type only hosts single-period sessions, any free room is as
        good as any other, so only the preferred one is tried. When multi-period
        blocks share the type, where a session goes can decide whether a later
        block still finds a room free for all its periods, so the alternatives
        are tried too (skipping rooms whose bookings are identical).
        """
        t = self.tasks[i]
        bits = ((1 << t.block) - 1) << s
        free = [r for r in self.rooms_of_type[t.room_type] if not self.room_busy[r] & bits]
        if not free:
            return []
        home = self.home_room.get(t.division)
        free.sort(key=lambda r: (r != home, self.room_busy[r].bit_count(), r))
        if not self.type_has_blocks[t.room_type]:
            return free[:1]
        seen, out = set(), []
        for r in free:
            if self.room_busy[r] not in seen:
                seen.add(self.room_busy[r])
                out.append(r)
        return out

    # ----------------------------------------------------------------- search
    def _choose(self):
        """Pick the unfinished task with the least slack.

        Returns (None, 0) when every task is done and (-1, 0) at a dead end
        (some task can no longer reach its workload).
        """
        best, best_key, best_starts = None, None, 0
        for i, t in enumerate(self.tasks):
            if not self.remaining[i]:
                continue
            starts = self._candidates(i)
            slack = self._upper_bound(i, starts) - self.remaining[i]
            if slack < 0:
                return -1, 0
            key = (slack, starts.bit_count(), -t.block, self.rng.random())
            if best_key is None or key < best_key:
                best, best_key, best_starts = i, key, starts
        return best, best_starts

    def _order(self, i: int, starts: int) -> list[int]:
        t = self.tasks[i]
        P = self.P
        div_day = self._day_counts(self.div_busy[t.division])
        tday = self.teacher_day[t.teacher]
        # First free period of each of the division's days.
        busy = self.div_busy[t.division]
        front = []
        for d in range(self.D):
            day_bits = (busy >> (d * P)) & ((1 << P) - 1)
            front.append((~day_bits & (day_bits + 1)).bit_length() - 1)
        scored = []
        m = starts
        while m:
            low = m & -m
            s = low.bit_length() - 1
            m ^= low
            d, p = divmod(s, P)
            score = (
                self.subj_day[i][d] * 100             # spread a subject across the week
                + div_day[d] * 4                      # balance each division's days
                + tday[d] * 2                         # balance each teacher's days
                + abs(p - front[d]) * 3               # pack the day from the top: no idle gaps
                + self.rng.random() * 3               # tie-break (varies between restarts)
            )
            scored.append((score, s))
        scored.sort()
        return [s for _, s in scored]

    def _search(self) -> bool:
        self.nodes += 1
        if self.nodes > self.node_limit or time.monotonic() > self.deadline:
            raise _Timeout
        i, starts = self._choose()
        if i is None:
            return True
        if i < 0:
            return False
        for s in self._order(i, starts):
            for r in self._room_options(i, s):
                self._apply(i, s, r, +1)
                self.placed.append((i, s, r))
                if len(self.placed) > self.best_depth:
                    self.best_depth = len(self.placed)
                    self.best_placed = list(self.placed)
                if self._aggregate_ok() and self._search():
                    return True
                self.placed.pop()
                self._apply(i, s, r, -1)
                self.backtracks += 1
        return False

    # ----------------------------------------------------------------- repair
    def _repair(self, initial: list[tuple[int, int, int]], deadline: float) -> list[tuple[int, int, int]] | None:
        """Conflict-directed repair (iterative forward search).

        Starts from the best partial timetable the backtracking found. Each
        step takes an unscheduled session, puts it in the (slot, room) that
        clashes with the fewest already-placed sessions, and un-schedules those
        clashing sessions so they are retried later. Sessions that keep getting
        bumped gain weight, so the search stops fighting over the same slots.
        The hard rules are never broken: a clash is resolved by removal, not
        tolerated.
        """
        rng = self.rng
        P, N = self.P, self.N
        tasks = self.tasks
        sess_task = [i for i, t in enumerate(tasks) for _ in range(t.count)]
        S = len(sess_task)
        assign: list[tuple[int, int] | None] = [None] * S
        div_at = defaultdict(lambda: [-1] * N)
        teacher_at = defaultdict(lambda: [-1] * N)
        room_at = [[-1] * N for _ in self.rooms]
        on_day = [[set() for _ in range(self.D)] for _ in tasks]  # task -> day -> sessions
        tload = defaultdict(lambda: [0] * self.D)
        bumped = [0] * S
        tabu: dict[tuple[int, int, int], int] = {}

        # Every (start, room) a session of each task could ever use.
        domain = []
        for t in tasks:
            starts = [x for x in range(N) if self.valid_start[t.block] >> x & 1]
            domain.append([(x, r) for x in starts for r in self.rooms_of_type[t.room_type]])

        def place(v, x, r):
            i = sess_task[v]; t = tasks[i]
            for k in range(t.block):
                div_at[t.division][x + k] = v
                teacher_at[t.teacher][x + k] = v
                room_at[r][x + k] = v
            on_day[i][x // P].add(v)
            tload[t.teacher][x // P] += t.block
            assign[v] = (x, r)

        def remove(v):
            x, r = assign[v]
            i = sess_task[v]; t = tasks[i]
            for k in range(t.block):
                div_at[t.division][x + k] = -1
                teacher_at[t.teacher][x + k] = -1
                room_at[r][x + k] = -1
            on_day[i][x // P].discard(v)
            tload[t.teacher][x // P] -= t.block
            assign[v] = None

        def conflicts(v, x, r):
            i = sess_task[v]; t = tasks[i]
            c = set()
            dv, tv, rv = div_at[t.division], teacher_at[t.teacher], room_at[r]
            for k in range(t.block):
                for w in (dv[x + k], tv[x + k], rv[x + k]):
                    if w >= 0:
                        c.add(w)
            d = x // P
            same = [w for w in on_day[i][d] if w not in c]
            if len(same) >= self.cap[i]:
                c.update(same[: len(same) - self.cap[i] + 1])
            tmax = self.tmax.get(t.teacher)
            if tmax:
                load = tload[t.teacher][d] - sum(tasks[sess_task[w]].block for w in c
                                                 if tasks[sess_task[w]].teacher == t.teacher and assign[w][0] // P == d)
                if load + t.block > tmax:
                    others = [w for x2 in range(d * P, d * P + P) if (w := teacher_at[t.teacher][x2]) >= 0 and w not in c]
                    for w in dict.fromkeys(others):
                        if load + t.block <= tmax:
                            break
                        c.add(w); load -= tasks[sess_task[w]].block
            return c

        # Seed with the partial timetable from the backtracking phase.
        used = defaultdict(list)
        for v, i in enumerate(sess_task):
            used[i].append(v)
        for i, x, r in initial:
            place(used[i].pop(), x, r)

        best = [a for a in assign]
        best_count = sum(a is not None for a in assign)
        it = 0
        while time.monotonic() < deadline:
            unassigned = [v for v in range(S) if assign[v] is None]
            if not unassigned:
                return [(sess_task[v], x, r) for v, (x, r) in enumerate(assign)]
            it += 1
            # Prefer long blocks and sessions that keep getting bumped.
            pool = rng.sample(unassigned, min(6, len(unassigned)))
            v = max(pool, key=lambda w: (tasks[sess_task[w]].block, bumped[w], rng.random()))
            i = sess_task[v]
            best_val, best_score = None, None
            for x, r in domain[i]:
                if tabu.get((v, x, r), -1) > it:
                    continue
                c = conflicts(v, x, r)
                score = sum(1 + bumped[w] for w in c) * 10 + len(on_day[i][x // P]) + rng.random() * 4
                if best_score is None or score < best_score:
                    best_val, best_score = (x, r, c), score
                    if not c and score < 5:
                        break
            if best_val is None:
                tabu.clear()
                continue
            x, r, c = best_val
            for w in c:
                tabu[(w, *assign[w])] = it + 10
                remove(w)
                bumped[w] += 1
            place(v, x, r)
            n = S - len(unassigned) + 1 - len(c)
            if n > best_count:
                best_count, best = n, list(assign)
        self.repair_iterations = it
        self.best_depth = max(self.best_depth, best_count)
        self.best_repair = [(sess_task[v], *a) for v, a in enumerate(best) if a is not None]
        return None

    # ----------------------------------------------------------------- polish
    def _gaps(self, busy: int, d: int) -> int:
        day = (busy >> (d * self.P)) & ((1 << self.P) - 1)
        if not day:
            return 0
        low = (day & -day).bit_length() - 1
        return day.bit_length() - low - day.bit_count()

    def _local_cost(self, divs: set, teachers: set, days: set) -> int:
        cost = 0
        for d in days:
            for dv in divs:
                cost += 3 * self._gaps(self.div_busy[dv], d)
            for t in teachers:
                cost += self._gaps(self.teacher_busy[t], d)
        return cost

    def _polish(self, placed: list[tuple[int, int, int]], deadline: float) -> list[tuple[int, int, int]]:
        """Hill-climb on soft goals (no idle gaps for divisions, fewer for teachers).

        Every move is checked against the hard rules before it is kept, so a
        valid timetable stays valid. Moves: shift one session to a free slot,
        or swap the slots of two single-period sessions of the same division.
        """
        self._reset()
        placed = list(placed)
        for i, x, r in placed:
            self._apply(i, x, r, +1)
        P = self.P
        improved_total = 0
        while time.monotonic() < deadline:
            improved = False
            order = list(range(len(placed)))
            self.rng.shuffle(order)
            for k in order:
                if time.monotonic() > deadline:
                    break
                i, x, r = placed[k]
                t = self.tasks[i]
                # --- move to another free slot
                self._apply(i, x, r, -1)
                cands = self._candidates(i)
                best = None
                m = cands
                while m:
                    low = m & -m; x2 = low.bit_length() - 1; m ^= low
                    if x2 == x:
                        continue
                    days = {x // P, x2 // P}
                    for r2 in self._room_options(i, x2)[:1]:
                        self._apply(i, x, r, +1)
                        before = self._local_cost({t.division}, {t.teacher}, days)
                        self._apply(i, x, r, -1)
                        self._apply(i, x2, r2, +1)
                        after = self._local_cost({t.division}, {t.teacher}, days)
                        self._apply(i, x2, r2, -1)
                        if after < before and (best is None or after - before < best[0]):
                            best = (after - before, x2, r2)
                if best:
                    _, x2, r2 = best
                    self._apply(i, x2, r2, +1)
                    placed[k] = (i, x2, r2)
                    improved = True; improved_total += 1
                    continue
                self._apply(i, x, r, +1)
                # --- swap with another single-period session of the same division
                if t.block != 1:
                    continue
                for k2 in order:
                    j, y, q = placed[k2]
                    u = self.tasks[j]
                    if k2 == k or u.division != t.division or u.block != 1 or j == i or y // P == x // P:
                        continue
                    divs, teachers, days = {t.division}, {t.teacher, u.teacher}, {x // P, y // P}
                    before = self._local_cost(divs, teachers, days)
                    self._apply(i, x, r, -1); self._apply(j, y, q, -1)
                    ok = False
                    # i goes to y (using j's room if types match), j goes to x.
                    ri = q if t.room_type == u.room_type else next(iter(self._room_options(i, y)), None)
                    if ri is not None and self._candidates(i) >> y & 1 and not self.room_busy[ri] >> y & 1:
                        self._apply(i, y, ri, +1)
                        rj = r if t.room_type == u.room_type else next(iter(self._room_options(j, x)), None)
                        if rj is not None and self._candidates(j) >> x & 1 and not self.room_busy[rj] >> x & 1:
                            self._apply(j, x, rj, +1)
                            if self._local_cost(divs, teachers, days) < before:
                                placed[k], placed[k2] = (i, y, ri), (j, x, rj)
                                ok = True
                            else:
                                self._apply(j, x, rj, -1)
                        if not ok:
                            self._apply(i, y, ri, -1)
                    if ok:
                        improved = True; improved_total += 1
                        break
                    self._apply(i, x, r, +1); self._apply(j, y, q, +1)
            if not improved:
                break
        self.polish_moves = improved_total
        return placed

    def solve(self) -> SolveOutcome:
        opts = self.inp.options
        start = time.monotonic()
        self.deadline = start + opts.time_limit_seconds
        total_sessions = sum(t.count for t in self.tasks)
        self.best_depth, self.best_placed = -1, []
        self.backtracks = 0
        self.repair_iterations = 0
        self.best_repair = None
        restarts = 0
        solved = exhausted = False

        # Phase 1: backtracking. Fast and tidy on most inputs; gets a share of
        # the time budget with a few restarts.
        phase1_end = start + min(opts.time_limit_seconds * 0.25, 4.0)
        self.node_limit = max(1500, total_sessions * 10)
        self.deadline = phase1_end
        while time.monotonic() < phase1_end:
            self.rng = random.Random(opts.seed + restarts)
            self.nodes = 0
            self._reset()
            try:
                # Either a solution, or the whole search space was explored
                # without one: in both cases trying again cannot help.
                solved = self._aggregate_ok() and self._search()
                exhausted = not solved
                break
            except _Timeout:
                restarts += 1
                self.node_limit = int(self.node_limit * 1.5)

        placed = self.placed if solved else None
        # Phase 2: conflict-directed repair from the best partial timetable.
        if not solved and not exhausted:
            self.rng = random.Random(opts.seed)
            placed = self._repair(self.best_placed, start + opts.time_limit_seconds)
            solved = placed is not None

        method = "backtracking" if placed is self.placed else "repair"
        self.polish_moves = 0
        if solved:
            placed = self._polish(placed, min(time.monotonic() + 2.0, start + opts.time_limit_seconds + 2.0))

        stats = {
            "sessions": total_sessions,
            "restarts": restarts,
            "backtracks": self.backtracks,
            "repair_steps": self.repair_iterations,
            "method": method,
            "polish_moves": self.polish_moves,
            "seconds": round(time.monotonic() - start, 3),
        }
        if not solved:
            left = [t.count for t in self.tasks]
            for i, _, _ in (self.best_repair or self.best_placed):
                left[i] -= 1
            unplaced = [
                {"division": t.division, "subject": t.subject, "teacher": t.teacher,
                 "sessions_missing": rem, "block": t.block}
                for t, rem in zip(self.tasks, left) if rem
            ]
            stats["best_placed"] = max(self.best_depth, 0)
            stats["exhausted"] = exhausted
            return SolveOutcome(None, stats, unplaced)

        entries: list[Entry] = []
        for block_id, (i, s, r) in enumerate(sorted(placed, key=lambda x: (self.tasks[x[0]].division, x[1]))):
            t = self.tasks[i]
            d, p = divmod(s, self.P)
            for k in range(t.block):
                entries.append(Entry(
                    division=t.division, day=self.inp.working_days[d], period=p + k + 1,
                    subject=t.subject, subject_type=t.subject_type, teacher=t.teacher,
                    room=self.rooms[r], block_id=block_id,
                ))
        return SolveOutcome(entries, stats, [])

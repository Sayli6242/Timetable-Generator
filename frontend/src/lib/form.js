// Form state <-> API payload.
//
// Inside the form, teachers point at subjects by a local id rather than by
// name, so renaming a subject doesn't silently drop it from every teacher.

export const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let seq = 0;
const uid = () => `k${++seq}`;

const DIV_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ---- time helpers --------------------------------------------------------
function toMin(t) {
  if (!t) return NaN;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmtMin(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
}

export const makeSubject = (i) => ({
  id: uid(), name: `Subject ${i + 1}`, type: "THEORY", weekly_workload: 4, block_length: 2,
  theory_workload: 3, lab_workload: 2,
});
export const makeTeacher = (i) => ({ id: uid(), name: `Teacher ${i + 1}`, subjectIds: [], max_periods_per_day: "" });
export const makeClassroom = (i) => ({ id: uid(), name: `Room ${101 + i}` });
export const makeLab = (i) => ({ id: uid(), name: `Lab ${i + 1}` });
export const makeDivision = (i) => ({ id: uid(), name: `Div ${DIV_LETTERS[i] ?? i + 1}` });

export function emptyForm() {
  return {
    name: "My timetable",
    working_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    periods_per_day: 7,
    // Each break: { after: <period number>, start: "HH:MM", end: "HH:MM" }
    breaks: [{ after: 4, start: "10:30", end: "11:00" }],
    day_start: "08:00",
    day_end: "17:00",
    subjects: [], teachers: [], classrooms: [], labs: [], divisions: [],
    time_limit_seconds: 20,
  };
}

/** Grow or shrink a list to n items, keeping what the user already typed. */
export function resize(list, n, make) {
  if (n <= list.length) return list.slice(0, n);
  return [...list, ...Array.from({ length: n - list.length }, (_, k) => make(list.length + k))];
}

/** Give each subject to teachers round-robin, so a fresh form is usable straight away. */
export function autoAssign(form) {
  const { subjects, teachers } = form;
  if (!teachers.length) return form;
  const next = teachers.map((t) => ({ ...t, subjectIds: [] }));
  subjects.forEach((s, i) => {
    next[i % next.length].subjectIds.push(s.id);
  });
  return { ...form, teachers: next };
}

export function toPayload(form) {
  const byId = Object.fromEntries(form.subjects.map((s) => [s.id, s.name.trim()]));
  return {
    name: form.name.trim() || "Untitled timetable",
    working_days: ALL_DAYS.filter((d) => form.working_days.includes(d)),
    periods_per_day: Number(form.periods_per_day),
    day_start: form.day_start || null,
    day_end: form.day_end || null,
    break_after_periods: (form.breaks || []).map((b) => Number(b.after)).filter(Boolean),
    subjects: form.subjects.map((s) => {
      const isMixed = s.type === "THEORY_AND_LAB";
      return {
        name: s.name.trim(),
        type: s.type,
        weekly_workload: isMixed
          ? Number(s.theory_workload) + Number(s.lab_workload)
          : Number(s.weekly_workload),
        theory_workload: isMixed ? Number(s.theory_workload) : null,
        lab_workload: isMixed ? Number(s.lab_workload) : null,
        block_length: (s.type === "LAB" || isMixed) ? Number(s.block_length) : 1,
      };
    }),
    teachers: form.teachers.map((t) => ({
      name: t.name.trim(),
      subjects: t.subjectIds.map((id) => byId[id]).filter(Boolean),
      max_periods_per_day: t.max_periods_per_day === "" ? null : Number(t.max_periods_per_day),
    })),
    rooms: [
      ...form.classrooms.map((r) => ({ name: r.name.trim(), type: "CLASSROOM" })),
      ...form.labs.map((r) => ({ name: r.name.trim(), type: "LAB" })),
    ],
    divisions: form.divisions.map((d) => ({ name: d.name.trim() })),
    options: { seed: 7, time_limit_seconds: Number(form.time_limit_seconds) || 20 },
  };
}

export function fromPayload(p) {
  const subjects = p.subjects.map((s) => ({
    id: uid(), name: s.name, type: s.type ?? "THEORY",
    weekly_workload: s.weekly_workload, block_length: s.block_length ?? 2,
    theory_workload: s.theory_workload ?? 3,
    lab_workload: s.lab_workload ?? 2,
  }));
  const idOf = Object.fromEntries(subjects.map((s) => [s.name, s.id]));
  return {
    name: p.name ?? "Untitled timetable",
    working_days: p.working_days,
    periods_per_day: p.periods_per_day,
    day_start: p.day_start ?? "08:00",
    day_end: p.day_end ?? "17:00",
    breaks: (p.break_after_periods ?? []).map((after) => ({ after, start: "10:30", end: "11:00" })),
    subjects,
    teachers: p.teachers.map((t) => ({
      id: uid(), name: t.name,
      subjectIds: (t.subjects ?? []).map((n) => idOf[n]).filter(Boolean),
      max_periods_per_day: t.max_periods_per_day ?? "",
    })),
    classrooms: p.rooms.filter((r) => (r.type ?? "CLASSROOM") === "CLASSROOM").map((r) => ({ id: uid(), name: r.name })),
    labs: p.rooms.filter((r) => r.type === "LAB").map((r) => ({ id: uid(), name: r.name })),
    divisions: p.divisions.map((d) => ({ id: uid(), name: d.name })),
    time_limit_seconds: p.options?.time_limit_seconds ?? 20,
  };
}

/** Problems the user can fix before even calling the server.
 *
 * Returns { problems, week, subjects, teachers, divisions, classrooms, labs, need, slots }
 * where each named array contains errors for that specific section.
 */
export function quickChecks(form) {
  const week = [], subjects = [], teachers = [], divisions = [], classrooms = [], labs = [];
  const global = []; // blocks generation but already shown via inline hint, not via SectionErrors
  const err = (section, msg) => section.push(msg);

  const slots = form.working_days.length * Number(form.periods_per_day || 0);
  const need = form.subjects.reduce((a, s) =>
    s.type === "THEORY_AND_LAB"
      ? a + Number(s.theory_workload || 0) + Number(s.lab_workload || 0)
      : a + Number(s.weekly_workload || 0), 0);

  const P = Number(form.periods_per_day) || 0;
  const dayStart = toMin(form.day_start);
  const dayEnd = toMin(form.day_end);
  const bks = form.breaks || [];

  // ---- Week section --------------------------------------------------------
  // 1. Start time must be earlier than end time
  if (!form.day_start) err(week, "Please enter the school start time.");
  if (!form.day_end)   err(week, "Please enter the school end time.");

  if (form.day_start && form.day_end) {
    if (dayEnd <= dayStart) {
      err(week, "School must end after it starts. Check your start and end times.");
    } else {
      let totalBreakMin = 0;

      bks.forEach((b, i) => {
        const n = i + 1;
        if (!b.start) { err(week, `Break ${n}: please enter when the break starts.`); return; }
        if (!b.end)   { err(week, `Break ${n}: please enter when the break ends.`); return; }
        const bs = toMin(b.start), be = toMin(b.end);
        if (be <= bs) { err(week, `Break ${n}: the break must end after it starts.`); return; }
        if (bs < dayStart || be > dayEnd)
          err(week, `Break ${n} (${b.start}–${b.end}) is outside school hours. Move it between ${form.day_start} and ${form.day_end}.`);
        totalBreakMin += be - bs;
      });

      const validBrks = bks
        .filter((b) => b.start && b.end && toMin(b.end) > toMin(b.start))
        .map((b) => ({ s: toMin(b.start), e: toMin(b.end) }))
        .sort((a, b) => a.s - b.s);
      for (let i = 1; i < validBrks.length; i++) {
        if (validBrks[i].s < validBrks[i - 1].e)
          err(week, `Two breaks overlap (${fmtMin(validBrks[i - 1].s)}–${fmtMin(validBrks[i - 1].e)} and ${fmtMin(validBrks[i].s)}–${fmtMin(validBrks[i].e)}). Please fix the break times so they don't overlap.`);
      }

      const workingMin = dayEnd - dayStart - totalBreakMin;

      if (workingMin <= 0) {
        err(week, "There is no time left for classes after the breaks. Please shorten the breaks or extend school hours.");
      } else if (P > 0) {
        const D = workingMin / P;

        if (D < 15)
          err(week, `Each class period would only be ${Math.round(D)} minutes. Please reduce the number of periods or shorten the breaks.`);

        const alignChecks = bks
          .filter((b) => b.start && b.end && toMin(b.end) > toMin(b.start) && Number(b.after) > 0)
          .sort((a, b) => Number(a.after) - Number(b.after));
        let priorBreakMin = 0;
        for (const b of alignChecks) {
          const expected = dayStart + Number(b.after) * D + priorBreakMin;
          const actual   = toMin(b.start);
          if (Math.abs(actual - expected) > 1)
            err(week, `Break after period ${b.after} cuts into a class. It should start at ${fmtMin(expected)} to fit between periods (you entered ${b.start}).`);
          priorBreakMin += toMin(b.end) - toMin(b.start);
        }
      }
    }
  }

  if (!form.working_days.length) err(week, "Please select at least one working day.");

  // ---- Subjects section ----------------------------------------------------
  if (!form.subjects.length) err(subjects, "Please add at least one subject.");
  if (need > slots) global.push(`The timetable is impossible to generate because subjects need ${need} periods a week but the schedule only has ${slots} (${form.working_days.length} days × ${Number(form.periods_per_day)} periods). Reduce subject workloads, add more working days, or increase periods per day.`);
  for (const s of form.subjects) {
    if (s.type === "LAB" && Number(s.weekly_workload) % Number(s.block_length))
      err(subjects, `"${s.name}" is a lab subject — its periods per week must be an even number (labs are taught in pairs).`);
    if (s.type === "THEORY_AND_LAB") {
      if (!Number(s.theory_workload) || !Number(s.lab_workload))
        err(subjects, `Please enter both theory and lab periods per week for "${s.name}".`);
      else if (Number(s.lab_workload) % Number(s.block_length))
        err(subjects, `Lab periods for "${s.name}" must be a multiple of ${s.block_length} (labs are taught in blocks).`);
    }
  }

  // ---- Teachers section ----------------------------------------------------
  if (!form.teachers.length) err(teachers, "Please add at least one teacher.");
  const taught = new Set(form.teachers.flatMap((t) => t.subjectIds));
  for (const s of form.subjects) {
    if (!taught.has(s.id)) err(teachers, `No teacher has been assigned to teach "${s.name}". Please assign a teacher.`);
  }

  // ---- Divisions section ---------------------------------------------------
  if (!form.divisions.length) err(divisions, "Please add at least one division (class/section).");

  // ---- Classrooms / Labs sections ------------------------------------------
  if (form.subjects.some((s) => s.type === "THEORY" || s.type === "THEORY_AND_LAB") && !form.classrooms.length)
    err(classrooms, "You have theory subjects but no classrooms. Please add at least one classroom.");
  if (form.subjects.some((s) => s.type === "LAB" || s.type === "THEORY_AND_LAB") && !form.labs.length)
    err(labs, "You have lab subjects but no lab rooms. Please add at least one laboratory.");

  const problems = [...global, ...week, ...subjects, ...teachers, ...divisions, ...classrooms, ...labs];
  return { problems, week, subjects, teachers, divisions, classrooms, labs, need, slots };
}

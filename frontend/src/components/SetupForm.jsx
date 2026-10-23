import { useState, useCallback, useEffect } from "react";
import { ALL_DAYS, quickChecks } from "../lib/form.js";

const toMin = (t) => { if (!t) return NaN; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

// ---- Inline SVG icons -------------------------------------------------------
const Svg = ({ children }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const CalendarIcon = () => <Svg><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>;
const BookIcon = () => <Svg><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></Svg>;
const UsersIcon = () => <Svg><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></Svg>;
const GridIcon = () => <Svg><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Svg>;
const MonitorIcon = () => <Svg><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></Svg>;
const FlaskIcon = () => <Svg><path d="M9 3h6M9 3v8L4 21h16L15 11V3" /><path d="M6.5 18h11" /></Svg>;
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 16 4 11" />
  </svg>
);
const ChevronIcon = ({ collapsed }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.25s ease", display: "block" }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// ---- Guided mode hint -------------------------------------------------------
function GuideHint({ children }) {
  return (
    <div className="guide-hint">
      <span className="guide-hint-icon" aria-hidden="true">💡</span>
      <div className="guide-hint-body">{children}</div>
    </div>
  );
}

// ---- Help tooltip -----------------------------------------------------------
function HelpTip({ text }) {
  return (
    <span className="tooltip-wrap">
      <span className="help-tip" tabIndex={0} role="img" aria-label="Help">?</span>
      <span className="tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

// ---- Stepper ----------------------------------------------------------------
function Stepper({ value, onChange, min = 0, max = 40, label }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="stepper-btn"
        onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
      <span className="stepper-val">{value}</span>
      <button type="button" className="stepper-btn"
        onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </div>
  );
}

// ---- Teacher avatar ---------------------------------------------------------
function Avatar({ name }) {
  const words = (name || "?").trim().split(/\s+/);
  const init = (words.length >= 2
    ? words[0][0] + words[words.length - 1][0]
    : (name || "?").slice(0, 2)
  ).toUpperCase();
  const hue = [...(name || "")].reduce(
    (h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261
  ) % 360;
  return <div className="avatar" style={{ "--h": hue }} aria-hidden="true">{init}</div>;
}

// ---- Section errors ---------------------------------------------------------
function SectionErrors({ errors }) {
  if (!errors?.length) return null;
  return (
    <div className="section-errors" role="alert">
      {errors.map((msg, i) => <p key={i} className="section-error"><strong>{msg}</strong></p>)}
    </div>
  );
}

// ---- Period budget bar ------------------------------------------------------
function PeriodBudgetBar({ need, slots }) {
  const over = need > slots;
  const pct = slots > 0 ? Math.min((need / slots) * 100, 100) : 0;
  return (
    <div className="budget-bar-wrap">
      <div className="budget-bar">
        <div className="budget-fill" style={{ width: `${pct}%`, background: over ? "var(--bad)" : "var(--good)" }} />
      </div>
      <p className={`hint ${over ? "bad" : ""}`} style={{ marginTop: 6, marginBottom: 0 }}>
        Each division needs <b>{need}</b> of <b>{slots}</b> available periods per week.
        {over && <> — Reduce workloads or add more periods.</>}
      </p>
    </div>
  );
}

// ---- Progress step indicator (mobile only) ----------------------------------
function ProgressBar({ steps }) {
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="progress-strip no-print">
      {steps.map((step) => (
        <button key={step.key} type="button"
          className={`progress-step ${step.ok ? "ok" : step.touched ? "bad" : ""}`}
          onClick={() => scrollTo(`section-${step.key}`)}>
          <span className="progress-dot" />
          <span className="progress-label">{step.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---- Section card -----------------------------------------------------------
function Section({ id, title, desc, icon, num, count, setCount, min = 1, children, ok, touched, collapsed, onToggle }) {
  return (
    <section className={`card${collapsed ? " card-collapsed" : ""}`} id={id}>
      <div className="section-head">
        <div>
          <h2>
            {num && <span className={`section-num section-num-${num}`}>{num}</span>}
            <span className="section-icon">{icon}</span>
            {title}
          </h2>
          {desc && !collapsed && <p className="section-desc">{desc}</p>}
        </div>
        <div className="section-head-right">
          {touched && ok && (
            <span className="section-check" title="Section complete"><CheckIcon /></span>
          )}
          {setCount && (
            <div className="how-many">
              <span>How many?</span>
              <Stepper value={count} onChange={setCount} min={min} label={`Number of ${title}`} />
            </div>
          )}
          {onToggle && (
            <button type="button" className="ghost section-toggle"
              onClick={onToggle} aria-label={collapsed ? "Expand section" : "Collapse section"}>
              <ChevronIcon collapsed={collapsed} />
            </button>
          )}
        </div>
      </div>
      {!collapsed && children}
    </section>
  );
}

function Names({ items, onChange, label }) {
  return (
    <div className="names">
      {items.map((it, i) => (
        <input key={it.id} value={it.name} aria-label={`${label} ${i + 1}`}
          placeholder={`${label} ${i + 1}`}
          onChange={(e) => onChange(items.map((x) => x.id === it.id ? { ...x, name: e.target.value } : x))} />
      ))}
    </div>
  );
}

// ---- Sidebar component (desktop only) ---------------------------------------
const BUSY_MSGS = ["Scheduling periods…", "Resolving conflicts…", "Checking constraints…", "Almost done…"];

function SetupSidebar({ steps, counts, need, slots, problems, busy, busyMsgIdx, onGenerate,
  storageOn, onLoadSample, onShowSaved, scrollTo, problemSectionId,
  draftSaved, onStartOver }) {
  const ready = !busy && problems.length === 0;
  return (
    <aside className="setup-sidebar no-print">
      <div className="sidebar-card">
        <p className="sidebar-label">Your setup</p>

        {/* Status checklist */}
        <div className="sidebar-steps">
          {steps.map((step, i) => (
            <button key={step.key} type="button"
              className={`sidebar-step ${step.ok ? "ok" : step.touched ? "bad" : ""}`}
              onClick={() => scrollTo(`section-${step.key}`)}>
              <span className="sidebar-step-dot">{i + 1}</span>
              {step.label}
              {step.ok && <span className="sidebar-step-check"><CheckIcon /></span>}
            </button>
          ))}
        </div>

        <div className="sidebar-divider" />

        {/* Quick stats */}
        <div className="sidebar-stats">
          <div className="sidebar-stat">
            <span className="sidebar-stat-val">{counts.subjects}</span>
            <span className="sidebar-stat-label">Subjects</span>
          </div>
          <div className="sidebar-stat">
            <span className="sidebar-stat-val">{counts.teachers}</span>
            <span className="sidebar-stat-label">Teachers</span>
          </div>
          <div className="sidebar-stat">
            <span className="sidebar-stat-val">{counts.divisions}</span>
            <span className="sidebar-stat-label">Divisions</span>
          </div>
        </div>

        {/* Period budget */}
        <PeriodBudgetBar need={need} slots={slots} />

        <div className="sidebar-divider" />

        {/* Error list */}
        {problems.length > 0 && (
          <div className="sidebar-errors">
            {problems.slice(0, 3).map((msg, i) => (
              <button key={i} type="button" className="sidebar-error-link"
                onClick={() => scrollTo(problemSectionId(msg))}>
                {msg}
              </button>
            ))}
            {problems.length > 3 && (
              <span className="bad-text small">+{problems.length - 3} more issues</span>
            )}
          </div>
        )}

        {/* Generate button */}
        <button className="sidebar-generate" disabled={busy || problems.length > 0} onClick={onGenerate}>
          {busy ? (
            <span className="spinner-wrap">
              <span className="spinner" />
              {BUSY_MSGS[busyMsgIdx]}
            </span>
          ) : ready ? "Generate Timetable →" : `Fix ${problems.length} issue${problems.length !== 1 ? "s" : ""} above`}
        </button>

        {/* Secondary links */}
        <div className="sidebar-links">
          {onLoadSample && (
            <button type="button" className="sidebar-link" onClick={onLoadSample}>
              Try an example
            </button>
          )}
          {storageOn && onShowSaved && (
            <button type="button" className="sidebar-link" onClick={onShowSaved}>
              Saved timetables
            </button>
          )}
          {onStartOver && (
            <button type="button" className="sidebar-link danger" onClick={onStartOver}>
              Start over
            </button>
          )}
        </div>

        {/* Draft saved indicator */}
        {draftSaved && <p className="draft-saved">✓ Draft saved</p>}
      </div>
    </aside>
  );
}

// ---- Main form export -------------------------------------------------------
export default function SetupForm({ form, setField, counts, setCount, onGenerate, busy,
  storageOn, onLoadSample, onShowSaved, draftSaved, onStartOver,
  guidedMode, onDismissGuide }) {
  const {
    problems, week: weekErrs, subjects: subjectErrs, teachers: teacherErrs,
    divisions: divisionErrs, classrooms: classroomErrs, labs: labErrs, need, slots,
  } = quickChecks(form);

  // ---- Period duration (derived from day_start / day_end / breaks) ----------
  const totalBreakMin = (form.breaks || []).reduce((sum, b) => {
    const bs = toMin(b.start), be = toMin(b.end);
    return (!isNaN(bs) && !isNaN(be) && be > bs) ? sum + (be - bs) : sum;
  }, 0);
  const P = Number(form.periods_per_day) || 0;
  const periodDuration = (P > 0 && form.day_start && form.day_end)
    ? Math.round((toMin(form.day_end) - toMin(form.day_start) - totalBreakMin) / P)
    : 45;

  const setPeriodDuration = (d) => {
    const start = toMin(form.day_start);
    if (isNaN(start) || P === 0) return;
    const newEnd = start + P * d + totalBreakMin;
    if (newEnd > 0 && newEnd <= 23 * 60) {
      touch("week");
      setField("day_end", fmtMin(newEnd));
    }
  };

  const DURATION_OPTIONS = [30, 35, 40, 45, 50, 55, 60, 75, 90];
  const durationInList = DURATION_OPTIONS.includes(periodDuration);

  const [touched, setTouched] = useState(
    () => new Set(["week", "subjects", "teachers", "divisions", "classrooms", "labs"])
  );
  const [collapsed, setCollapsed] = useState({});
  const [busyMsgIdx, setBusyMsgIdx] = useState(0);

  const touch = useCallback((key) => {
    setTouched((t) => { const n = new Set(t); n.add(key); return n; });
  }, []);

  const toggle = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  useEffect(() => {
    if (!busy) { setBusyMsgIdx(0); return; }
    const id = setInterval(() => setBusyMsgIdx((i) => (i + 1) % BUSY_MSGS.length), 1800);
    return () => clearInterval(id);
  }, [busy]);

  const updSubject = (id, patch) =>
    setField("subjects", form.subjects.map((s) => s.id === id ? { ...s, ...patch } : s));

  const toggleTeach = (t, sid) =>
    setField("teachers", form.teachers.map((x) => x.id !== t.id ? x : {
      ...x,
      subjectIds: x.subjectIds.includes(sid)
        ? x.subjectIds.filter((y) => y !== sid)
        : [...x.subjectIds, sid],
    }));

  const toggleDay = (d) => {
    touch("week");
    setField("working_days", form.working_days.includes(d)
      ? form.working_days.filter((x) => x !== d)
      : [...form.working_days, d]);
  };

  const setBreak = (i, patch) => {
    touch("week");
    const next = [...form.breaks];
    next[i] = { ...next[i], ...patch };
    setField("breaks", next);
  };

  const subjectsOk = !subjectErrs.length && need <= slots;
  const resourcesOk = !divisionErrs.length && !classroomErrs.length && !labErrs.length;

  const progressSteps = [
    { key: "week", label: "Week", ok: !weekErrs.length, touched: touched.has("week") },
    { key: "subjects", label: "Subjects", ok: subjectsOk, touched: touched.has("subjects") },
    { key: "teachers", label: "Teachers", ok: !teacherErrs.length, touched: touched.has("teachers") },
    { key: "resources", label: "Rooms & Divisions", ok: resourcesOk, touched: touched.has("divisions") || touched.has("classrooms") || touched.has("labs") },
  ];

  const problemSectionId = (msg) => {
    if (/day|period|break|school|time/i.test(msg)) return "section-week";
    if (/subject|workload|slot/i.test(msg)) return "section-subjects";
    if (/teacher/i.test(msg)) return "section-teachers";
    return "section-resources";
  };

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
      {/* ---- Timetable name input (full-width above layout) ---- */}
      <div className="timetable-name-wrap no-print">
        <label className="field-label" style={{ display: "block", marginBottom: 6 }}>Timetable name</label>
        <input
          className="timetable-name-input"
          value={form.name || ""}
          placeholder="e.g. Grade 10 — Term 1 2025"
          onChange={(e) => setField("name", e.target.value)}
          aria-label="Timetable name"
        />
      </div>

      {/* ---- Guided mode banner ---- */}
      {guidedMode && (
        <div className="guide-banner no-print">
          <div className="guide-banner-text">
            <b>Example loaded!</b> This is a sample school timetable. Each section below is pre-filled — read the hints, then edit the values to match your school.
          </div>
          <button className="ghost small" onClick={onDismissGuide}>Dismiss guide</button>
        </div>
      )}

      {/* ---- Progress strip (mobile only — hidden ≥901px via CSS) ---- */}
      <ProgressBar steps={progressSteps} />

      {/* ---- Two-panel layout ---- */}
      <div className="setup-layout">

        {/* ---- Left: form sections ---- */}
        <div className="setup-main">

          {/* 1 — Week */}
          <Section id="section-week" num={1} title="Week" desc="Which days you teach and how many lessons per day"
            icon={<CalendarIcon />}
            ok={!weekErrs.length} touched={touched.has("week")}
            collapsed={collapsed.week} onToggle={() => toggle("week")}>

            <div className="field-label" style={{ marginBottom: 8 }}>Working days</div>
            <div className="chips">
              {ALL_DAYS.map((d) => (
                <button key={d} type="button"
                  className={`chip ${form.working_days.includes(d) ? "on" : ""}`}
                  onClick={() => toggleDay(d)}>{d}</button>
              ))}
            </div>

            <div className="form-grid-3" style={{ marginTop: 20 }}>
              <div className="field-group">
                <div className="field-label">Periods per day <HelpTip text="How many lessons fit in one school day — e.g. 6 means 6 back-to-back lessons (excluding breaks)." /></div>
                <Stepper value={form.periods_per_day} min={1} label="Periods per day"
                  onChange={(v) => { touch("week"); setField("periods_per_day", v); }} />
              </div>
              <div className="field-group">
                <div className="field-label">Period duration <HelpTip text="How long each lesson is. Selecting a duration automatically updates the school end time." /></div>
                <select
                  value={durationInList ? periodDuration : "custom"}
                  onChange={(e) => { if (e.target.value !== "custom") setPeriodDuration(Number(e.target.value)); }}>
                  {DURATION_OPTIONS.map((v) => <option key={v} value={v}>{v} min</option>)}
                  {!durationInList && <option value="custom">{periodDuration > 0 ? `${periodDuration} min` : "—"} (custom)</option>}
                </select>
              </div>
              <div className="field-group">
                <div className="field-label">Breaks per day <HelpTip text="Number of breaks (e.g. lunch, recess). Each break splits the day. Set start/end times below." /></div>
                <Stepper
                  value={(form.breaks || []).length} min={0} max={form.periods_per_day - 1}
                  label="Breaks per day"
                  onChange={(n) => {
                    touch("week");
                    const cur = form.breaks || [];
                    if (n <= cur.length) { setField("breaks", cur.slice(0, n)); return; }
                    const step = Math.floor(form.periods_per_day / (n + 1));
                    const extra = Array.from({ length: n - cur.length }, (_, k) => ({
                      after: Math.min(step * (cur.length + k + 1), form.periods_per_day - 1),
                      start: "10:30", end: "11:00",
                    }));
                    setField("breaks", [...cur, ...extra]);
                  }}
                />
              </div>
            </div>{/* end form-grid-3 */}

            {(form.breaks || []).map((b, i) => (
              <div className="break-row" key={i}>
                <div className="break-tag">Break {i + 1}</div>
                <label className="field-group">
                  <span className="field-label">After period <HelpTip text="The break starts after this lesson number. E.g. '3' means the break is after the 3rd lesson." /></span>
                  <select value={b.after} onChange={(e) => setBreak(i, { after: Number(e.target.value) })}>
                    {Array.from({ length: Math.max(0, form.periods_per_day - 1) }, (_, k) =>
                      <option key={k} value={k + 1}>{k + 1}</option>)}
                  </select>
                </label>
                <label className="field-group">
                  <span className="field-label">From</span>
                  <input type="time" value={b.start} onChange={(e) => setBreak(i, { start: e.target.value })} />
                </label>
                <label className="field-group">
                  <span className="field-label">To</span>
                  <input type="time" value={b.end} onChange={(e) => setBreak(i, { end: e.target.value })} />
                </label>
              </div>
            ))}

            <div className="form-divider" />
            <div className="form-grid-2">
              <label className="field-group">
                <span className="field-label">School starts</span>
                <input type="time" value={form.day_start} required
                  onChange={(e) => { touch("week"); setField("day_start", e.target.value); }} />
              </label>
              <label className="field-group">
                <span className="field-label">School ends</span>
                <input type="time" value={form.day_end} required
                  onChange={(e) => { touch("week"); setField("day_end", e.target.value); }} />
              </label>
            </div>
            {guidedMode && (
              <GuideHint>
                <b>Week setup:</b> The example uses Mon–Fri, 6 periods/day, with a lunch break after period 3.
                Toggle days by clicking them. Change <em>Periods per day</em> to match your school's daily schedule.
              </GuideHint>
            )}
            <SectionErrors errors={weekErrs} />
          </Section>

          {/* 2 — Subjects */}
          <Section id="section-subjects" num={2} title="Subjects" desc="What is taught and how often per week"
            icon={<BookIcon />}
            count={counts.subjects} setCount={(v) => { touch("subjects"); setCount("subjects", v); }}
            ok={subjectsOk} touched={touched.has("subjects")}
            collapsed={collapsed.subjects} onToggle={() => toggle("subjects")}>
            <div className="rows">
              <div className="row-head">
                <span>Name</span>
                <span>Periods / week <HelpTip text="How many times per week this subject is taught to each division." /></span>
                <span>Type <HelpTip text="Theory: regular classroom. Lab only: needs a lab room + double-period block. Both: has separate theory and lab sessions." /></span>
              </div>
              {form.subjects.map((s) => (
                <div className="row3" key={s.id}>
                  <input value={s.name} aria-label="Subject name" placeholder="Subject name"
                    onChange={(e) => { touch("subjects"); updSubject(s.id, { name: e.target.value }); }} />
                  {s.type === "THEORY_AND_LAB" ? (
                    <span className="dual-count">
                      <input className="count" type="number" min={1} max={40}
                        value={s.theory_workload} aria-label="Theory periods per week"
                        onChange={(e) => { touch("subjects"); updSubject(s.id, { theory_workload: Math.max(1, Number(e.target.value) || 1) }); }} />
                      <span className="dual-sep">T +</span>
                      <input className="count" type="number" min={2} max={40}
                        value={s.lab_workload} aria-label="Lab periods per week"
                        onChange={(e) => { touch("subjects"); updSubject(s.id, { lab_workload: Math.max(2, Number(e.target.value) || 2) }); }} />
                      <span className="dual-sep">L</span>
                    </span>
                  ) : (
                    <input className="count" type="number" min={1} max={40}
                      value={s.weekly_workload} aria-label="Periods per week"
                      onChange={(e) => { touch("subjects"); updSubject(s.id, { weekly_workload: Math.max(1, Number(e.target.value) || 1) }); }} />
                  )}
                  <select data-type={s.type} value={s.type} aria-label="Subject type"
                    onChange={(e) => {
                      touch("subjects"); updSubject(s.id, {
                        type: e.target.value,
                        block_length: e.target.value === "THEORY" ? 1 : 2,
                      });
                    }}>
                    <option value="THEORY">Theory</option>
                    <option value="LAB">Lab only</option>
                    <option value="THEORY_AND_LAB">Both</option>
                  </select>
                </div>
              ))}
            </div>
            <PeriodBudgetBar need={need} slots={slots} />
            {guidedMode && (
              <GuideHint>
                <b>Subjects:</b> 4 theory subjects + 1 lab subject are pre-loaded. Rename them to your actual subjects.
                <em> Periods / week</em> = how many lessons per week each division has for that subject.
                Lab subjects automatically need a double-period block and a dedicated lab room.
              </GuideHint>
            )}
            <SectionErrors errors={subjectErrs} />
          </Section>

          {/* 3 — Teachers */}
          <Section id="section-teachers" num={3} title="Teachers" desc="Who teaches which subjects — every subject needs at least one teacher"
            icon={<UsersIcon />}
            count={counts.teachers} setCount={(v) => { touch("teachers"); setCount("teachers", v); }}
            ok={!teacherErrs.length} touched={touched.has("teachers")}
            collapsed={collapsed.teachers} onToggle={() => toggle("teachers")}>
            <p className="hint top">For each teacher, click the subject chips to show which subjects they teach. <b>Every subject must have at least one teacher assigned</b> — unassigned subjects will block generation.</p>
            <div className="rows">
              {form.teachers.map((t) => (
                <div className="row-teacher" key={t.id}>
                  <div className="teacher-name">
                    <Avatar name={t.name} />
                    <input value={t.name} aria-label="Teacher name" placeholder="Teacher name"
                      onChange={(e) => {
                        touch("teachers"); setField("teachers",
                          form.teachers.map((x) => x.id === t.id ? { ...x, name: e.target.value } : x));
                      }} />
                  </div>
                  <div className="chips">
                    {form.subjects.map((s) => (
                      <button key={s.id} type="button"
                        className={`chip small ${t.subjectIds.includes(s.id) ? "on" : ""}`}
                        onClick={() => { touch("teachers"); toggleTeach(t, s.id); }}>{s.name}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {guidedMode && (
              <GuideHint>
                <b>Teachers:</b> 5 teachers are pre-assigned to subjects. Click a coloured chip to assign or unassign a subject.
                Every subject must have at least one teacher — the generator will flag any that are missing.
              </GuideHint>
            )}
            <SectionErrors errors={teacherErrs} />
          </Section>

          {/* 4 — Resources (Divisions / Classrooms / Labs) */}
          {guidedMode && (
            <GuideHint>
              <b>Resources:</b> <em>Divisions</em> are your class groups (e.g. Grade 10-A, Grade 10-B).
              <em> Classrooms</em> are regular rooms. <em>Labs</em> are specialist rooms for lab subjects.
              The generator guarantees no room or teacher is double-booked.
            </GuideHint>
          )}
          <div id="section-resources" className="resources-wrap">
            <div className="resources-heading">
              <span className="section-num section-num-4">4</span>
              Resources — Divisions, Classrooms &amp; Labs
            </div>
            <div className="three">
              <Section title="Divisions" icon={<GridIcon />}
                count={counts.divisions} setCount={(v) => { touch("divisions"); setCount("divisions", v); }}
                ok={!divisionErrs.length} touched={touched.has("divisions")}>
                <Names items={form.divisions} label="Division"
                  onChange={(v) => { touch("divisions"); setField("divisions", v); }} />
                <SectionErrors errors={divisionErrs} />
              </Section>

              <Section title="Classrooms" icon={<MonitorIcon />}
                count={counts.classrooms} setCount={(v) => { touch("classrooms"); setCount("classrooms", v); }} min={0}
                ok={!classroomErrs.length} touched={touched.has("classrooms")}>
                <Names items={form.classrooms} label="Classroom"
                  onChange={(v) => { touch("classrooms"); setField("classrooms", v); }} />
                <SectionErrors errors={classroomErrs} />
              </Section>

              <Section title="Labs" icon={<FlaskIcon />}
                count={counts.labs} setCount={(v) => { touch("labs"); setCount("labs", v); }} min={0}
                ok={!labErrs.length} touched={touched.has("labs")}>
                <Names items={form.labs} label="Lab"
                  onChange={(v) => { touch("labs"); setField("labs", v); }} />
                <SectionErrors errors={labErrs} />
              </Section>
            </div>
          </div>

        </div>{/* end .setup-main */}

        {/* ---- Right: sticky sidebar (desktop only) ---- */}
        <SetupSidebar
          steps={progressSteps}
          counts={counts}
          need={need} slots={slots}
          problems={problems}
          busy={busy} busyMsgIdx={busyMsgIdx}
          onGenerate={onGenerate}
          storageOn={storageOn}
          onLoadSample={onLoadSample}
          onShowSaved={onShowSaved}
          scrollTo={scrollTo}
          problemSectionId={problemSectionId}
          draftSaved={draftSaved}
          onStartOver={onStartOver}
        />

      </div>{/* end .setup-layout */}

      {/* ---- Mobile bottom bar (hidden ≥901px via CSS) ---- */}
      <div className="bottom-bar no-print">
        {problems.length > 0 ? (
          <span className="bottom-errors">
            {problems.slice(0, 2).map((msg, i) => (
              <button key={i} type="button" className="error-link"
                onClick={() => scrollTo(problemSectionId(msg))}>
                {msg}
              </button>
            ))}
            {problems.length > 2 && (
              <span className="bad-text small"> +{problems.length - 2} more</span>
            )}
          </span>
        ) : form.subjects.some((s) => s.name && !/^Subject\s*\d*$/i.test(s.name.trim())) ? (
          <span className="muted small">No issues — ready to generate.</span>
        ) : (
          <span className="muted small">Fill in your subjects, teachers and rooms above, then generate.</span>
        )}
        <button className="primary big" disabled={busy || problems.length > 0} onClick={onGenerate}>
          {busy ? (
            <span className="spinner-wrap">
              <span className="spinner" />
              {BUSY_MSGS[busyMsgIdx]}
            </span>
          ) : "Generate timetable"}
        </button>
      </div>
    </>
  );
}

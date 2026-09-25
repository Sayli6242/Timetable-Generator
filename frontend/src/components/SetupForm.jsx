import { ALL_DAYS, quickChecks } from "../lib/form.js";

// ---- Inline SVG icons -------------------------------------------------------
const Svg = ({ children }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const CalendarIcon  = () => <Svg><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></Svg>;
const BookIcon      = () => <Svg><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></Svg>;
const UsersIcon     = () => <Svg><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></Svg>;
const GridIcon      = () => <Svg><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Svg>;
const MonitorIcon   = () => <Svg><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></Svg>;
const FlaskIcon     = () => <Svg><path d="M9 3h6M9 3v8L4 21h16L15 11V3"/><path d="M6.5 18h11"/></Svg>;

// ---- Stepper (replaces plain number CountBox) --------------------------------
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

// ---- Teacher avatar ----------------------------------------------------------
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

// ---- Shared components -------------------------------------------------------
function SectionErrors({ errors }) {
  if (!errors?.length) return null;
  return (
    <div className="section-errors" role="alert">
      {errors.map((msg, i) => <p key={i} className="section-error"><strong>{msg}</strong></p>)}
    </div>
  );
}

function Section({ title, icon, count, setCount, min = 1, children }) {
  return (
    <section className="card">
      <div className="section-head">
        <h2><span className="section-icon">{icon}</span>{title}</h2>
        {setCount && (
          <div className="how-many">
            <span>How many?</span>
            <Stepper value={count} onChange={setCount} min={min} label={`Number of ${title}`} />
          </div>
        )}
      </div>
      {children}
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

// ---- Main form ---------------------------------------------------------------
export default function SetupForm({ form, setField, counts, setCount, onGenerate, busy }) {
  const {
    problems, week: weekErrs, subjects: subjectErrs, teachers: teacherErrs,
    divisions: divisionErrs, classrooms: classroomErrs, labs: labErrs, need, slots,
  } = quickChecks(form);

  const updSubject = (id, patch) =>
    setField("subjects", form.subjects.map((s) => s.id === id ? { ...s, ...patch } : s));

  const toggleTeach = (t, sid) =>
    setField("teachers", form.teachers.map((x) => x.id !== t.id ? x : {
      ...x,
      subjectIds: x.subjectIds.includes(sid)
        ? x.subjectIds.filter((y) => y !== sid)
        : [...x.subjectIds, sid],
    }));

  const toggleDay = (d) =>
    setField("working_days", form.working_days.includes(d)
      ? form.working_days.filter((x) => x !== d)
      : [...form.working_days, d]);

  const setBreak = (i, patch) => {
    const next = [...form.breaks];
    next[i] = { ...next[i], ...patch };
    setField("breaks", next);
  };

  return (
    <>
      {/* ---- Week ---- */}
      <Section title="Week" icon={<CalendarIcon />}>

        <div className="field-label" style={{ marginBottom: 8 }}>Working days</div>
        <div className="chips">
          {ALL_DAYS.map((d) => (
            <button key={d} type="button"
              className={`chip ${form.working_days.includes(d) ? "on" : ""}`}
              onClick={() => toggleDay(d)}>{d}</button>
          ))}
        </div>

        <div className="form-grid-2" style={{ marginTop: 20 }}>
          <div className="field-group">
            <div className="field-label">Periods per day</div>
            <Stepper value={form.periods_per_day} min={1} label="Periods per day"
              onChange={(v) => setField("periods_per_day", v)} />
          </div>
          <div className="field-group">
            <div className="field-label">Breaks per day</div>
            <Stepper
              value={(form.breaks || []).length} min={0} max={form.periods_per_day - 1}
              label="Breaks per day"
              onChange={(n) => {
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
        </div>

        {(form.breaks || []).map((b, i) => (
          <div className="break-row" key={i}>
            <div className="break-tag">Break {i + 1}</div>
            <label className="field-group">
              <span className="field-label">After period</span>
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
              onChange={(e) => setField("day_start", e.target.value)} />
          </label>
          <label className="field-group">
            <span className="field-label">School ends</span>
            <input type="time" value={form.day_end} required
              onChange={(e) => setField("day_end", e.target.value)} />
          </label>
        </div>

        <SectionErrors errors={weekErrs} />
      </Section>

      {/* ---- Subjects ---- */}
      <Section title="Subjects" icon={<BookIcon />}
        count={counts.subjects} setCount={(v) => setCount("subjects", v)}>
        <div className="rows">
          <div className="row-head">
            <span>Name</span><span>Periods / week</span><span>Type</span>
          </div>
          {form.subjects.map((s) => (
            <div className="row3" key={s.id}>
              <input value={s.name} aria-label="Subject name" placeholder="Subject name"
                onChange={(e) => updSubject(s.id, { name: e.target.value })} />

              {s.type === "THEORY_AND_LAB" ? (
                <span className="dual-count">
                  <input className="count" type="number" min={1} max={40}
                    value={s.theory_workload} aria-label="Theory periods per week"
                    onChange={(e) => updSubject(s.id, { theory_workload: Math.max(1, Number(e.target.value) || 1) })} />
                  <span className="dual-sep">T +</span>
                  <input className="count" type="number" min={2} max={40}
                    value={s.lab_workload} aria-label="Lab periods per week"
                    onChange={(e) => updSubject(s.id, { lab_workload: Math.max(2, Number(e.target.value) || 2) })} />
                  <span className="dual-sep">L</span>
                </span>
              ) : (
                <input className="count" type="number" min={1} max={40}
                  value={s.weekly_workload} aria-label="Periods per week"
                  onChange={(e) => updSubject(s.id, { weekly_workload: Math.max(1, Number(e.target.value) || 1) })} />
              )}

              <select data-type={s.type} value={s.type} aria-label="Subject type"
                onChange={(e) => updSubject(s.id, {
                  type: e.target.value,
                  block_length: e.target.value === "THEORY" ? 1 : 2,
                })}>
                <option value="THEORY">Theory</option>
                <option value="LAB">Lab only</option>
                <option value="THEORY_AND_LAB">Both</option>
              </select>
            </div>
          ))}
        </div>

        <p className={`hint ${need > slots ? "bad" : ""}`} style={{ marginTop: 14 }}>
          Each division needs <b>{need}</b> of <b>{slots}</b> available periods per week.
        </p>
        <SectionErrors errors={subjectErrs} />
      </Section>

      {/* ---- Teachers ---- */}
      <Section title="Teachers" icon={<UsersIcon />}
        count={counts.teachers} setCount={(v) => setCount("teachers", v)}>
        <p className="hint top">Click a subject chip to assign it to that teacher.</p>
        <div className="rows">
          {form.teachers.map((t) => (
            <div className="row-teacher" key={t.id}>
              <div className="teacher-name">
                <Avatar name={t.name} />
                <input value={t.name} aria-label="Teacher name" placeholder="Teacher name"
                  onChange={(e) => setField("teachers",
                    form.teachers.map((x) => x.id === t.id ? { ...x, name: e.target.value } : x))} />
              </div>
              <div className="chips">
                {form.subjects.map((s) => (
                  <button key={s.id} type="button"
                    className={`chip small ${t.subjectIds.includes(s.id) ? "on" : ""}`}
                    onClick={() => toggleTeach(t, s.id)}>{s.name}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <SectionErrors errors={teacherErrs} />
      </Section>

      {/* ---- Divisions / Classrooms / Labs ---- */}
      <div className="three">
        <Section title="Divisions" icon={<GridIcon />}
          count={counts.divisions} setCount={(v) => setCount("divisions", v)}>
          <Names items={form.divisions} label="Division" onChange={(v) => setField("divisions", v)} />
          <SectionErrors errors={divisionErrs} />
        </Section>

        <Section title="Classrooms" icon={<MonitorIcon />}
          count={counts.classrooms} setCount={(v) => setCount("classrooms", v)} min={0}>
          <Names items={form.classrooms} label="Classroom" onChange={(v) => setField("classrooms", v)} />
          <SectionErrors errors={classroomErrs} />
        </Section>

        <Section title="Labs" icon={<FlaskIcon />}
          count={counts.labs} setCount={(v) => setCount("labs", v)} min={0}>
          <Names items={form.labs} label="Lab" onChange={(v) => setField("labs", v)} />
          <SectionErrors errors={labErrs} />
        </Section>
      </div>

      {/* ---- Bottom bar ---- */}
      <div className="bottom-bar no-print">
        {problems.length > 0
          ? <span className="bad-text">{problems[0]}{problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}</span>
          : <span className="muted small">All set — ready to generate.</span>}
        <button className="primary big" disabled={busy || problems.length > 0} onClick={onGenerate}>
          {busy ? "Generating…" : "Generate timetable"}
        </button>
      </div>
    </>
  );
}

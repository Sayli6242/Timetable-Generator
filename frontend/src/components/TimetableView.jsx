import { useMemo, useState } from "react";

// What each cell shows under the subject name, depending on whose timetable it is.
const DETAILS = {
  division: (e) => `${e.teacher} · ${e.room}`,
  teacher: (e) => `${e.division} · ${e.room}`,
  room: (e) => `${e.division} · ${e.teacher}`,
};

// A stable colour per subject. FNV-1a hash, spread by the golden angle so
// near-identical names ("Subject 1", "Subject 2") still get distinct hues.
function hue(name) {
  let h = 2166136261;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Math.round(((h >>> 0) % 997) * 137.508) % 360;
}

function Grid({ input, entries, kind }) {
  const P = input.periods_per_day;
  const brks = new Set((input.break_after_periods || []).filter((b) => b > 0 && b < P));
  const at = new Map(entries.map((e) => [`${e.day}|${e.period}`, e]));
  const blockLen = {};
  for (const e of entries) blockLen[e.block_id] = (blockLen[e.block_id] ?? 0) + 1;

  const head = [];
  for (let p = 1; p <= P; p++) {
    head.push(<th key={p}>{p}</th>);
    if (brks.has(p)) head.push(<th key={`b${p}`} className="brk" />);
  }

  return (
    <div className="tt-scroll">
      <table className="tt">
        <thead><tr><th className="day" />{head}</tr></thead>
        <tbody>
          {input.working_days.map((day, di) => {
            const cells = [];
            for (let p = 1; p <= P; p++) {
              const e = at.get(`${day}|${p}`);
              const continuesBlock = e && at.get(`${day}|${p - 1}`)?.block_id === e.block_id;
              if (e && !continuesBlock) {
                cells.push(
                  <td key={p} colSpan={blockLen[e.block_id]} className="slot" style={{ "--h": hue(e.subject) }}>
                    <div className="subj">{e.subject}</div>
                    <div className="meta">{DETAILS[kind](e)}</div>
                  </td>
                );
              } else if (!e) {
                cells.push(<td key={p} className="free" />);
              }
              if (brks.has(p)) cells.push(<td key={`b${p}`} className="brk">{di === 0 && <span>BREAK</span>}</td>);
            }
            return <tr key={day}><th className="day">{day}</th>{cells}</tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Stats bar above the timetable ------------------------------------------
function StatsBar({ input, entries }) {
  const totalSlots = input.working_days.length * input.periods_per_day * input.divisions.length;
  const uniqueSlots = new Set(entries.map((e) => `${e.division}|${e.day}|${e.period}`)).size;
  const freePct = totalSlots > 0 ? Math.round(((totalSlots - uniqueSlots) / totalSlots) * 100) : 0;
  const uniqueTeachers = new Set(entries.map((e) => e.teacher)).size;
  return (
    <div className="stats-bar no-print">
      <div className="stat-item">
        <span className="stat-val">{uniqueSlots}</span>
        <span className="stat-label">Scheduled</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item">
        <span className="stat-val">{input.divisions.length}</span>
        <span className="stat-label">Divisions</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item">
        <span className="stat-val">{uniqueTeachers}</span>
        <span className="stat-label">Teachers</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item">
        <span className="stat-val">{freePct}%</span>
        <span className="stat-label">Free periods</span>
      </div>
    </div>
  );
}

const KIND_LABELS = [
  ["division", "Divisions"],
  ["teacher", "Teachers"],
  ["room", "Rooms"],
];

// ---- Renders all grids for PDF print ----------------------------------------
function PrintAll({ input, result, title, itemsByKind }) {
  return (
    <div className="print-only">
      <div className="print-doc-title">{title}</div>
      <div className="print-meta">
        {input.working_days.length} days/week · {input.periods_per_day} periods/day · {input.divisions.length} division{input.divisions.length !== 1 ? "s" : ""}
      </div>
      {KIND_LABELS.map(([kind, kindLabel]) =>
        itemsByKind[kind].map((item, idx) => (
          <div key={`${kind}|${item}`} className="print-page">
            <div className="print-section-label">{kindLabel}</div>
            <h2 className="print-item-title">{item}</h2>
            <Grid
              input={input}
              entries={result.entries.filter((e) => e[kind] === item)}
              kind={kind}
            />
          </div>
        ))
      )}
    </div>
  );
}

export default function TimetableView({ input, result, onSave, saving, saved, storageOn, onRename }) {
  const teachers = useMemo(() => [...new Set(result.entries.map((e) => e.teacher))].sort(), [result]);

  const [title, setTitle] = useState(input.name ?? "");
  const [editingTitle, setEditingTitle] = useState(false);

  const commitTitle = (val) => {
    const trimmed = val.trim() || "Untitled Timetable";
    setTitle(trimmed);
    setEditingTitle(false);
    onRename?.(trimmed);
  };

  const itemsByKind = useMemo(() => ({
    division: input.divisions.map((d) => d.name),
    teacher: teachers,
    room: input.rooms.map((r) => r.name),
  }), [input, teachers]);

  const [activeKind, setActiveKind] = useState("division");
  const [pick, setPick] = useState(`division|${input.divisions[0].name}`);

  const switchKind = (k) => {
    setActiveKind(k);
    const first = itemsByKind[k][0];
    if (first) setPick(`${k}|${first}`);
  };

  const [kind, name] = pick.split("|");
  const entries = result.entries.filter((e) => e[kind] === name);

  return (
    <section className="card">
      {/* ---- Timetable identity header ---- */}
      <div className="result-header no-print">
        {editingTitle ? (
          <input
            className="result-name-input"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={(e) => commitTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle(e.target.value);
              if (e.key === "Escape") { setTitle(input.name ?? ""); setEditingTitle(false); }
            }}
          />
        ) : (
          <h2 className="result-name editable-title" onClick={() => setEditingTitle(true)} title="Click to rename">
            {title || "Untitled Timetable"}
            <span className="edit-pencil" aria-hidden="true">✏</span>
          </h2>
        )}
        <p className="result-meta">
          {input.working_days.length} days/week · {input.periods_per_day} periods/day · {input.divisions.length} division{input.divisions.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* ---- View selector: group tabs + item chips ---- */}
      <div className="result-top no-print">
        <div className="result-top-row1">
          <div className="view-kind-tabs">
            {KIND_LABELS.map(([k, label]) => (
              <button key={k} type="button"
                className={`view-kind-tab ${activeKind === k ? "active" : ""}`}
                onClick={() => switchKind(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="view-actions">
            <button className="ghost" onClick={() => window.print()}>Download PDF</button>
            {storageOn && (saved
              ? <span className="saved">✓ Saved</span>
              : <button className="primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>)}
          </div>
        </div>
        <div className="view-item-chips">
          {itemsByKind[activeKind].map((item) => (
            <button key={item} type="button"
              className={`chip small ${name === item && kind === activeKind ? "on" : ""}`}
              onClick={() => setPick(`${activeKind}|${item}`)}>
              {item}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Stats bar ---- */}
      <StatsBar input={input} entries={result.entries} />

      <h2 className="tt-title no-print">{name}</h2>
      <div className="no-print">
        <Grid input={input} entries={entries} kind={kind} />
      </div>

      {/* ---- All grids: only visible when printing ---- */}
      <PrintAll input={input} result={result} title={title} itemsByKind={itemsByKind} />
    </section>
  );
}

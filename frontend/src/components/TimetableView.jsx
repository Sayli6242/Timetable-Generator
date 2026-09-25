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

export default function TimetableView({ input, result, onSave, saving, saved, storageOn }) {
  const teachers = useMemo(() => [...new Set(result.entries.map((e) => e.teacher))].sort(), [result]);
  const [pick, setPick] = useState(`division|${input.divisions[0].name}`);
  const [kind, name] = pick.split("|");
  const entries = result.entries.filter((e) => e[kind] === name);

  return (
    <section className="card">
      <div className="result-bar no-print">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Show timetable for">
          <optgroup label="Divisions">{input.divisions.map((d) => <option key={d.name} value={`division|${d.name}`}>{d.name}</option>)}</optgroup>
          <optgroup label="Teachers">{teachers.map((t) => <option key={t} value={`teacher|${t}`}>{t}</option>)}</optgroup>
          <optgroup label="Rooms">{input.rooms.map((r) => <option key={r.name} value={`room|${r.name}`}>{r.name}</option>)}</optgroup>
        </select>
        <div className="spacer" />
        <button className="ghost" onClick={() => window.print()}>Download PDF</button>
        {storageOn && (saved
          ? <span className="saved">✓ Saved</span>
          : <button className="primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>)}
      </div>
      <h2 className="tt-title">{name}</h2>
      <Grid input={input} entries={entries} kind={kind} />
    </section>
  );
}

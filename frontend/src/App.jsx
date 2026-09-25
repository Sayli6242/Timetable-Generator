import { useEffect, useState } from "react";
import { api } from "./api.js";
import SetupForm from "./components/SetupForm.jsx";
import TimetableView from "./components/TimetableView.jsx";
import {
  autoAssign, emptyForm, fromPayload, makeClassroom, makeDivision, makeLab,
  makeSubject, makeTeacher, resize, toPayload,
} from "./lib/form.js";

const MAKERS = {
  subjects: makeSubject, teachers: makeTeacher, divisions: makeDivision,
  classrooms: makeClassroom, labs: makeLab,
};

function initialForm() {
  const f = emptyForm();
  f.subjects = resize([], 5, makeSubject);
  f.subjects[4] = { ...f.subjects[4], name: "Subject 5 Lab", type: "LAB", weekly_workload: 2 };
  f.teachers = resize([], 5, makeTeacher);
  f.divisions = resize([], 2, makeDivision);
  f.classrooms = resize([], 2, makeClassroom);
  f.labs = resize([], 1, makeLab);
  return autoAssign(f);
}

function SavedList({ onOpen, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.list().then(setRows).catch((e) => setErr(e.message)); }, []);
  const remove = async (id) => {
    if (!confirm("Delete this timetable?")) return;
    try { await api.remove(id); setRows((r) => r.filter((x) => x.id !== id)); } catch (e) { setErr(e.message); }
  };
  return (
    <section className="card">
      <div className="section-head"><h2>Saved timetables</h2><button className="ghost" onClick={onClose}>Close</button></div>
      {err && <p className="bad-text">{err}</p>}
      {!rows && !err && <p className="muted">Loading…</p>}
      {rows?.length === 0 && <p className="muted">Nothing saved yet.</p>}
      {rows?.map((r) => (
        <div className="saved-row" key={r.id}>
          <div><b>{r.name}</b><div className="muted small">{new Date(r.created_at).toLocaleString()}</div></div>
          <div>
            <button className="ghost" onClick={() => onOpen(r.id)}>Open</button>
            <button className="ghost danger" onClick={() => remove(r.id)}>Delete</button>
          </div>
        </div>
      ))}
    </section>
  );
}

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [screen, setScreen] = useState("setup"); // setup | result | saved
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);      // { title, items }
  const [result, setResult] = useState(null);
  const [payload, setPayload] = useState(null);
  const [storageOn, setStorageOn] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewKey, setViewKey] = useState(0);

  useEffect(() => {
    api.health()
      .then((h) => setStorageOn(h.storage === "supabase"))
      .catch((e) => setError({ title: e.message }))
      .finally(() => setConnecting(false));
  }, []);

  const fail = (e) => setError({ title: e.message });
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const counts = Object.fromEntries(Object.keys(MAKERS).map((k) => [k, form[k].length]));
  const setCount = (k, n) => setForm((f) => {
    const next = { ...f, [k]: resize(f[k], n, MAKERS[k]) };
    if (k === "subjects") {
      const ids = new Set(next.subjects.map((s) => s.id));
      next.teachers = f.teachers.map((t) => ({ ...t, subjectIds: t.subjectIds.filter((id) => ids.has(id)) }));
    }
    return next;
  });

  const loadSample = async () => {
    setError(null);
    try { setForm(fromPayload(await api.sample())); setScreen("setup"); } catch (e) { fail(e); }
  };

  const generate = async () => {
    setBusy(true); setError(null); setSaved(false);
    const p = toPayload(form);
    try {
      const r = await api.generate(p);
      if (r.status === "ok") {
        setPayload(p); setResult(r); setViewKey((k) => k + 1); setScreen("result");
        window.scrollTo(0, 0);
      } else {
        setError({
          title: r.status === "invalid"
            ? "Invalid inputs — cannot generate timetable:"
            : "Impossible to generate timetable — no valid arrangement exists:",
          items: r.errors.map((e) => e.message),
        });
      }
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const save = async () => {
    setSaving(true); setError(null);
    try { await api.save(payload, result); setSaved(true); } catch (e) { fail(e); } finally { setSaving(false); }
  };

  const openSaved = async (id) => {
    setError(null);
    try {
      const row = await api.get(id);
      setForm(fromPayload(row.input));
      setPayload(row.input); setResult(row.result); setSaved(true);
      setViewKey((k) => k + 1); setScreen("result");
    } catch (e) { fail(e); }
  };

  return (
    <div className="app">
      <header className="top no-print">
        <div className="top-title">
          <h1>Timetable Generator</h1>
          <span className="top-subtitle">Build conflict-free school schedules in seconds</span>
        </div>
        <div className="top-actions">
          {screen === "result" && <button className="ghost" onClick={() => setScreen("setup")}>← Edit inputs</button>}
          {screen === "setup" && <button className="ghost" onClick={loadSample}>Try an example</button>}
          {storageOn && screen !== "saved" && <button className="ghost" onClick={() => setScreen("saved")}>Saved</button>}
        </div>
      </header>

      {connecting && <div className="notice warn no-print">Waking up the server… this can take up to a minute on free hosting.</div>}
      {error && (
        <div className="notice bad no-print">
          <b>{error.title}</b>
          {error.items && <ul>{error.items.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        </div>
      )}

      {screen === "setup" && (
        <SetupForm form={form} setField={setField} counts={counts} setCount={setCount} onGenerate={generate} busy={busy} />
      )}
      {screen === "result" && result && (
        <>
          <div className="notice good no-print">✓ No clashes: every division, teacher and room is booked at most once per period.</div>
          <TimetableView key={viewKey} input={payload} result={result} storageOn={storageOn}
            onSave={save} saving={saving} saved={saved} />
        </>
      )}
      {screen === "saved" && <SavedList onOpen={openSaved} onClose={() => setScreen(result ? "result" : "setup")} />}
    </div>
  );
}

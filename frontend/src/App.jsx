import { useEffect, useRef, useState } from "react";
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

function SavedList({ onOpen, onEdit, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.list().then(setRows).catch((e) => setErr(e.message)); }, []);
  const remove = async (id) => {
    if (!confirm("Delete this timetable?")) return;
    try { await api.remove(id); setRows((r) => r.filter((x) => x.id !== id)); } catch (e) { setErr(e.message); }
  };
  return (
    <section className="card">
      <div className="section-head"><h2>Saved timetables</h2><button className="ghost" onClick={onClose}>← Back</button></div>
      {err && <p className="bad-text">{err}</p>}
      {!rows && !err && <p className="muted">Loading…</p>}
      {rows?.length === 0 && <p className="muted">Nothing saved yet.</p>}
      {rows?.map((r) => (
        <div className="saved-row" key={r.id}>
          <div><b>{r.name}</b><div className="muted small">{new Date(r.created_at).toLocaleString()}</div></div>
          <div>
            <button className="ghost" onClick={() => onOpen(r.id)}>Open</button>
            <button className="ghost" onClick={() => onEdit(r.id)}>Edit</button>
            <button className="ghost danger" onClick={() => remove(r.id)}>Delete</button>
          </div>
        </div>
      ))}
    </section>
  );
}

// ---- Sun / Moon icons -------------------------------------------------------
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

export default function App() {
  // ---- Dark mode ----
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem("tm-dark");
      if (stored !== null) return stored === "1";
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("tm-dark", dark ? "1" : "0"); } catch {}
  }, [dark]);

  // ---- Form — loaded from draft if available ----
  const [form, setFormRaw] = useState(() => {
    try {
      const draft = localStorage.getItem("tm-draft");
      if (draft) return JSON.parse(draft);
    } catch {}
    return initialForm();
  });
  const [formDirty, setFormDirty] = useState(() => {
    try { return !!localStorage.getItem("tm-draft"); } catch { return false; }
  });
  const [draftSaved, setDraftSaved] = useState(false);
  const draftTimer = useRef(null);

  // Wrapper so every form change marks dirty + auto-saves
  const setForm = (updater) => {
    setFormDirty(true);
    setFormRaw(updater);
  };

  useEffect(() => {
    if (!formDirty) return;
    try { localStorage.setItem("tm-draft", JSON.stringify(form)); } catch {}
    setDraftSaved(true);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => setDraftSaved(false), 2000);
  }, [form]);

  const [screen, setScreen] = useState("setup"); // setup | result | saved
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);      // { title, items }
  const [result, setResult] = useState(null);
  const [payload, setPayload] = useState(null);
  const [storageOn, setStorageOn] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [viewKey, setViewKey] = useState(0);

  // ---- First-time welcome banner ----
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return !localStorage.getItem("tm-seen"); } catch { return false; }
  });
  const dismissWelcome = () => {
    try { localStorage.setItem("tm-seen", "1"); } catch {}
    setShowWelcome(false);
  };

  // ---- Guided mode (activated after loading sample) ----
  const [guidedMode, setGuidedMode] = useState(false);

  // ---- Confirm before loading sample / resetting ----
  const [confirmSample, setConfirmSample] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

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

  const doLoadSample = async () => {
    setConfirmSample(false); setError(null);
    try {
      setFormRaw(fromPayload(await api.sample()));
      setFormDirty(false);
      setGuidedMode(true);
      try { localStorage.removeItem("tm-draft"); } catch {}
      setScreen("setup");
    } catch (e) { fail(e); }
  };

  const loadSample = () => {
    if (formDirty) { setConfirmSample(true); return; }
    doLoadSample();
  };

  const doReset = () => {
    setFormRaw({ ...emptyForm(), name: "" });
    setFormDirty(false);
    setGuidedMode(false);
    setSavedId(null);
    try { localStorage.removeItem("tm-draft"); } catch {}
    setConfirmReset(false);
    window.scrollTo(0, 0);
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
    try {
      const row = savedId
        ? await api.update(savedId, payload, result)
        : await api.save(payload, result);
      if (row?.id) setSavedId(row.id);
      setSaved(true);
    } catch (e) { fail(e); } finally { setSaving(false); }
  };

  const openSaved = async (id) => {
    setError(null);
    try {
      const row = await api.get(id);
      setFormRaw(fromPayload(row.input));
      setPayload(row.input); setResult(row.result); setSaved(true); setSavedId(id);
      setViewKey((k) => k + 1); setScreen("result");
    } catch (e) { fail(e); }
  };

  const editSaved = async (id) => {
    setError(null);
    try {
      const row = await api.get(id);
      setFormRaw(fromPayload(row.input));
      setFormDirty(false);
      setSavedId(id);
      setScreen("setup");
      window.scrollTo(0, 0);
    } catch (e) { fail(e); }
  };

  return (
    <div className="app">
      <header className="top no-print">
        <div className="top-title-wrap">
          <div className="app-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </div>
          <div className="top-title">
            <h1>
              Timetable Generator
              {screen === "result" && payload?.name && (
                <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: "0.85rem", marginLeft: 10 }}>
                  — {payload.name}
                </span>
              )}
            </h1>
            <span className="top-subtitle">Build conflict-free school schedules in seconds</span>
          </div>
        </div>
        <div className="top-actions">
          {screen === "result" && <button className="ghost" onClick={() => { setScreen("setup"); setSaved(false); }}>← Edit inputs</button>}
          {screen === "setup" && (
            <>
              <button className="ghost" onClick={loadSample}>Try an example</button>
              {formDirty && <button className="ghost" onClick={() => setConfirmReset(true)}>Start over</button>}
            </>
          )}
          {storageOn && screen !== "saved" && <button className="ghost" onClick={() => setScreen("saved")}>Saved</button>}
          <button className="ghost dark-toggle" onClick={() => setDark((d) => !d)}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={dark ? "Light mode" : "Dark mode"}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      {/* ---- Welcome banner (first-time visitors only) ---- */}
      {showWelcome && screen === "setup" && (
        <div className="notice welcome no-print">
          <button className="notice-dismiss" onClick={dismissWelcome} aria-label="Dismiss">×</button>
          <b>Welcome!</b> Fill in your school's subjects, teachers, and rooms — then hit <b>Generate</b>. Takes about 2 minutes.
          {" "}<button className="inline-link" onClick={() => { dismissWelcome(); loadSample(); }}>Try an example first →</button>
        </div>
      )}

      {/* ---- Sample load confirmation ---- */}
      {confirmSample && (
        <div className="notice warn no-print">
          <b>Replace your current inputs with the example?</b> Your entered data will be lost.
          <div className="notice-actions">
            <button className="primary small" onClick={doLoadSample}>Yes, load example</button>
            <button className="ghost small" onClick={() => setConfirmSample(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ---- Reset confirmation ---- */}
      {confirmReset && (
        <div className="notice warn no-print">
          <b>Clear everything and start over?</b> All your inputs will be erased.
          <div className="notice-actions">
            <button className="primary small" onClick={doReset}>Yes, start over</button>
            <button className="ghost small" onClick={() => setConfirmReset(false)}>Cancel</button>
          </div>
        </div>
      )}

      {connecting && <div className="notice warn no-print">Waking up the server… this can take up to a minute on free hosting.</div>}
      {error && (
        <div className="notice bad no-print">
          <button className="notice-dismiss" onClick={() => setError(null)} aria-label="Dismiss">×</button>
          <b>{error.title}</b>
          {error.items && <ul>{error.items.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        </div>
      )}

      {screen === "setup" && (
        <SetupForm form={form} setField={setField} counts={counts} setCount={setCount}
          onGenerate={generate} busy={busy}
          storageOn={storageOn}
          onLoadSample={loadSample}
          onShowSaved={() => setScreen("saved")}
          draftSaved={draftSaved}
          onStartOver={formDirty ? () => setConfirmReset(true) : null}
          guidedMode={guidedMode}
          onDismissGuide={() => setGuidedMode(false)}
        />
      )}
      {screen === "result" && result && (
        <>
          <div className="notice good no-print">✓ No clashes: every division, teacher and room is booked at most once per period.</div>
          <TimetableView key={viewKey} input={payload} result={result} storageOn={storageOn}
            onSave={save} saving={saving} saved={saved}
            onRename={(name) => { setPayload((p) => ({ ...p, name })); setSaved(false); }} />
        </>
      )}
      {screen === "saved" && <SavedList onOpen={openSaved} onEdit={editSaved} onClose={() => setScreen(result ? "result" : "setup")} />}
    </div>
  );
}

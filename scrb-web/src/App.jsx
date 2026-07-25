import { useState, useRef } from "react";
import "./App.css";

/* ------------------------------------------------------------------ *
 * SCRB Insight — answer view
 *
 * Wired to the real scrb-api (M6). Submits a question with a
 * hand-written Contract 2 payload (standing in for P4's router, which
 * doesn't exist yet — the design doc's whole point is that M6 is fully
 * testable before the model exists), polls Contract 4's progress shape,
 * and renders whatever Contract 3 answer comes back.
 * ------------------------------------------------------------------ */

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:9000";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const OFFENCES = [
  { id: 12, en: "Chain snatching", kn: "ಸರಪಳಿ ಕಳವು" },
  { id: 45, en: "House breaking", kn: "ಮನೆ ಕಳ್ಳತನ" },
  { id: 78, en: "Vehicle theft", kn: "ವಾಹನ ಕಳವು" },
  { id: 91, en: "Cheating", kn: "ವಂಚನೆ" },
];

const EXAMPLES = [
  { q: "chain snatchings this year by day and hour", intent: "TREND_BY_TIME" },
  { q: "monthly trend of this offence", intent: "TREND_BY_MONTH" },
  { q: "which units have the most of this", intent: "COUNT_BY_AREA" },
  { q: "by district", intent: "COUNT_BY_DISTRICT" },
  { q: "top crime types this year", intent: "TOP_CRIME_TYPES" },
  { q: "victim gender breakdown", intent: "VICTIM_BREAKDOWN" },
  { q: "accused age groups", intent: "ACCUSED_BREAKDOWN" },
  { q: "chargesheet rate", intent: "CHARGESHEET_RATE" },
  { q: "conviction rate", intent: "CONVICTION_ANALYSIS" },
  { q: "investigation delay", intent: "INVESTIGATION_DELAY" },
  { q: "hotspots", intent: "HOTSPOT_CURRENT" },
  { q: "this year vs last", intent: "TREND_COMPARE_PERIOD" },
  { q: "seasonal pattern", intent: "SEASONAL_PATTERN" },
  { q: "repeat accused", intent: "PERSON_CASE_HISTORY" },
  { q: "habitual offenders", intent: "HABITUAL_OFFENDERS" },
  { q: "trend (but I wont say which year)", intent: "TREND_BY_TIME", omitYear: true },
  { q: "map a criminal network", intent: "NETWORK_AROUND_PERSON" },
  { q: "forecast this offence", intent: "FORECAST_TREND" },
];

// UI copy, English + Kannada. Interface language toggles independently of
// what the router understands. Real Kannada understanding needs P4 router;
// the whole voice/language shell is here and plugs in when it lands.
const T = {
  en: { ask: "Ask", placeholder: "Ask a question...", offence: "Offence", listening: "Listening...", speak: "Speak answer", stop: "Stop", produced: "How this answer was produced", need: "Need one more detail", lang: "\u0c95\u0ca8\u0ccd\u0ca8\u0ca1" },
  kn: { ask: "ಕೇಳಿ", placeholder: "ಪ್ರಶ್ನೆ ಕೇಳಿ...", offence: "ಅಪರಾಧ", listening: "ಆಲಿಸುತ್ತಿದೆ...", speak: "ಉತ್ತರ ಓದಿ", stop: "ನಿಲ್ಲಿಸಿ", produced: "ಈ ಉತ್ತರ ಹೇಗೆ ರಚಿಸಲಾಗಿದೆ", need: "ಇನ್ನೊಂದು ವಿವರ ಬೇಕು", lang: "English" },
};

/* Canned Contract 2 payload, standing in for fn-intent-router (P4/M9).
   Picks the intent from the chosen example; entities stay fixed for the
   demo. Swap for a real router call when M9 exists. */
function buildContract2(intent, offenceId, omitYear) {
  const base = {
    crime_subhead_id: { value: offenceId, type: "INT", is_list: false, source: "STATED" },
    crime_head_id: null,
    unit_id: { value: 4430006, type: "INT", is_list: false, source: "INHERITED_FROM_SESSION" },
    district_id: null, case_master_id: null, person_id: null, community_id: null, case_category_id: null,
    year_num: { value: 2024, type: "INT", is_list: false, source: "DERIVED" },
    year_month: null, date_from: null, date_to: null,
    group_by: { value: "DAY_AND_HOUR", type: "ENUM", is_list: false, source: "STATED" },
    dimension: null,
  };
  if (intent === "TOP_CRIME_TYPES" || intent === "COUNT_BY_CRIME_TYPE") base.crime_subhead_id = null;
  if (intent === "TREND_COMPARE_PERIOD") base.year_num = null;
  if (omitYear) base.year_num = null; // deliberately trigger CLARIFICATION_NEEDED
  return { intent, confidence: 0.94, is_followup: false, entities: base };
}

const STAGE_LABELS = {
  QUEUED: "Queued",
  UNDERSTANDING: "Understanding the question",
  PERMISSION: "Checking permissions",
  TEMPLATE_SELECT: "Selecting a query template",
  QUERYING: "Querying the database",
  ANALYSING: "Analysing results",
  EXPLAINING: "Writing the explanation",
  AUDITING: "Recording the audit trail",
  FINALISING: "Finalising",
  DONE: "Done",
  FAILED: "Failed",
};

const pad = (n) => String(n).padStart(2, "0");

const REQUIRED = [
  "question", "intent", "entities", "permission", "template", "zcql",
  "tables_used", "source", "rows_returned", "rows_suppressed",
  "execution_ms", "confidence", "data_as_of", "warnings",
];

function Heatmap({ spec }) {
  const cells = spec.cells ?? [];
  const lookup = new Map(cells.map((c) => [`${c.day_of_week}-${c.hour_of_day}`, c.count]));
  const max = Math.max(...cells.map((c) => c.count), 1);
  const peak = cells.length ? cells.reduce((a, b) => (b.count > a.count ? b : a), cells[0]) : null;

  return (
    <figure className="heat">
      <div className="heat__scroll">
        <div className="heat__grid">
          <div className="heat__corner" aria-hidden="true" />
          {HOURS.map((h) => (
            <div key={h} className="heat__hour" aria-hidden="true">
              {h % 3 === 0 ? pad(h) : ""}
            </div>
          ))}
          {DAYS.map((label, i) => {
            const day = i + 1;
            return (
              <div className="heat__row" key={day} style={{ "--row": i }}>
                <div className="heat__day">{label}</div>
                {HOURS.map((h) => {
                  const count = lookup.get(`${day}-${h}`) ?? 0;
                  const isPeak = peak && peak.day_of_week === day && peak.hour_of_day === h;
                  return (
                    <div
                      key={h}
                      className={"heat__cell" + (count ? " is-filled" : "") + (isPeak ? " is-peak" : "")}
                      style={{ "--w": count / max }}
                      title={`${label} ${pad(h)}:00 — ${count} case${count === 1 ? "" : "s"}`}
                    >
                      <span className="visually-hidden">{label} {pad(h)}:00, {count} cases</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <figcaption className="heat__legend">
        <span className="heat__legend-label">{spec.value?.label ?? "Cases"}</span>
        <span className="heat__ramp" aria-hidden="true">
          <i style={{ "--w": 0.08 }} /><i style={{ "--w": 0.3 }} /><i style={{ "--w": 0.55 }} /><i style={{ "--w": 0.8 }} /><i style={{ "--w": 1 }} />
        </span>
        <span className="heat__legend-max">{max} max</span>
        {peak && <span className="heat__peak-note">Peak {DAYS[peak.day_of_week - 1]} {pad(peak.hour_of_day)}:00</span>}
      </figcaption>
    </figure>
  );
}

function BarChart({ spec }) {
  const points = spec.points ?? [];
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <figure className="bars">
      {spec.geographic && (
        <p className="bars__geo">Geographic distribution — ranked; boundary map pending GIS layer</p>
      )}
      {points.map((p, i) => (
        <div className="bars__row" key={i} style={{ "--i": i }}>
          <span className="bars__label" title={p.category}>{p.category}</span>
          <span className="bars__track">
            <span className="bars__fill" style={{ "--w": p.value / max }} />
          </span>
          <span className="bars__val">{spec.is_rate ? `${p.value}%` : p.value}</span>
        </div>
      ))}
      <figcaption className="bars__cap">{spec.value?.label}</figcaption>
    </figure>
  );
}

function LineChart({ spec }) {
  const points = spec.points ?? [];
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const W = 640, H = 200, PAD = 28;
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [PAD + i * step, H - PAD - (p.value / max) * (H - PAD * 2)]);
  const path = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${xy[xy.length - 1][0].toFixed(1)},${H - PAD} L${xy[0][0].toFixed(1)},${H - PAD} Z`;
  return (
    <figure className="line">
      <svg viewBox={`0 0 ${W} ${H}`} className="line__svg" role="img" aria-label="Trend over time">
        <path d={area} className="line__area" />
        <path d={path} className="line__stroke" />
        {xy.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="3.5" className="line__dot" />
            <text x={x} y={H - PAD + 16} className="line__xlabel" textAnchor="middle">
              {points[i].category}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="bars__cap">{spec.value?.label}</figcaption>
    </figure>
  );
}

function Visual({ visual }) {
  if (!visual) return null;
  if (visual.type === "HEATMAP_DAY_HOUR") return <Heatmap spec={visual.spec} />;
  if (visual.type === "BAR_CATEGORY") return <BarChart spec={visual.spec} />;
  if (visual.type === "LINE_TIME") return <LineChart spec={visual.spec} />;
  return null;
}

function Field({ n, label, children, mono, wide }) {
  return (
    <section className={"ev" + (wide ? " ev--wide" : "")}>
      <header className="ev__head">
        <span className="ev__n">{pad(n)}<span className="ev__n-of">/14</span></span>
        <h3 className="ev__label">{label}</h3>
      </header>
      <div className={"ev__body" + (mono ? " is-mono" : "")}>{children}</div>
    </section>
  );
}

function AnswerView({ result, lang, t }) {
  const { answer: ans, evidence: ev, outcome, turn_id, audit_id, error } = result;

  if (outcome === "CLARIFICATION_NEEDED") {
    return (
      <div className="notice notice--ask">
        <p className="notice__code">Need one more detail</p>
        <p>{error?.clarifying_question || error?.message}</p>
      </div>
    );
  }

  if (outcome === "UNSUPPORTED" || outcome === "ERROR") {
    return (
      <div className="notice notice--error">
        <p className="notice__code">{error?.code}</p>
        <p>{error?.message}</p>
        {error?.detail && <p className="muted">{error.detail}</p>}
        {error?.nearest_supported?.length > 0 && (
          <p className="muted">Try asking about: {error.nearest_supported.join(", ")}</p>
        )}
      </div>
    );
  }

  const present = ev ? REQUIRED.filter((k) => ev[k] !== undefined).length : 0;

  return (
    <>
      <header className="masthead masthead--slim">
        <dl className="masthead__meta">
          <div><dt>Turn</dt><dd>{turn_id}</dd></div>
          <div><dt>Audit</dt><dd>{audit_id}</dd></div>
          <div><dt>Outcome</dt><dd className="is-outcome">{outcome}</dd></div>
        </dl>
      </header>

      <main className="layout">
        <div className="col col--answer">
          <div className="ask">
            <span className="ask__tag">Asked</span>
            <p className="ask__text">{ev.question.raw}</p>
            <span className="ask__via">{ev.question.via} · {ev.question.language.toUpperCase()}</span>
          </div>
          <p className="summary">{ans.summary}</p>
          {ans.reasoning && <p className="reasoning">{ans.reasoning}</p>}
          {ans.visual && <Visual visual={ans.visual} />}
          {ans.table && (
            <div className="table-wrap">
              <table className="tbl">
                <caption className="tbl__cap">
                  Top cells
                  {ans.table.total_rows != null && <span> — {ans.table.total_rows} rows total</span>}
                  {ans.table.truncated && <span className="tbl__trunc"> · truncated</span>}
                </caption>
                <thead><tr>{ans.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {ans.table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{String(v)}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="col col--evidence" aria-label="Evidence">
          <header className="ev-head">
            <h2 className="ev-head__title">How this answer was produced</h2>
            <p className="ev-head__count">
              <strong>{present} of 14</strong> fields present
              {present < 14 && <span className="ev-head__gap"> — incomplete</span>}
            </p>
          </header>

          <Field n={1} label="Question">{ev.question.raw}</Field>
          <Field n={2} label="Intent">
            <span className="chip">{ev.intent.value}</span>
            <span className="muted"> confidence {ev.intent.confidence}</span>
          </Field>
          <Field n={3} label="Entities">
            <ul className="ents">
              {ev.entities.map((e) => (
                <li key={e.slot}>
                  <code>{e.slot}</code>
                  <span className="ents__val">{String(e.value)}{e.label && <em> — {e.label}</em>}</span>
                  <span className="ents__src">{e.source}</span>
                </li>
              ))}
            </ul>
          </Field>
          <Field n={4} label="Permission">
            <span className="chip">{ev.permission.role}</span>
            <span className="chip chip--quiet">{ev.permission.scope_rule}</span>
            <span className="chip chip--quiet">{ev.permission.field_policy}</span>
            <p className="muted">
              min cell size {ev.permission.min_cell_size} · rule {ev.permission.rule_id ?? "—"} ·{" "}
              {ev.permission.narrowed ? "scope was narrowed to your jurisdiction" : "not narrowed"}
            </p>
          </Field>
          <Field n={5} label="Template">
            <code>{ev.template.id}</code> <span className="muted">v{ev.template.version}</span>
            <p className="muted">written by {ev.template.author} · reviewed by {ev.template.reviewer} on {ev.template.reviewed}</p>
          </Field>
          <Field n={6} label="Statement executed" mono wide>
            <pre className="zcql">{ev.zcql}</pre>
          </Field>
          <Field n={7} label="Tables read">
            {ev.tables_used.map((t) => <code key={t} className="chip chip--code">{t}</code>)}
          </Field>
          <Field n={8} label="Source">
            <span className="chip chip--source">{ev.source}</span>
            <span className="muted"> read-only analytical copy</span>
          </Field>
          <Field n={9} label="Rows returned">
            <span className="stat">{ev.rows_returned}</span>
            {ev.pages_fetched > 1 && <span className="muted"> across {ev.pages_fetched} pages</span>}
          </Field>
          <Field n={10} label="Rows suppressed">
            <span className="stat">{ev.rows_suppressed}</span>
            <span className="muted"> {ev.rows_suppressed === 0 ? "nothing withheld" : "below minimum cell size"}</span>
          </Field>
          <Field n={11} label="Timing" wide>
            <ul className="timing">
              {Object.entries(ev.execution_ms).filter(([k]) => k !== "total").map(([k, v]) => (
                <li key={k}>
                  <span className="timing__k">{k}</span>
                  <span className="timing__bar" style={{ "--w": v / ev.execution_ms.total }} />
                  <span className="timing__v">{v} ms</span>
                </li>
              ))}
            </ul>
            <p className="timing__total">total <strong>{ev.execution_ms.total} ms</strong></p>
          </Field>
          <Field n={12} label="Confidence">
            <span className="chip">{ev.confidence.analytical}</span>
            <span className="muted"> intent {ev.confidence.intent}</span>
          </Field>
          <Field n={13} label="Data as of">
            <time dateTime={ev.data_as_of}>{new Date(ev.data_as_of).toLocaleString("en-IN")}</time>
          </Field>
          <Field n={14} label="Warnings">
            {ev.warnings.length === 0 ? <span className="muted">None</span> : (
              <ul className="warns">
                {ev.warnings.map((w) => <li key={w.code}><code>{w.code}</code> {w.message}</li>)}
              </ul>
            )}
          </Field>
        </aside>
      </main>

      <footer className="foot">
        <p>Rendered live from scrb-api. M6's real builder ran; execution used local seed data, not live Catalyst — see the warning above.</p>
      </footer>
    </>
  );
}

export default function App() {
  const [question, setQuestion] = useState("chain snatchings this year by day and hour");
  const [intent, setIntent] = useState("TREND_BY_TIME");
  const [offence, setOffence] = useState(12);
  const [lang, setLang] = useState("en");
  const [listening, setListening] = useState(false);
  const [stage, setStage] = useState(null);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const pollRef = useRef(null);
  const recogRef = useRef(null);
  const t = T[lang];

  async function ask(useIntent = intent, omitYear = false) {
    setResult(null);
    setErrorMsg(null);
    setStage("QUEUED");
    clearInterval(pollRef.current);

    try {
      const res = await fetch(`${API_BASE}/conversations/c1/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, as_unit_id: 4430006, contract2: buildContract2(useIntent, offence, omitYear) }),
      });
      if (!res.ok) throw new Error(`submit failed: ${res.status}`);
      const { turn_id } = await res.json();

      pollRef.current = setInterval(async () => {
        const s = await fetch(`${API_BASE}/turns/${turn_id}/status`).then((r) => r.json());
        setStage(s.stage);
        if (s.terminal) {
          clearInterval(pollRef.current);
          const final = await fetch(`${API_BASE}/turns/${turn_id}`).then((r) => r.json());
          setResult(final);
        }
      }, 400);
    } catch (e) {
      setErrorMsg(`Could not reach scrb-api at ${API_BASE}. Is it running? (${e.message})`);
      setStage(null);
    }
  }

  function pickExample(ex) {
    setQuestion(ex.q);
    setIntent(ex.intent);
    ask(ex.intent, !!ex.omitYear);
  }

  // ── Voice input via the browser Web Speech API. Recognises English or
  // Kannada depending on the language toggle. No backend needed. When P4's
  // router understands Kannada, the transcript already flows through the
  // same ask() path — only the fake buildContract2 gets replaced.
  function toggleVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setErrorMsg("This browser doesn't support voice input. Try Chrome.");
      return;
    }
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const r = new SR();
    r.lang = lang === "kn" ? "kn-IN" : "en-IN";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setQuestion(text);
      // Demo router stand-in: keep the currently selected intent, since the
      // real intent classification is P4's job. The transcript is real.
      ask(intent, false);
    };
    recogRef.current = r;
    r.start();
  }

  // ── Text-to-speech: read the answer summary aloud in the chosen language.
  function speakAnswer() {
    if (!result?.answer?.summary) return;
    const u = new SpeechSynthesisUtterance(result.answer.summary);
    u.lang = lang === "kn" ? "kn-IN" : "en-IN";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  const busy = stage && stage !== "DONE" && stage !== "FAILED";

  return (
    <div className="page">
      <div className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark">SCRB</span>
          <span className="topbar__sub">Insight</span>
          <span className="topbar__tag">Conversational crime analytics</span>
        </div>
        <div className="topbar__controls">
          <div className="seg">
            <span className="seg__label">{t.offence}</span>
            <select className="seg__select" value={offence} onChange={(e) => setOffence(Number(e.target.value))} disabled={busy}>
              {OFFENCES.map((o) => (
                <option key={o.id} value={o.id}>{lang === "kn" ? o.kn : o.en}</option>
              ))}
            </select>
          </div>
          <button className="lang-toggle" onClick={() => setLang(lang === "en" ? "kn" : "en")}>
            {lang === "en" ? "ಕನ್ನಡ" : "English"}
          </button>
        </div>
      </div>

      <div className="composer">
        <input
          className="composer__input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder={t.placeholder}
        />
        <button
          className={"mic" + (listening ? " is-live" : "")}
          onClick={toggleVoice}
          title={listening ? t.listening : "Voice"}
          disabled={busy && !listening}
        >
          {listening ? "●" : "🎤"}
        </button>
        <button className="composer__btn" onClick={() => ask()} disabled={busy}>{t.ask}</button>
      </div>

      {listening && <p className="progress"><span className="progress__dot" />{t.listening}</p>}

      <div className="examples">
        {EXAMPLES.map((ex, i) => (
          <button
            key={i}
            className={"examples__chip" + (ex.intent === intent && !ex.omitYear ? " is-active" : "") + (ex.omitYear ? " is-special" : "")}
            onClick={() => pickExample(ex)}
            disabled={busy}
          >
            {ex.q}
          </button>
        ))}
      </div>

      {busy && (
        <p className="progress"><span className="progress__dot" />{STAGE_LABELS[stage] || stage}…</p>
      )}

      {errorMsg && <div className="notice notice--error">{errorMsg}</div>}

      {result && (
        <>
          {result.answer?.summary && (
            <button className="speak-btn" onClick={speakAnswer}>🔊 {t.speak}</button>
          )}
          <AnswerView result={result} lang={lang} t={t} />
        </>
      )}
    </div>
  );
}

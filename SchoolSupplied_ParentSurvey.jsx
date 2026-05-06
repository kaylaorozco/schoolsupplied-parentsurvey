import { useState, useEffect } from "react";

// Parent discovery survey for SchoolSupplied.
// Goal: surface what's *actually* the second-most-painful school-related task
// across the year — so we can decide whether v2 is class coordination,
// permission slips, year-round teacher requests, or something else entirely.
//
// - Persistent shared storage so all submissions roll up in one place
// - Admin view at ?admin=1 (read responses, copy emails, clear all)
// - $25 coffee gift card raffle for completed submissions (auto-entered)
// - Clear consent line about future communication + opt-out

const STORAGE_KEY = "schoolsupplied_parent_survey";

// ============================================================
// Question definitions
// Single source of truth — questions render from this array, and the
// admin view also uses it to display response labels cleanly.
// ============================================================

const QUESTIONS = [
  {
    id: "kids",
    type: "text",
    label: "Quick context check: how many school-age kids do you have, and what grades?",
    helper: "e.g. \"two — a 2nd grader and a 6th grader\"",
    required: true,
  },
  {
    id: "worst_task",
    type: "longtext",
    label: "Think about this past school year. What's the *one* school-related task that drove you the most crazy?",
    helper: "Two or three sentences is plenty. Be honest — venting is welcome.",
    required: true,
  },
  {
    id: "tool_count",
    type: "single",
    label: "Roughly how many school-related apps, sites, or systems do you currently juggle?",
    helper: "Count everything: ClassDojo, Remind, the school portal, group texts, your own calendar, paper folders, etc.",
    options: ["1–2", "3–4", "5–6", "7 or more"],
    required: true,
  },
  {
    id: "info_loss",
    type: "multi",
    label: "Where do you currently lose the most information?",
    helper: "Pick up to 2.",
    options: [
      "Stuff sent home in backpacks",
      "Email from teacher / school",
      "Group texts with other parents",
      "App notifications (ClassDojo, Remind, etc.)",
      "The school's online portal",
      "Verbal reminders from my kid",
      "Other",
    ],
    maxSelections: 2,
    required: true,
  },
  {
    id: "frequency_grid",
    type: "grid",
    label: "In a typical school year, how often does each of these happen?",
    rows: [
      { id: "late_event", label: "Found out about a school event too late" },
      { id: "missed_form", label: "Missed a permission slip or form deadline" },
      { id: "forgot_request", label: "Forgot a \"teacher needs ___\" request (snacks, tissues, costumes)" },
      { id: "double_bought", label: "Double-bought a supply because I forgot I had it" },
      { id: "lost_paper", label: "Couldn't find an important paper when I needed it" },
      { id: "out_of_loop", label: "Felt out of the loop compared to other parents" },
    ],
    columns: ["Never", "Rarely", "Sometimes", "Often"],
    required: true,
  },
  {
    id: "most_frustrating",
    type: "single",
    label: "Of those, which one frustrates you the most?",
    options: [
      "Finding out about events too late",
      "Missing form / permission slip deadlines",
      "Forgetting teacher requests",
      "Double-buying supplies",
      "Losing important papers",
      "Feeling out of the loop",
    ],
    required: true,
  },
  {
    id: "info_source",
    type: "multi",
    label: "When something important happens in your kid's class, how do you usually find out?",
    helper: "Pick all that apply.",
    options: [
      "Directly from the teacher",
      "From the room parent / class parent",
      "From another parent (text, in person, etc.)",
      "From my kid",
      "From a school app or portal",
      "I often don't find out in time",
      "Other",
    ],
    required: true,
  },
  {
    id: "magic_wand",
    type: "longtext",
    label: "If you could wave a magic wand and have one school thing organized for you automatically, what would it be?",
    helper: "Dream big or small — both are useful.",
    required: true,
  },
  {
    id: "willingness_to_pay",
    type: "single",
    label: "Would you pay for an app that solved your biggest school-organization headache?",
    options: [
      "Yes — a one-time fee (under $10)",
      "Yes — a small monthly subscription (under $5/mo)",
      "Yes — a yearly subscription (under $30/yr)",
      "Only if it was free with optional paid features",
      "No, I wouldn't pay for this",
    ],
    required: true,
  },
  {
    id: "anything_else",
    type: "longtext",
    label: "Anything else you wish someone would build for parents like you?",
    helper: "Optional — but this is often where the best ideas live.",
    required: false,
  },
];

// ============================================================
// Root
// ============================================================
export default function App() {
  const [phase, setPhase] = useState("loading"); // loading | intro | survey | submitting | done | admin
  const [responses, setResponses] = useState({}); // {questionId: value}
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [stayUpdated, setStayUpdated] = useState(false);
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [error, setError] = useState("");

  // Load existing submissions on mount (mainly so admin view can render)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const isAdmin =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("admin") === "1";

      try {
        const result = await window.storage.get(STORAGE_KEY, true);
        const list = result ? JSON.parse(result.value) : [];
        if (!cancelled) {
          setAllSubmissions(list);
          setPhase(isAdmin ? "admin" : "intro");
        }
      } catch {
        if (!cancelled) {
          setAllSubmissions([]);
          setPhase(isAdmin ? "admin" : "intro");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function validateEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function updateResponse(qId, value) {
    setResponses((prev) => ({ ...prev, [qId]: value }));
  }

  // Validate that every required question has a non-empty answer
  function getMissingQuestions() {
    const missing = [];
    for (const q of QUESTIONS) {
      if (!q.required) continue;
      const val = responses[q.id];
      if (q.type === "text" || q.type === "longtext") {
        if (!val || !val.trim()) missing.push(q);
      } else if (q.type === "single") {
        if (!val) missing.push(q);
      } else if (q.type === "multi") {
        if (!val || val.length === 0) missing.push(q);
      } else if (q.type === "grid") {
        const allRowsAnswered = q.rows.every((r) => val && val[r.id]);
        if (!allRowsAnswered) missing.push(q);
      }
    }
    return missing;
  }

  async function handleSubmit() {
    setError("");
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      setError("Mind sharing your name?");
      return;
    }
    if (!validateEmail(trimmedEmail)) {
      setError("That email doesn't look quite right.");
      return;
    }

    const missing = getMissingQuestions();
    if (missing.length > 0) {
      setError(
        `Looks like you skipped ${missing.length} question${
          missing.length === 1 ? "" : "s"
        } — scroll up to fill in anything marked.`
      );
      // Scroll to first missing
      const el = document.getElementById(`q-${missing[0].id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setPhase("submitting");

    try {
      // Re-read latest list to avoid clobbering parallel submissions
      let latest = [];
      try {
        const fresh = await window.storage.get(STORAGE_KEY, true);
        latest = fresh ? JSON.parse(fresh.value) : [];
      } catch {
        latest = [];
      }

      // Already submitted — let them know but don't error hard
      if (latest.some((s) => s.email === trimmedEmail)) {
        setError("Looks like you already submitted this survey — thanks again!");
        setPhase("survey");
        return;
      }

      const updated = [
        ...latest,
        {
          name: trimmedName,
          email: trimmedEmail,
          responses,
          stayUpdated,
          ts: Date.now(),
        },
      ];
      await window.storage.set(STORAGE_KEY, JSON.stringify(updated), true);
      setAllSubmissions(updated);
      setPhase("done");
    } catch {
      setError("Something glitched on our end — try again in a sec?");
      setPhase("survey");
    }
  }

  async function handleResetAll() {
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify([]), true);
      setAllSubmissions([]);
    } catch {
      // ignore
    }
  }

  async function handleRemoveSubmission(emailToRemove) {
    try {
      const updated = allSubmissions.filter((s) => s.email !== emailToRemove);
      await window.storage.set(STORAGE_KEY, JSON.stringify(updated), true);
      setAllSubmissions(updated);
    } catch {
      // ignore
    }
  }

  return (
    <div
      className="min-h-screen w-full flex items-start justify-center px-4 py-8"
      style={{
        fontFamily: "'Fraunces', Georgia, serif",
        background:
          "radial-gradient(ellipse at top left, #fef3c7 0%, transparent 50%), radial-gradient(ellipse at bottom right, #fce7f3 0%, transparent 50%), #fffbf5",
      }}
    >
      {/* Decorative grain overlay */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.04] mix-blend-multiply"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative w-full max-w-2xl">
        <div
          className="bg-white rounded-3xl p-8 sm:p-10 relative overflow-hidden"
          style={{
            boxShadow:
              "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06), 0 24px 48px rgba(0,0,0,0.04)",
            border: "1px solid rgba(0,0,0,0.04)",
          }}
        >
          <div className="absolute top-5 right-5 text-[10px] tracking-[0.2em] uppercase text-neutral-400 font-sans">
            {phase === "admin" ? "admin" : "parent survey"}
          </div>

          {phase === "loading" && (
            <div className="py-16 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-900 rounded-full animate-spin" />
              <div className="text-xs text-neutral-500 font-sans">Loading…</div>
            </div>
          )}

          {phase === "intro" && (
            <IntroScreen onStart={() => setPhase("survey")} />
          )}

          {phase === "survey" && (
            <SurveyForm
              responses={responses}
              updateResponse={updateResponse}
              name={name}
              email={email}
              setName={setName}
              setEmail={setEmail}
              stayUpdated={stayUpdated}
              setStayUpdated={setStayUpdated}
              error={error}
              onSubmit={handleSubmit}
            />
          )}

          {phase === "submitting" && (
            <div className="py-16 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-900 rounded-full animate-spin" />
              <div className="text-xs text-neutral-500 font-sans">
                Saving your answers…
              </div>
            </div>
          )}

          {phase === "done" && <DoneState name={name} />}

          {phase === "admin" && (
            <AdminView
              submissions={allSubmissions}
              onReset={handleResetAll}
              onRemove={handleRemoveSubmission}
            />
          )}
        </div>

        <div className="text-center mt-6 text-[11px] text-neutral-500 font-sans tracking-wide">
          {phase === "admin"
            ? "private view · only you can see this"
            : "a small experiment · thanks for taking part ✨"}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Intro screen — tells parents what they're signing up for
// ============================================================
function IntroScreen({ onStart }) {
  return (
    <>
      {/* Raffle badge */}
      <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 mb-6">
        <span className="text-base">🎁</span>
        <span className="text-[11px] font-medium tracking-wide text-amber-900 font-sans">
          Complete the survey for a chance to win a $25 gift card
        </span>
      </div>

      <h1
        className="text-[5.2rem] leading-[1.0] font-medium text-neutral-900 tracking-tight mb-5"
        style={{ fontFamily: "'Fraunces', Georgia, serif" }}
      >
        What makes the school year <em className="italic">hard?</em>
      </h1>

      <p className="text-[15px] text-neutral-600 leading-relaxed mb-4 font-sans">
        I'm building something for{" "}
        <span className="text-neutral-900 font-medium">
          parents and guardians of school-age kids
        </span>{" "}
        — to make managing the school-year chaos a little easier. I want to
        hear from <span className="text-neutral-900 font-medium">you</span>{" "}
        about what's actually painful.
      </p>

      <p className="text-[15px] text-neutral-600 leading-relaxed mb-4 font-sans">
        Ten questions. About 5 minutes.
      </p>

      <p className="text-[15px] text-neutral-600 leading-relaxed mb-7 font-sans">
        <span className="text-neutral-900 font-medium">As a thank-you</span>,
        every completed survey gets entered into a drawing for a{" "}
        <span className="text-neutral-900 font-medium">$25 gift card</span>.
        I'll announce a winner on my stories &amp; email them directly after
        the survey closes after a week.
      </p>

      {/* Privacy note */}
      <div className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 mb-6">
        <div className="text-[11px] tracking-[0.15em] uppercase text-neutral-500 font-sans mb-1.5">
          About your email
        </div>
        <p className="text-[13px] text-neutral-700 leading-relaxed font-sans">
          I'll only use it to contact you if you win. At the end you can opt
          in to occasional updates about the app — totally optional. Never
          shared.
        </p>
      </div>

      <button
        onClick={onStart}
        className="w-full bg-neutral-900 text-white rounded-full py-3.5 text-[14px] font-medium font-sans tracking-wide hover:bg-neutral-800 active:scale-[0.99] transition-all"
      >
        Start the survey →
      </button>
    </>
  );
}

// ============================================================
// Survey form — renders each question by type
// ============================================================
function SurveyForm({
  responses,
  updateResponse,
  name,
  email,
  setName,
  setEmail,
  stayUpdated,
  setStayUpdated,
  error,
  onSubmit,
}) {
  return (
    <>
      {/* Persistent raffle reminder while filling out */}
      <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 mb-6">
        <span className="text-base">🎁</span>
        <span className="text-[11px] font-medium tracking-wide text-amber-900 font-sans">
          Finish for a chance at a $25 gift card
        </span>
      </div>

      <h2
        className="text-[1.8rem] leading-tight font-medium text-neutral-900 tracking-tight mb-6"
        style={{ fontFamily: "'Fraunces', Georgia, serif" }}
      >
        Tell me about your<br />
        <em className="italic">school year.</em>
      </h2>

      <div className="flex flex-col gap-7 mb-7">
        {QUESTIONS.map((q, idx) => (
          <QuestionRenderer
            key={q.id}
            question={q}
            number={idx + 1}
            value={responses[q.id]}
            onChange={(val) => updateResponse(q.id, val)}
          />
        ))}
      </div>

      {/* Contact info */}
      <div className="border-t border-neutral-200 pt-6 mb-2">
        <h3
          className="text-[1.2rem] leading-tight font-medium text-neutral-900 tracking-tight mb-1"
          style={{ fontFamily: "'Fraunces', Georgia, serif" }}
        >
          Last bit — <em className="italic">how to reach you.</em>
        </h3>
        <p className="text-[13px] text-neutral-600 font-sans mb-4 leading-relaxed">
          Needed so I can email you if you win the raffle.
        </p>
        <div className="flex flex-col gap-3">
          <FormInput
            label="Your name"
            value={name}
            onChange={setName}
            placeholder="Alex Rivera"
          />
          <FormInput
            label="Email"
            value={email}
            onChange={setEmail}
            placeholder="alex@email.com"
            type="email"
          />
        </div>

        {/* Stay-updated opt-in */}
        <button
          type="button"
          onClick={() => setStayUpdated(!stayUpdated)}
          className="mt-4 w-full flex items-start gap-3 text-left p-3 rounded-xl border border-neutral-200 bg-neutral-50 hover:border-neutral-400 hover:bg-white transition-all"
        >
          <span
            className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${
              stayUpdated
                ? "bg-neutral-900 border-neutral-900"
                : "bg-white border-neutral-400"
            }`}
          >
            {stayUpdated && (
              <span className="text-white text-[10px] leading-none font-bold">
                ✓
              </span>
            )}
          </span>
          <span className="text-[13px] text-neutral-700 font-sans leading-relaxed">
            Check this box if you'd like to stay updated about the app.
          </span>
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-4 font-sans">
          {error}
        </div>
      )}

      <button
        onClick={onSubmit}
        className="mt-5 w-full bg-neutral-900 text-white rounded-full py-3.5 text-[14px] font-medium font-sans tracking-wide hover:bg-neutral-800 active:scale-[0.99] transition-all"
      >
        Submit my answers →
      </button>

      <p className="text-[11px] text-neutral-500 text-center mt-3 font-sans leading-relaxed">
        Your responses are private. I'll never share or sell your info.
      </p>
    </>
  );
}

// Renders the appropriate input UI based on question.type
function QuestionRenderer({ question, number, value, onChange }) {
  return (
    <div id={`q-${question.id}`} className="flex flex-col">
      <div className="flex items-baseline gap-2 mb-2">
        <span
          className="text-[11px] tracking-[0.15em] uppercase text-neutral-400 font-sans font-medium"
        >
          {String(number).padStart(2, "0")}
        </span>
        <span
          className="text-[15px] font-medium text-neutral-900 leading-snug font-sans"
        >
          {question.label}
          {!question.required && (
            <span className="text-neutral-400 font-normal italic ml-1">
              (optional)
            </span>
          )}
        </span>
      </div>
      {question.helper && (
        <p className="text-[12px] text-neutral-500 mb-3 font-sans leading-relaxed pl-7">
          {question.helper}
        </p>
      )}
      <div className="pl-7">
        {question.type === "text" && (
          <ShortText value={value} onChange={onChange} />
        )}
        {question.type === "longtext" && (
          <LongText value={value} onChange={onChange} />
        )}
        {question.type === "single" && (
          <SingleSelect
            options={question.options}
            value={value}
            onChange={onChange}
          />
        )}
        {question.type === "multi" && (
          <MultiSelect
            options={question.options}
            value={value || []}
            onChange={onChange}
            maxSelections={question.maxSelections}
          />
        )}
        {question.type === "grid" && (
          <FrequencyGrid
            rows={question.rows}
            columns={question.columns}
            value={value || {}}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Input components
// ============================================================

function ShortText({ value, onChange }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type="text"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={`w-full px-4 py-3 rounded-xl text-[14px] outline-none transition-all font-sans ${
        focused
          ? "border-neutral-900 bg-white ring-4 ring-neutral-900/5"
          : "border-neutral-200 bg-neutral-50 hover:border-neutral-300"
      }`}
      style={{ borderWidth: 1, borderStyle: "solid" }}
    />
  );
}

function LongText({ value, onChange }) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      rows={3}
      className={`w-full px-4 py-3 rounded-xl text-[14px] outline-none transition-all font-sans resize-y ${
        focused
          ? "border-neutral-900 bg-white ring-4 ring-neutral-900/5"
          : "border-neutral-200 bg-neutral-50 hover:border-neutral-300"
      }`}
      style={{ borderWidth: 1, borderStyle: "solid", minHeight: 80 }}
    />
  );
}

function FormInput({ label, value, onChange, placeholder, type = "text" }) {
  const [focused, setFocused] = useState(false);
  return (
    <label className="block">
      <div className="text-[10px] tracking-[0.15em] uppercase text-neutral-500 font-sans mb-1.5">
        {label}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className={`w-full px-4 py-3 rounded-xl text-[15px] outline-none transition-all font-sans ${
          focused
            ? "border-neutral-900 bg-white ring-4 ring-neutral-900/5"
            : "border-neutral-200 bg-neutral-50 hover:border-neutral-300"
        }`}
        style={{ borderWidth: 1, borderStyle: "solid" }}
      />
    </label>
  );
}

function SingleSelect({ options, value, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`text-left px-4 py-2.5 rounded-xl text-[14px] font-sans transition-all ${
              selected
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-neutral-50 text-neutral-700 border-neutral-200 hover:border-neutral-400 hover:bg-white"
            }`}
            style={{ borderWidth: 1, borderStyle: "solid" }}
          >
            <span className="inline-flex items-center gap-2.5">
              <span
                className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 transition-all ${
                  selected
                    ? "border-white bg-white"
                    : "border-neutral-300 bg-white"
                }`}
              >
                {selected && (
                  <span className="block w-full h-full rounded-full bg-neutral-900 scale-50" />
                )}
              </span>
              {opt}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MultiSelect({ options, value, onChange, maxSelections }) {
  function toggle(opt) {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      // Enforce max — if already at limit, ignore further selections
      if (maxSelections && value.length >= maxSelections) return;
      onChange([...value, opt]);
    }
  }
  const atLimit = maxSelections && value.length >= maxSelections;

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt) => {
        const selected = value.includes(opt);
        const disabled = atLimit && !selected;
        return (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            disabled={disabled}
            className={`text-left px-4 py-2.5 rounded-xl text-[14px] font-sans transition-all ${
              selected
                ? "bg-neutral-900 text-white border-neutral-900"
                : disabled
                ? "bg-neutral-50 text-neutral-400 border-neutral-200 cursor-not-allowed"
                : "bg-neutral-50 text-neutral-700 border-neutral-200 hover:border-neutral-400 hover:bg-white"
            }`}
            style={{ borderWidth: 1, borderStyle: "solid" }}
          >
            <span className="inline-flex items-center gap-2.5">
              <span
                className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
                  selected
                    ? "border-white bg-white"
                    : "border-neutral-300 bg-white"
                }`}
              >
                {selected && (
                  <span className="text-neutral-900 text-[10px] leading-none font-bold">
                    ✓
                  </span>
                )}
              </span>
              {opt}
            </span>
          </button>
        );
      })}
      {maxSelections && (
        <div className="text-[11px] text-neutral-400 font-sans mt-1">
          {value.length} of {maxSelections} selected
        </div>
      )}
    </div>
  );
}

function FrequencyGrid({ rows, columns, value, onChange }) {
  function setRow(rowId, col) {
    onChange({ ...value, [rowId]: col });
  }

  return (
    <div className="border border-neutral-200 rounded-xl overflow-hidden bg-neutral-50">
      {rows.map((row, idx) => (
        <div
          key={row.id}
          className={`px-3 py-3 flex flex-col gap-2 ${
            idx > 0 ? "border-t border-neutral-200" : ""
          }`}
        >
          <div className="text-[13px] text-neutral-800 font-sans leading-snug">
            {row.label}
          </div>
          <div className="flex gap-1">
            {columns.map((col) => {
              const selected = value[row.id] === col;
              return (
                <button
                  key={col}
                  onClick={() => setRow(row.id, col)}
                  className={`flex-1 py-2 px-1 rounded-lg text-[11px] font-sans transition-all whitespace-nowrap ${
                    selected
                      ? "bg-neutral-900 text-white"
                      : "bg-white text-neutral-600 border border-neutral-200 hover:border-neutral-400"
                  }`}
                >
                  {col}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Done state
// ============================================================
function DoneState({ name }) {
  const firstName = name.trim().split(/\s+/)[0];
  return (
    <div className="py-4 flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center text-2xl mb-5">
        🎉
      </div>
      <h2
        className="text-[1.9rem] leading-tight font-medium text-neutral-900 tracking-tight mb-3"
        style={{ fontFamily: "'Fraunces', Georgia, serif" }}
      >
        Thank you,<br />
        <em className="italic">{firstName || "friend"}.</em>
      </h2>
      <p className="text-[14px] text-neutral-600 leading-relaxed font-sans max-w-[360px] mb-3">
        Your answers are in — and{" "}
        <span className="text-neutral-900 font-medium">
          you're entered in the drawing
        </span>{" "}
        for the $25 gift card. If you win, I'll email you to ask whether you'd
        like a coffee shop, Amazon, or Target card.
      </p>
      <p className="text-[13px] text-neutral-500 leading-relaxed font-sans max-w-[360px] mb-6">
        This kind of feedback is genuinely the most useful thing I can get
        right now. Thank you for taking the time.
      </p>
      <p className="text-[11px] text-neutral-500 font-sans tracking-wide uppercase">
        — talk soon ✨ —
      </p>
    </div>
  );
}

// ============================================================
// Admin view
// Read all submissions, copy emails, remove individuals, clear all
// ============================================================
function AdminView({ submissions, onReset, onRemove }) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState(null);

  function copyAllEmails() {
    const emails = submissions.map((s) => s.email).join(", ");
    if (!emails) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(emails).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = emails;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
      document.body.removeChild(ta);
    }
  }

  function formatDate(ts) {
    try {
      return new Date(ts).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  // Convert a stored response value into a readable display string
  function renderAnswer(question, answer) {
    if (answer === undefined || answer === null || answer === "") {
      return <span className="text-neutral-400 italic">no answer</span>;
    }
    if (question.type === "multi" && Array.isArray(answer)) {
      return answer.join(", ");
    }
    if (question.type === "grid" && typeof answer === "object") {
      return (
        <div className="flex flex-col gap-0.5 mt-1">
          {question.rows.map((r) => (
            <div key={r.id} className="text-[12px]">
              <span className="text-neutral-500">{r.label}:</span>{" "}
              <span className="text-neutral-900 font-medium">
                {answer[r.id] || "—"}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return String(answer);
  }

  return (
    <div className="font-sans">
      <div className="mb-6">
        <h2
          className="text-[1.6rem] leading-tight font-medium text-neutral-900 tracking-tight mb-1"
          style={{ fontFamily: "'Fraunces', Georgia, serif" }}
        >
          Survey responses
        </h2>
        <div className="text-[12px] text-neutral-500">
          {submissions.length} response{submissions.length === 1 ? "" : "s"} so
          far
        </div>
      </div>

      {submissions.length === 0 && (
        <div className="border border-dashed border-neutral-300 rounded-xl py-10 px-4 text-center">
          <div className="text-[13px] text-neutral-500">
            No responses yet. The survey is live and ready to share.
          </div>
        </div>
      )}

      {submissions.length > 0 && (
        <div className="flex flex-col gap-2 mb-5">
          {submissions.map((s, i) => {
            const expanded = expandedEmail === s.email;
            return (
              <div
                key={s.email}
                className="border border-neutral-200 rounded-xl bg-white overflow-hidden"
              >
                <button
                  onClick={() =>
                    setExpandedEmail(expanded ? null : s.email)
                  }
                  className="w-full p-3 flex items-start gap-3 text-left hover:bg-neutral-50 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center text-[11px] font-medium text-neutral-700 flex-shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-neutral-900 truncate flex items-center gap-2">
                      <span className="truncate">{s.name}</span>
                      {s.stayUpdated && (
                        <span className="text-[9px] font-medium tracking-[0.1em] uppercase text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">
                          updates
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-neutral-600 truncate">
                      {s.email}
                    </div>
                    <div className="text-[10px] text-neutral-400 mt-0.5">
                      submitted {formatDate(s.ts)}
                    </div>
                  </div>
                  <span className="text-neutral-400 text-sm flex-shrink-0 mt-1">
                    {expanded ? "▴" : "▾"}
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-neutral-200 p-4 bg-neutral-50 flex flex-col gap-3">
                    {QUESTIONS.map((q, idx) => (
                      <div key={q.id}>
                        <div className="text-[10px] tracking-[0.1em] uppercase text-neutral-500 font-medium mb-1">
                          Q{idx + 1} — {q.label}
                        </div>
                        <div className="text-[13px] text-neutral-800 leading-relaxed pl-2 border-l-2 border-neutral-200">
                          {renderAnswer(q, s.responses?.[q.id])}
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Remove ${s.name}'s response? This can't be undone.`
                          )
                        ) {
                          onRemove(s.email);
                          setExpandedEmail(null);
                        }
                      }}
                      className="self-start text-[11px] text-rose-700 hover:text-rose-900 underline mt-1"
                    >
                      Remove this response
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {submissions.length > 0 && (
          <button
            onClick={copyAllEmails}
            className="w-full bg-neutral-900 text-white rounded-full py-3 text-[13px] font-medium tracking-wide hover:bg-neutral-800 active:scale-[0.99] transition-all"
          >
            {copied ? "✓ Copied to clipboard" : "Copy all emails"}
          </button>
        )}

        {!confirmingReset ? (
          <button
            onClick={() => setConfirmingReset(true)}
            className="w-full border border-neutral-300 text-neutral-700 rounded-full py-3 text-[13px] font-medium tracking-wide hover:bg-neutral-50 transition-all"
          >
            Clear all responses
          </button>
        ) : (
          <div className="border border-rose-200 bg-rose-50 rounded-xl p-3 flex flex-col gap-2">
            <div className="text-[12px] text-rose-900 leading-relaxed">
              This deletes all {submissions.length} response
              {submissions.length === 1 ? "" : "s"}. Can't be undone.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onReset();
                  setConfirmingReset(false);
                }}
                className="flex-1 bg-rose-700 text-white rounded-full py-2 text-[12px] font-medium hover:bg-rose-800 transition-colors"
              >
                Yes, clear them
              </button>
              <button
                onClick={() => setConfirmingReset(false)}
                className="flex-1 border border-neutral-300 text-neutral-700 rounded-full py-2 text-[12px] font-medium hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="text-[11px] text-neutral-500 mt-5 leading-relaxed border-t border-neutral-100 pt-4">
        <span className="font-medium text-neutral-700">Tip:</span> Bookmark this
        URL with the{" "}
        <code className="bg-neutral-100 px-1 py-0.5 rounded text-[10px]">
          ?admin=1
        </code>{" "}
        param so you can pop back in anytime. Click any response to see the
        full answers.
      </div>
    </div>
  );
}

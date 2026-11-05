"use client";

import { useState, type ReactNode } from "react";
import {
  BudgetMeter,
  Button,
  ChoiceChips,
  Confetti,
  ConfirmDialog,
  Field,
  ImageDropzone,
  Panel,
  Podium,
  ProgressStages,
  ScoreInput,
  StatusPill,
  Tabs,
  Timer,
  Wordmark,
  useToast,
  type DropzoneItem,
  type Score,
  type Status,
} from "@/components/ui";
import s from "./styleguide.module.css";

/* Fake storyboard thumbnails (inline SVG) so the guide needs no network or art files. */
function fakeBoard(hue: number, label: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'>
  <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue},55%,28%)'/><stop offset='1' stop-color='hsl(${hue + 40},45%,10%)'/></linearGradient></defs>
  <rect width='600' height='400' fill='url(#g)'/>
  <g stroke='rgba(255,255,255,.35)' stroke-width='4'><line x1='300' y1='0' x2='300' y2='400'/><line x1='0' y1='200' x2='600' y2='200'/></g>
  <g fill='rgba(255,255,255,.18)'><circle cx='150' cy='110' r='46'/><rect x='390' y='60' width='120' height='90' rx='10'/><path d='M60 360 L150 250 L240 360Z'/><rect x='380' y='250' width='140' height='110' rx='60'/></g>
  <text x='300' y='392' font-family='monospace' font-size='22' fill='rgba(255,255,255,.7)' text-anchor='middle'>${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const GENRES = ["Horror", "Puzzle", "Action-adventure", "RPG", "Platformer", "Sci-fi", "Fantasy"];
const STAGES = [
  { id: "mod", label: "Checking the design", hint: "A quick safety check" },
  { id: "prompt", label: "Briefing the artist", hint: "Turning your design into a picture prompt" },
  { id: "draw", label: "Drawing 4 panels", hint: "This is the slow part, about 30-60 seconds" },
  { id: "save", label: "Pinning it to the wall" },
];

function Section({ id, title, kicker, children }: { id: string; title: string; kicker: string; children: ReactNode }) {
  return (
    <section id={id} className={s.section}>
      <div className={s.sectionHead}>
        <span className="kicker is-phos">{kicker}</span>
        <h2 className={s.sectionTitle}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Split({ children }: { children: (surface: "terminal" | "paper") => ReactNode }) {
  return (
    <div className={s.split}>
      <Panel variant="terminal" kicker="terminal side">
        <div className={s.demo}>{children("terminal")}</div>
      </Panel>
      <Panel variant="parchment" kicker="paper side">
        <div className={s.demo}>{children("paper")}</div>
      </Panel>
    </div>
  );
}

export function StyleguideClient() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [feeling, setFeeling] = useState({ terminal: "", paper: "Lonely, like the station forgot you" });
  const [enemy, setEnemy] = useState({ terminal: "", paper: "" });
  const [genre, setGenre] = useState({ terminal: "Horror", paper: "Cozy space western" });
  const [code, setCode] = useState("");
  const [imgs, setImgs] = useState<DropzoneItem[]>([
    { id: "a", url: fakeBoard(140, "ref 1"), name: "corridor.jpg", caption: "art style" },
    { id: "b", url: fakeBoard(30, "ref 2"), name: "monster.png", status: "uploading", progress: 0.6 },
  ]);
  const [tab, setTab] = useState("teams");
  const [stage, setStage] = useState(2);
  const [stageStart, setStageStart] = useState<number>(() => Date.now() - 23000);
  const [failed, setFailed] = useState(false);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, Score | null>>({ level: 4, enemy: null, ability: 2, puzzle: null });
  const [dialog, setDialog] = useState<null | "plain" | "danger">(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [boom, setBoom] = useState(0);

  const setTimer = (sec: number | null) => setEndsAt(sec === null ? null : new Date(Date.now() + sec * 1000).toISOString());

  const statuses: Status[] = ["drafting", "asking", "generating", "submitted", "idle", "error"];

  return (
    <main className={s.page}>
      <Confetti fire={boom} />

      {/* ---------- hero ---------- */}
      <header className={`${s.hero} bg-hero-split`}>
        <div className={s.heroInner}>
          <Wordmark size="hero" kicker="ENGL 175 / live activity" animate />
          <p className={s.heroLede}>
            Design system: <span className="vt glow-text">phosphor</span> meets <span className="hand">ink</span>, with party-game
            energy. Every component below, on both surfaces.
          </p>
          <nav className={s.toc} aria-label="Sections">
            {["type", "buttons", "forms", "status", "timer", "voting", "dialogs", "podium"].map((id) => (
              <a key={id} href={`#${id}`}>
                {id}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className={`container-wide ${s.body}`}>
        {/* ---------- type ---------- */}
        <Section id="type" kicker="01 / type" title="Type and color">
          <div className={s.split}>
            <Panel variant="terminal" kicker="roles">
              <div className={s.typeList}>
                <div>
                  <span className={s.tLabel}>--font-display / Bricolage Grotesque 800</span>
                  <div className="display" style={{ fontSize: "var(--fs-3xl)" }}>
                    Design Your Level
                  </div>
                </div>
                <div>
                  <span className={s.tLabel}>--font-terminal / VT323 (numbers, timer, labels)</span>
                  <div className="vt glow-text" style={{ fontSize: "var(--fs-2xl)" }}>
                    &gt; 07:42 TEAM 3 READY<span className="anim-blink">_</span>
                  </div>
                </div>
                <div>
                  <span className={s.tLabel}>--font-body / IBM Plex Sans (all reading text)</span>
                  <p>Get the player from the start room to the exit through 3 rooms. For each part, say how it creates your feeling.</p>
                </div>
                <div>
                  <span className={s.tLabel}>.split-text (deck seam headline)</span>
                  <div className="display split-text" style={{ fontSize: "var(--fs-2xl)" }}>
                    Level Design
                  </div>
                </div>
              </div>
            </Panel>
            <Panel variant="parchment" kicker="paper roles">
              <div className={s.typeList}>
                <div>
                  <span className={s.tLabel}>--font-serif / DM Serif Display</span>
                  <div className="serif" style={{ fontSize: "var(--fs-2xl)", lineHeight: 1.05 }}>
                    The Ink Machine Wing
                  </div>
                </div>
                <div>
                  <span className={s.tLabel}>--font-marquee / Limelight</span>
                  <div className="marquee" style={{ fontSize: "var(--fs-2xl)" }}>
                    Grand Prize
                  </div>
                </div>
                <div>
                  <span className={s.tLabel}>--font-type / Special Elite</span>
                  <div className="typewriter" style={{ fontSize: "var(--fs-lg)" }}>
                    Room 2: the projector booth, flickering.
                  </div>
                </div>
                <div>
                  <span className={s.tLabel}>--font-hand / Caveat (sparingly)</span>
                  <div className="hand" style={{ fontSize: "var(--fs-2xl)", color: "var(--sepia-text)" }}>
                    nice touch, the ink rises!
                  </div>
                </div>
              </div>
            </Panel>
          </div>
          <div className={s.swatches}>
            {[
              ["--phos", "#7CFF9B"],
              ["--phos-dim", "#2F7A45"],
              ["--phos-black", "#06140B"],
              ["--parch", "#E9DCBC"],
              ["--sepia", "#A67C4E"],
              ["--ink", "#1A120A"],
              ["--amber", "#FFC857"],
              ["--blood", "#FF5A4E"],
              ["--aspect-level", "#E8B05C"],
              ["--aspect-enemy", "#FF6B5B"],
              ["--aspect-ability", "#7CFF9B"],
              ["--aspect-puzzle", "#8FD3FF"],
            ].map(([v, hex]) => (
              <div key={v} className={s.swatch}>
                <span style={{ background: `var(${v})` }} />
                <code>{v}</code>
                <small>{hex}</small>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------- buttons ---------- */}
        <Section id="buttons" kicker="02 / buttons" title="Buttons and panels">
          <Split>
            {() => (
              <>
                <div className="row">
                  <Button>Generate</Button>
                  <Button variant="secondary">Edit design</Button>
                  <Button variant="ghost">Skip</Button>
                  <Button variant="danger">Reset</Button>
                </div>
                <div className="row">
                  <Button size="sm">Small</Button>
                  <Button size="md">Medium</Button>
                  <Button size="lg">Large</Button>
                </div>
                <Button size="xl" block loading={loading} loadingText="Drawing..." onClick={() => {
                  setLoading(true);
                  window.setTimeout(() => setLoading(false), 2200);
                }}>
                  Draw my storyboard
                </Button>
                <div className="row">
                  <Button disabled>Disabled</Button>
                  <Button variant="secondary" icon=">">With icon</Button>
                </div>
              </>
            )}
          </Split>
          <div className={s.panelRow}>
            <Panel variant="terminal" kicker="Team 4" title="Hollow Station" tilt={-1} actions={<StatusPill status="generating" size="sm" />}>
              <p className="muted">Terminal panel with a tilt, header actions and scanlines.</p>
            </Panel>
            <Panel variant="parchment" kicker="Round 2" title="Rate the design, not the art" tilt={1.2}>
              <p>Parchment panel. Text inside flips to ink automatically.</p>
            </Panel>
            <Panel variant="plain" title="Plain panel" titleAs="h3">
              <p className="muted">A quiet card for dense admin areas.</p>
            </Panel>
          </div>
        </Section>

        {/* ---------- forms ---------- */}
        <Section id="forms" kicker="03 / forms" title="Design form pieces">
          <Split>
            {(surf) => (
              <>
                <ChoiceChips
                  label="Genre"
                  options={GENRES}
                  value={genre[surf]}
                  onChange={(v) => setGenre((g) => ({ ...g, [surf]: v }))}
                />
                <Field
                  label="Feeling"
                  hint="What should the player feel the whole time?"
                  value={feeling[surf]}
                  onChange={(v) => setFeeling((f) => ({ ...f, [surf]: v }))}
                  placeholder="e.g. hunted, uneasy, powerful"
                  maxLength={120}
                  multiline={false}
                  examples={["hunted", "uneasy", "powerful", "lonely", "curious"]}
                />
                <Field
                  aspect="enemy"
                  label="Enemy"
                  hint="How does it create your feeling?"
                  value={enemy[surf]}
                  onChange={(v) => setEnemy((f) => ({ ...f, [surf]: v }))}
                  placeholder="What does it look like, how does it hunt, what warns you?"
                  maxLength={400}
                  error={surf === "paper" && enemy.paper.length > 0 && enemy.paper.length < 10 ? "A bit more detail, please" : undefined}
                />
                <ImageDropzone
                  items={imgs}
                  onFiles={(files) =>
                    setImgs((list) => [
                      ...list,
                      ...files.map((f, i) => ({ id: `${Date.now()}-${i}`, url: URL.createObjectURL(f), name: f.name })),
                    ])
                  }
                  onRemove={(id) => setImgs((list) => list.filter((x) => x.id !== id))}
                  hint="Up to 4 per storyboard. Art style, a monster, a room..."
                  compact={surf === "paper"}
                />
              </>
            )}
          </Split>
          <Panel variant="terminal" kicker="join" title="Big input">
            <div style={{ maxWidth: 520 }}>
              <Field label="Team code" multiline={false} big value={code} onChange={setCode} placeholder="three secret words" autoComplete="off" />
            </div>
          </Panel>
        </Section>

        {/* ---------- status ---------- */}
        <Section id="status" kicker="04 / status" title="Status, tabs, budget, progress">
          <Split>
            {() => (
              <>
                <div className="row">
                  {statuses.map((st) => (
                    <StatusPill key={st} status={st} />
                  ))}
                </div>
                <div className="row">
                  <StatusPill status="submitted" size="sm" />
                  <StatusPill status="asking" size="lg" label="3 questions" />
                </div>
                <Tabs
                  items={[
                    { id: "teams", label: "Teams" },
                    { id: "feed", label: "Feed", badge: 3 },
                    { id: "controls", label: "Controls" },
                  ]}
                  value={tab}
                  onChange={setTab}
                  aria-label="Admin sections"
                />
                <BudgetMeter spentUsd={1.42} budgetUsd={5} reservedUsd={0.3} perGenerationUsd={0.25} />
                <BudgetMeter spentUsd={4.62} budgetUsd={5} label="Almost out" />
                <BudgetMeter spentUsd={2.1} budgetUsd={5} compact />
              </>
            )}
          </Split>
          <div className={s.split}>
            <Panel variant="terminal">
              <ProgressStages title="Drawing your storyboard" stages={STAGES} current={stage} startedAt={stageStart} failed={failed} />
              <div className="row" style={{ marginTop: "var(--s-4)" }}>
                <Button size="sm" variant="ghost" onClick={() => { setStage(0); setFailed(false); setStageStart(Date.now()); }}>Restart</Button>
                <Button size="sm" variant="ghost" onClick={() => setStage((n) => Math.min(STAGES.length, n + 1))}>Next stage</Button>
                <Button size="sm" variant="danger" onClick={() => setFailed((f) => !f)}>Toggle fail</Button>
              </div>
            </Panel>
            <Panel variant="parchment">
              <ProgressStages title="Asking follow-ups" stages={STAGES.slice(0, 2)} current={1} startedAt={stageStart} />
            </Panel>
          </div>
        </Section>

        {/* ---------- timer ---------- */}
        <Section id="timer" kicker="05 / timer" title="Countdown">
          <div className="row" style={{ marginBottom: "var(--s-4)" }}>
            <Button size="sm" onClick={() => setTimer(15)}>15 s (hurry)</Button>
            <Button size="sm" onClick={() => setTimer(75)}>1:15</Button>
            <Button size="sm" onClick={() => setTimer(8 * 60)}>8:00</Button>
            <Button size="sm" variant="ghost" onClick={() => setTimer(3)}>3 s</Button>
            <Button size="sm" variant="ghost" onClick={() => setTimer(null)}>Clear</Button>
          </div>
          <div className={s.split}>
            <Panel variant="terminal">
              <div className="row" style={{ justifyContent: "space-around", alignItems: "flex-end", gap: "var(--s-6)" }}>
                <Timer endsAt={endsAt} size="sm" label="left" />
                <Timer endsAt={endsAt} size="md" label="Design" />
                <Timer endsAt={endsAt} size="lg" label="Voting" />
              </div>
            </Panel>
            <Panel variant="parchment">
              <div className="row" style={{ justifyContent: "space-around", alignItems: "flex-end" }}>
                <Timer endsAt={endsAt} size="md" label="Design" />
                <Timer endsAt={null} size="md" label="No timer" />
              </div>
            </Panel>
          </div>
          <div className={`${s.projector} bg-projector crt`}>
            <span className="kicker is-phos">projector size</span>
            <Timer endsAt={endsAt} size="giant" label="Design time" onExpire={() => toast.show("Timer hit zero (display only)", { title: "Time" })} />
          </div>
        </Section>

        {/* ---------- voting ---------- */}
        <Section id="voting" kicker="06 / voting" title="Score input">
          <Split>
            {(surf) => (
              <>
                {(["level", "enemy", "ability", "puzzle"] as const).map((a) => (
                  <ScoreInput
                    key={a}
                    name={`${surf}-${a}`}
                    aspect={a}
                    label={a[0].toUpperCase() + a.slice(1)}
                    value={scores[a]}
                    onChange={(v) => setScores((x) => ({ ...x, [a]: v }))}
                  />
                ))}
              </>
            )}
          </Split>
        </Section>

        {/* ---------- dialogs ---------- */}
        <Section id="dialogs" kicker="07 / feedback" title="Dialogs, toasts, confetti">
          <Panel variant="terminal">
            <div className="row">
              <Button onClick={() => setDialog("plain")}>Submit dialog</Button>
              <Button variant="danger" onClick={() => setDialog("danger")}>Reset event (typed)</Button>
              <Button variant="secondary" onClick={() => toast.success("Storyboard submitted. You can still swap it until voting.", { title: "Submitted" })}>
                Success toast
              </Button>
              <Button variant="ghost" onClick={() => toast.error("That one got refused. Nothing was charged; try rewording.", { title: "Refused" })}>
                Error toast
              </Button>
              <Button variant="ghost" onClick={() => toast.show("Team 5 renamed to The Drowned Archive")}>Info toast</Button>
              <Button variant="secondary" onClick={() => setBoom((n) => n + 1)}>Confetti</Button>
            </div>
          </Panel>
          <ConfirmDialog
            open={dialog === "plain"}
            title="Submit this storyboard?"
            body={<p>You can pick a different one any time before voting starts.</p>}
            confirmLabel="Submit"
            surface="paper"
            onCancel={() => setDialog(null)}
            onConfirm={() => {
              setDialog(null);
              toast.success("Submitted");
            }}
          />
          <ConfirmDialog
            open={dialog === "danger"}
            danger
            title="Reset the whole event?"
            body={
              <>
                <p>Wipes all teams, generations, uploads, votes and spend. Every team is logged out.</p>
              </>
            }
            requireText="RESET"
            confirmLabel="Wipe everything"
            busy={busy}
            onCancel={() => setDialog(null)}
            onConfirm={() => {
              setBusy(true);
              window.setTimeout(() => {
                setBusy(false);
                setDialog(null);
                toast.show("Event reset (demo)", { tone: "warn", title: "Reset" });
              }, 1200);
            }}
          />
        </Section>

        {/* ---------- podium ---------- */}
        <Section id="podium" kicker="08 / reveal" title="Podium">
          <div className="row" style={{ marginBottom: "var(--s-4)" }}>
            <Button size="sm" variant="ghost" onClick={() => setStep(0)}>Reset</Button>
            <Button size="sm" onClick={() => setStep((n) => (Math.min(3, n + 1) as 0 | 1 | 2 | 3))} disabled={step >= 3}>
              {step === 0 ? "Reveal 3rd" : step === 1 ? "Reveal 2nd" : "Reveal winner"}
            </Button>
            <span className="vt" style={{ fontSize: "var(--fs-lg)", color: "var(--text-muted)" }}>revealStep = {step}</span>
          </div>
          <div className={`${s.projector} ${s.podiumStage} bg-projector`}>
            <Podium
              revealStep={step}
              entries={[
                { place: 1, name: "The Drowned Archive", imageUrl: fakeBoard(150, "team 5"), score: 4.56 },
                { place: 2, name: "Hollow Station", imageUrl: fakeBoard(30, "team 2"), score: 4.19 },
                { place: 3, name: "Team 7", imageUrl: null, score: 3.94 },
              ]}
            />
          </div>
        </Section>

        <footer className={s.foot}>
          <Wordmark size="sm" layout="inline" />
          <span className="muted">/styleguide is a dev page. No emojis anywhere.</span>
        </footer>
      </div>
    </main>
  );
}

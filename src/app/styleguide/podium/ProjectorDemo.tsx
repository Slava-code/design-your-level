"use client";

import { useEffect, useState } from "react";
import { Button, Podium, Timer, Wordmark } from "@/components/ui";
import s from "./projector.module.css";

function board(hue: number) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'><rect width='600' height='400' fill='hsl(${hue},45%,22%)'/><g stroke='rgba(255,255,255,.35)' stroke-width='4'><line x1='300' y1='0' x2='300' y2='400'/><line x1='0' y1='200' x2='600' y2='200'/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Full-viewport 1600x900 mock of the /screen layout, to check sizing. Not the real projector page. */
export function ProjectorDemo({ initialStep, view }: { initialStep: 0 | 1 | 2 | 3; view: "podium" | "timer" }) {
  const [step, setStep] = useState(initialStep);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  useEffect(() => {
    if (view === "timer") setEndsAt(new Date(Date.now() + 7 * 60 * 1000 + 42000).toISOString());
  }, [view]);
  return (
    <main className={`${s.projScreen} bg-projector`}>
      <header className={s.projHead}>
        <Wordmark size="sm" layout="inline" />
        <span className="kicker is-phos">{view === "timer" ? "phase: design" : "phase: reveal"}</span>
        {view === "podium" && (
          <Button size="sm" variant="ghost" onClick={() => setStep((n) => ((n + 1) % 4) as 0 | 1 | 2 | 3)}>
            Step {step}
          </Button>
        )}
      </header>
      {view === "timer" ? (
        <div className={s.projCenter}>
          <Timer endsAt={endsAt} size="giant" label="Design time" />
        </div>
      ) : (
        <div className={s.projPodium}>
          <Podium
            revealStep={step}
            entries={[
              { place: 1, name: "The Drowned Archive", imageUrl: board(150), score: 4.56 },
              { place: 2, name: "Hollow Station", imageUrl: board(30), score: 4.19 },
              { place: 3, name: "Team 7", imageUrl: board(200), score: 3.94 },
            ]}
          />
        </div>
      )}
    </main>
  );
}

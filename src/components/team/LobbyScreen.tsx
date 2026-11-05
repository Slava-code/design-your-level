"use client";

import type { TeamState } from "@/lib/types";
import { cx } from "@/components/ui";
import { RoomPath } from "./RoomPath";
import s from "./shell.module.css";

const ASPECTS = [
  { k: "level", t: "Level", d: "The space: start room, 3 rooms, exit." },
  { k: "enemy", t: "Enemy", d: "What hunts you, and how you know." },
  { k: "ability", t: "Ability", d: "What you find, and what it unlocks." },
  { k: "puzzle", t: "Puzzle", d: "What stands between you and the exit." },
] as const;

/** LOBBY: waiting for the host, with a playful idle animation and a preview of the brief. */
export function LobbyScreen({ state }: { state: TeamState }) {
  return (
    <main className={s.lobby}>
      <section className={s.lobbyHero}>
        <p className={s.lobbyKicker}>You&apos;re in</p>
        <h1 className={s.lobbyTitle}>
          <span className={s.lobbyTeam}>{state.team.name}</span>
        </h1>
        <p className={s.waiting} role="status">
          Waiting for the host to start<span className={s.dots} aria-hidden><i>.</i><i>.</i><i>.</i></span>
        </p>
      </section>

      <RoomPath />

      <section className={s.brief} aria-labelledby="brief-title">
        <h2 id="brief-title" className={s.briefTitle}>
          Your mission
        </h2>
        <p className={s.briefLead}>
          Get the player from the <b>start room</b> to the <b>exit</b> through <b>3 rooms</b>. Pick a feeling, then design
          four things. For each one: <em>how does it create your feeling?</em>
        </p>
        <p className={s.typist}>
          <b>Pick one typist.</b> Everyone else: brainstorm out loud. Storyboards show up on every teammate&apos;s phone.
        </p>
        <ul className={cx(s.aspectGrid, "stagger")}>
          {ASPECTS.map((a, i) => (
            <li key={a.k} className={cx(s.aspectCard, "anim-rise-in")} data-aspect={a.k} style={{ ["--i" as string]: i + 2 }}>
              <span className={s.aspectDiamond} aria-hidden />
              <span className={s.aspectName}>{a.t}</span>
              <span className={s.aspectDesc}>{a.d}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

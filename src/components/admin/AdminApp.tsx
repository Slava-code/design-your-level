"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Tabs, Timer, Wordmark, useToast } from "@/components/ui";
import type { OkResponse } from "@/lib/types";
import { AdminLogin } from "./AdminLogin";
import { ControlsTab } from "./ControlsTab";
import { FeedTab } from "./FeedTab";
import { ResultsTab } from "./ResultsTab";
import { TeamsTab } from "./TeamsTab";
import { PHASE_LABEL, api, usd } from "./lib";
import { openProjector } from "./openProjector";
import { useLiveState, useNow } from "./useLiveState";
import s from "./admin.module.css";

type TabId = "teams" | "feed" | "controls" | "results";
const TAB_KEY = "dyl-admin-tab";

export function AdminApp() {
  const live = useLiveState("admin");
  const now = useNow(1000);
  const toast = useToast();
  const [tab, setTab] = useState<TabId>("controls");
  const [seenFeedId, setSeenFeedId] = useState(0);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = window.localStorage.getItem(TAB_KEY) as TabId | null;
    if (saved && ["teams", "feed", "controls", "results"].includes(saved)) setTab(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  const lastFeedId = live.feed.length ? live.feed[live.feed.length - 1].id : 0;
  useEffect(() => {
    if (tab === "feed") setSeenFeedId(lastFeedId);
  }, [tab, lastFeedId]);
  // The feed is cleared after a reset; don't keep counting against old ids.
  useEffect(() => {
    if (lastFeedId < seenFeedId) setSeenFeedId(0);
  }, [lastFeedId, seenFeedId]);

  if (live.status === "loading") {
    return (
      <main className={s.loginPage}>
        <p className={s.booting}>
          Connecting<span className="cursor" />
        </p>
      </main>
    );
  }
  if (live.status === "anon" || !live.state) {
    return <AdminLogin expired={live.anon?.sessionExpired} onDone={live.refresh} />;
  }

  const st = live.state;
  const unseen = live.feed.filter((f) => f.id > seenFeedId).length;

  async function logout() {
    const r = await api<OkResponse>("/api/admin/logout", {});
    if (!r.ok) toast.error(r.error);
    live.refresh();
  }

  return (
    <main className={s.page}>
      <header className={s.header}>
        <div className={s.brand}>
          <Wordmark size="sm" layout="inline" />
          <span className={s.brandSub}>Control room</span>
        </div>
        <div className={s.headerMid}>
          <span className={s.phaseBadge} data-phase={st.phase}>
            <span className={s.phaseBadgeK}>Phase</span>
            {PHASE_LABEL[st.phase]}
          </span>
          <Timer endsAt={st.phaseEndsAt} pausedMs={st.timerPausedMs} serverOffsetMs={live.offsetMs} size="sm" expiredLabel={null} />
          <span className={s.headerSpend} title="Total OpenAI spend by all teams this event">
            {usd(st.totals.totalSpendUsd)} <span className="muted">spent</span>
          </span>
        </div>
        <div className={s.headerRight}>
          <span className={s.conn} data-ok={live.failures < 2 || undefined} role="status">
            <span className={s.connDot} aria-hidden />
            {live.failures < 2 ? "Live" : "Reconnecting"}
          </span>
          <Button size="sm" variant="secondary" onClick={openProjector}>
            Open projector
          </Button>
          <Button size="sm" variant="ghost" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>

      {live.failures >= 2 && (
        <div className={s.banner} role="alert">
          Lost contact with the server ({live.failures} failed polls). Showing the last known state and retrying automatically.
        </div>
      )}

      <div className={s.tabsRow}>
        <Tabs
          idPrefix="admin"
          aria-label="Admin sections"
          value={tab}
          onChange={(id) => setTab(id as TabId)}
          items={[
            { id: "controls", label: "Controls" },
            { id: "teams", label: "Teams", badge: st.teams.length || undefined },
            { id: "feed", label: "Feed", badge: tab === "feed" ? undefined : unseen > 99 ? "99+" : unseen || undefined },
            { id: "results", label: "Results" },
          ]}
        />
      </div>

      <section className={s.panelArea} role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
        {tab === "teams" && <TeamsTab state={st} now={now + live.offsetMs} refresh={live.refresh} />}
        {tab === "feed" && <FeedTab feed={live.feed} now={now + live.offsetMs} />}
        {tab === "controls" && <ControlsTab state={st} offsetMs={live.offsetMs} refresh={live.refresh} />}
        {tab === "results" && <ResultsTab state={st} />}
      </section>
    </main>
  );
}

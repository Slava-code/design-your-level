"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  IN_FLIGHT_STATUSES,
  MAX_REFS,
  type DesignFields,
  type GenerateRequest,
  type GenerateResponse,
  type GenerationView,
  type RefField,
  type SubmitResponse,
  type TeamState,
} from "@/lib/types";
import { Button, ConfirmDialog, Tabs, useToast, cx } from "@/components/ui";
import { post, cr } from "./api";
import { FIELD_LABEL, missingFields, useDraft, type DraftRef } from "./draft";
import { uploadReference, ImagePrepError } from "./images";
import { DesignForm, type Upload } from "./DesignForm";
import { Board } from "./Board";
import { HistoryStrip } from "./HistoryStrip";
import s from "./design.module.css";

type Props = { state: TeamState; serverOffsetMs: number; refresh: () => Promise<void> };
type Tab = "design" | "board";

let uid = 0;
const nextId = () => `u${Date.now().toString(36)}${(uid++).toString(36)}`;

/** Whole seconds left on the phase timer (null = no timer), ticking once a second while `active`. */
function useSecondsLeft(endsAt: string | null, offsetMs: number, active: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active, endsAt]);
  if (!endsAt) return null;
  const end = Date.parse(endsAt);
  return Number.isFinite(end) ? Math.ceil((end - (now + offsetMs)) / 1000) : null;
}

const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1099px)").matches;

export function DesignPhase({ state, serverOffsetMs, refresh }: Props) {
  const toast = useToast();
  const { team, generations } = state;
  const { draft, setDraft, setField, loaded } = useDraft(state.epoch, team.slot);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [tab, setTab] = useState<Tab>(generations.length ? "board" : "design");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof DesignFields, string>>>({});
  const [askAgain, setAskAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<GenerationView | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  // Scroll requests run after the tab switch has rendered, so the target's final position is used.
  const [scrollReq, setScrollReq] = useState<{ to: "board" | "form"; n: number } | null>(null);
  const requestScroll = useCallback((to: "board" | "form") => setScrollReq((r) => ({ to, n: (r?.n ?? 0) + 1 })), []);
  useLayoutEffect(() => {
    if (!scrollReq) return;
    const el = scrollReq.to === "board" ? boardRef.current : formRef.current;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollReq]);

  const inFlight = generations.find((g) => IN_FLIGHT_STATUSES.includes(g.status)) ?? null;
  const newestId = generations[0]?.id ?? null;
  const selected = generations.find((g) => g.id === selectedId) ?? generations[0] ?? null;

  // Follow the newest generation when a new one appears (also covers another teammate's device starting one).
  const seenNewest = useRef<string | null>(newestId);
  useEffect(() => {
    if (newestId && newestId !== seenNewest.current) {
      seenNewest.current = newestId;
      setSelectedId(newestId);
      setTab("board");
    }
  }, [newestId]);

  // When a generation changes state while the board is NOT on screen (phone, Design tab), nudge with a toast.
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  const lastStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    const boardVisible = tabRef.current === "board" || window.matchMedia("(min-width: 1100px)").matches;
    for (const g of generations) {
      const prev = lastStatus.current[g.id];
      if (prev && prev !== g.status && !boardVisible) {
        const open = { title: "Tap Storyboard to see it" };
        if (g.status === "done") toast.success("Your storyboard is ready.", open);
        else if (g.status === "questions") toast.show("The artist has a few questions.", { tone: "info", ...open });
        else if ((g.status === "refused" || g.status === "error") && g.error !== "Cancelled.")
          toast.error(g.error ?? "That one didn't work.", open);
      }
      lastStatus.current[g.id] = g.status;
    }
  }, [generations, toast]);

  // On phones, when the storyboard on screen finishes (or fails), bring its top into view: the long
  // "drawing" view above it collapses, which otherwise leaves the new picture scrolled off the top.
  const selStatus = selected ? `${selected.id}:${selected.status}` : "";
  const prevSel = useRef(selStatus);
  useEffect(() => {
    const before = prevSel.current;
    prevSel.current = selStatus;
    if (!selected || tabRef.current !== "board" || !narrow()) return;
    const [bid, bstatus] = before.split(":");
    const finished = ["done", "refused", "error"].includes(selected.status);
    const wasWorking = bid === selected.id && (bstatus === "generating" || bstatus === "asking");
    if (finished && wasWorking) requestScroll("board");
  }, [selStatus, selected, requestScroll]);

  const refCount = draft.refs.length + uploads.filter((u) => u.status !== "error").length;
  const remainingRefs = Math.max(0, MAX_REFS - refCount);
  const uploading = uploads.some((u) => u.status === "uploading");

  const askQuestions = state.nextGenerateAsksQuestions || askAgain;
  const estimate = askQuestions ? state.estimates.withQuestionsUsd : state.estimates.generateUsd;
  const outOfBudget = team.remainingUsd + 1e-9 < estimate;

  // ---------------------------------------------------------------------------------- uploads

  const onFiles = useCallback(
    (field: RefField, files: File[]) => {
      const room = Math.max(0, MAX_REFS - (draft.refs.length + uploads.filter((u) => u.status !== "error").length));
      const take = files.slice(0, room);
      if (files.length > take.length) toast.show(`Up to ${MAX_REFS} reference images in total.`, { tone: "warn" });
      for (const file of take) {
        const id = nextId();
        const preview = URL.createObjectURL(file);
        setUploads((u) => [...u, { id, field, preview, name: file.name, progress: 0.02, status: "uploading" }]);
        uploadReference(file, state.uploadPrefix, (p) =>
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))),
        )
          .then(({ url }) => {
            setDraft((d) => ({ ...d, refs: [...d.refs, { id, url, field, name: file.name }].slice(0, MAX_REFS) }));
            setUploads((u) => u.filter((x) => x.id !== id));
            URL.revokeObjectURL(preview);
          })
          .catch((e: unknown) => {
            const msg = e instanceof ImagePrepError ? e.message : "Upload failed. Try again.";
            toast.error(msg, { title: "Image not added" });
            setUploads((u) => u.filter((x) => x.id !== id));
            URL.revokeObjectURL(preview);
          });
      }
    },
    [draft.refs.length, uploads, setDraft, state.uploadPrefix, toast],
  );

  const onRemoveRef = useCallback(
    (id: string) => {
      setDraft((d) => ({ ...d, refs: d.refs.filter((r) => r.id !== id) }));
      setUploads((u) => u.filter((x) => x.id !== id));
    },
    [setDraft],
  );

  // ---------------------------------------------------------------------------------- generate

  function scrollToField(k: keyof DesignFields) {
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-field="${k}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.querySelector<HTMLElement>("textarea, input")?.focus({ preventScroll: true });
    });
  }

  async function generate() {
    if (busy) return;
    const missing = missingFields(draft.fields);
    if (missing.length) {
      const next: Partial<Record<keyof DesignFields, string>> = {};
      for (const k of missing) next[k] = "Needed. A short line is fine.";
      setErrors(next);
      setTab("design");
      scrollToField(missing[0]);
      toast.show(`Still missing: ${missing.map((k) => FIELD_LABEL[k]).join(", ")}.`, { tone: "warn", title: "Almost there" });
      return;
    }
    if (uploading) {
      toast.show("Wait for your image upload to finish.", { tone: "warn" });
      return;
    }
    if (inFlight) {
      setSelectedId(inFlight.id);
      setTab("board");
      return;
    }
    setErrors({});
    setBusy(true);
    const body: GenerateRequest = {
      design: draft.fields,
      references: draft.refs.map((r) => ({ url: r.url, field: r.field })),
      askQuestions,
    };
    const r = await post<GenerateResponse>("/api/generate", body, 30000);
    setBusy(false);
    if (r.ok) {
      seenNewest.current = r.data.generation.id;
      setSelectedId(r.data.generation.id);
      setTab("board");
      setAskAgain(false);
      requestScroll("board");
      void refresh();
      return;
    }
    const code = r.error.code;
    if (code === "busy") {
      toast.show(r.error.error, { tone: "warn" });
      setTab("board");
    } else if (code === "budget") {
      toast.error(r.error.error, { title: "Out of credits", durationMs: 9000 });
    } else if (code === "bad_request" && /uploaded|Reference/i.test(r.error.error)) {
      toast.error(r.error.error, { title: "Image problem" });
    } else {
      toast.error(r.error.error);
    }
    void refresh();
  }

  // ---------------------------------------------------------------------------------- restore

  const draftMatches = (g: GenerationView) =>
    (Object.keys(g.inputs) as (keyof DesignFields)[]).every((k) => (g.inputs[k] ?? "") === draft.fields[k].trim()) &&
    g.references.length === draft.refs.length &&
    g.references.every((r, i) => draft.refs[i]?.url === r.url);

  function applyRestore(g: GenerationView) {
    const refs: DraftRef[] = g.references.map((r, i) => ({ id: `r${g.id}${i}`, url: r.url, field: r.field }));
    setDraft({ fields: { ...g.inputs }, refs });
    setRestore(null);
    setTab("design");
    setErrors({});
    toast.success(`Form now matches version ${versionOf(g)}. Edit away.`);
    requestScroll("form");
  }

  const versionOf = useCallback((g: GenerationView) => generations.length - generations.findIndex((x) => x.id === g.id), [generations]);

  const missing = useMemo(() => missingFields(draft.fields), [draft.fields]);
  const doneCount = generations.filter((g) => g.status === "done").length;

  // ---------------------------------------------------------------------------------- not-submitted nudge

  const newestDone = generations.find((g) => g.status === "done") ?? null; // newest first
  const showNudge = state.phase === "DESIGN" && !!newestDone && !state.submittedGenerationId;
  const secsLeft = useSecondsLeft(state.phaseEndsAt, serverOffsetMs, showNudge);
  const urgent = showNudge && secsLeft != null && secsLeft <= 60;
  const [submitting, setSubmitting] = useState(false);

  async function submitNewest() {
    if (!newestDone || submitting) return;
    setSubmitting(true);
    const r = await post<SubmitResponse>("/api/submit", { generationId: newestDone.id });
    setSubmitting(false);
    if (!r.ok) {
      toast.error(r.error.error, { title: "Not submitted" });
    } else {
      toast.success(`Version ${versionOf(newestDone)} submitted. You can still switch until time is up.`, { title: "Submitted" });
    }
    void refresh();
  }

  const nudge = (where: "bar" | "board") =>
    showNudge && newestDone ? (
      <div className={cx(s.nudge, urgent && s.nudgeUrgent, where === "board" && s.nudgeBoard)} role="status">
        <p className={s.nudgeText}>
          <b>Not submitted yet.</b> {urgent ? "Time is almost up!" : "Only submitted levels get rated."}
        </p>
        <Button size="sm" variant={urgent ? "primary" : "secondary"} onClick={submitNewest} loading={submitting} loadingText="Submitting" className={s.nudgeBtn}>
          Submit version {versionOf(newestDone)}
        </Button>
      </div>
    ) : null;

  // ---------------------------------------------------------------------------------- render

  const genLabel = inFlight
    ? inFlight.status === "questions"
      ? "Answer the questions"
      : "Drawing..."
    : askQuestions
      ? "Next: questions, then draw"
      : generations.length
        ? "Redraw storyboard"
        : "Draw my storyboard";

  return (
    <main className={s.design} data-tab={tab}>
      <div className={s.tabsBar}>
        <Tabs
          items={[
            { id: "design", label: "Design" },
            {
              id: "board",
              label: "Storyboard",
              badge: generations.length ? String(generations.length) : undefined,
              badgeTone: "calm",
              busy: !!inFlight,
            },
          ]}
          value={tab}
          onChange={(id) => setTab(id as Tab)}
          idPrefix="dz"
          fill
          aria-label="Design or storyboard"
        />
      </div>

      <div className={s.columns}>
        <section
          ref={formRef}
          className={s.formCol}
          id="dz-panel-design"
          role="tabpanel"
          aria-labelledby="dz-tab-design"
          data-active={tab === "design" || undefined}
        >
          {loaded ? (
            <DesignForm
              fields={draft.fields}
              setField={(k, v) => {
                setField(k, v);
                if (errors[k] && v.trim()) setErrors((e) => ({ ...e, [k]: undefined }));
              }}
              errors={errors}
              refs={draft.refs}
              uploads={uploads}
              remainingRefs={remainingRefs}
              onFiles={onFiles}
              onRemoveRef={onRemoveRef}
            />
          ) : (
            <div className={s.formSkeleton} aria-busy="true" />
          )}

          <div className={s.genBar}>
            <div className={s.genBarInner}>
              {missing.length > 0 && Object.keys(errors).some((k) => errors[k as keyof DesignFields]) && (
                <p className={s.missing} role="alert">
                  Missing: {missing.map((k) => FIELD_LABEL[k]).join(", ")}
                </p>
              )}
              {outOfBudget && !inFlight ? (
                <p className={s.outOfBudget} role="status">
                  Out of credits for new drawings ({cr(team.remainingUsd)} left).
                  {doneCount > 0 ? " You can still submit any storyboard you made." : " Ask the presenter for help."}
                </p>
              ) : null}
              {nudge("bar")}
              <div className={s.genRow}>
                <Button
                  size="lg"
                  block
                  onClick={generate}
                  loading={busy}
                  loadingText="Starting"
                  disabled={!!inFlight || (outOfBudget && !inFlight) || uploading}
                  className={s.genBtn}
                >
                  {uploading ? "Uploading image..." : genLabel}
                </Button>
              </div>
              <div className={s.genMeta}>
                {!state.nextGenerateAsksQuestions && !inFlight ? (
                  <label className={s.askAgain}>
                    <input type="checkbox" checked={askAgain} onChange={(e) => setAskAgain(e.target.checked)} />
                    <span>Ask me questions again</span>
                  </label>
                ) : state.nextGenerateAsksQuestions && !inFlight ? (
                  <span className={s.genNote}>First, up to 3 quick questions.</span>
                ) : (
                  <span className={s.genNote}>You can keep editing while it works.</span>
                )}
                <span className={s.cost}>up to {cr(estimate)}</span>
              </div>
            </div>
          </div>
        </section>

        <section
          ref={boardRef}
          className={s.boardCol}
          id="dz-panel-board"
          role="tabpanel"
          aria-labelledby="dz-tab-board"
          data-active={tab === "board" || undefined}
        >
          {selected && selected.status !== "done" && nudge("board")}
          <Board
            gen={selected}
            version={selected ? versionOf(selected) : 0}
            isLatest={!!selected && selected.id === newestId}
            submittedId={state.submittedGenerationId}
            canSubmit={state.phase === "DESIGN"}
            refresh={refresh}
            onEdit={() => {
              setTab("design");
              requestScroll("form");
            }}
            onRestore={(g) => (draftMatches(g) ? applyRestore(g) : setRestore(g))}
            restoreMatches={selected ? draftMatches(selected) : true}
          />
          {generations.length > 0 && (
            <HistoryStrip
              generations={generations}
              selectedId={selected?.id ?? null}
              submittedId={state.submittedGenerationId}
              onSelect={(id) => {
                setSelectedId(id);
                setTab("board");
              }}
            />
          )}
        </section>
      </div>

      <ConfirmDialog
        open={!!restore}
        title={restore ? `Load version ${versionOf(restore)} into the form?` : ""}
        body="This replaces what's in the form now with the design from that storyboard. Your storyboards stay in the history."
        confirmLabel="Load it"
        cancelLabel="Keep my form"
        onConfirm={() => restore && applyRestore(restore)}
        onCancel={() => setRestore(null)}
      />
      <span className={cx("sr-only")} aria-live="polite">
        {inFlight ? (inFlight.status === "questions" ? "The artist has questions." : "Working on your storyboard.") : ""}
      </span>
    </main>
  );
}

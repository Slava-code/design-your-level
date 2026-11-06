"use client";

import { useState } from "react";
import { DESIGN_FIELD_MAX, type DesignFields, type RefField } from "@/lib/types";
import { ChoiceChips, Field, ImageDropzone, type DropzoneItem, cx } from "@/components/ui";
import type { DraftRef } from "./draft";
import s from "./design.module.css";

export type Upload = {
  id: string;
  field: RefField;
  preview: string;
  name: string;
  progress: number;
  status: "uploading" | "error";
};

type Props = {
  fields: DesignFields;
  setField: (k: keyof DesignFields, v: string) => void;
  errors: Partial<Record<keyof DesignFields, string>>;
  refs: DraftRef[];
  uploads: Upload[];
  remainingRefs: number;
  onFiles: (field: RefField, files: File[]) => void;
  onRemoveRef: (id: string) => void;
};

const GENRES = ["Horror", "Puzzle", "Action-adventure", "RPG", "Platformer", "Sci-fi", "Fantasy"];
const FEELINGS = ["hunted", "uneasy", "powerful", "lonely", "curious", "frantic"];
const STYLES = [
  "pixel art",
  "1930s rubber-hose cartoon",
  "gritty 1970s sci-fi",
  "watercolor storybook",
  "claymation",
  "comic book ink",
];

const PATH_HINT = "The path from the start to the exit.";

const ASPECTS: {
  k: "level" | "enemy" | "ability" | "puzzle";
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    k: "level",
    label: "Level",
    hint: `${PATH_HINT} What does the place look like along the way, and how does the space create your feeling?`,
    placeholder: "A flooded subway station. You start in a dark ticket hall, wade through the tunnels...",
  },
  {
    k: "enemy",
    label: "Enemy",
    hint: "What hunts the player along the way? How does it look and behave, and how does it create your feeling?",
    placeholder: "A tall shape made of wet newspaper that only moves when the lights flicker...",
  },
  {
    k: "ability",
    label: "Ability",
    hint: "What does the player find on the way, and what does it let them do? How does it create your feeling?",
    placeholder: "A broken flashlight that shows footprints nobody else can see...",
  },
  {
    k: "puzzle",
    label: "Puzzle",
    hint: "What blocks the exit, and how do they solve it? How does it create your feeling?",
    placeholder: "The exit gate opens only when all three station clocks show the same time...",
  },
];

export function DesignForm({ fields, setField, errors, refs, uploads, remainingRefs, onFiles, onRemoveRef }: Props) {
  const [openZones, setOpenZones] = useState<Set<RefField>>(new Set());

  function zone(field: RefField, label: string) {
    const items: DropzoneItem[] = [
      ...refs.filter((r) => r.field === field).map((r) => ({ id: r.id, url: r.url, name: r.name ?? "Reference image", status: "done" as const })),
      ...uploads
        .filter((u) => u.field === field)
        .map((u) => ({ id: u.id, url: u.preview, name: u.name, status: u.status, progress: u.progress })),
    ];
    const open = items.length > 0 || openZones.has(field);
    if (!open) {
      if (remainingRefs <= 0) return null;
      return (
        <button
          type="button"
          className={s.addRef}
          onClick={() => setOpenZones((z) => new Set(z).add(field))}
          aria-label={`Add a reference image for ${label}`}
        >
          <span className={s.addRefPlus} aria-hidden>
            +
          </span>
          Reference image <span className={s.addRefOpt}>optional</span>
        </button>
      );
    }
    return (
      <ImageDropzone
        compact
        items={items}
        max={items.length + remainingRefs}
        onFiles={(files) => onFiles(field, files)}
        onRemove={onRemoveRef}
        label={`${label} reference`}
        hint={remainingRefs > 0 ? `${remainingRefs} of 4 image slots left for the whole design.` : "All 4 image slots used."}
        className={s.zone}
      />
    );
  }

  return (
    <div className={s.form}>
      <div className={s.formIntro}>
        <p className={s.formKicker}>Design document</p>
        <h1 className={s.formTitle}>Build your level</h1>
        <p className={s.formLead}>
          Get the player from the <b>start</b> of the level to the <b>exit</b>. Short answers are fine. The
          artist fills the gaps.
        </p>
      </div>

      <section className={cx(s.block, s.vibe)} aria-labelledby="vibe-h">
        <h2 id="vibe-h" className={s.blockHead}>
          <span className={s.blockNum}>01-03</span> The vibe
        </h2>
        <div className={s.blockBody}>
          <div data-field="genre">
            <ChoiceChips
              label={<span className={s.chipLegend}>Genre</span>}
              options={GENRES}
              value={fields.genre}
              onChange={(v) => setField("genre", v)}
              otherMaxLength={DESIGN_FIELD_MAX.genre}
              otherPlaceholder="Your genre"
              name="genre"
            />
          </div>
          <div data-field="feeling">
            <Field
              label="Feeling"
              hint="What should the player feel? One or two words is plenty."
              value={fields.feeling}
              onChange={(v) => setField("feeling", v)}
              multiline={false}
              placeholder="hunted"
              maxLength={DESIGN_FIELD_MAX.feeling}
              examples={FEELINGS}
              error={errors.feeling}
              required
              autoComplete="off"
            />
          </div>
          <div data-field="artStyle">
            <Field
              label="Art style"
              hint="How should the storyboard look?"
              value={fields.artStyle}
              onChange={(v) => setField("artStyle", v)}
              rows={2}
              placeholder="watercolor storybook"
              maxLength={DESIGN_FIELD_MAX.artStyle}
              examples={STYLES}
              exampleMode="replace"
              autoComplete="off"
            >
              {zone("artStyle", "Art style")}
            </Field>
          </div>
        </div>
      </section>

      <section className={cx(s.block, s.doc, "surface-paper")} aria-labelledby="doc-h">
        <h2 id="doc-h" className={s.blockHead}>
          <span className={s.blockNum}>04-07</span> The four aspects
        </h2>
        <p className={s.docLead}>For each one: how does it create your feeling?</p>
        <div className={s.showDontTell} role="note">
          <span className={s.sdtBig}>Show, don&apos;t tell!</span>
          <span className={s.sdtSub}>
            Not &quot;it&apos;s scary&quot;: what does the player <b>see</b>, <b>hear</b> and <b>do</b> that makes it scary?
          </span>
        </div>
        <div className={s.blockBody}>
          {ASPECTS.map((a) => (
            <div key={a.k} data-field={a.k} className={s.aspectField}>
              <Field
                label={a.label}
                aspect={a.k}
                hint={a.hint}
                value={fields[a.k]}
                onChange={(v) => setField(a.k, v)}
                rows={3}
                placeholder={a.placeholder}
                maxLength={DESIGN_FIELD_MAX[a.k]}
                error={errors[a.k]}
                required
              >
                {zone(a.k, a.label)}
              </Field>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

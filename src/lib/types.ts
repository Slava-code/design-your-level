// Shared API types for Design Your Level. Client-safe: no runtime code that touches the server.
// Every route under src/app/api returns either its documented response type or ApiError.
//
// Polling contract: clients poll GET /api/state?view=team|admin|screen every 2 s (no-store).
// Timers run locally: remainingMs = Date.parse(phaseEndsAt) - (Date.now() + (serverNow - clientReceiveTime)).
// Generation progress (asking -> questions -> generating -> done) is read from the same poll.

// ---------------------------------------------------------------------------------------------
// Basics

export type Phase = "LOBBY" | "DESIGN" | "VOTING" | "REVEAL" | "CLOSED";
export const PHASES: Phase[] = ["LOBBY", "DESIGN", "VOTING", "REVEAL", "CLOSED"];

/** ISO-8601 timestamp string (UTC). */
export type ISODate = string;

export type ErrorCode =
  | "bad_request" // malformed body / validation failed (message says what)
  | "unauthorized" // no valid session for this action (or session from an old epoch: re-join)
  | "invalid_code" // join/admin code not recognised
  | "rate_limited" // too many failed attempts from this IP; see retryAfterSec
  | "not_found"
  | "phase" // action not allowed in the current phase
  | "busy" // team already has a generation in asking|questions|generating
  | "budget" // not enough budget left for this call (HTTP 402)
  | "flagged" // text failed the moderation pre-check (answers step); nothing charged
  | "conflict" // state changed underneath (e.g. generation no longer waiting for answers)
  | "server"; // unexpected error

/** Every non-2xx JSON response has this shape. */
export type ApiError = { error: string; code: ErrorCode; retryAfterSec?: number };

// ---------------------------------------------------------------------------------------------
// Design input (mirrors DesignInput in src/lib/ai, but client-safe)

export type RefField = "genre" | "feeling" | "artStyle" | "level" | "enemy" | "ability" | "puzzle" | "general";
export const REF_FIELDS: RefField[] = ["genre", "feeling", "artStyle", "level", "enemy", "ability", "puzzle", "general"];

/** A reference image already uploaded to Vercel Blob (url = PutBlobResult.url). */
export type RefImage = { url: string; field: RefField };

/** The text fields of a design. All strings, trimmed server-side; empty allowed (at least one must be non-empty). */
export type DesignFields = {
  genre: string; // max 80
  feeling: string; // max 300
  artStyle: string; // max 300
  level: string; // max 1500
  enemy: string; // max 1500
  ability: string; // max 1500
  puzzle: string; // max 1500
};
export const DESIGN_FIELD_MAX: Record<keyof DesignFields, number> = {
  genre: 80,
  feeling: 300,
  artStyle: 300,
  level: 1500,
  enemy: 1500,
  ability: 1500,
  puzzle: 1500,
};
export const MAX_REFS = 4;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const UPLOAD_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

// ---------------------------------------------------------------------------------------------
// Generations

/**
 * asking     - follow-up questions are being written (AI running)
 * questions  - waiting for the team's answers (POST /api/generate/[id]/answers, or cancel)
 * generating - image prompt + storyboard being made (AI running)
 * done       - imageUrl is set
 * refused    - the image model refused; `error` has a friendly message; cost was charged
 * error      - something failed (or timed out after 6 min, or cancelled); `error` explains
 * flagged    - moderation pre-check flagged the text; nothing charged; `error` explains
 */
export type GenerationStatus = "asking" | "questions" | "generating" | "done" | "refused" | "error" | "flagged";
export const IN_FLIGHT_STATUSES: GenerationStatus[] = ["asking", "questions", "generating"];

export type GenerationView = {
  id: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** When the current asking/generating stage started (for an elapsed-time display). */
  stageStartedAt: ISODate;
  status: GenerationStatus;
  /** True if this generation had (or is having) a follow-up round. */
  askedQuestions: boolean;
  inputs: DesignFields;
  references: RefImage[];
  /** null if no follow-up round; [] if the model had no questions. */
  questions: string[] | null;
  /** Aligned with questions; "" = skipped. null until answered. */
  answers: string[] | null;
  /** "What the artist was told". null until written. */
  imagePrompt: string | null;
  /** 4 captions: entering, enemy, ability, puzzle/exit. null until written. */
  panelCaptions: string[] | null;
  referenceRoles: string[] | null;
  /** What was softened/changed vs. the team's text (may be empty). */
  changesMade: string[] | null;
  imageUrl: string | null;
  /** Friendly message for refused / error / flagged. */
  error: string | null;
  costUsd: number;
  msText: number | null;
  msImage: number | null;
  /** True if this is the team's currently submitted generation. */
  submitted: boolean;
};

/** Admin-only extra detail for GET /api/admin/team/[slot]. */
export type GenerationAdminView = GenerationView & {
  slot: number;
  reservedUsd: number;
  modelText: string | null;
  modelImage: string | null;
  errorDetail: string | null;
  /** Per-call cost breakdown: {followup|prompt|image: {usd, ms, ...token counts}}. */
  costDetail: Record<string, Record<string, number | null>>;
};

// ---------------------------------------------------------------------------------------------
// Teams

export type TeamSummary = {
  slot: number; // "Team N"
  name: string;
  spendUsd: number;
  reservedUsd: number;
  budgetUsd: number;
  /** budget - spend - reserved, floored at 0. */
  remainingUsd: number;
  submittedGenerationId: string | null;
};

/** Derived from the latest generation + submission. */
export type TeamActivity = "drafting" | "asking" | "answering" | "generating" | "submitted";

export type AdminTeamRow = TeamSummary & {
  joinedAt: ISODate;
  lastSeenAt: ISODate;
  /** last poll within 15 s */
  online: boolean;
  generationCount: number;
  activity: TeamActivity;
  submittedImageUrl: string | null;
  /** VOTING/REVEAL/CLOSED: votes cast / designs assigned to this team. */
  votesCast: number;
  votesAssigned: number;
};

// ---------------------------------------------------------------------------------------------
// Voting and reveal

export type Scores = { level: number; enemy: number; ability: number; puzzle: number }; // integers 1-5
export const SCORE_KEYS: (keyof Scores)[] = ["level", "enemy", "ability", "puzzle"];

/** One design a team must rate. Anonymous: no author slot or name. */
export type AssignedDesign = {
  /** Opaque id to send as `target` in POST /api/vote. */
  target: string;
  /** 1-based display order ("Design 1 of 4"). */
  position: number;
  inputs: DesignFields;
  imageUrl: string | null;
  panelCaptions: string[] | null;
  /** This team's vote, if cast (can be changed until VOTING ends). */
  myVote: Scores | null;
};

export type RankingEntry = {
  rank: number; // 1 = winner
  slot: number;
  name: string;
  generationId: string;
  imageUrl: string | null;
  panelCaptions: string[] | null;
  inputs: DesignFields;
  /** Mean of the four category means; null if nobody rated it. */
  score: number | null;
  ratings: number;
  categoryMeans: Scores | null;
};

export type RevealState = {
  /** 0..maxStep. Step 1 reveals the lowest podium place, the last step reveals the winner. */
  step: number;
  /** min(3, number of ranked designs). */
  maxStep: number;
  /** Revealed podium entries so far, lowest place first (e.g. [3rd, 2nd] at step 2 of 3). */
  revealed: RankingEntry[];
};

// ---------------------------------------------------------------------------------------------
// Feed

export type FeedType =
  | "joined"
  | "renamed"
  | "asked" // follow-up questions ready (payload: {generationId, count})
  | "generated" // storyboard done (payload: {generationId, costUsd, imageUrl})
  | "refused" // (payload: {generationId, costUsd})
  | "error" // (payload: {generationId, message})
  | "flagged" // moderation pre-check (payload: {generationId, categories})
  | "cancelled"
  | "submitted" // (payload: {generationId, resubmit})
  | "voted" // first vote by a voter on a target (payload: {target: slot})
  | "phase" // (payload: {from, to, durationSec})
  | "timer"
  | "reveal" // (payload: {step})
  | "budget_reset"
  | "budget_set"
  | "event_reset";

export type FeedItem = {
  id: number;
  ts: ISODate;
  type: FeedType;
  slot: number | null;
  /** Team name at read time (null for event-level items). */
  teamName: string | null;
  payload: Record<string, unknown>;
};

// ---------------------------------------------------------------------------------------------
// GET /api/state

export type StateBase = {
  phase: Phase;
  phaseStartedAt: ISODate;
  phaseEndsAt: ISODate | null;
  /** Set while the countdown is paused: milliseconds left (phaseEndsAt is then null). */
  timerPausedMs: number | null;
  /** Server clock at response time, for client clock-offset correction. */
  serverNow: ISODate;
  epoch: number;
};

/** No valid session. `sessionExpired` = a cookie was present but is from an old epoch / invalid (re-join). */
export type AnonState = StateBase & { role: "anon"; sessionExpired: boolean };

export type TeamState = StateBase & {
  role: "team";
  team: TeamSummary;
  /** Newest first. */
  generations: GenerationView[];
  submittedGenerationId: string | null;
  /** Can rename now (LOBBY/DESIGN). */
  canRename: boolean;
  /** Pathname prefix the reference-image upload must use, e.g. "ev3/refs/slot2/". */
  uploadPrefix: string;
  /** True until the team has had a follow-up round: the next generate will ask questions regardless. */
  nextGenerateAsksQuestions: boolean;
  /** Estimated cost of the next generate call (with and without questions), for the UI. */
  estimates: { generateUsd: number; withQuestionsUsd: number };
  /** VOTING only (else null): designs this team must rate. */
  voting: { assigned: AssignedDesign[]; done: number; total: number } | null;
  /** REVEAL/CLOSED only (else null). */
  reveal: RevealState | null;
};

export type AdminTotals = {
  totalSpendUsd: number;
  totalReservedUsd: number;
  teamsJoined: number;
  submissions: number;
  generationsDone: number;
  inFlight: number;
  /** VOTING onwards. */
  votesCast: number;
  votesAssigned: number;
  votersDone: number;
};

/** view=admin and view=screen (both need the admin cookie). */
export type AdminState = StateBase & {
  role: "admin" | "screen";
  teams: AdminTeamRow[]; // only teams that have joined, by slot
  /** Feed items with id > since (ascending, max 100); without `since`, the latest 100 (ascending). */
  feed: FeedItem[];
  /** Pass as ?since= on the next poll. */
  feedCursor: number;
  totals: AdminTotals;
  /** REVEAL/CLOSED only. */
  reveal: RevealState | null;
  /** view=admin in REVEAL/CLOSED only: the full ranking (never sent to view=screen). */
  ranking: RankingEntry[] | null;
  /** Number of team slots configured (TEAM_CODES length). */
  slotsConfigured: number;
};

export type StateResponse = AnonState | TeamState | AdminState;

// ---------------------------------------------------------------------------------------------
// Request / response bodies

/** POST /api/join */
export type JoinRequest = { code: string };
export type JoinResponse = { team: TeamSummary; firstJoin: boolean };

/** POST /api/leave (clears the team cookie) */
export type OkResponse = { ok: true };

/** POST /api/team/name  (LOBBY/DESIGN only) */
export type RenameRequest = { name: string }; // 1-32 chars after trim + whitespace collapse
export type RenameResponse = { team: TeamSummary };

/**
 * POST /api/upload: Vercel Blob client-upload token route. Use from the browser:
 *   import { upload } from "@vercel/blob/client";
 *   const blob = await upload(`${state.uploadPrefix}${safeName}`, file, { access: "public", handleUploadUrl: "/api/upload" });
 *   refs.push({ url: blob.url, field });
 * Allowed in LOBBY/DESIGN with a team session; types UPLOAD_CONTENT_TYPES; max 8 MB; random suffix added.
 */

/** POST /api/generate (DESIGN only). The team's first generation always asks questions. */
export type GenerateRequest = { design: DesignFields; references: RefImage[]; askQuestions: boolean };
/** Returns immediately; poll /api/state for progress. status is "asking", "generating" or "flagged". */
export type GenerateResponse = { generation: GenerationView };

/** POST /api/generate/[id]/answers  (status must be "questions"). "" skips a question. */
export type AnswersRequest = { answers: string[] }; // each max 500 chars
export type AnswersResponse = { generation: GenerationView };

/** POST /api/generate/[id]/cancel  (status must be "questions"; marks it error "Cancelled"). */
export type CancelResponse = { generation: GenerationView };

/** POST /api/submit  (DESIGN only; own generation with status done; resubmitting replaces). */
export type SubmitRequest = { generationId: string };
export type SubmitResponse = { team: TeamSummary };

/** POST /api/vote  (VOTING only; target from TeamState.voting.assigned[].target; re-voting updates). */
export type VoteRequest = { target: string; scores: Scores };
export type VoteResponse = { ok: true; done: number; total: number };

/** POST /api/admin/login */
export type AdminLoginRequest = { code: string };
/** POST /api/admin/logout -> OkResponse */

/**
 * POST /api/admin/phase
 * Allowed: one step forward (LOBBY->DESIGN->VOTING->REVEAL->CLOSED) or one step back.
 * durationSec sets the new phase's timer (omit/0 = no timer).
 * Entering VOTING from DESIGN freezes submissions and computes assignments.
 * Entering REVEAL from VOTING computes the ranking and resets reveal step to 0.
 */
export type PhaseRequest = { phase: Phase; durationSec?: number };
export type PhaseResponse = { phase: Phase; phaseEndsAt: ISODate | null; warning?: string };

/** POST /api/admin/timer: addSec extends (from now if no timer/expired); setSec sets from now (0 clears). */
export type TimerRequest = { addSec?: number; setSec?: number; action?: "pause" | "resume" | "end" };
export type TimerResponse = { phaseEndsAt: ISODate | null; timerPausedMs: number | null };

/** POST /api/admin/reveal  (REVEAL only) */
/** fromStep: the step the admin saw when clicking; makes a double click a no-op instead of skipping a place. */
export type RevealRequest = { action: "next" | "prev" | "reset"; fromStep?: number };
export type RevealResponse = { reveal: RevealState };

/** GET /api/admin/team/[slot] */
export type AdminTeamDetailResponse = { team: AdminTeamRow; generations: GenerationAdminView[] };

/** POST /api/admin/team/[slot]/reset-budget  (spend -> 0; keeps work) */
export type ResetBudgetResponse = { team: TeamSummary };

/** POST /api/admin/reset-event  (wipes everything, bumps epoch; re-issues the caller's admin cookie) */
export type ResetEventRequest = { confirm: "RESET" };
export type ResetEventResponse = { ok: true; epoch: number; blobsDeleted: number };

/** POST /api/dev/team-budget  (NOT in production; admin cookie) — for tests. */
export type DevTeamBudgetRequest = { slot: number; budgetUsd: number };

"use client";

import { useState } from "react";
import type { Person, Result, Signal } from "./types";
import { momentTint } from "./format";
import { Avatar } from "./Avatar";

type LinkedIn = NonNullable<Person["linkedin"]>;

/**
 * Right-side detail panel. Order:
 *   1. Header (avatar, name, headline, location, follower counts, status flags)
 *   2. About (LinkedIn summary)
 *   3. Why now (moment_score)
 *   4. Career (synthesized current role)
 *   5. Experience (LinkedIn work history)
 *   6. Education (LinkedIn)
 *   7. Last 90 days (signal-derived)
 *   8. Priorities (synthesized)
 *   9. Skills (LinkedIn)
 *  10. Languages, certifications, recommendations (LinkedIn)
 *  11. More angles (talking_points, demoted)
 *  12. Raw signals (collapsed)
 */
export function DetailPanel({
  result,
  signals,
  cohort,
  onSelectRank,
}: {
  result: Result;
  signals: Signal[];
  /**
   * The full visible-result list for the current lookup. Used by the
   * Cohort overlap section to find other people who share companies or
   * schools with this person.
   */
  cohort?: Result[];
  /**
   * Jump to another person in the same lookup. Wired by `page.tsx` to
   * `setSelectedRank` so the cohort overlap rows can navigate.
   */
  onSelectRank?: (rank: number) => void;
}) {
  const [highlightedSignalId, setHighlightedSignalId] = useState<string | null>(
    null,
  );

  const { person, matchReason } = result;
  if (!person) return null;

  function jumpToSignal(id: string) {
    setHighlightedSignalId(id);
    const el = document.getElementById(`signal-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => setHighlightedSignalId(null), 1800);
    }
  }

  const li = person.linkedin;
  // Prefer the LinkedIn-fetched headline (richer, current) over the
  // synthesized one when both exist.
  const headline = li?.headline ?? person.identity.headline ?? null;

  return (
    <article className="flex flex-col gap-6 pb-20 min-w-0">
      {/* Header */}
      <header className="flex items-start gap-4">
        <Avatar
          src={li?.profilePictureUrl}
          name={person.identity.name}
          size={72}
        />
        <div className="min-w-0 flex-1">
          <h2
            className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 tracking-tight wrap-anywhere"
            style={{ textWrap: "balance" }}
          >
            {person.identity.name}
          </h2>
          {headline && (
            <p
              className="mt-1 text-sm text-zinc-500 wrap-anywhere"
              style={{ textWrap: "pretty" }}
            >
              {headline}
            </p>
          )}
          {li && <MetaStrip li={li} />}
          {li && <StatusFlags li={li} />}
          {matchReason && (
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300 wrap-anywhere">
              <span className="text-zinc-500">Why this person. </span>
              {matchReason}
            </p>
          )}
          {person.identity.profiles.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {person.identity.profiles.map((p, i) => (
                <a
                  key={i}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-mono text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 border border-zinc-200 dark:border-zinc-800 rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                >
                  {p.source}
                </a>
              ))}
            </div>
          )}
        </div>
      </header>

      <EnrichmentStatus li={li} />

      <ContactSection person={person} li={li} />

      {/* About / summary */}
      {li?.summary && (
        <Section title="About">
          <p
            className="whitespace-pre-line wrap-anywhere text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
            style={{ textWrap: "pretty" }}
          >
            {li.summary}
          </p>
        </Section>
      )}

      {/* Why now */}
      {person.momentScore && (
        <Section title="Why now">
          <div className="flex items-baseline gap-3">
            <span
              className={[
                "text-3xl font-semibold tabular-nums",
                momentTint(person.momentScore.score),
              ].join(" ")}
            >
              {person.momentScore.score.toFixed(2)}
            </span>
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              {person.momentScore.reason}
            </span>
          </div>
          {person.momentScore.signalId && (
            <button
              type="button"
              onClick={() =>
                person.momentScore?.signalId &&
                jumpToSignal(person.momentScore.signalId)
              }
              className="mt-2 text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              See cited signal
            </button>
          )}
        </Section>
      )}

      {/* Career */}
      {person.career &&
        (person.career.currentRole ||
          person.career.currentCompany ||
          person.career.trajectory ||
          person.career.recentChange) && (
          <Section title="Career">
            <div className="space-y-1 text-sm text-zinc-800 dark:text-zinc-200">
              {(person.career.currentRole || person.career.currentCompany) && (
                <div className="font-medium wrap-anywhere">
                  {person.career.currentRole}
                  {person.career.currentRole && person.career.currentCompany
                    ? " · "
                    : ""}
                  {person.career.currentCompany}
                </div>
              )}
              {person.career.trajectory && (
                <p className="text-zinc-600 dark:text-zinc-400 wrap-anywhere">
                  {person.career.trajectory}
                </p>
              )}
              {person.career.recentChange && (
                <p className="text-zinc-600 dark:text-zinc-400 wrap-anywhere">
                  Recent change. {person.career.recentChange}
                </p>
              )}
            </div>
          </Section>
        )}

      {/* Trajectory — derived intelligence over the experience array */}
      {li?.derived && (
        <TrajectorySection derived={li.derived} />
      )}

      {/* Experience timeline (LinkedIn) */}
      {li?.experience && li.experience.length > 0 && (
        <Section
          title="Experience"
          aside={
            li.experienceTotalCount &&
            li.experienceTotalCount > li.experience.length
              ? `showing ${li.experience.length} of ${li.experienceTotalCount}`
              : undefined
          }
        >
          <ol className="space-y-4">
            {li.experience.map((e, i) => (
              <li key={i} className="flex gap-3">
                <Avatar
                  src={e.companyPictureUrl}
                  name={e.company ?? "?"}
                  size={32}
                  rounded={false}
                />
                <div className="min-w-0 flex-1 text-sm">
                  {e.position && (
                    <div className="font-medium text-zinc-900 dark:text-zinc-100 wrap-anywhere">
                      {e.position}
                    </div>
                  )}
                  <div className="text-zinc-600 dark:text-zinc-400 wrap-anywhere">
                    {[e.company, e.location].filter(Boolean).join(" · ")}
                  </div>
                  <div className="font-mono text-[11px] text-zinc-400 tabular-nums mt-0.5 wrap-anywhere">
                    {formatRange(e.start, e.end, e.current)}
                  </div>
                  {e.description && (
                    <p
                      className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 whitespace-pre-line wrap-anywhere line-clamp-6"
                      style={{ textWrap: "pretty" }}
                    >
                      {e.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Education (LinkedIn) */}
      {li?.education && li.education.length > 0 && (
        <Section
          title="Education"
          aside={
            li.educationTotalCount &&
            li.educationTotalCount > li.education.length
              ? `showing ${li.education.length} of ${li.educationTotalCount}`
              : undefined
          }
        >
          <ol className="space-y-3">
            {li.education.map((e, i) => (
              <li key={i} className="flex gap-3">
                <Avatar
                  src={e.schoolPictureUrl}
                  name={e.school ?? "?"}
                  size={32}
                  rounded={false}
                />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100 wrap-anywhere">
                    {e.school}
                  </div>
                  {(e.degree || e.fieldOfStudy) && (
                    <div className="text-zinc-600 dark:text-zinc-400 wrap-anywhere">
                      {[e.degree, e.fieldOfStudy].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div className="font-mono text-[11px] text-zinc-400 tabular-nums mt-0.5">
                    {formatRange(e.start, e.end, false)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Cohort overlap — alumni / ex-colleagues from this same lookup */}
      {cohort && cohort.length > 1 && (
        <CohortOverlapSection
          person={person}
          cohort={cohort}
          onSelectRank={onSelectRank}
        />
      )}

      {/* Last 90 days */}
      {person.last90Days && person.last90Days.length > 0 && (
        <Section title="Last 90 days">
          <ol className="space-y-3">
            {person.last90Days.map((it, i) => (
              <li key={i} className="min-w-0 text-sm">
                <div className="text-zinc-900 dark:text-zinc-100 wrap-anywhere">
                  {it.summary}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5 wrap-anywhere">
                  {it.whyItMatters}
                  {" · "}
                  <button
                    type="button"
                    onClick={() => jumpToSignal(it.signalId)}
                    className="underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    source
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Priorities */}
      {person.priorities && person.priorities.length > 0 && (
        <Section title="What they care about right now">
          <ul className="space-y-1.5 text-sm text-zinc-800 dark:text-zinc-200">
            {person.priorities.map((p, i) => (
              <li key={i} className="flex gap-2 min-w-0">
                <span className="shrink-0 text-zinc-400">•</span>
                <span
                  className="min-w-0 wrap-anywhere"
                  style={{ textWrap: "pretty" }}
                >
                  {p}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Skills (LinkedIn) */}
      {li?.skills && li.skills.length > 0 && (
        <Section
          title="Skills"
          aside={
            li.skillsTotalCount && li.skillsTotalCount > li.skills.length
              ? `showing ${li.skills.length} of ${li.skillsTotalCount}`
              : undefined
          }
        >
          <ul className="flex flex-wrap gap-1.5 min-w-0">
            {[...li.skills]
              .sort(
                (a, b) =>
                  (b.endorsementCount ?? 0) - (a.endorsementCount ?? 0),
              )
              .slice(0, 40)
              .map((s, i) => (
                <li key={i} className="min-w-0 max-w-full">
                  <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-700 dark:text-zinc-300">
                    <span className="truncate">{s.name}</span>
                    {typeof s.endorsementCount === "number" &&
                      s.endorsementCount > 0 && (
                        <span className="shrink-0 font-mono tabular-nums text-zinc-400">
                          {s.endorsementCount}
                        </span>
                      )}
                  </span>
                </li>
              ))}
          </ul>
        </Section>
      )}

      {/* Languages (LinkedIn) */}
      {li?.languages && li.languages.length > 0 && (
        <Section title="Languages">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm min-w-0">
            {li.languages.map((l, i) => (
              <li
                key={i}
                className="min-w-0 max-w-full wrap-anywhere text-zinc-700 dark:text-zinc-300"
              >
                {l.name}
                {l.proficiency && (
                  <span className="text-zinc-400"> · {l.proficiency}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Certifications (LinkedIn) */}
      {li?.certifications && li.certifications.length > 0 && (
        <Section title="Certifications">
          <ul className="space-y-1.5 text-sm">
            {li.certifications.map((c, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline gap-x-2 min-w-0"
              >
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 max-w-full wrap-anywhere font-medium text-zinc-900 dark:text-zinc-100 underline decoration-dotted underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded"
                  >
                    {c.name}
                  </a>
                ) : (
                  <span className="min-w-0 max-w-full wrap-anywhere font-medium text-zinc-900 dark:text-zinc-100">
                    {c.name}
                  </span>
                )}
                {c.organization && (
                  <span className="min-w-0 max-w-full wrap-anywhere text-xs text-zinc-500">
                    {c.organization}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Recommendations received + given (LinkedIn) */}
      {((li?.recommendationsReceived &&
        li.recommendationsReceived.length > 0) ||
        (li?.recommendationsGiven && li.recommendationsGiven.length > 0)) && (
        <RecommendationsSection
          received={li?.recommendationsReceived}
          given={li?.recommendationsGiven}
        />
      )}

      {/* More angles (talking_points, demoted) */}
      {person.talkingPoints && person.talkingPoints.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded">
            More angles to try ({person.talkingPoints.length})
          </summary>
          <ul className="mt-3 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
            {person.talkingPoints.map((tp, i) => (
              <li key={i} className="flex gap-2 min-w-0">
                <span className="shrink-0 text-zinc-400">•</span>
                <span className="min-w-0 flex-1 wrap-anywhere">
                  {tp.point}
                  {" · "}
                  <button
                    type="button"
                    onClick={() => jumpToSignal(tp.signalId)}
                    className="text-xs underline decoration-dotted underline-offset-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    source
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Coverage map — per-section confidence + source breakdown */}
      <CoverageSection person={person} signals={signals} li={li} />

      {/* Raw signals (collapsed) */}
      {signals.length > 0 && (
        <details>
          <summary className="cursor-pointer list-none text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded">
            Raw signals ({signals.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {signals.map((s) => (
              <li
                key={s._id}
                id={`signal-${s._id}`}
                className={[
                  "min-w-0 overflow-hidden rounded border p-3 text-sm transition-colors",
                  highlightedSignalId === s._id
                    ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30"
                    : "border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950",
                ].join(" ")}
              >
                <div className="flex items-baseline justify-between gap-2 text-xs text-zinc-500 min-w-0">
                  <span className="font-mono truncate min-w-0">{s.source}</span>
                  {s.publishedAt && (
                    <span className="tabular-nums shrink-0">
                      {new Date(s.publishedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {s.title && (
                  <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100 wrap-anywhere">
                    {s.title}
                  </div>
                )}
                <p className="mt-1 text-zinc-600 dark:text-zinc-400 line-clamp-3 wrap-anywhere">
                  {s.snippet}
                </p>
                {s.sourceUrl && (
                  <a
                    href={s.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block max-w-full text-xs underline decoration-dotted underline-offset-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 break-all"
                  >
                    {s.sourceUrl}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3 min-w-0">
        <h3 className="shrink-0 text-xs uppercase tracking-wider text-zinc-500">
          {title}
        </h3>
        {aside && (
          <span className="min-w-0 truncate font-mono text-[10px] text-zinc-400 tabular-nums">
            {aside}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

// ─── LinkedIn helpers ──────────────────────────────────────────────────────

const ARC_LABELS: Record<
  NonNullable<NonNullable<LinkedIn["derived"]>["careerArc"]>,
  { label: string; hint: string; tone: "emerald" | "violet" | "blue" | "amber" | "zinc" }
> = {
  founder: {
    label: "Founder",
    hint: "Has founded at least one company",
    tone: "violet",
  },
  serial_founder: {
    label: "Serial founder",
    hint: "Multiple founder roles in the trajectory",
    tone: "violet",
  },
  operator: {
    label: "Operator",
    hint: "Predominantly leadership / management roles",
    tone: "blue",
  },
  long_tenure_operator: {
    label: "Long-tenure operator",
    hint: "Stayed in leadership at one place for years",
    tone: "blue",
  },
  ic_specialist: {
    label: "IC specialist",
    hint: "Predominantly individual-contributor expert",
    tone: "emerald",
  },
  oscillator: {
    label: "Oscillator",
    hint: "Many short tenures, frequent moves",
    tone: "amber",
  },
  early_career: {
    label: "Early career",
    hint: "Less than ~3 years total experience",
    tone: "zinc",
  },
  unknown: { label: "Unclassified", hint: "Couldn't infer arc", tone: "zinc" },
};

const MAKER_MANAGER_LABELS = {
  maker: "Maker",
  manager: "Manager",
  mixed: "Mixed",
} as const;

/**
 * Trajectory card — the derived-intel layer over `experience[]`.
 *
 * Renders as a tight 2x2 grid of intel chips:
 *   [Career arc badge]   [Maker / Manager mix bar]
 *   [Tenure stats grid]  [Location history pills]
 *
 * Intentionally information-dense and mono-typed — this is the part of the
 * dossier that should feel like an OSINT card, not a bio page.
 */
function TrajectorySection({
  derived,
}: {
  derived: NonNullable<LinkedIn["derived"]>;
}) {
  const arc = derived.careerArc ? ARC_LABELS[derived.careerArc] : null;
  const tenure = derived.tenure;
  const mix = derived.makerManagerMix;
  const locations = derived.locationHistory ?? [];

  const hasAnything =
    !!arc || (tenure && tenure.rolesCount > 0) || !!mix || locations.length > 0;
  if (!hasAnything) return null;

  return (
    <Section title="Trajectory">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Career arc */}
        {arc && (
          <IntelCell label="Arc">
            <div className="flex items-baseline gap-2">
              <ArcBadge label={arc.label} tone={arc.tone} />
              <span
                className="text-[11px] text-zinc-500"
                title={arc.hint}
                style={{ textWrap: "balance" }}
              >
                {arc.hint}
              </span>
            </div>
          </IntelCell>
        )}

        {/* Maker vs manager mix bar */}
        {mix && (mix.makerPct > 0 || mix.managerPct > 0) && (
          <IntelCell
            label={`Maker / Manager · ${MAKER_MANAGER_LABELS[mix.classification]}`}
          >
            <MixBar makerPct={mix.makerPct} managerPct={mix.managerPct} />
          </IntelCell>
        )}

        {/* Tenure stats */}
        {tenure && tenure.rolesCount > 0 && (
          <IntelCell label="Tenure" wide={!mix && !arc}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
              <div className="flex items-baseline justify-between">
                <dt className="text-zinc-400">total</dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {formatYears(tenure.totalYears)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-zinc-400">avg</dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {formatYears(tenure.avgYears)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-zinc-400">longest</dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {formatYears(tenure.longestYears)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-zinc-400">roles</dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {tenure.rolesCount}
                </dd>
              </div>
              {typeof tenure.currentTenureYears === "number" && (
                <div className="flex items-baseline justify-between">
                  <dt className="text-zinc-400">current</dt>
                  <dd className="text-zinc-900 dark:text-zinc-100">
                    {formatYears(tenure.currentTenureYears)}
                  </dd>
                </div>
              )}
              {typeof tenure.gapCount === "number" && tenure.gapCount > 0 && (
                <div className="flex items-baseline justify-between">
                  <dt className="text-zinc-400">{tenure.gapCount === 1 ? "gap" : "gaps"}</dt>
                  <dd className="text-zinc-900 dark:text-zinc-100">
                    {tenure.gapCount}
                  </dd>
                </div>
              )}
            </dl>
          </IntelCell>
        )}

        {/* Location history */}
        {locations.length > 0 && (
          <IntelCell
            label="Location history"
            wide={
              !arc &&
              !mix &&
              !(tenure && tenure.rolesCount > 0)
            }
          >
            <ol className="flex flex-wrap items-center gap-1.5 text-[11px] min-w-0">
              {locations.slice(0, 6).map((l, i) => (
                <li
                  key={`${l.location}-${i}`}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-1.5 py-0.5 font-mono text-zinc-600 dark:text-zinc-400"
                  title={
                    l.start
                      ? `${l.start}${l.end ? ` – ${l.end}` : " – present"}${l.company ? ` · ${l.company}` : ""}`
                      : undefined
                  }
                >
                  <span className="truncate max-w-[24ch] text-zinc-700 dark:text-zinc-300">
                    {l.location}
                  </span>
                </li>
              ))}
              {locations.length > 6 && (
                <li className="font-mono text-[10px] text-zinc-400">
                  +{locations.length - 6}
                </li>
              )}
            </ol>
          </IntelCell>
        )}
      </div>
    </Section>
  );
}

function IntelCell({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        "min-w-0 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-3",
        wide ? "sm:col-span-2" : "",
      ].join(" ")}
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function ArcBadge({
  label,
  tone,
}: {
  label: string;
  tone: "emerald" | "violet" | "blue" | "amber" | "zinc";
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50"
      : tone === "violet"
        ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900/50"
        : tone === "blue"
          ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50"
          : tone === "amber"
            ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50"
            : "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800";
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function MixBar({
  makerPct,
  managerPct,
}: {
  makerPct: number;
  managerPct: number;
}) {
  const total = makerPct + managerPct;
  const left = total > 0 ? (makerPct / total) * 100 : 50;
  const right = 100 - left;
  return (
    <div className="space-y-1">
      <div
        className="h-2 w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900 flex"
        role="img"
        aria-label={`${Math.round(left)}% maker, ${Math.round(right)}% manager`}
      >
        <span
          className="h-full bg-emerald-500/70 dark:bg-emerald-400/60"
          style={{ width: `${left}%` }}
        />
        <span
          className="h-full bg-blue-500/70 dark:bg-blue-400/60"
          style={{ width: `${right}%` }}
        />
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500 tabular-nums">
        <span>maker {Math.round(left)}%</span>
        <span>manager {Math.round(right)}%</span>
      </div>
    </div>
  );
}

function formatYears(y: number): string {
  if (y < 0.1) return "<0.1y";
  if (y < 1) return `${(Math.round(y * 12 * 10) / 10).toFixed(0)}mo`;
  return `${y.toFixed(1)}y`;
}

type RecommendationRow = NonNullable<LinkedIn["recommendationsReceived"]>[number];

/**
 * Coverage / source map. The "data quality" footer of the dossier — tells
 * the operator which sections have real data, which are inferred, and where
 * everything came from.
 *
 * Per-section confidence is computed from data *presence* (do we have a
 * non-empty value, how many entries, how recent) — not a model output.
 * It's the difference between "we know nothing about education" and "they
 * have one degree from MIT" being legible at a glance.
 */
function CoverageSection({
  person,
  signals,
  li,
}: {
  person: Person;
  signals: Signal[];
  li: LinkedIn | undefined;
}) {
  // Freeze "now" to first-render time so the relative-time strings below
  // are stable across re-renders. The user won't notice the dossier showing
  // "12m ago" instead of "13m ago" while they read it.
  const [now] = useState(() => Date.now());

  const sectionsCoverage = computeSectionCoverage(person, signals, li);
  const sourceBreakdown = computeSourceBreakdown(signals);
  const enrichedAgo =
    li?.enrichedAt && now - li.enrichedAt > 0
      ? formatAgo(li.enrichedAt, now)
      : null;

  return (
    <Section title="Coverage">
      <div className="space-y-4">
        {/* Per-section confidence grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {sectionsCoverage.map((s) => (
            <CoverageChip key={s.label} {...s} />
          ))}
        </div>

        {/* Source map */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              Source map
            </div>
            <div className="font-mono text-[10px] tabular-nums text-zinc-400">
              {signals.length} {signals.length === 1 ? "signal" : "signals"}
              {li?.status === "ok" ? " · linkedin" : ""}
            </div>
          </div>
          {sourceBreakdown.length > 0 ? (
            <ul className="space-y-1">
              {sourceBreakdown.map((s) => (
                <li
                  key={s.source}
                  className="flex items-baseline justify-between gap-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-400"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {s.source}
                    </span>
                    <span className="text-zinc-400 tabular-nums">
                      {s.count}
                    </span>
                  </span>
                  <span className="text-zinc-400 tabular-nums">
                    {s.freshest ? formatAgo(s.freshest, now) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-mono text-[11px] text-zinc-400">
              No web signals attached to this person.
            </p>
          )}
          {enrichedAgo && (
            <div className="mt-2 border-t border-zinc-100 dark:border-zinc-900 pt-2 flex items-baseline justify-between font-mono text-[10px] text-zinc-400">
              <span>linkedin profile · unipile</span>
              <span className="tabular-nums">{enrichedAgo}</span>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function CoverageChip({
  label,
  confidence,
  count,
}: {
  label: string;
  confidence: "none" | "low" | "med" | "high";
  count?: number;
}) {
  const tone =
    confidence === "high"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50"
      : confidence === "med"
        ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900/50"
        : confidence === "low"
          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/50"
          : "bg-zinc-50 text-zinc-400 border-zinc-200 dark:bg-zinc-950 dark:text-zinc-600 dark:border-zinc-900";
  const dot =
    confidence === "high"
      ? "bg-emerald-500"
      : confidence === "med"
        ? "bg-blue-500"
        : confidence === "low"
          ? "bg-amber-500"
          : "bg-zinc-300 dark:bg-zinc-700";
  return (
    <span
      className={`inline-flex items-baseline justify-between gap-2 rounded border px-2 py-1 font-mono text-[10px] ${tone}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
        <span className="uppercase tracking-wider">{label}</span>
      </span>
      <span className="tabular-nums opacity-70">
        {confidence === "none" ? "—" : (count ?? "·")}
      </span>
    </span>
  );
}

/**
 * Reduce each renderable section of the dossier to a coverage tier:
 *
 *   none → no data we could render
 *   low  → 1 entry / shallow signal
 *   med  → ≥2 entries
 *   high → ≥4 entries
 *
 * Plus a row count when applicable. Pure shape — no model in the loop.
 */
function computeSectionCoverage(
  person: Person,
  signals: Signal[],
  li: LinkedIn | undefined,
): { label: string; confidence: "none" | "low" | "med" | "high"; count?: number }[] {
  const tier = (n: number): "none" | "low" | "med" | "high" => {
    if (n <= 0) return "none";
    if (n === 1) return "low";
    if (n < 4) return "med";
    return "high";
  };

  const has = (b: unknown): "none" | "low" | "med" | "high" =>
    b ? "med" : "none";

  const careerSignals =
    (person.career?.currentRole ? 1 : 0) +
    (person.career?.currentCompany ? 1 : 0) +
    (person.career?.trajectory ? 1 : 0) +
    (person.career?.recentChange ? 1 : 0);

  return [
    {
      label: "identity",
      confidence: person.identity.profiles.length > 0 ? "high" : "low",
      count: person.identity.profiles.length,
    },
    {
      label: "career",
      confidence: tier(careerSignals),
      count: careerSignals > 0 ? careerSignals : undefined,
    },
    {
      label: "experience",
      confidence: tier(li?.experience?.length ?? 0),
      count: li?.experience?.length,
    },
    {
      label: "education",
      confidence: tier(li?.education?.length ?? 0),
      count: li?.education?.length,
    },
    {
      label: "skills",
      confidence: tier(li?.skills?.length ?? 0),
      count: li?.skills?.length,
    },
    {
      label: "languages",
      confidence: tier(li?.languages?.length ?? 0),
      count: li?.languages?.length,
    },
    {
      label: "certs",
      confidence: tier(li?.certifications?.length ?? 0),
      count: li?.certifications?.length,
    },
    {
      label: "recs",
      confidence: tier(
        (li?.recommendationsReceived?.length ?? 0) +
          (li?.recommendationsGiven?.length ?? 0),
      ),
      count:
        (li?.recommendationsReceived?.length ?? 0) +
        (li?.recommendationsGiven?.length ?? 0),
    },
    {
      label: "contact",
      confidence: tier(
        (li?.contactInfo?.emails?.length ?? 0) +
          (li?.contactInfo?.phones?.length ?? 0) +
          (li?.contactInfo?.socials?.length ?? 0),
      ),
      count:
        (li?.contactInfo?.emails?.length ?? 0) +
        (li?.contactInfo?.phones?.length ?? 0) +
        (li?.contactInfo?.socials?.length ?? 0),
    },
    {
      label: "moment",
      confidence: has(person.momentScore),
    },
    {
      label: "last 90d",
      confidence: tier(person.last90Days?.length ?? 0),
      count: person.last90Days?.length,
    },
    {
      label: "signals",
      confidence: tier(signals.length),
      count: signals.length,
    },
  ];
}

/**
 * Aggregate the raw signals by their `source` field, plus the freshest
 * fetch timestamp per source.
 */
function computeSourceBreakdown(
  signals: Signal[],
): { source: string; count: number; freshest: number | null }[] {
  const byKey = new Map<string, { count: number; freshest: number | null }>();
  for (const s of signals) {
    const key = (s.source ?? "unknown").toLowerCase();
    const cur = byKey.get(key) ?? { count: 0, freshest: null };
    cur.count += 1;
    if (
      s.publishedAt &&
      (cur.freshest === null || s.publishedAt > cur.freshest)
    ) {
      cur.freshest = s.publishedAt;
    }
    byKey.set(key, cur);
  }
  return Array.from(byKey.entries())
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Pure relative-time formatter — takes "now" as an explicit param so the
 * caller controls the reference frame and the function can be safely
 * called during render.
 */
function formatAgo(ms: number, now: number): string {
  const diff = now - ms;
  if (diff < 0) return "in future";
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}

/**
 * Cross-reference engine for the current lookup. For the selected person,
 * walks every *other* person in the same `cohort` and computes:
 *
 *   - shared companies (from `linkedin.experience[].company`)
 *   - shared schools   (from `linkedin.education[].school`)
 *
 * Then renders the overlapping people as clickable rows that jump to that
 * person via `onSelectRank`. This is the OSINT "they all worked at Stripe
 * together" view that turns a list of 30 people into a graph.
 *
 * Pure client-side. No server round-trips. Uses lowercase token sets for
 * the join key so "Stripe" and "stripe.com" don't collide while "Stripe"
 * and "STRIPE" do.
 */
function CohortOverlapSection({
  person,
  cohort,
  onSelectRank,
}: {
  person: Person;
  cohort: Result[];
  onSelectRank?: (rank: number) => void;
}) {
  const myCompanies = new Set(
    (person.linkedin?.experience ?? [])
      .map((e) => e.company?.toLowerCase().trim())
      .filter((s): s is string => !!s),
  );
  const mySchools = new Set(
    (person.linkedin?.education ?? [])
      .map((e) => e.school?.toLowerCase().trim())
      .filter((s): s is string => !!s),
  );

  type Overlap = {
    rank: number;
    name: string;
    headline?: string;
    avatar?: string;
    sharedCompanies: string[];
    sharedSchools: string[];
  };

  const overlaps: Overlap[] = [];

  for (const r of cohort) {
    if (!r.person) continue;
    if (r.person._id === person._id) continue;

    const otherCompanies = (r.person.linkedin?.experience ?? [])
      .map((e) => ({
        key: e.company?.toLowerCase().trim(),
        display: e.company,
      }))
      .filter((x): x is { key: string; display: string } => !!x.key && !!x.display);

    const sharedCompanies = Array.from(
      new Map(
        otherCompanies
          .filter((c) => myCompanies.has(c.key))
          .map((c) => [c.key, c.display]),
      ).values(),
    );

    const otherSchools = (r.person.linkedin?.education ?? [])
      .map((e) => ({
        key: e.school?.toLowerCase().trim(),
        display: e.school,
      }))
      .filter((x): x is { key: string; display: string } => !!x.key && !!x.display);

    const sharedSchools = Array.from(
      new Map(
        otherSchools
          .filter((s) => mySchools.has(s.key))
          .map((s) => [s.key, s.display]),
      ).values(),
    );

    if (sharedCompanies.length === 0 && sharedSchools.length === 0) continue;

    overlaps.push({
      rank: r.rank,
      name: r.person.identity.name,
      headline: r.person.linkedin?.headline ?? r.person.identity.headline,
      avatar: r.person.linkedin?.profilePictureUrl,
      sharedCompanies,
      sharedSchools,
    });
  }

  if (overlaps.length === 0) return null;

  // Strongest overlap (most shared companies + schools) first.
  overlaps.sort(
    (a, b) =>
      b.sharedCompanies.length +
      b.sharedSchools.length -
      (a.sharedCompanies.length + a.sharedSchools.length),
  );

  return (
    <Section
      title="Cohort overlap"
      aside={`${overlaps.length} of ${cohort.length - 1}`}
    >
      <ul className="space-y-2">
        {overlaps.map((o) => (
          <li key={o.rank}>
            <button
              type="button"
              onClick={() => onSelectRank?.(o.rank)}
              className="group flex w-full items-start gap-3 rounded-lg border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 px-3 py-2 text-left transition-colors hover:border-zinc-400 dark:hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
            >
              <Avatar src={o.avatar} name={o.name} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1 truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
                    {o.name}
                  </div>
                  <div className="shrink-0 font-mono text-[10px] text-zinc-400 tabular-nums">
                    #{o.rank + 1}
                  </div>
                </div>
                {o.headline && (
                  <div className="min-w-0 truncate text-xs text-zinc-500">
                    {o.headline}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {o.sharedCompanies.map((c) => (
                    <span
                      key={`co-${c}`}
                      className="inline-flex items-center gap-1 rounded border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 dark:text-blue-300"
                    >
                      <span className="opacity-60 uppercase tracking-wider">
                        co
                      </span>
                      <span className="truncate max-w-[14ch]">{c}</span>
                    </span>
                  ))}
                  {o.sharedSchools.map((s) => (
                    <span
                      key={`edu-${s}`}
                      className="inline-flex items-center gap-1 rounded border border-violet-200 dark:border-violet-900/50 bg-violet-50 dark:bg-violet-950/40 px-1.5 py-0.5 font-mono text-[10px] text-violet-700 dark:text-violet-300"
                    >
                      <span className="opacity-60 uppercase tracking-wider">
                        edu
                      </span>
                      <span className="truncate max-w-[14ch]">{s}</span>
                    </span>
                  ))}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function RecommendationsSection({
  received,
  given,
}: {
  received: RecommendationRow[] | undefined;
  given: RecommendationRow[] | undefined;
}) {
  const receivedCount = received?.length ?? 0;
  const givenCount = given?.length ?? 0;
  return (
    <Section
      title="Recommendations"
      aside={`${receivedCount} received · ${givenCount} given`}
    >
      <div className="space-y-4">
        {receivedCount > 0 && (
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              Received
            </div>
            <RecommendationList rows={received!.slice(0, 5)} />
          </div>
        )}
        {givenCount > 0 && (
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              Given
            </div>
            <RecommendationList rows={given!.slice(0, 5)} />
          </div>
        )}
      </div>
    </Section>
  );
}

function RecommendationList({ rows }: { rows: RecommendationRow[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li
          key={i}
          className="rounded-lg border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-3"
        >
          <p
            className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 line-clamp-6 wrap-anywhere"
            style={{ textWrap: "pretty" }}
          >
            {r.text}
          </p>
          {r.actor && (
            <div className="mt-2 flex items-center gap-2">
              <Avatar
                src={r.actor.profilePictureUrl}
                name={
                  `${r.actor.firstName ?? ""} ${r.actor.lastName ?? ""}`.trim() ||
                  "?"
                }
                size={24}
              />
              <div className="min-w-0 text-xs">
                <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {[r.actor.firstName, r.actor.lastName]
                    .filter(Boolean)
                    .join(" ")}
                </div>
                {r.actor.headline && (
                  <div className="text-zinc-500 truncate">
                    {r.actor.headline}
                  </div>
                )}
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Contact card. Pulls in:
 *   - LinkedIn `contact_info` (emails, phones, addresses, socials) — gated
 *     behind LinkedIn's "View contact info", typically only populated for
 *     first-degree connections of the connected Unipile account.
 *   - Synthesized `person.contact.email` as a fallback when LinkedIn has no
 *     emails. Suppressed if LinkedIn provided one (LinkedIn is authoritative).
 *   - LinkedIn `websites` and `birthdate`.
 *
 * Renders nothing at all if every field is empty so we don't show a stub
 * "Contact" card on people whose contact info we don't have.
 */
function ContactSection({
  person,
  li,
}: {
  person: Person;
  li: LinkedIn | undefined;
}) {
  const ci = li?.contactInfo;

  // LinkedIn emails win — they're verified by LinkedIn. Only fall back to
  // the synth-derived email when LinkedIn has none, and only when the
  // synth's confidence is at least 0.5 (otherwise it's a guess).
  const linkedinEmails = ci?.emails ?? [];
  const synthEmail =
    person.contact?.email &&
    (person.contact.emailConfidence ?? 0) >= 0.5 &&
    !linkedinEmails.includes(person.contact.email)
      ? person.contact.email
      : null;
  const emails = linkedinEmails.length > 0 ? linkedinEmails : synthEmail ? [synthEmail] : [];

  const hasAnything =
    emails.length > 0 ||
    (ci?.phones && ci.phones.length > 0) ||
    (ci?.addresses && ci.addresses.length > 0) ||
    (ci?.socials && ci.socials.length > 0) ||
    (li?.websites && li.websites.length > 0) ||
    !!li?.birthdate;

  if (!hasAnything) return null;

  return (
    <Section title="Contact">
      <dl className="space-y-2 text-sm">
        {emails.length > 0 && (
          <ContactRow label="Email">
            {emails.map((e) => (
              <a
                key={e}
                href={`mailto:${e}`}
                className="text-zinc-900 dark:text-zinc-100 underline decoration-dotted underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded break-all"
              >
                {e}
              </a>
            ))}
            {linkedinEmails.length === 0 && synthEmail && (
              <span className="font-mono text-[10px] text-zinc-400">
                inferred from web signals
              </span>
            )}
          </ContactRow>
        )}

        {ci?.phones && ci.phones.length > 0 && (
          <ContactRow label="Phone">
            {ci.phones.map((p) => (
              <a
                key={p}
                href={`tel:${p.replace(/\s+/g, "")}`}
                className="text-zinc-900 dark:text-zinc-100 underline decoration-dotted underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded tabular-nums"
              >
                {p}
              </a>
            ))}
          </ContactRow>
        )}

        {ci?.addresses && ci.addresses.length > 0 && (
          <ContactRow label="Address">
            {ci.addresses.map((a, i) => (
              <span
                key={i}
                className="text-zinc-700 dark:text-zinc-300 wrap-anywhere"
              >
                {a}
              </span>
            ))}
          </ContactRow>
        )}

        {ci?.socials && ci.socials.length > 0 && (
          <ContactRow label="Social">
            {ci.socials.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-baseline gap-1.5 text-zinc-700 dark:text-zinc-300"
              >
                <span className="font-mono text-[10px] uppercase text-zinc-400">
                  {s.type}
                </span>
                <span>{s.name}</span>
              </span>
            ))}
          </ContactRow>
        )}

        {li?.websites && li.websites.length > 0 && (
          <ContactRow label="Website">
            {li.websites.map((w) => (
              <a
                key={w}
                href={w}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-900 dark:text-zinc-100 underline decoration-dotted underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded break-all"
              >
                {w}
              </a>
            ))}
          </ContactRow>
        )}

        {li?.birthdate && (
          <ContactRow label="Birthday">
            <span className="text-zinc-700 dark:text-zinc-300 tabular-nums">
              {formatBirthday(li.birthdate)}
            </span>
          </ContactRow>
        )}
      </dl>
    </Section>
  );
}

function ContactRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[68px_1fr] items-baseline gap-3">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
        {label}
      </dt>
      <dd className="flex flex-col gap-0.5 min-w-0">{children}</dd>
    </div>
  );
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
function formatBirthday(b: { month: number; day: number }): string {
  const m = MONTH_LABELS[b.month - 1];
  return m ? `${m} ${b.day}` : `${b.month}/${b.day}`;
}

/**
 * OSINT-style metadata strip under the headline. Compact tags separated by
 * middle dots — relationship distance, location, reach (followers /
 * connections). Designed to read like a status bar, not a sentence.
 */
function MetaStrip({ li }: { li: LinkedIn }) {
  const items: React.ReactNode[] = [];

  if (li.networkDistance) {
    items.push(
      <RelPill
        key="rel"
        distance={li.networkDistance}
        shared={li.sharedConnectionsCount}
      />,
    );
  }
  if (li.location) {
    items.push(
      <span key="loc" className="inline-flex max-w-full items-center gap-1 min-w-0">
        <span className="shrink-0 text-zinc-300 dark:text-zinc-700" aria-hidden>
          [
        </span>
        <span className="shrink-0 uppercase tracking-wider text-zinc-400">
          loc
        </span>
        <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">
          {li.location}
        </span>
        <span className="shrink-0 text-zinc-300 dark:text-zinc-700" aria-hidden>
          ]
        </span>
      </span>,
    );
  }
  if (
    typeof li.connectionsCount === "number" ||
    typeof li.followerCount === "number"
  ) {
    const parts: string[] = [];
    if (typeof li.connectionsCount === "number")
      parts.push(`${formatCompactCount(li.connectionsCount)} conn`);
    if (typeof li.followerCount === "number")
      parts.push(`${formatCompactCount(li.followerCount)} follow`);
    items.push(
      <span key="reach" className="inline-flex items-center gap-1">
        <span className="text-zinc-300 dark:text-zinc-700" aria-hidden>
          [
        </span>
        <span className="uppercase tracking-wider text-zinc-400">reach</span>
        <span className="text-zinc-700 dark:text-zinc-300 tabular-nums">
          {parts.join(" · ")}
        </span>
        <span className="text-zinc-300 dark:text-zinc-700" aria-hidden>
          ]
        </span>
      </span>,
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 font-mono text-[10px] text-zinc-500">
      {items.map((it, i) => (
        <span key={i} className="inline-flex max-w-full items-center min-w-0">
          {it}
        </span>
      ))}
    </div>
  );
}

/**
 * Network-distance pill, color-coded.
 *   1°  → emerald (warm — DM today)
 *   2°  → amber   (intro-able)
 *   3°  → zinc    (cold)
 *   OON → red     (out of network)
 *
 * Includes the shared connections count when known so the searcher can see
 * how thick the warm-intro path is at a glance.
 */
function RelPill({
  distance,
  shared,
}: {
  distance: NonNullable<LinkedIn["networkDistance"]>;
  shared: number | undefined;
}) {
  const meta = {
    FIRST_DEGREE: {
      label: "1°",
      tone: "emerald",
      hint: "direct connection",
    },
    SECOND_DEGREE: {
      label: "2°",
      tone: "amber",
      hint: "warm intro path",
    },
    THIRD_DEGREE: {
      label: "3°",
      tone: "zinc",
      hint: "cold",
    },
    OUT_OF_NETWORK: {
      label: "OON",
      tone: "red",
      hint: "out of network",
    },
  }[distance];

  const tone =
    meta.tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50"
      : meta.tone === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50"
        : meta.tone === "red"
          ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50"
          : "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800";

  return (
    <span
      title={meta.hint}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${tone}`}
    >
      <span className="uppercase tracking-wider opacity-70">rel</span>
      <span className="font-semibold">{meta.label}</span>
      {typeof shared === "number" && shared > 0 && (
        <>
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <span className="tabular-nums">{formatCompactCount(shared)} mutual</span>
        </>
      )}
    </span>
  );
}

function StatusFlags({ li }: { li: LinkedIn }) {
  const flags: { label: string; tone: "emerald" | "amber" | "violet" | "blue" }[] = [];
  if (li.isOpenToWork) flags.push({ label: "Open to work", tone: "emerald" });
  if (li.isHiring) flags.push({ label: "Hiring", tone: "emerald" });
  if (li.isOpenProfile) flags.push({ label: "Open profile", tone: "blue" });
  if (li.canSendInmail) flags.push({ label: "InMail open", tone: "blue" });
  if (li.isRelationship) flags.push({ label: "Connected", tone: "emerald" });
  if (li.isInfluencer) flags.push({ label: "Influencer", tone: "violet" });
  if (li.isCreator) flags.push({ label: "Creator", tone: "violet" });
  if (li.isPremium) flags.push({ label: "Premium", tone: "amber" });
  if (flags.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <span
          key={f.label}
          className={[
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
            f.tone === "emerald"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : f.tone === "violet"
                ? "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                : f.tone === "blue"
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
          ].join(" ")}
        >
          {f.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Inline strip below the header that surfaces the LinkedIn enrichment state:
 *
 *   - undefined           → "Enriching from LinkedIn…" with a pulse
 *   - status: "ok"        → nothing (data is rendered in the sections below)
 *   - status: "not_found" → muted note
 *   - status: "error"     → muted note with truncated reason
 *   - throttled sections  → small "partial" badge
 *
 * Kept intentionally low-key — these are status hints, not warnings.
 */
function EnrichmentStatus({ li }: { li: LinkedIn | undefined }) {
  if (!li) {
    return (
      <div className="inline-flex items-center gap-2 self-start rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1 text-[11px] font-mono text-zinc-500">
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
        </span>
        Enriching from LinkedIn…
      </div>
    );
  }
  if (li.status === "ok") {
    if (li.throttledSections && li.throttledSections.length > 0) {
      return (
        <div className="inline-flex items-center gap-1.5 self-start rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1 text-[11px] font-mono text-zinc-500">
          <span
            className="h-1.5 w-1.5 rounded-full bg-amber-500"
            aria-hidden
          />
          partial: LinkedIn throttled {li.throttledSections.join(", ")}
        </div>
      );
    }
    return null;
  }
  const label =
    li.status === "no_linkedin_url"
      ? "No LinkedIn profile on this person."
      : li.status === "not_found"
        ? "LinkedIn profile not found."
        : `LinkedIn enrichment failed${li.errorMessage ? ` (${li.errorMessage.slice(0, 80)})` : ""}.`;
  return (
    <div className="inline-flex items-center gap-1.5 self-start rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1 text-[11px] font-mono text-zinc-500">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" aria-hidden />
      {label}
    </div>
  );
}

/**
 * Format an experience-row date range. The Unipile payload returns these as
 * ISO-ish strings (`"2021-03-01"`) or partial dates (`"2021"`). We display
 * "MMM YYYY" when we can parse it, otherwise the raw string. "Present" is
 * substituted for the end when `current === true` or `end` is missing.
 */
function formatRange(
  start: string | undefined,
  end: string | undefined,
  current: boolean | undefined,
): string {
  const left = formatYearMonth(start);
  const right = current ? "Present" : (formatYearMonth(end) ?? "Present");
  if (!left && right === "Present") return "Present";
  if (!left) return right;
  return `${left} – ${right}`;
}

function formatYearMonth(raw: string | undefined): string | null {
  if (!raw) return null;
  // Try ISO-ish date first.
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime()) && /\d{4}/.test(raw)) {
    // If the original string has a month-level component, render Mon YYYY.
    if (/^\d{4}-\d{2}/.test(raw)) {
      return d.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      });
    }
    // Year-only string — render as the year.
    if (/^\d{4}$/.test(raw)) return raw;
  }
  return raw;
}

/**
 * 1.2k / 3.4k / 12k / 1.2M style — keeps the metadata strip readable for
 * profiles with massive follower counts.
 */
function formatCompactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Result } from "./types";
import { momentTint } from "./format";
import { Avatar } from "./Avatar";

/**
 * Left-rail card. Shows just enough to triage:
 *   name → role · company → moment_score
 *
 * Skipped people are dimmed in place (kept in the list, opacity-50) so the
 * user can undo by clicking the thumb again.
 */
export function PersonCard({
  result,
  lookupId,
  isSelected,
  onSelect,
}: {
  result: Result;
  lookupId: Id<"lookups">;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const setReaction = useMutation(api.lookups.setReaction);
  const clearReaction = useMutation(api.lookups.clearReaction);

  const { person, reaction } = result;
  if (!person) return null;

  const isSkipped = reaction === "skip";
  const isAha = reaction === "aha";

  const role = [person.career?.currentRole, person.career?.currentCompany]
    .filter(Boolean)
    .join(" · ");

  function toggle(next: "aha" | "skip") {
    if (!person) return;
    if (reaction === next) {
      void clearReaction({ lookupId, personId: person._id });
    } else {
      void setReaction({ lookupId, personId: person._id, reaction: next });
    }
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "group relative w-full text-left rounded-lg border px-4 py-3 transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
        isSelected
          ? "border-zinc-900 dark:border-zinc-100 bg-white dark:bg-zinc-950 shadow-sm"
          : "border-zinc-200 dark:border-zinc-900 bg-white/60 dark:bg-zinc-950/40 hover:bg-white dark:hover:bg-zinc-950",
        isSkipped ? "opacity-40" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-3 min-w-0">
        <Avatar
          src={person.linkedin?.profilePictureUrl}
          name={person.identity.name}
          size={36}
        />
        <div className="min-w-0 flex-1">
          <div
            className="font-semibold text-sm text-zinc-900 dark:text-zinc-50 truncate"
            style={{ textWrap: "balance" }}
          >
            {person.identity.name}
          </div>
          {role && (
            <div className="text-xs text-zinc-500 truncate mt-0.5">{role}</div>
          )}
          {person.linkedin?.location && (
            <div className="text-[11px] text-zinc-400 truncate mt-0.5">
              {person.linkedin.location}
            </div>
          )}
        </div>

        {/* Triage thumbs — visible on hover or when active */}
        <div
          className={[
            "flex items-center gap-1 shrink-0",
            isSelected || isSkipped || isAha
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 transition-opacity",
          ].join(" ")}
        >
          <ThumbButton
            label="Mark as worth reaching out to"
            onClick={(e) => {
              e.stopPropagation();
              toggle("aha");
            }}
            active={isAha}
            symbol="up"
          />
          <ThumbButton
            label="Skip this person"
            onClick={(e) => {
              e.stopPropagation();
              toggle("skip");
            }}
            active={isSkipped}
            symbol="skip"
          />
        </div>
      </div>

      {person.momentScore && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <DotScale value={person.momentScore.score} />
          <span
            className={[
              "tabular-nums font-medium",
              momentTint(person.momentScore.score),
            ].join(" ")}
          >
            {person.momentScore.score.toFixed(2)}
          </span>
          <span className="text-zinc-400">moment</span>
        </div>
      )}
    </button>
  );
}

function ThumbButton({
  label,
  onClick,
  active,
  symbol,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  active: boolean;
  symbol: "up" | "skip";
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
      className={[
        "inline-flex h-6 w-6 items-center justify-center rounded text-[11px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
        active
          ? symbol === "up"
            ? "bg-emerald-600 text-white"
            : "bg-zinc-700 text-white"
          : "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900",
      ].join(" ")}
    >
      {symbol === "up" ? "↑" : "✕"}
    </span>
  );
}

/**
 * Five-dot moment scale, low-fi. Each dot is filled if the score crosses
 * its threshold. Reads at a glance without the user having to parse a number.
 */
function DotScale({ value }: { value: number }) {
  const filled = Math.round(value * 5);
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={[
            "h-1.5 w-1.5 rounded-full",
            i < filled
              ? "bg-zinc-900 dark:bg-zinc-100"
              : "bg-zinc-200 dark:bg-zinc-800",
          ].join(" ")}
        />
      ))}
    </span>
  );
}

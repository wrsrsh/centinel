/**
 * Shared client types derived from the Convex `getLookup` query shape.
 *
 * Kept in one place so the component files don't each re-spell the
 * `data.results[i]` shape — and so renames in the schema only touch one file.
 */
import type { Doc } from "@/convex/_generated/dataModel";

export type Person = Doc<"people">;
export type Signal = Doc<"signals">;
export type LookupDoc = Doc<"lookups">;

export type Result = {
  rank: number;
  matchReason?: string;
  person: Person | null;
  reaction: "aha" | "skip" | null;
};

export type LookupData = {
  lookup: LookupDoc;
  signals: Signal[];
  results: Result[];
};

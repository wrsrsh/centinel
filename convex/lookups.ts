import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Public mutation: kick off a person lookup. Returns the lookupId so the
 * client can subscribe to it via `getLookup`.
 */
export const startLookup = mutation({
  args: {
    inputType: v.union(
      v.literal("name"),
      v.literal("linkedin"),
      v.literal("email"),
      v.literal("query"),
    ),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    let userId = undefined;
    if (identity) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", identity.subject))
        .unique();
      userId = existing?._id;
      if (!userId) {
        userId = await ctx.db.insert("users", {
          clerkUserId: identity.subject,
          email: identity.email,
          name: identity.name,
        });
      }
    }

    const now = Date.now();
    const lookupId = await ctx.db.insert("lookups", {
      userId,
      inputType: args.inputType,
      input: args.input,
      status: "queued",
      timings: { queuedAt: now },
    });

    // Kick off the async pipeline. Actions can call external APIs; mutations cannot.
    await ctx.scheduler.runAfter(0, internal.parallel.runSearch, {
      lookupId,
    });

    return lookupId;
  },
});

/**
 * Reactive query: the UI subscribes to this and re-renders as the pipeline
 * advances through queued → searching → resolving → synthesizing → complete.
 *
 * Returns the ranked list of (person, matchReason, feedback) joined via
 * the `lookupPeople` table. The UI's master rail iterates this list.
 */
export const getLookup = query({
  args: { lookupId: v.id("lookups") },
  handler: async (ctx, { lookupId }) => {
    const lookup = await ctx.db.get(lookupId);
    if (!lookup) return null;

    const signals = await ctx.db
      .query("signals")
      .withIndex("by_lookup", (q) => q.eq("lookupId", lookupId))
      .collect();

    const joins = await ctx.db
      .query("lookupPeople")
      .withIndex("by_lookup", (q) => q.eq("lookupId", lookupId))
      .collect();
    joins.sort((a, b) => a.rank - b.rank);

    const results = await Promise.all(
      joins.map(async (j) => {
        const person = await ctx.db.get(j.personId);
        const fb = await ctx.db
          .query("feedback")
          .withIndex("by_lookup_person", (q) =>
            q.eq("lookupId", lookupId).eq("personId", j.personId),
          )
          .unique();
        return {
          rank: j.rank,
          matchReason: j.matchReason,
          person,
          reaction: fb?.reaction ?? null,
        };
      }),
    );

    return { lookup, signals, results };
  },
});

/**
 * Hydrate the sidebar history. Takes a list of lookup ids the client has
 * stashed in localStorage and returns just the lightweight metadata the
 * sidebar needs (input, status, creation time). Returned in newest-first
 * order; missing/deleted ids are silently dropped so a stale localStorage
 * doesn't break the rail.
 */
export const listLookupsByIds = query({
  args: { ids: v.array(v.id("lookups")) },
  handler: async (ctx, { ids }) => {
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return rows
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((r) => ({
        _id: r._id,
        input: r.input,
        inputType: r.inputType,
        status: r.status,
        createdAt: r._creationTime,
      }));
  },
});

/**
 * Triage: thumbs-up ("aha") or skip on a person within the context of a lookup.
 * Idempotent — overwrites prior reaction. Used by the list rail's per-card buttons.
 */
export const setReaction = mutation({
  args: {
    lookupId: v.id("lookups"),
    personId: v.id("people"),
    reaction: v.union(v.literal("aha"), v.literal("skip")),
  },
  handler: async (ctx, { lookupId, personId, reaction }) => {
    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_lookup_person", (q) =>
        q.eq("lookupId", lookupId).eq("personId", personId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { reaction });
    } else {
      await ctx.db.insert("feedback", {
        lookupId,
        personId,
        reaction,
        createdAt: Date.now(),
      });
    }
  },
});

export const clearReaction = mutation({
  args: {
    lookupId: v.id("lookups"),
    personId: v.id("people"),
  },
  handler: async (ctx, { lookupId, personId }) => {
    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_lookup_person", (q) =>
        q.eq("lookupId", lookupId).eq("personId", personId),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

// ─── Internal helpers used by the action pipeline ──────────────────────────

export const setStatus = internalMutation({
  args: {
    lookupId: v.id("lookups"),
    status: v.union(
      v.literal("queued"),
      v.literal("searching"),
      v.literal("resolving"),
      v.literal("synthesizing"),
      v.literal("complete"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { lookupId, status, error }) => {
    const lookup = await ctx.db.get(lookupId);
    if (!lookup) return;
    const timings = { ...(lookup.timings ?? { queuedAt: Date.now() }) };
    const now = Date.now();
    if (status === "searching") timings.searchStartedAt = now;
    if (status === "resolving") timings.searchEndedAt = now;
    if (status === "synthesizing") timings.resolveEndedAt = now;
    if (status === "complete") timings.synthesisEndedAt = now;
    await ctx.db.patch(lookupId, { status, error, timings });
  },
});

export const insertSignal = internalMutation({
  args: {
    lookupId: v.id("lookups"),
    source: v.string(),
    sourceUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    snippet: v.string(),
    publishedAt: v.optional(v.number()),
    raw: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("signals", args);
  },
});

// Replaced by `attachResult` (writes to the `lookupPeople` join table) — see synthHelpers.ts.

// Used by the Node-runtime action in `parallel.ts` — internalQueries can't
// live in "use node" files, so they're hosted here.
export const _getLookup = internalQuery({
  args: { lookupId: v.id("lookups") },
  handler: async (ctx, { lookupId }) => {
    return await ctx.db.get(lookupId);
  },
});

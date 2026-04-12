import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { linkedinEnrichmentValidator } from "./schema";

/**
 * Non-Node companion to `synth.ts`. Convex's `"use node"` files can only
 * contain actions, so the query/mutation pieces of the synthesis flow live here.
 */

export const _loadForSynthesis = internalQuery({
  args: { lookupId: v.id("lookups") },
  handler: async (ctx, { lookupId }) => {
    const lookup = await ctx.db.get(lookupId);
    if (!lookup) return null;
    const signals = await ctx.db
      .query("signals")
      .withIndex("by_lookup", (q) => q.eq("lookupId", lookupId))
      .collect();
    return { lookup, signals };
  },
});

export const _upsertPerson = internalMutation({
  args: {
    identityKey: v.string(),
    identity: v.object({
      name: v.string(),
      headline: v.optional(v.string()),
      profiles: v.array(
        v.object({
          source: v.string(),
          url: v.string(),
          confidence: v.number(),
        }),
      ),
    }),
    career: v.optional(
      v.object({
        currentRole: v.optional(v.string()),
        currentCompany: v.optional(v.string()),
        trajectory: v.optional(v.string()),
        recentChange: v.optional(v.string()),
      }),
    ),
    last90Days: v.optional(
      v.array(
        v.object({
          summary: v.string(),
          whyItMatters: v.string(),
          signalId: v.id("signals"),
        }),
      ),
    ),
    priorities: v.optional(v.array(v.string())),
    momentScore: v.optional(
      v.object({
        score: v.number(),
        reason: v.string(),
        signalId: v.optional(v.id("signals")),
      }),
    ),
    talkingPoints: v.array(
      v.object({
        point: v.string(),
        signalId: v.id("signals"),
      }),
    ),
    contact: v.optional(
      v.object({
        email: v.optional(v.string()),
        emailConfidence: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("people")
      .withIndex("by_identity_key", (q) =>
        q.eq("identityKey", args.identityKey),
      )
      .unique();
    const now = Date.now();
    const payload = {
      identity: args.identity,
      career: args.career,
      last90Days: args.last90Days,
      priorities: args.priorities,
      talkingPoints: args.talkingPoints,
      momentScore: args.momentScore,
      contact: args.contact,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("people", {
      identityKey: args.identityKey,
      confidence: 0.5,
      ...payload,
    });
  },
});

/**
 * Read a person row by id, scoped to what the Unipile enrichment action needs:
 * the LinkedIn URL on `identity.profiles` and the prior `linkedin` field (so
 * we can skip if it was enriched recently).
 *
 * Lives here because actions can't query the db directly — they call out to
 * an internal query like this one.
 */
export const _getPersonForEnrichment = internalQuery({
  args: { personId: v.id("people") },
  handler: async (ctx, { personId }) => {
    return await ctx.db.get(personId);
  },
});

/**
 * Patch the LinkedIn enrichment payload onto a person row. Idempotent —
 * just overwrites whatever was there. Convex `patch` is a shallow merge,
 * so unrelated fields (career, talkingPoints, etc.) stay intact.
 */
export const _attachLinkedInEnrichment = internalMutation({
  args: {
    personId: v.id("people"),
    linkedin: linkedinEnrichmentValidator,
  },
  handler: async (ctx, { personId, linkedin }) => {
    const existing = await ctx.db.get(personId);
    if (!existing) return;
    await ctx.db.patch(personId, { linkedin, updatedAt: Date.now() });
  },
});

/**
 * Writes one row in the `lookupPeople` join table — i.e. "this person was
 * the Nth-ranked result for this lookup, and here's why they match."
 *
 * Idempotent on (lookupId, personId): if the same person was already attached
 * (e.g. retry after partial failure) we update the existing row instead.
 */
export const _attachResult = internalMutation({
  args: {
    lookupId: v.id("lookups"),
    personId: v.id("people"),
    rank: v.number(),
    matchReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("lookupPeople")
      .withIndex("by_lookup", (q) => q.eq("lookupId", args.lookupId))
      .filter((q) => q.eq(q.field("personId"), args.personId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        rank: args.rank,
        matchReason: args.matchReason,
      });
      return existing._id;
    }
    return await ctx.db.insert("lookupPeople", args);
  },
});

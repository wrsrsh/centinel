"use node";

import { v } from "convex/values";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Synthesis layer.
 *
 * Takes the raw signals collected by `parallel.runSearch` and asks OpenAI
 * (with structured outputs) to emit an array of Person dossiers.
 *
 * Hard rules enforced via prompt + post-validation:
 *
 *   1. Every cited `signal_id` must exist in the input set. One corrective
 *      retry; offending entries dropped on second failure.
 *
 *   2. Talking points must be specific. Generic copy ("passionate about",
 *      "thought leader") is filtered post-hoc.
 *
 *   3. If evidence for a field is missing, return null or [] — never
 *      fabricate.
 */

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-2024-08-06";

// ─── Schemas ───────────────────────────────────────────────────────────────

const ProfileSchema = z.object({
  source: z.string(),
  url: z.string(),
  confidence: z.number().min(0).max(1),
});

const TalkingPointSchema = z.object({
  point: z.string(),
  signal_id: z.string(),
});

const Last90DaysItemSchema = z.object({
  summary: z.string(),
  why_it_matters: z.string(),
  signal_id: z.string(),
});

const PersonObjectSchema = z.object({
  identity: z.object({
    name: z.string(),
    headline: z.string().nullable(),
    profiles: z.array(ProfileSchema),
  }),
  career: z
    .object({
      current_role: z.string().nullable(),
      current_company: z.string().nullable(),
      trajectory: z.string().nullable(),
      recent_change: z.string().nullable(),
    })
    .nullable(),
  last_90_days: z.array(Last90DaysItemSchema),
  priorities: z.array(z.string()),
  moment_score: z
    .object({
      score: z.number().min(0).max(1),
      reason: z.string(),
      signal_id: z.string().nullable(),
    })
    .nullable(),
  talking_points: z.array(TalkingPointSchema),
  contact: z
    .object({
      email: z.string().nullable(),
      email_confidence: z.number().min(0).max(1).nullable(),
    })
    .nullable(),
  match_reason: z.string().nullable(),
});

const SynthResultSchema = z.object({
  people: z.array(PersonObjectSchema),
});

type SynthPerson = z.infer<typeof PersonObjectSchema>;

// ─── Action ────────────────────────────────────────────────────────────────

export const synthesize = internalAction({
  args: { lookupId: v.id("lookups") },
  handler: async (ctx, { lookupId }) => {
    await ctx.runMutation(internal.lookups.setStatus, {
      lookupId,
      status: "synthesizing",
    });

    const bundle = await ctx.runQuery(
      internal.synthHelpers._loadForSynthesis,
      { lookupId },
    );
    if (!bundle) return;
    const { lookup, signals } = bundle;

    if (signals.length === 0) {
      await ctx.runMutation(internal.lookups.setStatus, {
        lookupId,
        status: "complete",
      });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      await ctx.runMutation(internal.lookups.setStatus, {
        lookupId,
        status: "error",
        error: "OPENAI_API_KEY not set in Convex environment",
      });
      return;
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Build a stable string-id index so the model can cite signals without
    // ever seeing Convex's internal Id type. We map back to real Ids before
    // writing the join row.
    const idMap = new Map<string, Id<"signals">>();
    signals.forEach((s, i) => {
      idMap.set(`sig_${i}`, s._id);
    });

    const signalsBlock = signals
      .map((s, i) => {
        const tag = `sig_${i}`;
        const date = s.publishedAt
          ? new Date(s.publishedAt).toISOString().slice(0, 10)
          : "unknown";
        return [
          `[${tag}] source=${s.source} date=${date}`,
          s.title ? `  title: ${s.title}` : null,
          s.sourceUrl ? `  url: ${s.sourceUrl}` : null,
          `  snippet: ${s.snippet.slice(0, 600)}`,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    const isQuery = lookup.inputType === "query";
    const expectedShape = isQuery
      ? [
          "Return 30 to 40 distinct humans matching the query, ranked by fit (best first). This range is a TARGET FLOOR — aim for 30 at minimum. Only return fewer if the evidence genuinely does not contain that many distinct named individuals that are plausible matches.",
          "",
          "The user wants BREADTH. They'd rather see a thin dossier on a plausible candidate than have you omit that candidate because the evidence was sparse. Err toward inclusion, not exclusion.",
          "",
          "Each entry must be a real, named individual mentioned in the evidence — no fabrication. BUT individual fields on a person (career details, talking_points, last_90_days, contact) can legitimately be sparse or empty for lower-ranked candidates. The HARD RULES below about returning null when evidence is missing apply PER FIELD, not per person. Do not drop an otherwise plausible match just because their talking_points would only have one entry.",
          "",
          "Ranking: top ~10 should be your highest-confidence, evidence-dense matches. Ranks 10-40 can have thinner dossiers. The top of the list is where you're careful; the rest is where you're generous.",
        ].join("\n")
      : "Return exactly one person: the human the input refers to. If the evidence does not clearly identify them, return one person object with low confidence values rather than refusing.";

    const systemPrompt = [
      "You are Centinel's synthesis layer. You turn raw web evidence about a person into a structured dossier and a concrete recommended next action.",
      "",
      expectedShape,
      "",
      "HARD RULES",
      "1. Every entry in `talking_points`, `last_90_days`, and the `cited_signal_id` of `moment_score` MUST cite a `signal_id` that appears in the EVIDENCE block. Never invent ids.",
      "2. Be specific. If a sentence could apply to any person in the same role, rewrite it or omit it.",
      '3. `moment_score` (0..1) answers "why now". A score of 0.8+ requires a time-bounded trigger less than 30 days old (job change, funding, launch, public post about a specific pain). A score of 0.2 means nothing time-sensitive is visible.',
      "4. If you cannot find evidence for a field on a given person, return null or []. Do not fabricate. This applies PER FIELD, not per person — a sparse dossier is better than a dropped person.",
      "",
      "KEEP EACH DOSSIER LEAN",
      "We are returning 30 to 40 people in one response. Token budget is tight. For each person:",
      "   - `talking_points`: max 2 entries per person. Pick the two strongest.",
      "   - `last_90_days`: max 2 entries per person. Only the most recent or most consequential.",
      "   - `priorities`: max 3 short strings.",
      "   - `trajectory` and `recent_change`: one short phrase each, not a paragraph.",
      "   - `match_reason`: one short sentence. No preamble.",
      "Prefer short, punchy strings everywhere. Do not pad.",
    ].join("\n");

    const userPrompt = [
      `INPUT TYPE: ${lookup.inputType}`,
      `INPUT: ${lookup.input}`,
      "",
      "EVIDENCE:",
      signalsBlock,
    ].join("\n");

    let parsed: SynthPerson[] | null = null;
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const completion = await client.chat.completions.parse({
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
            ...(attempt > 0 && lastError
              ? [
                  {
                    role: "user" as const,
                    content: `Your previous response had a problem: ${lastError}\nReturn the dossier again, fixing only that issue.`,
                  },
                ]
              : []),
          ],
          response_format: zodResponseFormat(SynthResultSchema, "people_result"),
          // gpt-4o-2024-08-06 defaults output to 4096 tokens, which silently
          // truncates the people array at ~10-12 full dossiers. Bump to the
          // model ceiling so a 25-30 person list actually fits.
          max_completion_tokens: 16000,
        });

        const candidate = completion.choices[0]?.message.parsed;
        if (!candidate || candidate.people.length === 0) {
          lastError = "no people returned";
          continue;
        }

        // Validate cited signal_ids exist in the input set.
        const unknown: string[] = [];
        for (const p of candidate.people) {
          for (const tp of p.talking_points) {
            if (!idMap.has(tp.signal_id)) unknown.push(tp.signal_id);
          }
          for (const it of p.last_90_days) {
            if (!idMap.has(it.signal_id)) unknown.push(it.signal_id);
          }
          if (
            p.moment_score?.signal_id &&
            !idMap.has(p.moment_score.signal_id)
          ) {
            unknown.push(p.moment_score.signal_id);
          }
        }

        if (unknown.length > 0 && attempt === 0) {
          lastError = `cited signal_id(s) not found in evidence: ${[
            ...new Set(unknown),
          ].join(", ")}. Only use ids that appear in the EVIDENCE block (sig_0, sig_1, ...).`;
          continue;
        }

        parsed = candidate.people;
        break;
      } catch (err) {
        lastError = (err as Error).message;
      }
    }

    if (!parsed) {
      await ctx.runMutation(internal.lookups.setStatus, {
        lookupId,
        status: "error",
        error: `Synthesis failed: ${lastError}`,
      });
      return;
    }

    // Write each person + the per-lookup join row. Collect the resulting
    // person ids so we can fan out LinkedIn enrichment after the loop.
    const enrichedPersonIds: Id<"people">[] = [];

    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];

      const validTalkingPoints = p.talking_points
        .filter((tp) => idMap.has(tp.signal_id))
        .filter((tp) => !looksGeneric(tp.point))
        .map((tp) => ({
          point: stripEmDashes(tp.point),
          signalId: idMap.get(tp.signal_id)!,
        }));

      const validLast90 = p.last_90_days
        .filter((it) => idMap.has(it.signal_id))
        .map((it) => ({
          summary: stripEmDashes(it.summary),
          whyItMatters: stripEmDashes(it.why_it_matters),
          signalId: idMap.get(it.signal_id)!,
        }));

      const momentScore = p.moment_score
        ? {
            score: p.moment_score.score,
            reason: stripEmDashes(p.moment_score.reason),
            signalId:
              p.moment_score.signal_id && idMap.has(p.moment_score.signal_id)
                ? idMap.get(p.moment_score.signal_id)!
                : undefined,
          }
        : undefined;

      const personId = await ctx.runMutation(
        internal.synthHelpers._upsertPerson,
        {
          identityKey: p.identity.name.toLowerCase().trim(),
          identity: {
            name: p.identity.name,
            headline: p.identity.headline ?? undefined,
            profiles: p.identity.profiles,
          },
          career: p.career
            ? {
                currentRole: p.career.current_role ?? undefined,
                currentCompany: p.career.current_company ?? undefined,
                trajectory: p.career.trajectory ?? undefined,
                recentChange: p.career.recent_change ?? undefined,
              }
            : undefined,
          last90Days: validLast90.length ? validLast90 : undefined,
          priorities: p.priorities.length ? p.priorities : undefined,
          momentScore,
          talkingPoints: validTalkingPoints,
          contact: p.contact
            ? {
                email: p.contact.email ?? undefined,
                emailConfidence: p.contact.email_confidence ?? undefined,
              }
            : undefined,
        },
      );

      await ctx.runMutation(internal.synthHelpers._attachResult, {
        lookupId,
        personId,
        rank: i,
        matchReason: p.match_reason ? stripEmDashes(p.match_reason) : undefined,
      });
      enrichedPersonIds.push(personId);
    }

    // Mark the lookup complete now — the dossier is usable from the
    // synth output. LinkedIn enrichment streams in afterwards via Convex
    // reactivity, so the UI gets the rich sections without blocking the
    // "complete" status pill.
    await ctx.runMutation(internal.lookups.setStatus, {
      lookupId,
      status: "complete",
    });

    // ─── LinkedIn enrichment fan-out ─────────────────────────────────────
    //
    // Two things going on here:
    //
    //   1. Account rotation. We list every healthy LinkedIn account on the
    //      Unipile workspace and round-robin them across the people we just
    //      created. Each account has its own LinkedIn rate limit, so spreading
    //      load is the cheapest way to avoid the per-account throttling
    //      Unipile warns about.
    //
    //   2. Adaptive spacing. With one account we keep ~3s spacing (the safe
    //      single-account budget). With more accounts we shrink the spacing
    //      proportionally to sqrt(poolSize) — sqrt rather than linear because
    //      Unipile / IP-level limits are still shared, so we want a smoother
    //      ramp-up than "pool size = N means N× faster".
    //
    // Each scheduled action is independent and best-effort; per-person
    // failures are written as a status on the person row, not surfaced as a
    // lookup error.
    let accountPool: string[] = [];
    try {
      accountPool = await ctx.runAction(
        internal.unipile.listLinkedInAccounts,
        {},
      );
    } catch (err) {
      console.warn(
        "Failed to list LinkedIn accounts, falling back to default account:",
        err,
      );
    }

    const PER_ACCOUNT_BASE_MS = 3000;
    const PER_ACCOUNT_JITTER_MS = 2000;
    const poolSize = Math.max(1, accountPool.length);
    const speedup = Math.sqrt(poolSize);
    const ENRICH_BASE_MS = Math.max(
      500,
      Math.floor(PER_ACCOUNT_BASE_MS / speedup),
    );
    const ENRICH_JITTER_MS = Math.max(
      200,
      Math.floor(PER_ACCOUNT_JITTER_MS / speedup),
    );

    let cursor = 0;
    for (let idx = 0; idx < enrichedPersonIds.length; idx++) {
      const personId = enrichedPersonIds[idx];
      const jitter = Math.floor(Math.random() * ENRICH_JITTER_MS);
      // Round-robin: each consecutive person uses the next account in the
      // pool, wrapping around. When the pool is empty `accountId` is
      // undefined and the action falls back to the env-configured default.
      const accountId =
        accountPool.length > 0
          ? accountPool[idx % accountPool.length]
          : undefined;
      await ctx.scheduler.runAfter(
        cursor + jitter,
        internal.unipile.enrichPersonFromLinkedIn,
        { personId, accountId },
      );
      cursor += ENRICH_BASE_MS + jitter;
    }
  },
});

// ─── Filters ──────────────────────────────────────────────────────────────

const GENERIC_PHRASES = [
  "passionate about",
  "thought leader",
  "results-driven",
  "exciting opportunity",
  "love to connect",
  "leverage synerg",
  "i came across your profile",
  "i hope this finds you well",
  "your impressive work",
];
function looksGeneric(point: string): boolean {
  const lower = point.toLowerCase();
  return GENERIC_PHRASES.some((p) => lower.includes(p));
}

// Belt-and-suspenders against the model sneaking em dashes / en dashes /
// ellipses into the output despite the prompt. Replace with normal punctuation.
function stripEmDashes(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/…/g, "...")
    .replace(/\s+,/g, ",");
}

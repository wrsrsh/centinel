import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * LinkedIn enrichment payload, populated by the Unipile profile fetch.
 *
 * Exported so the `_attachLinkedInEnrichment` mutation in `synthHelpers.ts`
 * can reuse the exact same shape — single source of truth for what a
 * LinkedIn-enriched person looks like.
 *
 * Every section is optional so partial enrichments (LinkedIn throttles
 * heavy section requests, see `throttledSections`) and failure modes
 * (no LinkedIn URL on the person, profile 404, transient API error) all
 * round-trip through the same field.
 */
export const linkedinEnrichmentValidator = v.object({
  enrichedAt: v.number(),
  source: v.literal("unipile"),
  // What happened on the last enrichment attempt. Lets the UI distinguish
  // "didn't have a LinkedIn URL" from "tried but the API errored" from "ok".
  status: v.optional(
    v.union(
      v.literal("ok"),
      v.literal("not_found"),
      v.literal("error"),
      v.literal("no_linkedin_url"),
    ),
  ),
  errorMessage: v.optional(v.string()),

  // Identity
  publicIdentifier: v.optional(v.string()),
  publicProfileUrl: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  pronoun: v.optional(v.string()),
  headline: v.optional(v.string()),
  summary: v.optional(v.string()),
  location: v.optional(v.string()),

  // Media
  profilePictureUrl: v.optional(v.string()),
  backgroundPictureUrl: v.optional(v.string()),

  // Counts & flags
  followerCount: v.optional(v.number()),
  connectionsCount: v.optional(v.number()),
  // Network distance from the connected Unipile account, plus the count of
  // mutuals between you and them. The single highest-leverage piece of
  // metadata in the whole payload — distinguishes "I can DM them today"
  // from "I need a warm intro" from "they don't know I exist."
  sharedConnectionsCount: v.optional(v.number()),
  networkDistance: v.optional(
    v.union(
      v.literal("FIRST_DEGREE"),
      v.literal("SECOND_DEGREE"),
      v.literal("THIRD_DEGREE"),
      v.literal("OUT_OF_NETWORK"),
    ),
  ),
  isInfluencer: v.optional(v.boolean()),
  isCreator: v.optional(v.boolean()),
  isHiring: v.optional(v.boolean()),
  isOpenToWork: v.optional(v.boolean()),
  isPremium: v.optional(v.boolean()),
  // Open Profile = anyone can message them for free without burning an
  // InMail credit. Premium-tier feature, real signal of accessibility.
  isOpenProfile: v.optional(v.boolean()),
  // Whether the connected account can send InMail to them right now.
  canSendInmail: v.optional(v.boolean()),
  // True if the connected account is already connected with them.
  isRelationship: v.optional(v.boolean()),

  websites: v.optional(v.array(v.string())),

  // Contact info — gated behind LinkedIn's "View contact info", which is
  // typically only populated for first-degree connections of the connected
  // Unipile account. Often empty; when present, it's authoritative.
  contactInfo: v.optional(
    v.object({
      emails: v.optional(v.array(v.string())),
      phones: v.optional(v.array(v.string())),
      addresses: v.optional(v.array(v.string())),
      socials: v.optional(
        v.array(
          v.object({
            type: v.string(),
            name: v.string(),
          }),
        ),
      ),
    }),
  ),

  // Month + day only — LinkedIn never exposes year for privacy.
  birthdate: v.optional(
    v.object({
      month: v.number(),
      day: v.number(),
    }),
  ),

  // Sections
  experience: v.optional(
    v.array(
      v.object({
        position: v.optional(v.string()),
        company: v.optional(v.string()),
        companyPictureUrl: v.optional(v.string()),
        location: v.optional(v.string()),
        description: v.optional(v.string()),
        current: v.optional(v.boolean()),
        start: v.optional(v.string()),
        end: v.optional(v.string()),
      }),
    ),
  ),
  experienceTotalCount: v.optional(v.number()),

  education: v.optional(
    v.array(
      v.object({
        school: v.optional(v.string()),
        schoolPictureUrl: v.optional(v.string()),
        degree: v.optional(v.string()),
        fieldOfStudy: v.optional(v.string()),
        start: v.optional(v.string()),
        end: v.optional(v.string()),
      }),
    ),
  ),
  educationTotalCount: v.optional(v.number()),

  skills: v.optional(
    v.array(
      v.object({
        name: v.string(),
        endorsementCount: v.optional(v.number()),
      }),
    ),
  ),
  skillsTotalCount: v.optional(v.number()),

  languages: v.optional(
    v.array(
      v.object({
        name: v.string(),
        proficiency: v.optional(v.string()),
      }),
    ),
  ),

  certifications: v.optional(
    v.array(
      v.object({
        name: v.string(),
        organization: v.optional(v.string()),
        url: v.optional(v.string()),
      }),
    ),
  ),

  volunteering: v.optional(
    v.array(
      v.object({
        organization: v.optional(v.string()),
        role: v.optional(v.string()),
        cause: v.optional(v.string()),
        description: v.optional(v.string()),
        start: v.optional(v.string()),
        end: v.optional(v.string()),
      }),
    ),
  ),

  projects: v.optional(
    v.array(
      v.object({
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        start: v.optional(v.string()),
        end: v.optional(v.string()),
        skills: v.optional(v.array(v.string())),
      }),
    ),
  ),

  recommendationsReceived: v.optional(
    v.array(
      v.object({
        text: v.string(),
        caption: v.optional(v.string()),
        actor: v.optional(
          v.object({
            firstName: v.optional(v.string()),
            lastName: v.optional(v.string()),
            headline: v.optional(v.string()),
            publicProfileUrl: v.optional(v.string()),
            profilePictureUrl: v.optional(v.string()),
          }),
        ),
      }),
    ),
  ),
  recommendationsGiven: v.optional(
    v.array(
      v.object({
        text: v.string(),
        caption: v.optional(v.string()),
        actor: v.optional(
          v.object({
            firstName: v.optional(v.string()),
            lastName: v.optional(v.string()),
            headline: v.optional(v.string()),
            publicProfileUrl: v.optional(v.string()),
            profilePictureUrl: v.optional(v.string()),
          }),
        ),
      }),
    ),
  ),

  // The list of sections LinkedIn throttled on this fetch (see Unipile docs).
  // Useful for the UI to show a "partial enrichment" badge and for us to
  // back off when we see this happening too often.
  throttledSections: v.optional(v.array(v.string())),

  // Computed-once intelligence derived from the raw experience array.
  // Lives on the row so the dossier can render trajectory analysis without
  // re-deriving on every render. Recomputed every enrichment refresh.
  derived: v.optional(
    v.object({
      // Coarse archetype based on titles + tenure + role count.
      careerArc: v.optional(
        v.union(
          v.literal("founder"),
          v.literal("serial_founder"),
          v.literal("operator"),
          v.literal("long_tenure_operator"),
          v.literal("ic_specialist"),
          v.literal("oscillator"),
          v.literal("early_career"),
          v.literal("unknown"),
        ),
      ),
      // Tenure stats over the full experience array, in fractional years.
      // Ongoing roles use today as the end date.
      tenure: v.optional(
        v.object({
          totalYears: v.number(),
          avgYears: v.number(),
          medianYears: v.number(),
          longestYears: v.number(),
          rolesCount: v.number(),
          currentTenureYears: v.optional(v.number()),
          // Number of >1y gaps between consecutive roles. Big number = lots
          // of breaks; sometimes a sabbatical, sometimes parsing weirdness.
          gapCount: v.optional(v.number()),
        }),
      ),
      // Maker (engineer/designer/founder/researcher) vs manager
      // (head/director/VP/chief) classification, expressed as a 0..1 mix.
      makerManagerMix: v.optional(
        v.object({
          makerPct: v.number(),
          managerPct: v.number(),
          classification: v.union(
            v.literal("maker"),
            v.literal("manager"),
            v.literal("mixed"),
          ),
        }),
      ),
      // Coalesced location history pulled from experience entries.
      // Consecutive entries in the same place collapse into one segment.
      locationHistory: v.optional(
        v.array(
          v.object({
            location: v.string(),
            start: v.optional(v.string()),
            end: v.optional(v.string()),
            company: v.optional(v.string()),
          }),
        ),
      ),
    }),
  ),
});

/**
 * Centinel — core data model
 *
 * Three layers:
 *  - `lookups`  → user-facing requests (input + status). One row per "find this person" request.
 *  - `signals`  → raw, source-attributed evidence pulled from the web (Parallel.ai, etc.).
 *  - `people`   → resolved entities + the synthesized Person object surfaced to clients.
 *
 * `people.identityKey` is the canonical dedupe key (lowercased linkedin URL → email hash → name+company hash).
 * Identity resolution writes to this column; collisions mean "same human, merge".
 */
export default defineSchema({
  // ─── Auth-adjacent ────────────────────────────────────────────────────────
  users: defineTable({
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  }).index("by_clerk_id", ["clerkUserId"]),

  apiKeys: defineTable({
    userId: v.id("users"),
    // Stored as a hash; the plaintext is shown to the user once at creation.
    keyHash: v.string(),
    label: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_hash", ["keyHash"]),

  // ─── Request lifecycle ────────────────────────────────────────────────────
  lookups: defineTable({
    userId: v.optional(v.id("users")), // optional so anonymous demo lookups still work
    inputType: v.union(
      v.literal("name"),
      v.literal("linkedin"),
      v.literal("email"),
      v.literal("query"), // for "find people building X" style searches
    ),
    input: v.string(),
    // Lifecycle stages — useful both for the UI progress bar and for latency telemetry.
    status: v.union(
      v.literal("queued"),
      v.literal("searching"),
      v.literal("resolving"),
      v.literal("synthesizing"),
      v.literal("complete"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
    // Stage timings (ms since unix epoch). The <60s target only matters if we can see where it's spent.
    timings: v.optional(
      v.object({
        queuedAt: v.number(),
        searchStartedAt: v.optional(v.number()),
        searchEndedAt: v.optional(v.number()),
        resolveEndedAt: v.optional(v.number()),
        synthesisEndedAt: v.optional(v.number()),
      }),
    ),
  }).index("by_user", ["userId"]),

  // ─── Knowledge graph (lite) ───────────────────────────────────────────────
  // Raw, source-attributed evidence. Synthesis must cite these by id.
  signals: defineTable({
    lookupId: v.id("lookups"),
    personId: v.optional(v.id("people")),
    source: v.string(), // "linkedin" | "x" | "github" | "news" | "podcast" | "youtube" | ...
    sourceUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    snippet: v.string(),
    publishedAt: v.optional(v.number()),
    // Free-form metadata from the upstream provider (Parallel result excerpt, embeddings, etc.)
    raw: v.optional(v.any()),
  })
    .index("by_lookup", ["lookupId"])
    .index("by_person", ["personId"]),

  // The Person object — synthesized output, not raw data.
  people: defineTable({
    identityKey: v.string(), // dedupe anchor
    confidence: v.number(), // 0..1
    // Person object fields, mirroring the PRD shape.
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
        score: v.number(), // 0..1
        reason: v.string(),
        signalId: v.optional(v.id("signals")),
      }),
    ),
    talkingPoints: v.optional(
      v.array(
        v.object({
          point: v.string(),
          signalId: v.id("signals"), // every TP must cite a signal — generic ones get rejected upstream
        }),
      ),
    ),
    contact: v.optional(
      v.object({
        email: v.optional(v.string()),
        emailConfidence: v.optional(v.number()),
      }),
    ),
    // Rich LinkedIn profile data, fetched async via Unipile after synthesis
    // and patched in. Absent until enrichment runs; the UI handles all the
    // intermediate states (loading, no_linkedin_url, not_found, error).
    linkedin: v.optional(linkedinEnrichmentValidator),
    updatedAt: v.number(),
  }).index("by_identity_key", ["identityKey"]),

  // ─── Per-lookup ranked results ────────────────────────────────────────────
  // The same person could be found via different lookups, so the ranked
  // result lives on the join, not on `people`. `matchReason` depends on
  // WHY the user is looking, which is lookup-specific.
  //
  // Note: `recommendedAction` is kept on the validator as optional for
  // backwards compatibility with any existing dev data — the UI no longer
  // surfaces it and the synth layer no longer writes it.
  lookupPeople: defineTable({
    lookupId: v.id("lookups"),
    personId: v.id("people"),
    rank: v.number(), // 0 = top result
    matchReason: v.optional(v.string()), // for query-type lookups: "founded clean-label skincare brand in 2024"
    recommendedAction: v.optional(
      v.object({
        channel: v.union(
          v.literal("email"),
          v.literal("linkedin"),
          v.literal("twitter"),
          v.literal("warm_intro"),
          v.literal("in_person"),
          v.literal("skip"),
        ),
        timing: v.union(
          v.literal("today"),
          v.literal("this_week"),
          v.literal("this_month"),
          v.literal("wait_for_signal"),
          v.literal("skip"),
        ),
        timingReason: v.string(),
        opener: v.string(),
        angle: v.string(),
        risks: v.optional(v.string()),
        citedSignalId: v.optional(v.id("signals")),
      }),
    ),
  })
    .index("by_lookup", ["lookupId", "rank"])
    .index("by_person", ["personId"]),

  // ─── Triage feedback ──────────────────────────────────────────────────────
  // Per-(lookup, person) reaction so we can measure "aha rate" per signal type.
  // The reaction lives on the join because the same person could be a strong
  // candidate in one outreach context and a skip in another.
  feedback: defineTable({
    lookupId: v.id("lookups"),
    personId: v.id("people"),
    reaction: v.union(
      v.literal("aha"),
      v.literal("skip"),
    ),
    createdAt: v.number(),
  })
    .index("by_lookup_person", ["lookupId", "personId"])
    .index("by_person", ["personId"]),
});

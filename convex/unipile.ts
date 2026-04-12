import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Infer } from "convex/values";
import { linkedinEnrichmentValidator } from "./schema";

const UNIPILE_ACCOUNTS_PATH = "/api/v1/accounts";

/**
 * LinkedIn profile enrichment via Unipile.
 *
 * After the synthesis layer creates a `people` row, we fan out one
 * `enrichPersonFromLinkedIn` call per person to fetch the structured
 * LinkedIn profile (work history, education, skills, recommendations…)
 * and patch it onto the row. The UI subscribes to the row reactively, so
 * sections appear as enrichment completes.
 *
 * **Throttling.** LinkedIn aggressively rate-limits profile fetches. We
 * mitigate three ways:
 *
 *   1. The synth scheduler staggers calls 2.5–4.5s apart per person, so
 *      30 people take ~90s instead of hammering Unipile in parallel.
 *   2. We request `*_preview` for everything (light), plus full data only
 *      for the four sections we actually render in the dossier
 *      (experience, education, skills). Unipile docs explicitly call this
 *      out as the safe pattern when chaining many profile calls.
 *   3. Failures are isolated per-person — a 404 / 429 / network error
 *      writes a `linkedin.status` of `not_found` / `error` so the UI shows
 *      "couldn't enrich" instead of leaving the person in limbo. We never
 *      throw out of the action.
 *
 * Endpoint: `GET https://{dsn}/api/v1/users/{identifier}`
 *           Headers: `X-API-KEY`
 *           Query:   `account_id`, `notify=false` (don't ping the viewee),
 *                    repeated `linkedin_sections` for each section we want.
 *
 * Docs: https://developer.unipile.com/reference/usercontroller_getprofilebyidentifier
 *       https://developer.unipile.com/docs/provider-limits-and-restrictions
 */

const UNIPILE_USER_PATH = "/api/v1/users/";

// Mix of preview + full sections. `*_preview` keeps the response light for
// sections we just glance at; full data on experience/education/skills is
// what powers the rich timeline UI in the dossier.
const ENRICH_SECTIONS: ReadonlyArray<string> = [
  "*_preview",
  "experience",
  "education",
  "skills",
];

// Skip re-enriching a person whose LinkedIn data is fresher than this.
// LinkedIn profiles change slowly; a week is a reasonable cache window
// and saves us from re-fetching the same person across multiple lookups.
const ENRICHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_UNIPILE_ACCOUNT_ID = "8KMvZvHSQa6owclhc24iSA";

type LinkedInPayload = Infer<typeof linkedinEnrichmentValidator>;

/**
 * List the healthy LinkedIn accounts on the connected Unipile workspace,
 * returning just the ids in a flat array.
 *
 * "Healthy" = the account exists, the type is LINKEDIN, and at least one
 * of its sub-`sources` reports `OK` (or it has no sources at all, which
 * happens for some older account shapes). Accounts whose sources are all
 * `ERROR` / `CREDENTIALS` / `STOPPED` are excluded so we don't waste profile
 * fetches on a disconnected account that'll just 401.
 *
 * Used by the synth pipeline to round-robin LinkedIn enrichment across
 * every connected LinkedIn account, dramatically reducing the per-account
 * throttle pressure on a 30-person lookup.
 *
 * The accounts list is cheap (one or two pages of 250 items each) and
 * changes rarely, so we just refetch it once per lookup rather than caching.
 *
 * Endpoint: `GET https://{dsn}/api/v1/accounts?limit=250&cursor=…`
 *           Headers: `X-API-KEY`
 */
export const listLinkedInAccounts = internalAction({
  args: {},
  handler: async (): Promise<string[]> => {
    const dsn = process.env.UNIPILE_DSN;
    const apiKey = process.env.UNIPILE_API_KEY;
    if (!dsn || !apiKey) {
      console.warn(
        "Unipile listAccounts: UNIPILE_DSN or UNIPILE_API_KEY not set",
      );
      return [];
    }

    const accountIds: string[] = [];
    let cursor: string | null = null;
    // Defensive cap. With limit=250 this lets us walk up to 2500 accounts,
    // which is far more than any sane Unipile workspace will ever have.
    const MAX_PAGES = 10;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams();
      params.set("limit", "250");
      if (cursor) params.set("cursor", cursor);
      const url = `https://${dsn}${UNIPILE_ACCOUNTS_PATH}?${params.toString()}`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          headers: {
            "X-API-KEY": apiKey,
            Accept: "application/json",
          },
        });
      } catch (err) {
        console.error(
          "Unipile listAccounts fetch failed:",
          (err as Error).message,
        );
        break;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error(
          `Unipile listAccounts ${response.status}: ${text.slice(0, 300)}`,
        );
        break;
      }

      let data: {
        items?: Array<Record<string, unknown>>;
        cursor?: string | null;
      };
      try {
        data = await response.json();
      } catch (err) {
        console.error(
          "Unipile listAccounts json parse failed:",
          (err as Error).message,
        );
        break;
      }

      for (const item of data.items ?? []) {
        if (item.type !== "LINKEDIN") continue;
        if (typeof item.id !== "string" || item.id.length === 0) continue;
        const sources = Array.isArray(item.sources) ? item.sources : [];
        // Some legacy account shapes have no `sources` array at all — treat
        // them as healthy. Otherwise we require at least one OK source.
        const hasOkSource =
          sources.length === 0 ||
          sources.some(
            (s) =>
              typeof s === "object" &&
              s !== null &&
              (s as { status?: unknown }).status === "OK",
          );
        if (!hasOkSource) continue;
        accountIds.push(item.id);
      }

      cursor = typeof data.cursor === "string" ? data.cursor : null;
      if (!cursor) break;
    }

    return accountIds;
  },
});

export const enrichPersonFromLinkedIn = internalAction({
  args: {
    personId: v.id("people"),
    // Optional caller-supplied account id. The synth pipeline rotates
    // through every healthy LinkedIn account on the workspace via
    // `listLinkedInAccounts` and passes one in per scheduled call so the
    // load is spread across the pool. When omitted (e.g. ad-hoc reruns)
    // we fall back to the env-configured default account.
    accountId: v.optional(v.string()),
  },
  handler: async (ctx, { personId, accountId: providedAccountId }) => {
    const dsn = process.env.UNIPILE_DSN;
    const apiKey = process.env.UNIPILE_API_KEY;
    const accountId =
      providedAccountId ??
      process.env.UNIPILE_ACCOUNT_ID ??
      DEFAULT_UNIPILE_ACCOUNT_ID;

    if (!dsn || !apiKey) {
      console.warn(
        "Unipile enrich: UNIPILE_DSN or UNIPILE_API_KEY not set, skipping",
      );
      return;
    }

    const person = await ctx.runQuery(
      internal.synthHelpers._getPersonForEnrichment,
      { personId },
    );
    if (!person) return;

    // Skip if recently enriched and the previous fetch was successful — no
    // point burning a Unipile call to re-fetch the same data.
    if (
      person.linkedin?.status === "ok" &&
      Date.now() - person.linkedin.enrichedAt < ENRICHMENT_TTL_MS
    ) {
      return;
    }

    // Closure-bound writer for terminal status. Stamps `enrichedAt` and
    // `source` so each failure branch below stays one line.
    const writeStatus = (partial: {
      status: NonNullable<LinkedInPayload["status"]>;
      errorMessage?: string;
    }) =>
      ctx.runMutation(internal.synthHelpers._attachLinkedInEnrichment, {
        personId,
        linkedin: {
          enrichedAt: Date.now(),
          source: "unipile" as const,
          status: partial.status,
          errorMessage: partial.errorMessage,
        },
      });

    const linkedinProfile = person.identity.profiles.find(
      (p) => p.source.toLowerCase() === "linkedin",
    );
    if (!linkedinProfile) {
      await writeStatus({ status: "no_linkedin_url" });
      return;
    }

    const slug = extractLinkedinSlug(linkedinProfile.url);
    if (!slug) {
      await writeStatus({
        status: "no_linkedin_url",
        errorMessage: `Could not parse a public id from ${linkedinProfile.url}`,
      });
      return;
    }

    // Build the URL. URLSearchParams handles encoding and repeated keys for
    // `linkedin_sections` correctly (one `?linkedin_sections=foo&linkedin_sections=bar`).
    const params = new URLSearchParams();
    params.set("account_id", accountId);
    params.set("notify", "false");
    for (const section of ENRICH_SECTIONS) {
      params.append("linkedin_sections", section);
    }
    const url = `https://${dsn}${UNIPILE_USER_PATH}${encodeURIComponent(slug)}?${params.toString()}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "X-API-KEY": apiKey,
          Accept: "application/json",
        },
      });
    } catch (err) {
      await writeStatus({
        status: "error",
        errorMessage: `fetch failed: ${(err as Error).message}`,
      });
      return;
    }

    if (response.status === 404) {
      await writeStatus({ status: "not_found" });
      return;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      await writeStatus({
        status: "error",
        errorMessage: `${response.status}: ${text.slice(0, 300)}`,
      });
      return;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      await writeStatus({
        status: "error",
        errorMessage: `json parse failed: ${(err as Error).message}`,
      });
      return;
    }

    // Defensive check: the endpoint can return WhatsApp/Instagram/Telegram
    // shapes too. Anything that isn't a LinkedIn profile is treated as a
    // hard error rather than silently writing garbage.
    const provider = (data as { provider?: string })?.provider;
    if (provider !== "LINKEDIN") {
      await writeStatus({
        status: "error",
        errorMessage: `unexpected provider: ${provider ?? "unknown"}`,
      });
      return;
    }

    const parsed = parseLinkedInProfile(data as Record<string, unknown>);
    await ctx.runMutation(internal.synthHelpers._attachLinkedInEnrichment, {
      personId,
      linkedin: {
        ...parsed,
        enrichedAt: Date.now(),
        source: "unipile",
        status: "ok",
      },
    });
  },
});

/**
 * Pull the public id slug out of a LinkedIn URL.
 *
 * Handles all the variants we see in the wild:
 *   - `https://www.linkedin.com/in/satyanadella`
 *   - `https://linkedin.com/in/satyanadella/`
 *   - `linkedin.com/in/satyanadella?trk=...`
 *   - `https://www.linkedin.com/in/john-doe-1a2b3c/?originalSubdomain=uk`
 *
 * URL-encoded slugs (international names) are decoded before being passed
 * back to Unipile so the path-encoded version is correct.
 */
function extractLinkedinSlug(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Convert the Unipile LinkedIn payload (snake_case, lots of optional fields)
 * into our camelCase shape that matches `linkedinEnrichmentValidator`.
 *
 * Defensive throughout — every field is treated as possibly missing or the
 * wrong type. We never throw; the worst case is an empty section.
 */
function parseLinkedInProfile(
  d: Record<string, unknown>,
): Omit<LinkedInPayload, "enrichedAt" | "source" | "status" | "errorMessage"> {
  const optStr = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  const optNum = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const optBool = (v: unknown): boolean | undefined =>
    typeof v === "boolean" ? v : undefined;
  const optArr = <T>(v: unknown, map: (x: Record<string, unknown>) => T): T[] | undefined =>
    Array.isArray(v) && v.length > 0
      ? v
          .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
          .map(map)
      : undefined;

  const recommendations = (d.recommendations ?? null) as
    | Record<string, unknown>
    | null;
  const rawWebsites = d.websites;
  const websites = Array.isArray(rawWebsites)
    ? rawWebsites.filter((s): s is string => typeof s === "string")
    : undefined;
  const rawThrottled = d.throttled_sections;
  const throttledSections = Array.isArray(rawThrottled)
    ? rawThrottled.filter((s): s is string => typeof s === "string")
    : undefined;

  return {
    publicIdentifier: optStr(d.public_identifier),
    publicProfileUrl: optStr(d.public_profile_url),
    firstName: optStr(d.first_name),
    lastName: optStr(d.last_name),
    pronoun: optStr(d.pronoun),
    headline: optStr(d.headline),
    summary: optStr(d.summary),
    location: optStr(d.location),
    profilePictureUrl:
      optStr(d.profile_picture_url_large) ?? optStr(d.profile_picture_url),
    backgroundPictureUrl: optStr(d.background_picture_url),
    followerCount: optNum(d.follower_count),
    connectionsCount: optNum(d.connections_count),
    sharedConnectionsCount: optNum(d.shared_connections_count),
    networkDistance: parseNetworkDistance(d.network_distance),
    isInfluencer: optBool(d.is_influencer),
    isCreator: optBool(d.is_creator),
    isHiring: optBool(d.is_hiring),
    isOpenToWork: optBool(d.is_open_to_work),
    isPremium: optBool(d.is_premium),
    isOpenProfile: optBool(d.is_open_profile),
    canSendInmail: optBool(d.can_send_inmail),
    isRelationship: optBool(d.is_relationship),
    websites: websites && websites.length > 0 ? websites : undefined,

    contactInfo: parseContactInfo(d),
    birthdate: parseBirthdate(d),

    experience: optArr(d.work_experience, (w) => ({
      position: optStr(w.position),
      company: optStr(w.company),
      companyPictureUrl: optStr(w.company_picture_url),
      location: optStr(w.location),
      description: optStr(w.description),
      current: optBool(w.current),
      start: optStr(w.start),
      end: optStr(w.end),
    })),
    experienceTotalCount: optNum(d.work_experience_total_count),

    education: optArr(d.education, (e) => ({
      school: optStr(e.school),
      schoolPictureUrl: optStr(e.school_picture_url),
      degree: optStr(e.degree),
      fieldOfStudy: optStr(e.field_of_study),
      start: optStr(e.start),
      end: optStr(e.end),
    })),
    educationTotalCount: optNum(d.education_total_count),

    skills: optArr(d.skills, (s) => ({
      name: typeof s.name === "string" ? s.name : "",
      endorsementCount: optNum(s.endorsement_count),
    }))?.filter((s) => s.name.length > 0),
    skillsTotalCount: optNum(d.skills_total_count),

    languages: optArr(d.languages, (l) => ({
      name: typeof l.name === "string" ? l.name : "",
      proficiency: optStr(l.proficiency),
    }))?.filter((l) => l.name.length > 0),

    certifications: optArr(d.certifications, (c) => ({
      name: typeof c.name === "string" ? c.name : "",
      organization: optStr(c.organization),
      url: optStr(c.url),
    }))?.filter((c) => c.name.length > 0),

    volunteering: optArr(d.volunteering_experience, (v) => ({
      organization: optStr(v.company),
      role: optStr(v.role),
      cause: optStr(v.cause),
      description: optStr(v.description),
      start: optStr(v.start),
      end: optStr(v.end),
    })),

    projects: optArr(d.projects, (p) => ({
      name: optStr(p.name),
      description: optStr(p.description),
      start: optStr(p.start),
      end: optStr(p.end),
      skills: Array.isArray(p.skills)
        ? p.skills.filter((s): s is string => typeof s === "string")
        : undefined,
    })),

    recommendationsReceived: parseRecommendationList(recommendations?.received),
    recommendationsGiven: parseRecommendationList(recommendations?.given),

    throttledSections:
      throttledSections && throttledSections.length > 0
        ? throttledSections
        : undefined,

    derived: deriveTrajectoryIntel(d),
  };
}

/**
 * Recommendations have the same shape whether received or given, so the
 * row mapper is shared. Returns undefined when the section is empty so we
 * don't litter the people row with empty arrays.
 */
function parseRecommendationList(
  raw: unknown,
):
  | {
      text: string;
      caption?: string;
      actor?: {
        firstName?: string;
        lastName?: string;
        headline?: string;
        publicProfileUrl?: string;
        profilePictureUrl?: string;
      };
    }[]
  | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const optStr = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  const out = raw
    .filter(
      (r): r is Record<string, unknown> => typeof r === "object" && r !== null,
    )
    .map((r) => {
      const actor = (r.actor ?? null) as Record<string, unknown> | null;
      return {
        text: typeof r.text === "string" ? r.text : "",
        caption: optStr(r.caption),
        actor: actor
          ? {
              firstName: optStr(actor.first_name),
              lastName: optStr(actor.last_name),
              headline: optStr(actor.headline),
              publicProfileUrl: optStr(actor.public_profile_url),
              profilePictureUrl: optStr(actor.profile_picture_url),
            }
          : undefined,
      };
    })
    .filter((r) => r.text.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * Network distance comes back as one of four enum strings. Anything else
 * (missing field, weird casing, future enum value) returns undefined so the
 * Convex validator doesn't reject the row.
 */
function parseNetworkDistance(
  raw: unknown,
):
  | "FIRST_DEGREE"
  | "SECOND_DEGREE"
  | "THIRD_DEGREE"
  | "OUT_OF_NETWORK"
  | undefined {
  if (typeof raw !== "string") return undefined;
  if (
    raw === "FIRST_DEGREE" ||
    raw === "SECOND_DEGREE" ||
    raw === "THIRD_DEGREE" ||
    raw === "OUT_OF_NETWORK"
  ) {
    return raw;
  }
  return undefined;
}

/**
 * Pull `contact_info` out of the LinkedIn payload. This block is gated by
 * LinkedIn behind "View contact info" — typically only populated when the
 * Unipile-connected account is a first-degree connection of the viewee.
 * Returns `undefined` if the whole block is empty rather than writing
 * `{}` to the row.
 */
function parseContactInfo(
  d: Record<string, unknown>,
):
  | {
      emails?: string[];
      phones?: string[];
      addresses?: string[];
      socials?: { type: string; name: string }[];
    }
  | undefined {
  const ci = (d.contact_info ?? null) as Record<string, unknown> | null;
  if (!ci) return undefined;

  const filterStrings = (raw: unknown): string[] | undefined => {
    if (!Array.isArray(raw)) return undefined;
    const filtered = raw.filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    return filtered.length > 0 ? filtered : undefined;
  };

  const emails = filterStrings(ci.emails);
  const phones = filterStrings(ci.phones);
  // The Unipile API spec literally has the typo `adresses` (single 'd').
  // Tolerate both spellings in case they fix it server-side later.
  const addresses = filterStrings(ci.adresses) ?? filterStrings(ci.addresses);

  const socialsRaw = Array.isArray(ci.socials) ? ci.socials : [];
  const socials = socialsRaw
    .filter(
      (s): s is Record<string, unknown> =>
        typeof s === "object" && s !== null,
    )
    .map((s) => ({
      type: typeof s.type === "string" ? s.type : "",
      name: typeof s.name === "string" ? s.name : "",
    }))
    .filter((s) => s.type.length > 0 && s.name.length > 0);

  if (!emails && !phones && !addresses && socials.length === 0) {
    return undefined;
  }

  return {
    emails,
    phones,
    addresses,
    socials: socials.length > 0 ? socials : undefined,
  };
}

/**
 * `birthdate` is exposed as month + day only — LinkedIn never returns the
 * year, presumably to keep the field shareable for "happy birthday" outreach
 * without leaking age. Returns `undefined` for the common case where the
 * viewee hasn't filled it in.
 */
function parseBirthdate(
  d: Record<string, unknown>,
): { month: number; day: number } | undefined {
  const b = (d.birthdate ?? null) as Record<string, unknown> | null;
  if (!b) return undefined;
  if (typeof b.month !== "number" || typeof b.day !== "number") return undefined;
  if (b.month < 1 || b.month > 12 || b.day < 1 || b.day > 31) return undefined;
  return { month: b.month, day: b.day };
}

// ─── Trajectory derivation ────────────────────────────────────────────────
//
// Pure-function intelligence layer that runs over the parsed work_experience
// array and emits cohorted facts the dossier UI can render directly:
// career arc, tenure stats, maker-vs-manager mix, and a coalesced location
// history. Defensive throughout — partial dates, single roles, unparseable
// titles all degrade gracefully.

type RawExperience = {
  position?: string;
  company?: string;
  location?: string;
  current?: boolean;
  start?: string;
  end?: string;
};

function deriveTrajectoryIntel(d: Record<string, unknown>): {
  careerArc?:
    | "founder"
    | "serial_founder"
    | "operator"
    | "long_tenure_operator"
    | "ic_specialist"
    | "oscillator"
    | "early_career"
    | "unknown";
  tenure?: {
    totalYears: number;
    avgYears: number;
    medianYears: number;
    longestYears: number;
    rolesCount: number;
    currentTenureYears?: number;
    gapCount?: number;
  };
  makerManagerMix?: {
    makerPct: number;
    managerPct: number;
    classification: "maker" | "manager" | "mixed";
  };
  locationHistory?: {
    location: string;
    start?: string;
    end?: string;
    company?: string;
  }[];
} {
  const rawExp = Array.isArray(d.work_experience) ? d.work_experience : [];
  const experience: RawExperience[] = rawExp
    .filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null,
    )
    .map((x) => ({
      position: typeof x.position === "string" ? x.position : undefined,
      company: typeof x.company === "string" ? x.company : undefined,
      location: typeof x.location === "string" ? x.location : undefined,
      current: typeof x.current === "boolean" ? x.current : undefined,
      start: typeof x.start === "string" ? x.start : undefined,
      end: typeof x.end === "string" ? x.end : undefined,
    }));

  if (experience.length === 0) return {};

  return {
    tenure: computeTenureStats(experience),
    careerArc: classifyCareerArc(experience),
    makerManagerMix: classifyMakerVsManager(experience),
    locationHistory: extractLocationHistory(experience),
  };
}

/**
 * Loose date parser. Unipile date strings come in three flavours:
 *   - "2021-03"   (year + month, common)
 *   - "2021"      (year only, common for older entries)
 *   - "2021-03-15" (full ISO, rare)
 * Anything else returns null and the entry contributes nothing to the stats.
 */
function parseLooseDate(s: string | undefined): Date | null {
  if (!s) return null;
  if (/^\d{4}$/.test(s)) return new Date(`${s}-01-01T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01T00:00:00Z`);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function yearsBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function computeTenureStats(experience: RawExperience[]): {
  totalYears: number;
  avgYears: number;
  medianYears: number;
  longestYears: number;
  rolesCount: number;
  currentTenureYears?: number;
  gapCount?: number;
} {
  const now = new Date();
  // Map every parseable role to {start, end, isCurrent} sorted by start asc.
  const segments = experience
    .map((e) => {
      const start = parseLooseDate(e.start);
      if (!start) return null;
      const isCurrent = e.current === true || !e.end;
      const end = isCurrent ? now : parseLooseDate(e.end);
      if (!end) return null;
      return { start, end, isCurrent };
    })
    .filter((x): x is { start: Date; end: Date; isCurrent: boolean } => x !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const rolesCount = experience.length;
  if (segments.length === 0) {
    return {
      totalYears: 0,
      avgYears: 0,
      medianYears: 0,
      longestYears: 0,
      rolesCount,
    };
  }

  const durations = segments.map((s) =>
    Math.max(0, yearsBetween(s.start, s.end)),
  );
  const totalYears = durations.reduce((a, b) => a + b, 0);
  const avgYears = totalYears / durations.length;
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianYears =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const longestYears = sorted[sorted.length - 1] ?? 0;

  const currentSegment = segments.find((s) => s.isCurrent);
  const currentTenureYears = currentSegment
    ? Math.max(0, yearsBetween(currentSegment.start, now))
    : undefined;

  // Count >1y gaps between consecutive roles. Roles that overlap (e.g. an
  // advisorship started before leaving an operator job) contribute zero.
  let gapCount = 0;
  for (let i = 1; i < segments.length; i++) {
    const prevEnd = segments[i - 1].end;
    const nextStart = segments[i].start;
    if (yearsBetween(prevEnd, nextStart) >= 1) gapCount += 1;
  }

  return {
    totalYears: round1(totalYears),
    avgYears: round1(avgYears),
    medianYears: round1(medianYears),
    longestYears: round1(longestYears),
    rolesCount,
    currentTenureYears: currentTenureYears
      ? round1(currentTenureYears)
      : undefined,
    gapCount,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const FOUNDER_PATTERN = /\b(co[- ]?founder|founder|founding|co[- ]?ceo)\b/i;
const MANAGER_PATTERN =
  /\b(head of|director|vp|vice president|chief|cto|ceo|cfo|coo|cmo|cpo|cro|cso|svp|evp|vp |vp,|president|gm|general manager|manager|principal pm|product lead|engineering lead|tech lead|leader|partner|managing partner)\b/i;
const MAKER_PATTERN =
  /\b(engineer|developer|designer|scientist|researcher|writer|architect|illustrator|builder|founder|creator|artist|analyst|fellow|staff|principal engineer|software|sde|ml|data scientist)\b/i;

function classifyCareerArc(
  experience: RawExperience[],
):
  | "founder"
  | "serial_founder"
  | "operator"
  | "long_tenure_operator"
  | "ic_specialist"
  | "oscillator"
  | "early_career"
  | "unknown" {
  if (experience.length === 0) return "unknown";

  const founderRoles = experience.filter(
    (e) => e.position && FOUNDER_PATTERN.test(e.position),
  ).length;
  const managerRoles = experience.filter(
    (e) => e.position && MANAGER_PATTERN.test(e.position),
  ).length;
  const makerRoles = experience.filter(
    (e) => e.position && MAKER_PATTERN.test(e.position),
  ).length;

  const tenure = computeTenureStats(experience);
  const totalYears = tenure.totalYears;
  const avgYears = tenure.avgYears;

  if (founderRoles >= 2) return "serial_founder";
  if (founderRoles >= 1) return "founder";

  if (totalYears < 3 && experience.length <= 2) return "early_career";

  // Lots of short roles, no founder/manager dominance ⇒ oscillator.
  if (avgYears > 0 && avgYears < 1.7 && experience.length >= 4)
    return "oscillator";

  if (managerRoles >= Math.max(2, Math.ceil(experience.length * 0.4))) {
    // Long tenure operator = same kind of role for years at one or two places.
    if (totalYears >= 10 && experience.length <= 3)
      return "long_tenure_operator";
    return "operator";
  }

  if (makerRoles >= Math.max(2, Math.ceil(experience.length * 0.5))) {
    return "ic_specialist";
  }

  return "unknown";
}

function classifyMakerVsManager(experience: RawExperience[]): {
  makerPct: number;
  managerPct: number;
  classification: "maker" | "manager" | "mixed";
} {
  // Weight by tenure rather than role count — a 6-year IC stretch should
  // dominate a 6-month manager promotion at the end. Falls back to equal
  // weight if no dates parse.
  const weights = experience.map((e) => {
    const start = parseLooseDate(e.start);
    if (!start) return 1;
    const end =
      e.current === true || !e.end ? new Date() : parseLooseDate(e.end);
    if (!end) return 1;
    return Math.max(0.25, yearsBetween(start, end));
  });

  let makerW = 0;
  let managerW = 0;
  for (let i = 0; i < experience.length; i++) {
    const title = experience[i].position ?? "";
    const isManager = MANAGER_PATTERN.test(title);
    const isMaker = MAKER_PATTERN.test(title);
    // If a title matches both ("Founding Engineer", "Engineering Manager"),
    // bias toward manager — leadership context dominates the relationship.
    if (isManager) managerW += weights[i];
    else if (isMaker) makerW += weights[i];
    else {
      // Neither — split half/half so unparseable roles don't skew the bar.
      makerW += weights[i] / 2;
      managerW += weights[i] / 2;
    }
  }

  const total = makerW + managerW;
  if (total === 0) {
    return { makerPct: 0, managerPct: 0, classification: "mixed" };
  }
  const makerPct = makerW / total;
  const managerPct = managerW / total;
  const classification: "maker" | "manager" | "mixed" =
    makerPct >= 0.7 ? "maker" : managerPct >= 0.7 ? "manager" : "mixed";
  return {
    makerPct: round1(makerPct * 100) / 100,
    managerPct: round1(managerPct * 100) / 100,
    classification,
  };
}

function extractLocationHistory(experience: RawExperience[]): {
  location: string;
  start?: string;
  end?: string;
  company?: string;
}[] {
  // Walk experience newest-to-oldest, collapse consecutive entries that share
  // a location into one segment. Drop entries with no location at all.
  const sorted = [...experience]
    .map((e, idx) => ({ e, idx, parsed: parseLooseDate(e.start) }))
    .sort((a, b) => {
      const da = a.parsed?.getTime() ?? 0;
      const db = b.parsed?.getTime() ?? 0;
      return db - da; // newest first
    });

  const out: {
    location: string;
    start?: string;
    end?: string;
    company?: string;
  }[] = [];

  for (const { e } of sorted) {
    if (!e.location) continue;
    const last = out[out.length - 1];
    if (last && last.location === e.location) {
      // Extend the existing segment backwards in time.
      if (e.start && (!last.start || e.start < last.start)) {
        last.start = e.start;
      }
    } else {
      out.push({
        location: e.location,
        start: e.start,
        end: e.end,
        company: e.company,
      });
    }
  }

  return out.length > 0 ? out : [];
}

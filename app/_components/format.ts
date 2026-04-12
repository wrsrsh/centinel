/**
 * Tiny formatting helpers for chips and labels.
 */

/**
 * Tint for moment_score values. ≥0.7 is green, 0.4–0.7 is amber, below is muted.
 */
export function momentTint(score: number): string {
  if (score >= 0.7)
    return "text-emerald-700 dark:text-emerald-400";
  if (score >= 0.4) return "text-amber-700 dark:text-amber-400";
  return "text-zinc-500";
}

export function detectInputType(
  raw: string,
): "name" | "linkedin" | "email" | "query" {
  const v = raw.trim();
  if (v.includes("linkedin.com")) return "linkedin";
  if (v.includes("@") && !v.includes(" ")) return "email";
  if (v.split(/\s+/).length > 5) return "query";
  return "name";
}

"use client";

import { useState } from "react";

/**
 * Profile picture with graceful fallback to initials.
 *
 * LinkedIn CDN URLs occasionally rot (signed URLs expire, hosts move) — when
 * an image fails to load we swap to a flat initials chip so the layout
 * doesn't shift and the row still reads as a person, not a broken icon.
 *
 * Plain `<img>` rather than `next/image` so we don't have to whitelist
 * LinkedIn's CDN domains in `next.config.ts`. Width and height are always
 * set explicitly to prevent layout shift (per the web interface guidelines).
 */
export function Avatar({
  src,
  name,
  size = 40,
  rounded = true,
  className = "",
}: {
  src?: string;
  name: string;
  size?: number;
  rounded?: boolean;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  const radius = rounded ? "rounded-full" : "rounded-md";

  if (!src || errored) {
    return (
      <div
        aria-hidden
        className={[
          "shrink-0 grid place-items-center bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium select-none",
          radius,
          className,
        ].join(" ")}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(10, Math.floor(size * 0.36)),
        }}
      >
        {initials}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- intentional, see file header comment about LinkedIn CDN whitelisting
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setErrored(true)}
      referrerPolicy="no-referrer"
      className={[
        "shrink-0 object-cover bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800",
        radius,
        className,
      ].join(" ")}
      style={{ width: size, height: size }}
    />
  );
}

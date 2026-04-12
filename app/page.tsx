"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { PersonCard } from "./_components/PersonCard";
import { DetailPanel } from "./_components/DetailPanel";
import { detectInputType } from "./_components/format";
import type { LookupData } from "./_components/types";

/**
 * Centinel — single-page lookup app.
 *
 * Layout: ChatGPT-style. Left sidebar holds the persisted history of past
 * lookups (kept in localStorage so refreshes don't lose state). Main column
 * shows either the empty "new lookup" prompt or the master–detail view of
 * the current lookup's results.
 */
const STORAGE_KEY_HISTORY = "centinel:history";
const STORAGE_KEY_CURRENT = "centinel:current";
const HISTORY_LIMIT = 50;

const EXAMPLE_QUERIES: ReadonlyArray<string> = [
  "Sundar Pichai",
  "linkedin.com/in/satyanadella",
  "VPs of Engineering at Series B fintech in NYC",
];

type SidebarRow = {
  _id: Id<"lookups">;
  input: string;
  inputType: "name" | "linkedin" | "email" | "query";
  status:
    | "queued"
    | "searching"
    | "resolving"
    | "synthesizing"
    | "complete"
    | "error";
  createdAt: number;
};

export default function Home() {
  const [input, setInput] = useState("");
  const [lookupId, setLookupId] = useState<Id<"lookups"> | null>(null);
  const [selectedRank, setSelectedRank] = useState<number>(0);
  const [showSkipped, setShowSkipped] = useState(true);
  const [history, setHistory] = useState<Id<"lookups">[]>([]);

  // Hydrate history + current id from localStorage on mount. setState in
  // an effect is the SSR-safe pattern here — server renders with empty
  // values, client effect populates them, no hydration mismatch. Lazy
  // useState init would diverge between server and client.
  /* eslint-disable react-hooks/set-state-in-effect -- canonical SSR-safe localStorage hydration */
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawHist = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (rawHist) {
        const parsed = JSON.parse(rawHist);
        if (Array.isArray(parsed)) setHistory(parsed as Id<"lookups">[]);
      }
      const cur = localStorage.getItem(STORAGE_KEY_CURRENT);
      if (cur) setLookupId(cur as Id<"lookups">);
    } catch {
      // localStorage may be blocked (Safari private, etc.) — sidebar stays empty.
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist current id (or clear it on "new lookup").
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (lookupId) localStorage.setItem(STORAGE_KEY_CURRENT, lookupId);
      else localStorage.removeItem(STORAGE_KEY_CURRENT);
    } catch {}
  }, [lookupId]);

  const startLookup = useMutation(api.lookups.startLookup);

  const data = useQuery(
    api.lookups.getLookup,
    lookupId ? { lookupId } : "skip",
  ) as LookupData | null | undefined;

  // Sidebar history list — server resolves the localStorage ids into rows.
  const historyRows = useQuery(
    api.lookups.listLookupsByIds,
    history.length > 0 ? { ids: history } : "skip",
  ) as SidebarRow[] | undefined;

  function pushHistory(id: Id<"lookups">) {
    setHistory((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(
        0,
        HISTORY_LIMIT,
      );
      try {
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    const id = await startLookup({
      inputType: detectInputType(input),
      input: input.trim(),
    });
    pushHistory(id);
    setLookupId(id);
    setSelectedRank(0);
    setInput("");
  }

  function onSelectLookup(id: Id<"lookups">) {
    setLookupId(id);
    setSelectedRank(0);
    setInput("");
  }

  function onNewLookup() {
    setLookupId(null);
    setInput("");
    setSelectedRank(0);
  }

  // React Compiler memoizes these automatically — manual useMemo would just
  // fight the compiler's dependency inference.
  const visibleResults = data?.results
    ? data.results
        .filter((r) => showSkipped || r.reaction !== "skip")
        .sort((a, b) => a.rank - b.rank)
    : [];

  const skippedCount = data?.results
    ? data.results.filter((r) => r.reaction === "skip").length
    : 0;

  // Derive the effective rank during render: if the user's pick is no
  // longer visible (e.g. they hid skipped) fall back to the first visible.
  // This replaces an effect that called setSelectedRank — derived-state
  // is the recommended pattern.
  const effectiveRank = visibleResults.some((r) => r.rank === selectedRank)
    ? selectedRank
    : (visibleResults[0]?.rank ?? 0);

  const selectedResult =
    data?.results?.find((r) => r.rank === effectiveRank) ?? null;

  return (
    <div className="flex flex-col min-h-[100dvh] md:h-[100dvh] bg-zinc-50 dark:bg-black">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-zinc-900 focus:text-white focus:px-3 focus:py-1.5 focus:rounded"
      >
        Skip to content
      </a>

      <Header />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          rows={historyRows}
          currentId={lookupId}
          onSelect={onSelectLookup}
          onNew={onNewLookup}
        />

        <main id="main" className="flex flex-1 flex-col min-h-0">
          {!lookupId ? (
            <CenteredPrompt>
              <SearchBar
                input={input}
                setInput={setInput}
                onSubmit={onSubmit}
                autoFocus
              />
              <ExampleLinks onPick={setInput} />
            </CenteredPrompt>
          ) : (
            <>
              <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950">
                <div className="px-4 sm:px-6 lg:px-8 py-3 max-w-3xl">
                  <SearchBar
                    input={input}
                    setInput={setInput}
                    onSubmit={onSubmit}
                  />
                </div>
              </div>
              <ResultsView
                data={data}
                lookupId={lookupId}
                selectedRank={effectiveRank}
                setSelectedRank={setSelectedRank}
                visibleResults={visibleResults}
                selectedResult={selectedResult}
                showSkipped={showSkipped}
                setShowSkipped={setShowSkipped}
                skippedCount={skippedCount}
                onExportCsv={() =>
                  data &&
                  exportResultsToCsv(visibleResults, data.lookup.input)
                }
              />
            </>
          )}
        </main>
      </div>

      <StatusBar />
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="shrink-0 flex h-12 items-center justify-between gap-4 px-4 sm:px-6 border-b border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-2.5 min-w-0">
        <Logo />
        <h1
          className="font-mono text-[13px] tracking-tight text-zinc-900 dark:text-zinc-50"
          translate="no"
        >
          centinel
        </h1>
      </div>
      <AuthHeader />
    </header>
  );
}

function Logo() {
  return (
    <div
      aria-hidden
      className="grid place-items-center h-6 w-6 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="h-3.5 w-3.5"
      >
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4" />
        <circle
          cx="12"
          cy="12"
          r="1.2"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    </div>
  );
}

function AuthHeader() {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return <div className="h-7 w-7" />;
  if (isSignedIn) return <UserButton />;
  return (
    <SignInButton mode="modal">
      <button
        type="button"
        className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded"
      >
        Sign in
      </button>
    </SignInButton>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────

function Sidebar({
  rows,
  currentId,
  onSelect,
  onNew,
}: {
  rows: SidebarRow[] | undefined;
  currentId: Id<"lookups"> | null;
  onSelect: (id: Id<"lookups">) => void;
  onNew: () => void;
}) {
  return (
    <aside
      className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 lg:border-r lg:border-zinc-200 dark:lg:border-zinc-900 bg-zinc-100/50 dark:bg-zinc-950/50 min-h-0"
      aria-label="Lookup history"
    >
      <div className="p-2 border-b border-zinc-200 dark:border-zinc-900">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden
              className="h-3.5 w-3.5"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            New lookup
          </span>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-2">
        <div className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
          Recent
        </div>
        {rows === undefined ? (
          <div className="px-2 py-1.5 space-y-2" aria-hidden>
            <div className="h-2.5 w-4/5 rounded bg-zinc-200/70 dark:bg-zinc-800/70 animate-pulse" />
            <div className="h-2.5 w-3/5 rounded bg-zinc-200/70 dark:bg-zinc-800/70 animate-pulse" />
            <div className="h-2.5 w-2/3 rounded bg-zinc-200/70 dark:bg-zinc-800/70 animate-pulse" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-zinc-400">
            No lookups yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li key={r._id}>
                <SidebarHistoryItem
                  row={r}
                  isSelected={r._id === currentId}
                  onSelect={() => onSelect(r._id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function SidebarHistoryItem({
  row,
  isSelected,
  onSelect,
}: {
  row: SidebarRow;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? "page" : undefined}
      className={[
        "block w-full text-left rounded px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
        isSelected
          ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/40 dark:hover:bg-zinc-900/60 hover:text-zinc-900 dark:hover:text-zinc-100",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot status={row.status} />
        <div className="flex-1 min-w-0 truncate text-xs">{row.input}</div>
      </div>
      <div className="ml-3.5 mt-0.5 font-mono text-[10px] text-zinc-400 tabular-nums">
        {formatRelativeTime(row.createdAt)}
      </div>
    </button>
  );
}

function StatusDot({ status }: { status: SidebarRow["status"] }) {
  const cls =
    status === "complete"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-red-500"
        : "bg-amber-500 motion-safe:animate-pulse";
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`}
      aria-hidden
    />
  );
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
}

// ─── Search bar ────────────────────────────────────────────────────────────

function SearchBar({
  input,
  setInput,
  onSubmit,
  autoFocus = false,
}: {
  input: string;
  setInput: (s: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = input.trim();
  const detected = trimmed ? detectInputType(trimmed) : null;

  // Auto-grow the textarea — single row at rest, capped at ~6 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Global ⌘K / Ctrl-K to focus the prompt — small detail that earns the
  // "feels like real software" reaction.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits, Shift+Enter inserts a newline. Skip while IME composing.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      onSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm focus-within:border-zinc-400 dark:focus-within:border-zinc-700 transition-colors">
        <label htmlFor="lookup-input" className="sr-only">
          Person to look up
        </label>
        <div className="flex items-end gap-1.5 px-2 py-1.5">
          <textarea
            id="lookup-input"
            ref={ref}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="search"
            autoFocus={autoFocus}
            placeholder="Name, LinkedIn URL, email, or a description…"
            className="flex-1 min-w-0 resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 outline-none"
          />
          <button
            type="submit"
            disabled={!trimmed}
            aria-label="Look up"
            className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 disabled:opacity-25 disabled:cursor-not-allowed hover:bg-zinc-700 dark:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-950 transition-colors"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-3.5 w-3.5"
            >
              <path d="M8 13V3" />
              <path d="m4 7 4-4 4 4" />
            </svg>
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 px-1 font-mono text-[10px] text-zinc-400">
        <div className="min-w-0 truncate" aria-live="polite">
          {detected ? (
            <span>
              detected:{" "}
              <span className="text-zinc-600 dark:text-zinc-300">
                {detected === "query" ? "natural query" : detected}
              </span>
            </span>
          ) : (
            <span>
              <Kbd>↵</Kbd> search&nbsp; · &nbsp;<Kbd>⇧↵</Kbd> newline
            </span>
          )}
        </div>
        <div className="hidden sm:inline-flex items-center gap-1">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </div>
      </div>
    </form>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-1 font-mono text-[10px] text-zinc-500 dark:text-zinc-400 align-middle">
      {children}
    </kbd>
  );
}

// ─── Centered hero (no-lookup state) ───────────────────────────────────────

function CenteredPrompt({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-4 text-center">
          <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
            New lookup
          </div>
          <h2
            className="mt-2 text-base font-medium text-zinc-900 dark:text-zinc-50"
            style={{ textWrap: "balance" }}
          >
            Who are you trying to find?
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function ExampleLinks({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px]">
      {EXAMPLE_QUERIES.map((q, i) => (
        <span key={q} className="inline-flex items-center gap-2">
          {i > 0 && (
            <span aria-hidden className="text-zinc-300 dark:text-zinc-700">
              ·
            </span>
          )}
          <button
            type="button"
            onClick={() => onPick(q)}
            className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded"
          >
            {q}
          </button>
        </span>
      ))}
    </div>
  );
}

// ─── Status bar ────────────────────────────────────────────────────────────

function StatusBar() {
  return (
    <footer
      className="shrink-0 border-t border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 px-4 sm:px-6 py-1.5 flex items-center justify-between font-mono text-[10px] text-zinc-400"
      aria-label="Application status"
    >
      <span className="tabular-nums">centinel · v0.1.0</span>
      <span className="hidden sm:inline-flex items-center gap-1">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </span>
    </footer>
  );
}

// ─── Results layout ────────────────────────────────────────────────────────

function ResultsView({
  data,
  lookupId,
  selectedRank,
  setSelectedRank,
  visibleResults,
  selectedResult,
  showSkipped,
  setShowSkipped,
  skippedCount,
  onExportCsv,
}: {
  data: LookupData | null | undefined;
  lookupId: Id<"lookups">;
  selectedRank: number;
  setSelectedRank: (n: number) => void;
  visibleResults: LookupData["results"];
  selectedResult: LookupData["results"][number] | null;
  showSkipped: boolean;
  setShowSkipped: (b: boolean) => void;
  skippedCount: number;
  onExportCsv: () => void;
}) {
  if (data === undefined) {
    return <SkeletonView />;
  }
  if (data === null) {
    return (
      <EmptyState
        title="Not found."
        body="We couldn’t load this lookup. Try again."
      />
    );
  }

  const { lookup, signals, results } = data;
  const isWorking =
    lookup.status === "queued" ||
    lookup.status === "searching" ||
    lookup.status === "resolving" ||
    lookup.status === "synthesizing";

  // No results yet — show progress + skeleton cards
  if (results.length === 0 && isWorking) {
    return <SkeletonView status={lookup.status} />;
  }
  if (results.length === 0 && lookup.status === "complete") {
    return (
      <EmptyState
        title="No people found."
        body="The signals were too sparse to identify anyone. Try a broader query, or paste a LinkedIn URL directly."
      />
    );
  }
  if (lookup.status === "error") {
    return (
      <EmptyState
        title="Something went wrong."
        body={lookup.error ?? "Unknown error."}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row w-full min-h-0">
      {/* Left rail */}
      <aside className="md:w-72 md:shrink-0 md:border-r md:border-zinc-200 md:dark:border-zinc-900 px-6 sm:px-10 md:px-4 py-4 md:min-h-0 md:min-w-0 md:overflow-y-auto">
        <RailHeader
          status={lookup.status}
          totalCount={results.length}
          visibleCount={visibleResults.length}
          skippedCount={skippedCount}
          showSkipped={showSkipped}
          setShowSkipped={setShowSkipped}
          onExportCsv={onExportCsv}
          canExport={visibleResults.length > 0}
        />
        <ul className="mt-3 space-y-2">
          {visibleResults.map((r) => (
            <li key={r.rank}>
              <PersonCard
                result={r}
                lookupId={lookupId}
                isSelected={r.rank === selectedRank}
                onSelect={() => setSelectedRank(r.rank)}
              />
            </li>
          ))}
          {isWorking && <SkeletonCard />}
        </ul>
      </aside>

      {/* Detail panel */}
      <section className="flex-1 px-6 sm:px-10 md:px-8 py-6 md:min-h-0 md:min-w-0 md:overflow-y-auto">
        {selectedResult ? (
          <DetailPanel
            result={selectedResult}
            signals={signals}
            cohort={visibleResults}
            onSelectRank={setSelectedRank}
          />
        ) : (
          <EmptyState
            title="Pick a person on the left."
            body="Their dossier will appear here."
          />
        )}
      </section>
    </div>
  );
}

function RailHeader({
  status,
  totalCount,
  visibleCount,
  skippedCount,
  showSkipped,
  setShowSkipped,
  onExportCsv,
  canExport,
}: {
  status: string;
  totalCount: number;
  visibleCount: number;
  skippedCount: number;
  showSkipped: boolean;
  setShowSkipped: (b: boolean) => void;
  onExportCsv: () => void;
  canExport: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <div className="text-zinc-500 tabular-nums">
          {visibleCount} of {totalCount}{" "}
          {totalCount === 1 ? "person" : "people"}
        </div>
        <StatusPill status={status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {skippedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowSkipped(!showSkipped)}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
          >
            <span>{showSkipped ? "Hide" : "Show"} skipped</span>
            <span className="tabular-nums text-zinc-400">{skippedCount}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onExportCsv}
          disabled={!canExport}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            canExport
              ? "Export the visible list as CSV"
              : "Nothing to export yet"
          }
        >
          <span aria-hidden>↓</span>
          <span>Export CSV</span>
        </button>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isWorking =
    status === "queued" ||
    status === "searching" ||
    status === "resolving" ||
    status === "synthesizing";

  const label =
    status === "queued"
      ? "Queued"
      : status === "searching"
        ? "Searching the web"
        : status === "resolving"
          ? "Resolving identities"
          : status === "synthesizing"
            ? "Writing dossiers"
            : status === "complete"
              ? "Done"
              : status === "error"
                ? "Error"
                : status;

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-mono",
        status === "complete"
          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          : status === "error"
            ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
      ].join(" ")}
    >
      {isWorking && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      )}
      <span>{label}</span>
    </div>
  );
}

// ─── Skeletons & empty ─────────────────────────────────────────────────────

function SkeletonView({ status }: { status?: string } = {}) {
  return (
    <div className="flex-1 flex flex-col md:flex-row w-full min-h-0">
      <aside className="md:w-72 md:shrink-0 md:border-r md:border-zinc-200 md:dark:border-zinc-900 px-6 sm:px-10 md:px-4 py-4 md:min-h-0 md:min-w-0 md:overflow-y-auto">
        {status && (
          <div className="mb-3">
            <StatusPill status={status} />
          </div>
        )}
        <ul className="space-y-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </ul>
      </aside>
      <section className="flex-1 px-6 sm:px-10 md:px-8 py-6 md:min-h-0 md:min-w-0 md:overflow-y-auto">
        <SkeletonDetail />
      </section>
    </div>
  );
}

function SkeletonCard() {
  return (
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-900 px-4 py-3 animate-pulse">
      <div className="h-3 w-3/4 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-2.5 w-1/2 rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="mt-3 h-4 w-24 rounded-full bg-zinc-100 dark:bg-zinc-900" />
    </li>
  );
}

function SkeletonDetail() {
  return (
    <div className="animate-pulse space-y-6">
      <div>
        <div className="h-6 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-3 w-3/4 rounded bg-zinc-100 dark:bg-zinc-900" />
      </div>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-900 p-5 space-y-3">
        <div className="h-4 w-32 rounded-full bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-4 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-4 w-5/6 rounded bg-zinc-100 dark:bg-zinc-900" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-3 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-3 w-4/5 rounded bg-zinc-100 dark:bg-zinc-900" />
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="max-w-sm text-center">
        <h2
          className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
          style={{ textWrap: "balance" }}
        >
          {title}
        </h2>
        <p
          className="mt-2 text-sm text-zinc-500"
          style={{ textWrap: "pretty" }}
        >
          {body}
        </p>
      </div>
    </div>
  );
}

// ─── CSV export ────────────────────────────────────────────────────────────

/**
 * Turns the visible result list into a CSV file and triggers a browser
 * download. Filename is `centinel-<slugified-query>-<yyyy-mm-dd>.csv`.
 *
 * Scope intentionally matches what the rail shows: if the user has the
 * "Hide skipped" toggle on, skipped people are excluded from the export.
 * Flip the toggle before exporting to include them.
 */
function exportResultsToCsv(
  results: LookupData["results"],
  query: string,
): void {
  const headers = [
    "Rank",
    "Name",
    "Headline",
    "Role",
    "Company",
    "Trajectory",
    "Recent change",
    "LinkedIn",
    "Twitter / X",
    "GitHub",
    "Other profiles",
    "Moment score",
    "Moment reason",
    "Priorities",
    "Match reason",
    "Reaction",
  ];

  const rows: string[][] = [];
  for (const r of results) {
    const p = r.person;
    if (!p) continue;

    const profileByHost = (hosts: string[]): string => {
      const match = p.identity.profiles.find((pr) =>
        hosts.includes(pr.source.toLowerCase()),
      );
      return match?.url ?? "";
    };

    const knownHosts = new Set([
      "linkedin",
      "twitter",
      "x",
      "github",
    ]);
    const otherProfiles = p.identity.profiles
      .filter((pr) => !knownHosts.has(pr.source.toLowerCase()))
      .map((pr) => pr.url)
      .join(" | ");

    rows.push([
      String(r.rank + 1),
      p.identity.name,
      p.identity.headline ?? "",
      p.career?.currentRole ?? "",
      p.career?.currentCompany ?? "",
      p.career?.trajectory ?? "",
      p.career?.recentChange ?? "",
      profileByHost(["linkedin"]),
      profileByHost(["twitter", "x"]),
      profileByHost(["github"]),
      otherProfiles,
      p.momentScore ? p.momentScore.score.toFixed(2) : "",
      p.momentScore?.reason ?? "",
      (p.priorities ?? []).join(" | "),
      r.matchReason ?? "",
      r.reaction ?? "",
    ]);
  }

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");

  // BOM prefix so Excel opens UTF-8 correctly without mangling accents.
  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `centinel-${slugifyForFilename(query)}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  // RFC 4180: fields containing quotes, commas, or line breaks must be
  // double-quoted, with internal quotes doubled.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function slugifyForFilename(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40) || "lookup";
}

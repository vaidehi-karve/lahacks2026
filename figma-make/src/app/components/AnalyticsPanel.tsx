import React from "react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

type Props = {
  sessionId: string;
  userId: string;
};

type LiveEvent = {
  sessionId?: string;
  eventType: string;
  element: string;
  page: string;
  timestamp: number;
};

type BetaTask = {
  id: string;
  title: string;
  description: string;
  completeIf: (e: LiveEvent) => boolean;
};

function pickDifferentTaskId(all: string[], current?: string | null): string | null {
  if (all.length === 0) return null;
  if (all.length === 1) return all[0]!;
  let next = current;
  while (next === current) next = all[Math.floor(Math.random() * all.length)]!;
  return next ?? null;
}

export function AnalyticsPanel({ sessionId, userId }: Props) {
  const [mode, setMode] = React.useState<"tester" | "pm">("tester");
  const [connected, setConnected] = React.useState(false);
  const [events, setEvents] = React.useState<LiveEvent[]>([]);
  const [analysis, setAnalysis] = React.useState<any>(null);
  const [friction, setFriction] = React.useState<any>(null);
  const [aggregated, setAggregated] = React.useState<any>(null);
  const [running, setRunning] = React.useState(false);
  const [taskDone, setTaskDone] = React.useState(false);
  const [pmOverview, setPmOverview] = React.useState<any>(null);
  const [pmAi, setPmAi] = React.useState<any>(null);
  const [pmRunning, setPmRunning] = React.useState(false);
  const [submitStatus, setSubmitStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");

  const tasks: BetaTask[] = React.useMemo(
    () => [
      {
        id: "make_tuition_payment",
        title: "Beta task",
        description: "Make a tuition payment (submit the payment).",
        completeIf: (e) => e.eventType === "click" && e.element === "payments_submit",
      },
      {
        id: "enroll_payment_plan",
        title: "Beta task",
        description: "Enroll in a payment plan.",
        completeIf: (e) => e.eventType === "click" && e.element === "payment_plan_enroll",
      },
      {
        id: "upload_document",
        title: "Beta task",
        description: "Upload a required financial aid document.",
        completeIf: (e) => e.eventType === "click" && e.element === "documents_upload_submit",
      },
      {
        id: "search_courses",
        title: "Beta task",
        description: "Search for a Spring course using the course search filters.",
        completeIf: (e) => e.eventType === "click" && e.element === "courses_search",
      },
      {
        id: "register_course",
        title: "Beta task",
        description: "Register for any available course.",
        completeIf: (e) => e.eventType === "click" && e.element.startsWith("courses_action_register_"),
      },
    ],
    []
  );

  const [taskId, setTaskId] = React.useState<string | null>(() =>
    pickDifferentTaskId(tasks.map((t) => t.id), null)
  );

  const betaTask = React.useMemo(() => tasks.find((t) => t.id === taskId) ?? tasks[0], [tasks, taskId]);

  React.useEffect(() => {
    // New session (refresh) -> new random task.
    setTaskId(pickDifferentTaskId(tasks.map((t) => t.id), null));
    setTaskDone(false);
  }, [sessionId, tasks]);

  React.useEffect(() => {
    const es = new EventSource(`/api/session/${sessionId}/stream`);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "event" && data.event) {
          const e = data.event;
          setEvents((prev) => [...prev.slice(-199), e]);
          if (!taskDone && betaTask.completeIf(e)) setTaskDone(true);
        }
        if (data.type === "analysis") {
          setAnalysis(data.ai);
          setFriction(data.friction);
          setAggregated(data.aggregated);
        }
      } catch {
        // ignore
      }
    };

    return () => es.close();
  }, [sessionId, betaTask, taskDone]);

  const refreshAggregates = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/session/${sessionId}/analytics`);
      const j = await r.json();
      setAggregated(j.aggregated);
    } catch {
      // ignore
    }
  }, [sessionId]);

  React.useEffect(() => {
    void refreshAggregates();
    const t = window.setInterval(refreshAggregates, 2500);
    return () => window.clearInterval(t);
  }, [refreshAggregates]);

  const runAnalyze = async () => {
    setRunning(true);
    try {
      const r = await fetch(`/api/session/${sessionId}/analyze`, { method: "POST" });
      const j = await r.json();
      setAnalysis(j.ai);
      setFriction(j.friction);
      setAggregated(j.aggregated);
    } finally {
      setRunning(false);
    }
  };

  const loadPmOverview = React.useCallback(async () => {
    try {
      const r = await fetch("/api/pm/overview");
      const j = await r.json();
      setPmOverview(j);
    } catch {
      // ignore
    }
  }, []);

  const runPmAnalyze = async () => {
    setPmRunning(true);
    try {
      const r = await fetch("/api/pm/analyze", { method: "POST" });
      const j = await r.json();
      setPmOverview({ totals: j.overview, topClicked: j.overview?.topClicked ?? [] });
      setPmAi(j.ai);
    } finally {
      setPmRunning(false);
    }
  };

  const submitThisSession = async () => {
    setSubmitStatus("saving");
    try {
      const r = await fetch(`/api/session/${sessionId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          taskId: betaTask.id,
          taskDescription: betaTask.description,
          taskDone,
          client: "web",
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSubmitStatus("saved");
      setTimeout(() => setSubmitStatus("idle"), 1500);
    } catch {
      setSubmitStatus("error");
      setTimeout(() => setSubmitStatus("idle"), 2000);
    }
  };

  const frictionScore = friction?.frictionScore ?? null;
  const top = aggregated?.topElements ?? [];
  const navPath: string[] = aggregated?.navPath ?? [];

  return (
    <aside
      data-analytics-panel
      className="fixed right-0 top-0 h-screen w-[340px] sm:w-[360px] lg:w-[400px] xl:w-[420px] max-w-[90vw] border-l border-rose-200 bg-rose-50/80 backdrop-blur supports-[backdrop-filter]:bg-rose-50/60 z-50 font-[var(--dashboard-font)]"
    >
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-rose-200 bg-gradient-to-r from-rose-200/60 via-fuchsia-100/60 to-white/70">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight text-rose-950">FlowState</div>
              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Session:</span>
                <span className="font-mono truncate max-w-[200px] sm:max-w-[240px] lg:max-w-[260px]">
                  {sessionId}
                </span>
                <span>•</span>
                <span className={connected ? "text-green-600" : "text-red-600"}>
                  {connected ? "live" : "disconnected"}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              {/* Toggle pill */}
              <div
                className="inline-flex rounded-full border border-rose-200 bg-white/70 p-1 shadow-sm"
                role="tablist"
                aria-label="Mode toggle"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "tester"}
                  className={`px-3 py-1 text-xs rounded-full transition-colors ${
                    mode === "tester" ? "bg-fuchsia-600 text-white" : "text-rose-950 hover:bg-rose-50"
                  }`}
                  onClick={() => setMode("tester")}
                  data-track="mode_tester"
                >
                  Tester
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "pm"}
                  className={`px-3 py-1 text-xs rounded-full transition-colors ${
                    mode === "pm" ? "bg-fuchsia-600 text-white" : "text-rose-950 hover:bg-rose-50"
                  }`}
                  onClick={() => {
                    setMode("pm");
                    void loadPmOverview();
                  }}
                  data-track="mode_pm"
                >
                  PM
                </button>
              </div>

              {/* Action button */}
              {mode === "tester" ? (
                <div className="text-xs text-rose-950/80 px-2 py-1">
                  Tester mode
                </div>
              ) : (
                <Button
                  onClick={runPmAnalyze}
                  disabled={pmRunning}
                  data-track="pm_run_ai"
                  className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white h-9 px-3 text-sm"
                >
                  {pmRunning ? "Analyzing…" : "Run AI"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 overflow-hidden">
          <div className="p-4 space-y-4 overflow-x-hidden">
            {mode === "tester" ? (
            <div className="rounded-xl border-2 border-fuchsia-300 bg-gradient-to-br from-rose-100/80 via-white to-white shadow-md">
              <div className="px-3 py-2 border-b border-rose-200 bg-fuchsia-100/60 text-sm font-semibold flex items-center justify-between gap-3">
                <span>{betaTask.title}</span>
                <button
                  className="text-xs px-2 py-1 rounded border border-rose-200 bg-white hover:bg-rose-50 shrink-0"
                  onClick={() => {
                    setTaskId((cur) => pickDifferentTaskId(tasks.map((t) => t.id), cur));
                    setTaskDone(false);
                  }}
                  data-track="beta_task_new"
                >
                  New task
                </button>
              </div>
              <div className="p-3">
                <div className="text-sm font-medium text-rose-950">{betaTask.description}</div>
                <div className="text-xs text-muted-foreground mt-2 flex items-center gap-2">
                  Status:{" "}
                  <span
                    className={
                      taskDone
                        ? "px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium"
                        : "px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-800 font-medium"
                    }
                  >
                    {taskDone ? "completed" : "in progress"}
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="text-xs px-3 py-1.5 rounded border border-rose-200 bg-white hover:bg-rose-50"
                    onClick={submitThisSession}
                    data-track="session_submit"
                  >
                    {submitStatus === "saving"
                      ? "Submitting…"
                      : submitStatus === "saved"
                        ? "Submitted"
                        : submitStatus === "error"
                          ? "Submit failed"
                          : "Submit session"}
                  </button>
                </div>
              </div>
            </div>
            ) : (
              <div className="rounded-xl border-2 border-rose-200 bg-white shadow-md">
                <div className="px-3 py-2 border-b border-rose-200 bg-fuchsia-100/60 text-sm font-semibold">
                  PM dashboard
                </div>
                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
                      <div className="text-xs text-muted-foreground">Submitted sessions</div>
                      <div className="text-xl font-semibold">
                        {pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? pmOverview?.totals?.submittedSessions ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
                      <div className="text-xs text-muted-foreground">Task completion rate</div>
                      <div className="text-xl font-semibold">
                        {pmOverview?.totals?.taskCompletionRate != null
                          ? `${Math.round(pmOverview.totals.taskCompletionRate * 100)}%`
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-rose-200 bg-white p-3">
                    <div className="text-sm font-semibold mb-2">Top clicked</div>
                    <div className="space-y-1">
                      {(pmOverview?.topClicked ?? []).slice(0, 10).map((t: any) => (
                        <div key={t.element} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 flex-1 break-words whitespace-normal">{t.element}</span>
                          <span className="font-mono shrink-0">{t.clicks}</span>
                        </div>
                      ))}
                      {!(pmOverview?.topClicked ?? []).length ? (
                        <div className="text-xs text-muted-foreground">No submitted sessions yet.</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-lg border border-rose-200 bg-white p-3">
                    <div className="text-sm font-semibold mb-2">AI recommendations</div>
                    {pmAi?.error ? (
                      <div className="text-xs text-red-600 break-words whitespace-pre-wrap">{pmAi.error}</div>
                    ) : pmAi?.recommendations?.length ? (
                      <div className="space-y-2">
                        {pmAi.recommendations.slice(0, 6).map((r: any, idx: number) => (
                          <div key={idx} className="rounded-lg border border-rose-200 bg-fuchsia-50/60 p-3">
                            <div className="text-xs text-muted-foreground font-medium">{r.priority ?? "P?"}</div>
                            <div className="text-sm font-semibold">{r.title}</div>
                            {r.why ? <div className="text-xs mt-1 text-muted-foreground">{r.why}</div> : null}
                            {r.how ? <div className="text-xs mt-1">{r.how}</div> : null}
                            {r.successMetric ? <div className="text-xs mt-1">Metric: {r.successMetric}</div> : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Click “Run AI” to analyze submitted sessions.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-rose-200 bg-white p-3 shadow-sm">
                <div className="text-xs text-muted-foreground">Friction score</div>
                <div className="text-2xl font-semibold">{frictionScore ?? "—"}</div>
              </div>
              <div className="rounded-lg border border-rose-200 bg-white p-3 shadow-sm">
                <div className="text-xs text-muted-foreground">Nav path</div>
                <div className="text-xs mt-1 break-words overflow-hidden">
                  {navPath.length ? navPath.join(" → ") : "—"}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-rose-200 bg-white shadow-sm">
              <div className="px-3 py-2 border-b border-rose-200 bg-fuchsia-100/60 text-sm font-semibold">Top clicked</div>
              <div className="p-3 space-y-1">
                {top.length ? (
                  top.slice(0, 10).map((t: any) => (
                    <div key={t.element} className="flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 flex-1 break-words whitespace-normal">{t.element}</span>
                      <span className="font-mono shrink-0">{t.clicks}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">No clicks yet.</div>
                )}
              </div>
            </div>

            {/* Tester mode intentionally omits AI recommendations (PM view is aggregate-only). */}

            <div className="rounded-lg border border-rose-200 bg-white shadow-sm">
              <div className="px-3 py-2 border-b border-rose-200 bg-fuchsia-100/60 text-sm font-semibold">Live event stream</div>
              <div className="p-3 space-y-2">
                {events.length ? (
                  events
                    .slice()
                    .reverse()
                    .slice(0, 120)
                    .map((e, idx) => (
                      <div key={idx} className="text-xs break-words whitespace-normal rounded px-2 py-1 hover:bg-rose-50">
                        <span className="font-mono text-muted-foreground">
                          {new Date(e.timestamp).toLocaleTimeString()}
                        </span>{" "}
                        <span className="font-mono">{e.eventType}</span>{" "}
                        <span className="text-muted-foreground">{e.page}</span>{" "}
                        <span className="break-words whitespace-normal">{e.element}</span>
                      </div>
                    ))
                ) : (
                  <div className="text-xs text-muted-foreground">Interact with the portal to generate events.</div>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}


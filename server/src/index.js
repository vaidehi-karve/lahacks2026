import express from "express";
import cors from "cors";
import { insertEvent, getSessionEvents, submitSession, listSubmittedSessions } from "./db.js";
import { aggregateSession, computeFriction } from "./analytics.js";
import { getUxInsightsFromGemini, getUxInsightsFromGeminiAggregate } from "./gemini.js";
import { loadEnv } from "./env.js";

loadEnv();

const app = express();
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: "1mb" }));

// Simple in-memory SSE subscribers keyed by sessionId
const streams = new Map(); // sessionId -> Set(res)

function broadcast(sessionId, data) {
  const subs = streams.get(sessionId);
  if (!subs) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) res.write(msg);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/event", (req, res) => {
  const evt = req.body;
  const valid =
    isNonEmptyString(evt?.sessionId) &&
    isNonEmptyString(evt?.userId) &&
    isNonEmptyString(evt?.eventType) &&
    isNonEmptyString(evt?.element) &&
    isNonEmptyString(evt?.page) &&
    Number.isFinite(evt?.timestamp);

  if (!valid) {
    return res.status(400).json({ error: "Invalid event payload." });
  }

  const payloadJson = JSON.stringify(evt);
  insertEvent(evt, payloadJson);
  broadcast(evt.sessionId, { type: "event", event: evt });
  res.json({ ok: true });
});

app.get("/api/session/:id/analytics", (req, res) => {
  const sessionId = req.params.id;
  const events = getSessionEvents(sessionId).map((e) => ({
    ...e,
    // Flatten for client convenience
    ...(e.payloadJson ? JSON.parse(e.payloadJson) : {}),
  }));
  const aggregated = aggregateSession(events);
  res.json({ sessionId, aggregated });
});

app.post("/api/session/:id/submit", (req, res) => {
  const sessionId = req.params.id;
  const body = req.body ?? {};
  const valid = isNonEmptyString(body?.userId);
  if (!valid) return res.status(400).json({ error: "Missing userId." });

  submitSession({
    sessionId,
    userId: body.userId,
    taskId: typeof body.taskId === "string" ? body.taskId : null,
    taskDone: Boolean(body.taskDone),
    submittedAt: Date.now(),
    metaJson: JSON.stringify({
      taskDescription: typeof body.taskDescription === "string" ? body.taskDescription : null,
      client: typeof body.client === "string" ? body.client : null,
    }),
  });

  res.json({ ok: true });
});

app.get("/api/pm/sessions", (req, res) => {
  const limit = Number(req.query.limit || 50);
  const sessions = listSubmittedSessions({ limit: Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 50 });
  res.json({ sessions });
});

app.get("/api/pm/overview", (req, res) => {
  const sessions = listSubmittedSessions({ limit: 200 });
  const sessionIds = sessions.map((s) => s.sessionId);

  // Aggregate clicks across sessions (from stored raw events).
  const byElement = new Map();
  let totalEvents = 0;
  let completed = 0;

  for (const s of sessions) {
    if (s.taskDone) completed++;
    const events = getSessionEvents(s.sessionId).map((e) => (e.payloadJson ? JSON.parse(e.payloadJson) : e));
    totalEvents += events.length;
    for (const e of events) {
      if (e.eventType !== "click") continue;
      byElement.set(e.element, (byElement.get(e.element) ?? 0) + 1);
    }
  }

  const topClicked = Array.from(byElement.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([element, clicks]) => ({ element, clicks }));

  res.json({
    totals: {
      submittedSessions: sessions.length,
      taskCompletionRate: sessions.length ? completed / sessions.length : 0,
      totalEvents,
    },
    topClicked,
    sessionIds,
  });
});

app.post("/api/pm/analyze", async (_req, res) => {
  const overview = await (async () => {
    const sessions = listSubmittedSessions({ limit: 200 });
    const byElement = new Map();
    let totalEvents = 0;
    let completed = 0;
    const tasks = {};
    const globalPairs = new Map(); // "a||b" -> count
    const globalTransitions = new Map(); // "from->to" -> {count, totalDelayMs}
    const globalCrossPageTransitions = new Map(); // "fromPage:from->toPage:to" -> count
    const byTask = {}; // taskId -> { sessions, completed, pairs, transitions, crossPageTransitions }

    const addPair = (map, a, b) => {
      if (!a || !b || a === b) return;
      const key = a < b ? `${a}||${b}` : `${b}||${a}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    };

    const addTransition = (map, from, to, delayMs) => {
      if (!from || !to) return;
      const key = `${from}→${to}`;
      const cur = map.get(key) ?? { count: 0, totalDelayMs: 0 };
      cur.count += 1;
      cur.totalDelayMs += Math.max(0, Number(delayMs) || 0);
      map.set(key, cur);
    };

    const addCrossPageTransition = (map, fromPage, from, toPage, to) => {
      if (!from || !to) return;
      const key = `${fromPage}:${from}→${toPage}:${to}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    };

    for (const s of sessions) {
      if (s.taskDone) completed++;
      if (s.taskId) tasks[s.taskId] = (tasks[s.taskId] ?? 0) + 1;
      if (s.taskId && !byTask[s.taskId]) {
        byTask[s.taskId] = {
          sessions: 0,
          completed: 0,
          pairs: new Map(),
          transitions: new Map(),
          crossPageTransitions: new Map(),
        };
      }
      const taskBucket = s.taskId ? byTask[s.taskId] : null;
      if (taskBucket) {
        taskBucket.sessions += 1;
        if (s.taskDone) taskBucket.completed += 1;
      }

      const events = getSessionEvents(s.sessionId).map((e) => (e.payloadJson ? JSON.parse(e.payloadJson) : e));
      totalEvents += events.length;
      for (const e of events) {
        if (e.eventType !== "click") continue;
        byElement.set(e.element, (byElement.get(e.element) ?? 0) + 1);
      }

      // Relationships: co-occurrence (per session) + transitions (within session).
      const clickSeq = events
        .filter((e) => e.eventType === "click" && typeof e.element === "string")
        .map((e) => ({ element: e.element, ts: Number(e.timestamp) || 0, page: e.page || "unknown" }));

      const uniqueClicks = Array.from(new Set(clickSeq.map((c) => c.element))).slice(0, 40);
      for (let i = 0; i < uniqueClicks.length; i++) {
        for (let j = i + 1; j < uniqueClicks.length; j++) {
          addPair(globalPairs, uniqueClicks[i], uniqueClicks[j]);
          if (taskBucket) addPair(taskBucket.pairs, uniqueClicks[i], uniqueClicks[j]);
        }
      }

      // Next-click transitions (cap at 15s gap to keep "task-local" intent)
      for (let i = 1; i < clickSeq.length; i++) {
        const prev = clickSeq[i - 1];
        const cur = clickSeq[i];
        const delay = cur.ts - prev.ts;
        if (delay >= 0 && delay <= 15_000) {
          addTransition(globalTransitions, prev.element, cur.element, delay);
          if (taskBucket) addTransition(taskBucket.transitions, prev.element, cur.element, delay);
          if (prev.page !== cur.page) {
            addCrossPageTransition(globalCrossPageTransitions, prev.page, prev.element, cur.page, cur.element);
            if (taskBucket) addCrossPageTransition(taskBucket.crossPageTransitions, prev.page, prev.element, cur.page, cur.element);
          }
        }
      }
    }

    const topClicked = Array.from(byElement.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([element, clicks]) => ({ element, clicks }));

    const topPairs = Array.from(globalPairs.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([key, count]) => {
        const [a, b] = key.split("||");
        return { a, b, count };
      });

    const topTransitions = Array.from(globalTransitions.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25)
      .map(([key, v]) => {
        const [from, to] = key.split("→");
        return { from, to, count: v.count, avgDelayMs: Math.round(v.totalDelayMs / Math.max(1, v.count)) };
      });

    const topCrossPageTransitions = Array.from(globalCrossPageTransitions.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([key, count]) => {
        const [fromPart, toPart] = key.split("→");
        const [fromPage, from] = fromPart.split(":");
        const [toPage, to] = toPart.split(":");
        return { fromPage, from, toPage, to, count };
      });

    const taskJourneys = Object.fromEntries(
      Object.entries(byTask).map(([taskId, bucket]) => {
        const pairs = Array.from(bucket.pairs.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([key, count]) => {
            const [a, b] = key.split("||");
            return { a, b, count };
          });

        const transitions = Array.from(bucket.transitions.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 15)
          .map(([key, v]) => {
            const [from, to] = key.split("→");
            return { from, to, count: v.count, avgDelayMs: Math.round(v.totalDelayMs / Math.max(1, v.count)) };
          });

        const crossPageTransitions = Array.from(bucket.crossPageTransitions.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([key, count]) => {
            const [fromPart, toPart] = key.split("→");
            const [fromPage, from] = fromPart.split(":");
            const [toPage, to] = toPart.split(":");
            return { fromPage, from, toPage, to, count };
          });

        return [
          taskId,
          {
            sessions: bucket.sessions,
            completionRate: bucket.sessions ? bucket.completed / bucket.sessions : 0,
            topCooccurringActions: pairs,
            topTransitions: transitions,
            topCrossPageTransitions: crossPageTransitions,
          },
        ];
      })
    );

    return {
      submittedSessions: sessions.length,
      taskCompletionRate: sessions.length ? completed / sessions.length : 0,
      totalEvents,
      tasks,
      topClicked,
      relationships: {
        global: {
          topCooccurringActions: topPairs,
          topTransitions,
          topCrossPageTransitions,
        },
        byTask: taskJourneys,
      },
    };
  })();

  let ai;
  try {
    ai = await getUxInsightsFromGeminiAggregate({ aggregate: overview });
  } catch (err) {
    ai = {
      provider: "gemini",
      error: `Gemini request failed: ${err instanceof Error ? err.message : String(err)}`,
      recommendations: [],
      rawText: "",
    };
  }

  res.json({ overview, ai });
});

app.post("/api/session/:id/analyze", async (req, res) => {
  const sessionId = req.params.id;
  const events = getSessionEvents(sessionId).map((e) => ({
    ...e,
    ...(e.payloadJson ? JSON.parse(e.payloadJson) : {}),
  }));
  const aggregated = aggregateSession(events);
  const friction = computeFriction(events, aggregated);

  const recentEvents = events.slice(-40).map((e) => ({
    eventType: e.eventType,
    element: e.element,
    page: e.page,
    timestamp: e.timestamp,
  }));

  let ai;
  try {
    ai = await getUxInsightsFromGemini({ friction, aggregated, recentEvents });
  } catch (err) {
    ai = {
      provider: "gemini",
      error: `Gemini request failed: ${err instanceof Error ? err.message : String(err)}`,
      recommendations: [],
      rawText: "",
    };
  }

  const payload = { sessionId, friction, aggregated, ai };
  broadcast(sessionId, { type: "analysis", ...payload });
  res.json(payload);
});

app.get("/api/session/:id/stream", (req, res) => {
  const sessionId = req.params.id;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.write(`data: ${JSON.stringify({ type: "hello", sessionId })}\n\n`);

  if (!streams.has(sessionId)) streams.set(sessionId, new Set());
  streams.get(sessionId).add(res);

  req.on("close", () => {
    streams.get(sessionId)?.delete(res);
  });
});

const port = Number(process.env.PORT || 4010);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});


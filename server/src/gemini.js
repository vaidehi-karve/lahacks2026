import { GoogleGenerativeAI } from "@google/generative-ai";

function isModelNotFoundError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("404") && msg.toLowerCase().includes("model");
}

async function pickFallbackModelName(genAI) {
  // If listModels exists and works, choose a model that supports generateContent.
  if (typeof genAI.listModels === "function") {
    try {
      const { models } = await genAI.listModels();
      const supportsGenerate = (m) =>
        Array.isArray(m?.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("generateContent") &&
        typeof m?.name === "string";

      // Prefer "flash" models for speed, otherwise first compatible.
      const flash = models?.find((m) => supportsGenerate(m) && m.name.toLowerCase().includes("flash"));
      const any = models?.find((m) => supportsGenerate(m));
      return flash?.name?.replace(/^models\//, "") ?? any?.name?.replace(/^models\//, "") ?? null;
    } catch {
      // ignore and fall back to hardcoded candidates
    }
  }

  // Hardcoded candidates (API availability varies by key/project).
  return "gemini-2.0-flash";
}

export async function getUxInsightsFromGemini({ friction, aggregated, recentEvents }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      provider: "gemini",
      error: "Missing GEMINI_API_KEY on server.",
      recommendations: [],
      rawText: "",
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const requestedModelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  const prompt = [
    "You are a senior UX researcher analyzing product usage data.",
    "Based on the following user interaction analytics, identify usability problems and suggest specific UI/UX improvements.",
    "",
    "Return JSON ONLY with this shape:",
    "{",
    '  "summary": "string",',
    '  "issues": [{ "title": "string", "severity": "low|medium|high", "evidence": "string" }],',
    '  "recommendations": [{ "title": "string", "priority": "P0|P1|P2", "why": "string", "how": "string" }],',
    '  "navigationImprovements": ["string"],',
    '  "layoutChanges": ["string"]',
    "}",
    "",
    "ANALYTICS:",
    JSON.stringify(
      {
        friction,
        aggregated: {
          topElements: aggregated.topElements,
          navPath: aggregated.navPath,
          backtracks: aggregated.backtracks,
          scrollMaxByPage: aggregated.scrollMaxByPage,
          pageSectionTimeMs: aggregated.pageSectionTimeMs,
        },
        recentEvents,
      },
      null,
      2
    ),
  ].join("\n");

  let rawText = "";
  try {
    const model = genAI.getGenerativeModel({ model: requestedModelName });
    const result = await model.generateContent(prompt);
    rawText = result.response.text();
  } catch (err) {
    if (isModelNotFoundError(err)) {
      const fallbackName = await pickFallbackModelName(genAI);
      if (!fallbackName) throw err;
      const model = genAI.getGenerativeModel({ model: fallbackName });
      const result = await model.generateContent(prompt);
      rawText = result.response.text();
    } else {
      throw err;
    }
  }

  // Attempt to parse JSON even if Gemini adds surrounding text.
  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  const jsonSlice = firstBrace >= 0 && lastBrace >= 0 ? rawText.slice(firstBrace, lastBrace + 1) : "";

  try {
    const parsed = JSON.parse(jsonSlice);
    return { provider: "gemini", rawText, ...parsed };
  } catch {
    return {
      provider: "gemini",
      rawText,
      error: "Gemini response was not valid JSON.",
      recommendations: [],
    };
  }
}

export async function getUxInsightsFromGeminiAggregate({ aggregate }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { provider: "gemini", error: "Missing GEMINI_API_KEY on server.", recommendations: [], rawText: "" };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const requestedModelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  const prompt = [
    "You are a senior UX researcher supporting a Product Manager during beta testing.",
    "You will receive AGGREGATE analytics across many user sessions (not a single session).",
    "Identify usability problems and suggest specific UI/UX improvements grounded in the patterns.",
    "Pay special attention to cross-page behavior: co-occurring actions and next-click transitions can indicate that UI controls are part of the same user goal.",
    "",
    "Return JSON ONLY with this shape:",
    "{",
    '  "summary": "string",',
    '  "keyPatterns": ["string"],',
    '  "issues": [{ "title": "string", "severity": "low|medium|high", "evidence": "string" }],',
    '  "recommendations": [{ "title": "string", "priority": "P0|P1|P2", "why": "string", "how": "string", "successMetric": "string" }]',
    "}",
    "",
    "AGGREGATE_DATA:",
    JSON.stringify(aggregate, null, 2),
  ].join("\n");

  let rawText = "";
  try {
    const model = genAI.getGenerativeModel({ model: requestedModelName });
    const result = await model.generateContent(prompt);
    rawText = result.response.text();
  } catch (err) {
    if (isModelNotFoundError(err)) {
      const fallbackName = await pickFallbackModelName(genAI);
      if (!fallbackName) throw err;
      const model = genAI.getGenerativeModel({ model: fallbackName });
      const result = await model.generateContent(prompt);
      rawText = result.response.text();
    } else {
      throw err;
    }
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  const jsonSlice = firstBrace >= 0 && lastBrace >= 0 ? rawText.slice(firstBrace, lastBrace + 1) : "";

  try {
    const parsed = JSON.parse(jsonSlice);
    return { provider: "gemini", rawText, ...parsed };
  } catch {
    return { provider: "gemini", rawText, error: "Gemini response was not valid JSON.", recommendations: [] };
  }
}


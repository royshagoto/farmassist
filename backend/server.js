import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MANDI_API_BASE = "https://mandi-api.onrender.com/v1";
const MSP_SOURCE_URL = process.env.MSP_SOURCE_URL || "https://cacp.da.gov.in/Home/MSP";

// ---------- Data source tools (each is a discrete, callable "tool" the agent uses) ----------

async function geocode(place) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.results || !d.results.length) {
    throw Object.assign(new Error("Could not resolve that location."), { status: 400 });
  }
  const g = d.results[0];
  return {
    lat: g.latitude,
    lon: g.longitude,
    state: g.admin1 || "",
    label: `${g.name}, ${g.admin1 || ""} ${g.country_code || ""}`.trim(),
  };
}

async function getWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean&forecast_days=7&timezone=auto`;
  const r = await fetch(url);
  const d = await r.json();
  return d.daily;
}

function summarizeWeather(daily) {
  if (!daily) return "unavailable";
  const rain = daily.precipitation_sum.reduce((a, b) => a + b, 0).toFixed(1);
  const tmax = Math.max(...daily.temperature_2m_max).toFixed(1);
  const tmin = Math.min(...daily.temperature_2m_min).toFixed(1);
  const hum = (
    daily.relative_humidity_2m_mean.reduce((a, b) => a + b, 0) / daily.relative_humidity_2m_mean.length
  ).toFixed(0);
  return `7-day total rainfall ${rain}mm, temps ${tmin}-${tmax}C, avg humidity ${hum}%. Daily rainfall (mm): ${daily.precipitation_sum
    .map((v) => v.toFixed(1))
    .join(", ")}.`;
}

async function getMandiPrice(crop, state) {
  // Free, keyless API. Supported states (v1): Maharashtra, Uttar Pradesh, Punjab, Madhya Pradesh, Karnataka.
  try {
    const params = new URLSearchParams();
    if (crop) params.set("commodity", crop);
    if (state) params.set("state", state);
    const url = `${MANDI_API_BASE}/prices?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) return { available: false, summary: `mandi price service returned an error (${r.status})` };
    const d = await r.json();
    if (!d.success || !d.data || !d.data.length) {
      return { available: false, summary: `no mandi records found for "${crop}"${state ? ` in ${state}` : ""} (state may not be covered yet — currently Maharashtra, Uttar Pradesh, Punjab, Madhya Pradesh, Karnataka)` };
    }
    const summary = d.data
      .slice(0, 5)
      .map(
        (rec) =>
          `${rec.market || "?"} (${rec.district || "?"}, ${rec.state || "?"}): min Rs${rec.min_price ?? "?"} / modal Rs${
            rec.modal_price ?? "?"
          } / max Rs${rec.max_price ?? "?"} per quintal (${rec.arrival_date || ""})`
      )
      .join("; ");
    return { available: true, summary, records: d.data };
  } catch (e) {
    return { available: false, summary: "mandi price lookup failed" };
  }
}

async function callGemini(contents, { useUrlContext = false } = {}) {
  if (!GEMINI_KEY) {
    throw Object.assign(new Error("Server is missing GEMINI_API_KEY. Set it in backend/.env"), { status: 500 });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents,
    generationConfig: { temperature: 0.3 },
  };
  if (useUrlContext) body.tools = [{ url_context: {} }];
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    const t = await r.text();
    throw Object.assign(new Error(`Gemini API error (${r.status}): ${t.slice(0, 300)}`), { status: 502 });
  }
  const d = await r.json();
  const text = d.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") || "";
  if (!text) throw Object.assign(new Error("Gemini returned an empty response."), { status: 502 });
  return text;
}

function parseJSONish(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function buildPrompt({ crop, stage, soil, question, geo, weatherSummary, mandiSummary }) {
  return `You are an agricultural decision-support assistant for a farmer in India, continuing an ongoing conversation with this farmer (see prior turns above, if any — use them for context, e.g. don't repeat information already given, and note anything that changed). Base factual claims ONLY on the data given below or on ${MSP_SOURCE_URL} (the official CACP Minimum Support Price page, which you have a tool to read) - do not invent numbers. Be concise, specific, and explain your reasoning in plain language a farmer would find useful. If data is missing or insufficient for confidence, say so plainly rather than guessing.

FARM CONTEXT
Crop: ${crop}
Growth stage: ${stage}
Location: ${geo.label}
Soil type: ${soil || "not specified"}

WEATHER (next 7 days, from Open-Meteo)
${weatherSummary}

MARKET PRICES (mandi, from mandi-api.onrender.com, sourced from data.gov.in)
${mandiSummary}

MINIMUM SUPPORT PRICE (MSP)
If the farmer's question involves selling, pricing, or whether the mandi price is fair, use your URL-reading tool to check ${MSP_SOURCE_URL} for the current MSP of ${crop}, and compare it to the mandi price above. If the page doesn't load or has no MSP for this crop, say so rather than guessing a figure. Skip this if the question isn't about price/selling.

FARMER'S QUESTION (this turn)
${question}

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{
  "recommendation": "one clear sentence stating the recommended action",
  "reasoning": "2-4 sentences explaining why, referencing the specific weather/market/stage/MSP data above and prior conversation where relevant",
  "risk_flags": ["short risk labels, e.g. Fungal risk, Waterlogging risk, Price dip - omit if none"],
  "confidence": "high | medium | low",
  "caveat": "one sentence on what could change this recommendation, or empty string"
}`;
}

// ---------- Routes ----------

app.get("/api/health", (req, res) => {
  res.json({ ok: true, geminiConfigured: !!GEMINI_KEY });
});

app.post("/api/recommend", async (req, res) => {
  try {
    const { crop, stage, location, soil, question, history } = req.body || {};
    if (!crop || !location || !question) {
      return res.status(400).json({ error: "crop, location and question are required." });
    }

    const geo = await geocode(location);
    const daily = await getWeather(geo.lat, geo.lon);
    const weatherSummary = summarizeWeather(daily);
    const mandi = await getMandiPrice(crop, geo.state);

    const prompt = buildPrompt({ crop, stage, soil, question, geo, weatherSummary, mandiSummary: mandi.summary });

    // Turn prior turns into alternating user/model messages so Gemini has real conversation memory.
    // history: [{ question: string, recommendation: {recommendation, reasoning, ...} }, ...] — capped client-side.
    const priorTurns = Array.isArray(history) ? history.slice(-6) : [];
    const contents = [];
    for (const turn of priorTurns) {
      if (!turn?.question) continue;
      contents.push({ role: "user", parts: [{ text: turn.question }] });
      contents.push({
        role: "model",
        parts: [{ text: JSON.stringify(turn.recommendation || {}) }],
      });
    }
    contents.push({ role: "user", parts: [{ text: prompt }] });

    const raw = await callGemini(contents, { useUrlContext: true });
    const parsed = parseJSONish(raw);

    res.json({
      recommendation: parsed || { recommendation: raw, reasoning: "", risk_flags: [], confidence: "low", caveat: "" },
      trace: {
        location: geo.label,
        coordinates: { lat: geo.lat, lon: geo.lon },
        weather: weatherSummary,
        mandi: mandi.summary,
        mspSource: MSP_SOURCE_URL,
        turnsRemembered: priorTurns.length,
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Unexpected server error." });
  }
});

// Serve the consumer frontend
app.use(express.static(path.join(__dirname, "..", "frontend")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Field Assistant backend running on http://localhost:${PORT}`);
  if (!GEMINI_KEY) console.warn("WARNING: GEMINI_API_KEY not set in backend/.env — recommendations will fail.");
});

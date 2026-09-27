# FarmAssist — AI Farm Decision & Market Intelligence Agent

A consumer-facing web app where a farmer describes their crop, stage, location and
question, and gets back a recommendation grounded in live weather and mandi
(market) price data — with a visible explanation of exactly what data was used.

## Why this architecture

- **Frontend** (`/frontend`): what the farmer sees. No API keys anywhere in this
  code — it only ever talks to your own backend.
- **Backend** (`/backend`): an Express server that holds the real API keys as
  environment variables, orchestrates three data sources (geocoding, weather,
  mandi prices), builds a grounded prompt, and calls Gemini. This is the
  "agent" — it decides what data to fetch and hands it to the LLM as context
  rather than letting the LLM guess.

```
Farmer's browser  -->  POST /api/recommend  -->  Backend (Node/Express)
                          (+ conversation history)   ├─ Open-Meteo geocoding (free)
                                                      ├─ Open-Meteo weather (free)
                                                      ├─ mandi-api.onrender.com prices (free, keyless)
                                                      ├─ Gemini API, multi-turn + URL context tool
                                                      │    reads MSP page live when relevant
                                                      └─ reasoning + recommendation
                                                           |
                                                           v
                                                    JSON: recommendation + reasoning
                                                    + risk flags + confidence + data trace
```

## Conversation memory

The frontend keeps a session-only array of prior question/answer turns in a
JS variable (never saved to disk, cleared on page reload or the "New
conversation" button). Each request sends the last 6 turns to the backend,
which replays them as alternating `user`/`model` messages before the new
question — genuine multi-turn context, not just a longer single prompt. So a
farmer can ask "should I irrigate this week?" and then "what about the pest
risk you mentioned?" without repeating context.

## MSP (Minimum Support Price)

For questions about selling or whether the mandi price is fair, the backend
enables Gemini's **URL context tool**, which lets Gemini fetch and read a
live webpage itself — here, the CACP MSP page
(`https://cacp.da.gov.in/Home/MSP`, configurable via `MSP_SOURCE_URL`). No
scraper code needed; the model decides whether to pull it based on the
question, and is instructed to say so plainly if the page doesn't load or has
no MSP figure for that crop, rather than inventing one.

## Setup

### Prerequisite: Node.js 18+

The backend uses the built-in `fetch` API, which needs Node 18 or newer.

- **Windows**: download and run the installer (LTS version) from https://nodejs.org — this gives you `node` and `npm` in Command Prompt/PowerShell. Check it worked with `node -v` in a new terminal window.
- **macOS/Linux**: install via https://nodejs.org, or `brew install node` on macOS, or your distro's package manager. Check with `node -v`.

### macOS / Linux

```bash
cd backend
npm install
cp .env.example .env
# edit .env and add your GEMINI_API_KEY
npm start
```
Open http://localhost:3001

### Windows

**Command Prompt** (recommended — avoids a common PowerShell permissions issue, see note below):
```cmd
cd backend
npm install
copy .env.example .env
notepad .env
```
In Notepad, fill in `GEMINI_API_KEY=your_actual_key_here`, save, and close. Then:
```cmd
npm start
```
Open http://localhost:3001 in your browser.

**PowerShell**: the same commands work, except `copy` and `notepad` are already
available, but PowerShell may block `npm` with a message like *"running
scripts is disabled on this system."* If that happens, either switch to
Command Prompt instead (simplest fix), or open PowerShell **as Administrator**
and run:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
then retry `npm install`.

**Editing `.env` on Windows**: make sure File Explorer isn't hiding the real
extension — View tab → check "File name extensions" — otherwise a file saved
as `.env` can silently become `.env.txt` and the server won't find your key.

Either way, once `.env` has your key and `npm start` is running, everything
else in this README applies identically — Windows, macOS, and Linux all use
the same Node/Express app.

### API keys needed

- `GEMINI_API_KEY` — required. Get a free key at https://aistudio.google.com/apikey

Mandi (market) prices come from https://mandi-api.onrender.com, a free,
keyless public API sourced from data.gov.in — no setup needed. It currently
covers Maharashtra, Uttar Pradesh, Punjab, Madhya Pradesh, and Karnataka; for
other states the app just notes that prices weren't found.

## What counts as "the agent" here

For each question, the backend:
1. Resolves the farmer's location to coordinates.
2. Pulls a real 7-day forecast (rainfall, temperature, humidity).
3. Looks up current mandi prices for the named crop, if a data.gov.in key is configured.
4. Builds a prompt that hands Gemini *only* that real data plus the farmer's
   context (crop, growth stage, soil, question) and instructs it not to invent
   numbers.
5. Asks for a structured JSON response: recommendation, reasoning, risk flags,
   confidence, and a caveat — so the UI can show *why*, not just *what*.
6. Returns a `trace` object alongside the recommendation so the frontend can
   show exactly which weather/market data grounded the answer (explainability).

## Extending it (good next steps for a hackathon demo)

- **Pest/disease ID from photos**: add an endpoint that accepts an image and
  passes it to Gemini's multimodal input alongside the text prompt.
- **Regional languages**: add a language field to the request and ask Gemini
  to respond in that language.
- **Soil data**: wire in SoilGrids (ISRIC) or Google Earth Engine for
  location-based soil properties instead of relying on the farmer's manual input.
- **Caching**: cache weather/mandi lookups per location for a few hours to cut
  latency and API usage during a live demo.
- **Deploy**: this Express app deploys as-is to Cloud Run, Render, or Railway —
  just set the same environment variables there.

## Notes on the mandi price source

`mandi-api.onrender.com` is a free wrapper around data.gov.in's mandi price
data — no key, rate-limited to 100 requests / 15 minutes per IP. It only
covers five states in v1 (Maharashtra, Uttar Pradesh, Punjab, Madhya Pradesh,
Karnataka); for a location outside those, the app clearly reports that no
mandi data was found rather than failing silently. Because it's a third-party
hosted wrapper rather than data.gov.in itself, it's worth having a fallback
plan for a live demo (e.g. a cached example response) in case it's briefly
unreachable.

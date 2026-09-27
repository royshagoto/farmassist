# FarmAssist 🌾
### AI Farm Decision & Market Intelligence Agent

*Submitted for the AgriTech track — Google Hackathon*

---

## Why We built this

Farmers make constant, high-stakes decisions — when to sow, when to irrigate, what to spray, when to sell — and every one of those decisions depends on information that's currently scattered across different apps, portals, and word of mouth. Weather on one app. Mandi prices on another. Pest advisories somewhere else, if at all. By the time all of it reaches a farmer, it's often too generic or too late to actually help.

We wanted to build something that pulls the relevant data together automatically and reasons over it in plain language — not a chatbot that guesses, but an agent that actually goes and checks the weather, checks the market, and tells the farmer *why* it's recommending what it's recommending.

That's FarmAssist.

## The problem, specifically

- **Fragmented sources** — weather, prices, and pest info live in separate places with no single view.
- **Generic advice** — most advisories are one-size-fits-all and ignore a farmer's actual soil, crop stage, and location.
- **Stale market data** — by the time price information trickles down, the mandi may have already moved.
- **Wrong timing costs money** — irrigating, fertilizing, or selling at the wrong moment directly hits yield and income.

## My approach

FarmAssist is an agent, not a static form. When a farmer asks a question, the backend:

1. Resolves their location and pulls a real 7-day weather forecast.
2. Looks up live mandi (market) prices for their crop and state.
3. If the question is about selling or pricing, has Gemini read the government's official MSP (Minimum Support Price) page live.
4. Hands only that real, fetched data to Gemini and asks it to reason — explicitly instructed never to invent a number.
5. Returns a structured answer: a recommendation, the reasoning behind it, risk flags, a confidence level, and a full trace of exactly what data was used.

That last part mattered a lot to me — We didn't want a black box. Every answer shows its work.

## User interface

A single, plain-language form: crop, growth stage, location, soil type, and a free-text question. No jargon, no menus to learn. It also remembers the conversation within a session, so a farmer can ask a follow-up ("what about my fertilizer schedule now?") without repeating everything they already said — the app shows a small "remembering N earlier turns" badge so that's never hidden.

**Languages & tech used:** HTML5, CSS3, JavaScript (vanilla, no framework) on the frontend; Node.js + Express on the backend; REST APIs throughout.

## Why We chose Gemini

A few reasons this was the right model for the job, not just a familiar one:

- **Tool / function-calling** — the agent can decide which data source a question actually needs instead of running one rigid pipeline every time.
- **Built-in URL context tool** — this is what let me pull live MSP data straight off a government webpage without writing and maintaining a scraper. We just point Gemini at the page and ask it to read it.
- **Multimodal by default** — the same API accepts images, which sets up photo-based pest/disease identification as a natural next feature.
- **Gemini 2.5 Flash** keeps latency and cost low enough for a responsive, farmer-facing tool.

### Getting mandi prices in

We use a free, keyless mandi price API (sourced from data.gov.in) that We call server-side with the farmer's crop and resolved state. The API key setup here is simple by design: my backend holds the Gemini API key as an environment variable, so it's never exposed to the browser, and the mandi price lookup needs no key at all. Only the real numbers that come back get inserted into the prompt — the model never sees a blank slot it might feel tempted to fill in itself.

### Why we added MSP

The mandi price API We'm using only has live coverage for five states in its current version. Rather than leave a gap for farmers outside that coverage — or invent a plausible-sounding price, which We wasn't willing to do — We used Gemini's URL context tool to read the official CACP Minimum Support Price page live, on demand. MSP is a single, government-set number per crop, so it works as a consistent reference price regardless of mandi coverage. If the page doesn't load or has nothing for that crop, the agent says so plainly instead of guessing.

## Benefits & accuracy

**Benefits**
- One interface for weather, price, MSP, and reasoning
- Real session memory for natural follow-up questions
- No cost floor on the free/keyless data sources
- Extensible — photo-based pest ID and regional-language output are natural next additions

**Accuracy & trust**
- Every prompt explicitly instructs the model to use only the data it was given, never invent a number
- A visible confidence level (high / medium / low) on every answer
- The full data trace is shown alongside the recommendation, not hidden
- Missing or unreachable data is reported honestly rather than silently guessed

## Project structure

```
FarmAssist/
├── frontend/         # what the farmer sees — no API keys anywhere in this code
│   ├── index.html
│   ├── style.css
│   └── app.js
├── backend/           # holds the real API keys, orchestrates all data sources
│   ├── server.js
│   ├── package.json
│   └── .env.example
└── README.md
```

## Running it

**Prerequisite:** Node.js 18+ (needed for the built-in `fetch` API).

### macOS / Linux
```bash
cd backend
npm install
cp .env.example .env
# add your GEMINI_API_KEY to .env
npm start
```
Then open `http://localhost:3001`.

### Windows
```cmd
cd backend
npm install
copy .env.example .env
notepad .env
```
Fill in `GEMINI_API_KEY=your_actual_key_here` in Notepad, save, then:
```cmd
npm start
```
Open `http://localhost:3001` in your browser.

> If PowerShell blocks `npm` with a script-execution error, either use Command Prompt instead, or run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` in an Administrator PowerShell window first.

Get a free Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). No other keys are required — mandi prices are free and keyless.

## What We'd add next

- Photo-based pest/disease identification, using Gemini's vision input on a leaf/insect photo
- Regional-language responses
- Soil property lookups (SoilGrids or Google Earth Engine) instead of relying on manual soil input
- Caching weather/mandi lookups per location to cut latency

## References & data sources

- **Google Gemini API** — [aistudio.google.com](https://aistudio.google.com) — reasoning, multi-turn chat, URL context tool
- **Open-Meteo** — [open-meteo.com](https://open-meteo.com) — free geocoding & 7-day weather forecast
- **Mandi Price API** — [mandi-api.onrender.com](https://mandi-api.onrender.com) — free, keyless market prices sourced from data.gov.in
- **CACP — Minimum Support Price** — [cacp.da.gov.in/Home/MSP](https://cacp.da.gov.in/Home/MSP) — official government MSP reference
- **data.gov.in** — Open Government Data Platform India

---

*Built for the AgriTech track of the Google Hackathon.*

# Vivaha AI — An Agentic Wedding-Planning Organisation

A fully agentic organisation powered by **five specialised AI agents** that collaborate
in a pipeline to plan an Indian wedding end-to-end. This is the final project for
**H9CEAI (Customer Engagement and AI)** — "Build an Agentic Organisation".

The five agents (each with its own system prompt, personality and domain expertise):

```
Researcher (Aanya) → Designer (Ishaan) → Maker (Ravi) → Communicator (Meera) → Manager (Arjun)
```

| Agent | Archetype | Name | Produces |
|-------|-----------|------|----------|
| 🔍 Researcher | Deep analysis & pattern recognition | Aanya | Research brief / opportunity analysis (grounded in **live vendor data**) |
| 🎨 Designer | Creative problem-solving | Ishaan | Design specification — theme, guest journey, budget architecture |
| 🛠️ Maker | Technical craftsmanship | Ravi | Working artefact — a structured wedding plan (JSON) |
| 📣 Communicator | Persuasion & storytelling | Meera | Marketing pack / go-to-market |
| 🧭 Manager | Leadership & orchestration | Arjun | Executive summary + operational plan + risk register |

Each agent's output is passed as the next agent's input — the handoff is the heart of the project.

## Architecture

```
┌──────────────────────┐          ┌──────────────────────────────┐
│  GitHub Pages (UI)   │  HTTPS   │  Render (Python backend)     │
│  index.html, app.js  │ ───────► │  /api/generate  → Gemini     │
│  agents.js, main.js  │ ◄─────── │  /api/vendors   → G.Sheets   │
└──────────────────────┘          └──────────────────────────────┘
```

- **Frontend (GitHub Pages)** — static UI, the five agent definitions, and the pipeline
  orchestration (the function-calling loop and handoffs all run here and are fully
  visible in the transcript).
- **Backend (Render)** — hides the Gemini API key and reads the Google Sheet
  server-side. Visitors open the Pages URL and run the pipeline **without any key**.

## One-time setup

### 1. Get a Gemini API key
Create a free key at <https://aistudio.google.com/app/apikey>.

### 2. Create the live data source (Google Sheet)
1. Go to <https://sheets.google.com> and create a blank spreadsheet.
2. **File → Import** → upload `data/vivaha_vendors.csv` (a synthetic 48-vendor
   marketplace dataset — it is *not* hardcoded anywhere; it is read at query time).
3. **Share** → "Anyone with the link" → **Viewer**.
4. Copy the share link (`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit…`).

### 3. Deploy the backend to Render
1. Push this folder to GitHub.
2. Go to <https://dashboard.render.com> → **New → Blueprint** → select the repo
   (it reads `render.yaml`), or **New → Web Service** with:
   - Root directory: `server`
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn --bind 0.0.0.0:$PORT app:app`
3. Set the environment variables:
   - `GEMINI_API_KEY` — your Gemini key (secret; never committed)
   - `VENDOR_SHEET_URL` — the Google Sheet share link from step 2
   - `ALLOWED_ORIGINS` — `*` (or your Pages origin)
4. Copy your service URL, e.g. `https://vivaha-ai-api.onrender.com`.

### 4. Point the frontend at the backend
In `config.js`, set:
```js
API_BASE: "https://vivaha-ai-api.onrender.com",
USE_BACKEND: true,
```

### 5. Deploy the frontend to GitHub Pages
Repo → **Settings → Pages** → source = `main` branch (root).
Your live prototype is at `https://<username>.github.io/<repo>/`.

> Note: Render's free tier sleeps after ~15 min of inactivity, so the first request
> after a pause may take ~30–60 s to wake up. Keep the Pages site and the backend
> (and the Google Sheet) live for **at least 8 weeks** after submission.

## Running locally (optional, without the backend)

Set `USE_BACKEND: false` in `config.js`, open `index.html`, and supply a Gemini key +
Google Sheet link in the "Advanced" section. This calls Gemini directly from the browser.

## Security / requirements checklist

- ✅ At least one agent connects to a **live external data source** via a **tool call**
  (`fetch_live_vendor_database` → the backend reads the Google Sheet at query time).
- ✅ Synthetic data lives in a **real queryable source** (Google Sheet) and is fetched
  dynamically — never hardcoded or cached.
- ✅ No API keys or secrets are committed (the Gemini key is a Render env var).
- ✅ Visitors can run the pipeline with **no key or setup** (backend holds credentials).
- ✅ Works as a static GitHub Pages site with a live interaction.

## Project structure

```
vivaha-ai/
├── index.html        # UI
├── styles.css        # styling
├── config.js         # API_BASE / USE_BACKEND (point at your Render URL)
├── agents.js         # the five agents (system prompts + tool declaration)
├── app.js            # orchestration, Gemini calls, live-data fetch, markdown renderer
├── main.js           # UI wiring
├── render.yaml       # Render Blueprint (deploys the backend)
├── server/
│   ├── app.py        # Flask backend (hides the key, reads the Sheet server-side)
│   └── requirements.txt
├── data/
│   └── vivaha_vendors.csv   # synthetic vendor marketplace (import into Google Sheets)
└── README.md
```

## Citing the AI usage

Built with **Google Gemini** (models: `gemini-2.5-flash` default, configurable in the UI).
System prompts authored to define the five agent archetypes; the pipeline orchestration,
the live-data tool call, and the evaluation of outputs are the author's own design work.

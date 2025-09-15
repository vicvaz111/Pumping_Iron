Pumping Iron
===========

Mobile-first workout tracker SPA with localStorage persistence and optional Postgres API.

Quick start (local)
- Open `index.html` in a browser.

Deploy to GitHub Pages
- Commit and push this repository to GitHub.
- In your repo: Settings → Pages → Build and deployment:
  - Source: Deploy from a branch
  - Branch: `main` (or your default), folder: `/ (root)`
- The site will be available at `https://<your-user>.github.io/<repo>/`.

Notes for Pages
- The app is fully static and works offline using `localStorage`.
- It attempts a health check at `/api/health` to detect an API; on Pages this returns 404 and the app automatically falls back to local mode.
- `404.html` is included to gracefully handle deep links on Pages.

Optional server + Postgres (not used on Pages)
- A minimal Express API is provided under `server/` for Neon/Postgres.
- To run locally:
  - `cp .env.example server/.env`
  - `cd server && npm install && npm start`
  - Open `http://localhost:3000/` to use the API mode.


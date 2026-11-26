# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Imperial** is a crowd-sourced beer price tracker for Lisbon — a static single-page application with no build step, using plain HTML, CSS, and vanilla JavaScript (ES modules), backed by Firebase (Firestore + Auth + App Check).

## Commands

```bash
npm run dev      # Local dev server at http://localhost:5173 (uses real Firebase)
npm run deploy   # Deploy hosting + Firestore rules to Firebase
npm run seed     # Bulk-load venues from data/venues.json into Firestore
                 # Requires: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run seed
```

There is no build step, no linter, and no test suite — changes are verified manually against the running dev server.

## Architecture

```
index.html          # Single entry point; loads src/app.js as ES module
src/
  app.js            # All UI logic: state, model, rendering, event handlers (~2000 lines)
  map.js            # Map view: lazy-loads Leaflet (unpkg) + CARTO tiles, draws price pins
  store.js          # Firebase init, Auth, Firestore real-time listeners, write fns
  config.js         # Firebase web config + reCAPTCHA Enterprise site key
  style.css         # Responsive CSS, light/dark mode via CSS custom properties
scripts/seed.mjs    # Node.js script using firebase-admin to populate Firestore
data/venues.json    # ~20 starting bars with estimated prices
firestore.rules     # Firestore security rules
firebase.json       # Hosting config (serves repo root) + Firestore rules reference
```

## Firestore Data Model

| Collection | Key fields | Who writes |
|------------|------------|------------|
| `venues/{id}` | `name, area, kind, beer, est: { eur, cl }, loc: { lat, lng }, at` | Admins only |
| `reports/{uid}` | `{ items: [...], venues: [...], updatedAt }` | Each user writes their own doc |
| `mod/state` | `{ hiddenReports, hiddenUsers, hiddenVenues }` | Admins only |
| `admins/{uid}` | `{ name? }` | Manual creation in Firestore console |

## Key Logic in `app.js`

- **Price calculation**: Median of the 3 most recent reports from the last 6 months. Each unique user's latest submission counts once. Falls back to oldest report, then to the estimate from `venues`.
- **Happy hour**: Latest happy-hour report wins; detection uses `Europe/Lisbon` timezone (hardcoded).
- **State flow**: `model()` applies filters → `view()` applies search/sort → `render()` builds DOM. UI preferences (sort, area, filter) are persisted to `localStorage`.
- **Moderation**: Hidden content is filtered client-side by reading `mod/state`; not enforced server-side.

## Auth Model

- **Anonymous auth** for all reporters (low friction).
- **Google OAuth** for moderators — moderator status is checked by reading `admins/{uid}` after sign-in.
- To create a moderator: manually add a document at `admins/<uid>` in Firestore console.

## Firebase Setup Notes

- `src/config.js` holds the Firebase web config — safe to commit, access is controlled by Firestore rules.
- App Check (reCAPTCHA Enterprise) is enabled in production; the site key is in `src/config.js`.
- Local dev (`localhost`) is whitelisted as an auth domain.
- Firestore region: `eur3` / `europe-west1`.

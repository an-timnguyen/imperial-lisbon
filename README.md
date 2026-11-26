# Imperial

Crowd-sourced beer prices in Lisbon, ranked per half litre. Inspired by Norway's [Pilsguiden](https://www.pilsguiden.no/).

A static site (plain HTML, CSS and ES modules, no build step) backed by Firebase: Firestore stores the data, and Auth signs reporters in anonymously and moderators in with Google.

## How prices work

- Anyone can report a price. Visitors are signed in anonymously in the background, so no account is needed.
- Each person's latest report for a bar counts once.
- The shown price is the median of the three most recent reports from the last six months. If every report is older, the latest one is shown and marked "old". A bar nobody has reported shows its estimate, marked "est.".
- Happy hour uses the newest happy-hour report (days, from, to).
- A price that works out to under €0,75 or over €25 per 0,5 L is rejected, and the same person can't report the same bar twice within 10 minutes.
- Moderators can hide a report, everything from one person, or a bar.

## Project layout

```
index.html          markup
src/style.css       styles (light and dark)
src/app.js          UI and price logic
src/store.js        Firebase auth + Firestore reads/writes
src/config.js       your Firebase web config  ← edit this
firestore.rules     security rules
data/venues.json    starting bars (prices are estimates)
scripts/seed.mjs    loads venues.json into Firestore
```

## Setup

1. **Create a Firebase project** at https://console.firebase.google.com.
2. **Add a web app** (Project settings → Your apps → Web), and paste its config into `src/config.js`.
3. **Firestore:** Build → Firestore Database → Create database (production mode, region `eur3` or `europe-west1`).
4. **Auth:** Build → Authentication → Sign-in method → enable **Anonymous** and **Google**. Under Settings → Authorized domains, add the domain you'll deploy to.
5. **Deploy the rules and the site:**
   ```sh
   cp .firebaserc.example .firebaserc   # put your project id in it
   npx firebase-tools login
   npm run deploy
   ```
6. **Seed the starting bars.** In Project settings → Service accounts → Generate new private key, save the key as `service-account.json` in the project root (it's gitignored). Then run:
   ```sh
   npm install
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run seed
   ```
7. **Make yourself a moderator.** Open the site, click "Moderator sign-in" in the footer and sign in with Google. Then copy your UID from Authentication → Users, and create a Firestore document `admins/<your-uid>`. It can be empty, or hold `{ "name": "you" }`. Reload the page and the Hide buttons appear.

## Run locally

```sh
npm run dev   # http://localhost:5173
```

It uses your real Firebase project, so add `localhost` to Auth's authorized domains (it's there by default).

## Hosting elsewhere

The site is static, so GitHub Pages, Netlify, Vercel or Cloudflare Pages all work: serve the repo root. Deploy `firestore.rules` with `npx firebase-tools deploy --only firestore:rules` either way, and add the host's domain to Auth's authorized domains.

## Before going public

- Turn on **App Check** (reCAPTCHA Enterprise) for Firestore and Auth. It stops scripts from posting reports with throwaway anonymous accounts.
- Set a **budget alert** in Google Cloud. The free tier covers a lot, but every visitor reads all report docs, so cost grows with the number of reporters. Past a few thousand reporters, move the price calculation to a Cloud Function that writes one summary doc.
- The prices in `data/venues.json` are rough estimates and haven't been checked. Replace them as real reports come in.

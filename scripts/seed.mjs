// Load data/venues.json into Firestore's venues collection.
// Usage: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run seed
import { readFile } from "node:fs/promises";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const venues = JSON.parse(await readFile(new URL("../data/venues.json", import.meta.url), "utf8"));

const batch = db.batch();
for (const { id, ...v } of venues) batch.set(db.collection("venues").doc(id), v, { merge: true });
await batch.commit();
console.log(`Seeded ${venues.length} venues.`);

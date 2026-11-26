// Data layer: Firebase Auth (anonymous for reporters, Google for moderators) + Firestore.
//
// Firestore layout
//   venues/<id>     starting bars, written by admins / the seed script
//   reports/<uid>   one doc per person: { items: [report], venues: [bar they added], updatedAt }
//   mod/state       { hiddenReports: [], hiddenUsers: [], hiddenVenues: [] }, admins only
//   admins/<uid>    exists = this user is a moderator (create by hand in the console)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, getDoc, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { firebaseConfig, recaptchaSiteKey } from "./config.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app-check.js";


const MAX_ITEMS = 300;
const arr = (x) => (Array.isArray(x) ? x : []);

const app = initializeApp(firebaseConfig);
if (location.hostname === "localhost") self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
  isTokenAutoRefreshEnabled: true,
});
const auth = getAuth(app);
const db = getFirestore(app);

export const session = { uid: null, isAdmin: false, isAnonymous: true };

/** Start auth + live subscriptions. Callbacks receive plain data. */
export function start({ onVenues, onReports, onMod, onSession, onError }) {
  onSnapshot(collection(db, "venues"),
    (s) => onVenues(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
  onSnapshot(collection(db, "reports"),
    (s) => onReports(new Map(s.docs.map((d) => [d.id, d.data() || {}]))), onError);
  onSnapshot(doc(db, "mod", "state"),
    (s) => onMod(s.exists() ? s.data() : {}), onError);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try { await signInAnonymously(auth); } catch (e) { onError(e); }
      return;
    }
    session.uid = user.uid;
    session.isAnonymous = user.isAnonymous;
    session.isAdmin = false;
    if (!user.isAnonymous) {
      try { session.isAdmin = (await getDoc(doc(db, "admins", user.uid))).exists(); } catch { /* not admin */ }
    }
    onSession({ ...session });
  });
}

/** Read-modify-write your own reports doc in a transaction. */
export async function writeMine(fn) {
  if (!session.uid) throw Object.assign(new Error("Not signed in"), { code: "unauthenticated" });
  const ref = doc(db, "reports", session.uid);
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    const d = cur.exists() ? cur.data() : {};
    const next = { items: [...arr(d.items)], venues: [...arr(d.venues)] };
    fn(next);
    next.items = next.items.sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
    tx.set(ref, { ...next, updatedAt: serverTimestamp() });
  });
}

/** Moderators only: hide reports, people or bars. */
export async function writeMod(fn) {
  const ref = doc(db, "mod", "state");
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    const d = cur.exists() ? cur.data() : {};
    const next = {
      hiddenReports: [...arr(d.hiddenReports)],
      hiddenUsers: [...arr(d.hiddenUsers)],
      hiddenVenues: [...arr(d.hiddenVenues)],
    };
    fn(next);
    tx.set(ref, next);
  });
}

export async function moderatorSignIn() {
  await signInWithPopup(auth, new GoogleAuthProvider());
}
export async function moderatorSignOut() {
  await signOut(auth); // onAuthStateChanged signs back in anonymously
}

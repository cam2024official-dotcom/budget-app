// Live sync between devices through Firebase (Firestore + email/password sign-in).
// The app keeps working from its in-memory `db`; this file mirrors every change to the
// shared household in the cloud and applies changes made on the other phone.
'use strict';
const Sync = (() => {
  const FB_VER = '10.12.2';
  const COLS = ['categories', 'transactions', 'bills', 'goals'];
  const ORDERED = ['categories', 'goals'];
  const CHUNK = 400; // Firestore allows 500 writes per batch
  let fb = null, auth = null, fs = null, user = null;
  let unsubs = [], last = {}, ready = false, status = 'off', started = false;
  const statusFns = new Set();

  const setStatus = s => { if (s === status) return; status = s; statusFns.forEach(f => f(s)); };
  const stable = v => {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  };
  const home = () => fb.doc(fs, 'households', 'home');
  const col = c => fb.collection(fs, 'households', 'home', c);
  const enabled = () => !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);

  async function loadSdk() {
    if (window.__fbMock) return window.__fbMock;
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
    const [app, a, f] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
    return { ...app, ...a, ...f };
  }

  async function init() {
    if (!enabled() || started) return;
    started = true;
    setStatus('connecting');
    try { fb = await loadSdk(); }
    catch (e) {
      started = false; setStatus('offline');
      window.addEventListener('online', init, { once: true });
      return;
    }
    const app = fb.initializeApp(window.FIREBASE_CONFIG);
    auth = fb.getAuth(app);
    try {
      fs = fb.initializeFirestore(app, { ignoreUndefinedProperties: true,
        localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
    } catch (e) { fs = fb.getFirestore(app); }
    fb.onAuthStateChanged(auth, u => {
      detach(); user = u;
      if (u) start(); else setStatus('signedout');
    });
  }

  async function start() {
    setStatus('connecting');
    const flag = 'budget-sync-joined:' + user.uid;
    let joined = false;
    try { joined = localStorage.getItem(flag) === '1'; } catch (e) {}
    if (!joined) {
      try { await join(); try { localStorage.setItem(flag, '1'); } catch (e) {} }
      catch (e) {
        console.error(e);
        if (e && e.code === 'permission-denied') { setStatus('denied'); return; }
        setStatus('offline');
        window.addEventListener('online', () => { if (user) start(); }, { once: true });
        return;
      }
    }
    attach();
  }

  // First sign-in on this phone: share what's here, or bring it into the existing shared budget.
  async function join() {
    const catSnap = await fb.getDocsFromServer(col('categories'));
    if (catSnap.empty) {
      await writeOps(fullOps(db));
      toast('Your budget is now shared ✓');
      return;
    }
    const cloudCats = catSnap.docs.map(d => d.data());
    const [txS, billS, goalS] = await Promise.all(['transactions', 'bills', 'goals'].map(c => fb.getDocsFromServer(col(c))));
    const ids = s => new Set(s.docs.map(d => d.id));
    const txIds = ids(txS), billIds = ids(billS), goalIds = ids(goalS);
    const mapCat = id => {
      if (cloudCats.some(c => c.id === id)) return id;
      const local = db.categories.find(c => c.id === id);
      if (!local) return null;
      const m = cloudCats.find(c => String(c.name).trim().toLowerCase() === String(local.name).trim().toLowerCase());
      return m ? m.id : null;
    };
    const newTx = db.transactions.filter(t => !txIds.has(t.id));
    const newBills = db.bills.filter(b => !billIds.has(b.id));
    const newGoals = db.goals.filter(g => !goalIds.has(g.id));
    const n = newTx.length + newBills.length + newGoals.length;
    if (n && confirm(`Signed in! Add ${n} item${n > 1 ? 's' : ''} from this phone to your shared budget?\n\nChoose Cancel to just use the shared budget.`)) {
      const ops = [];
      newTx.forEach(t => ops.push(['set', 'transactions', { ...t, catId: t.catId ? mapCat(t.catId) : null }]));
      newBills.forEach(b => ops.push(['set', 'bills', { ...b, catId: b.catId ? mapCat(b.catId) : null }]));
      const goalCount = goalIds.size;
      newGoals.forEach((g, i) => ops.push(['set', 'goals', { ...g, order: goalCount + i }]));
      await writeOps(ops);
    }
  }

  function fullOps(d) {
    const ops = [['settings', d.settings]];
    COLS.forEach(c => d[c].forEach((x, i) => ops.push(['set', c, ORDERED.includes(c) ? { ...x, order: i } : x])));
    return ops;
  }

  async function writeOps(ops) {
    for (let i = 0; i < ops.length; i += CHUNK) {
      const batch = fb.writeBatch(fs);
      ops.slice(i, i + CHUNK).forEach(([kind, c, x]) => {
        // Replace (not merge) so removed keys, like a cleared custom-hours entry, are removed in the cloud too
        if (kind === 'settings') batch.set(home(), { settings: c });
        else if (kind === 'set') batch.set(fb.doc(col(c), x.id), x);
        else batch.delete(fb.doc(col(c), x));
      });
      await batch.commit();
    }
  }

  function attach() {
    const waiting = new Set([...COLS, 'settings']);
    const meta = {};
    const arrived = (key, m) => {
      meta[key] = m;
      if (waiting.delete(key) && !waiting.size) ready = true;
      const all = Object.values(meta);
      setStatus(all.some(x => x.hasPendingWrites) ? 'pending' : all.some(x => x.fromCache) ? 'offline' : 'synced');
      scheduleRender();
    };
    unsubs.push(fb.onSnapshot(home(), { includeMetadataChanges: true }, s => {
      const st = s.exists() ? s.data().settings : null;
      if (st) { db.settings = { ...db.settings, ...st }; last.settings = stable(db.settings); }
      arrived('settings', s.metadata);
    }, onError));
    COLS.forEach(c => unsubs.push(fb.onSnapshot(col(c), { includeMetadataChanges: true }, s => {
      let items = s.docs.map(d => d.data());
      if (ORDERED.includes(c)) items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      db[c] = items;
      last[c] = new Map(items.map(x => [x.id, stable(x)]));
      arrived(c, s.metadata);
    }, onError)));
  }

  function detach() { unsubs.forEach(u => u()); unsubs = []; ready = false; last = {}; }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => { renderQueued = false; saveLocal(); render(); }, 16);
  }

  function onError(e) {
    console.error(e);
    if (e && e.code === 'permission-denied') setStatus('denied');
    else setStatus('offline');
  }

  // Called after every local change: send only what changed.
  function push() {
    if (!user || !ready) return;
    ORDERED.forEach(c => db[c].forEach((x, i) => { x.order = i; }));
    const ops = [];
    COLS.forEach(c => {
      const prev = last[c] || new Map(), seen = new Set(), next = new Map();
      db[c].forEach(x => {
        const s = stable(x);
        seen.add(x.id); next.set(x.id, s);
        if (prev.get(x.id) !== s) ops.push(['set', c, x]);
      });
      prev.forEach((_, id) => { if (!seen.has(id)) ops.push(['del', c, id]); });
      last[c] = next;
    });
    const ss = stable(db.settings);
    if (ss !== last.settings) { ops.push(['settings', db.settings]); last.settings = ss; }
    if (ops.length) writeOps(ops).catch(onError);
  }

  async function signIn(email, password) { return fb.signInWithEmailAndPassword(auth, email.trim(), password); }
  async function signOut() { await fb.signOut(auth); }
  async function resetPassword(email) { return fb.sendPasswordResetEmail(auth, email.trim()); }
  function errorText(e) {
    const code = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return 'That email or password is not right.';
    if (/too-many-requests/.test(code)) return 'Too many tries. Wait a few minutes and try again.';
    if (/network/.test(code)) return 'No internet connection. Try again when you are online.';
    if (/user-disabled/.test(code)) return 'This account has been turned off.';
    return 'Something went wrong. Please try again.';
  }

  return {
    init, push, signIn, signOut, resetPassword, errorText,
    get enabled() { return enabled(); },
    get user() { return user; },
    get status() { return status; },
    get live() { return !!user && ready; },
    onStatus(fn) { statusFns.add(fn); }
  };
})();

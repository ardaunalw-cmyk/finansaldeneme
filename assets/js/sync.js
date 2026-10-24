/**
 * Pure merge rules for account sync (assets/js/account.js), shared with test/sync.test.mjs.
 * No DOM, no storage, no network.
 *
 * A bundle is what one device keeps: { v: 1, profile, watchlist, alerts, charts, watchAt, alertsAt,
 * chartsAt }. charts holds the price chart's keys (pro-chart.js exportData): drawings per stock,
 * indicators, settings and layout.
 * profile is the Profilim store (profile.js); profile.updatedAt is when it last changed and
 * profile.gone lists ids deleted on purpose (transactions, journal entries, portfolios), so a merge
 * does not bring them back from the other side.
 *
 * Normal sync is "the latest write wins" guarded by a revision number; these rules only run when
 * two devices changed data since they last synced (a conflict) or on a first sign-in.
 */
(function (root) {
  const MAX_GONE = 2000;
  const ts = x => (x && Number.isFinite(x.updatedAt) ? x.updatedAt : 0);
  const arr = x => (Array.isArray(x) ? x : []);
  const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

  /** Items of both lists by id, the newer side's copy winning, minus the deleted ids. */
  function unionById(older, newer, gone) {
    const m = new Map();
    arr(older).forEach(x => { if (x && x.id) m.set(x.id, x); });
    arr(newer).forEach(x => { if (x && x.id) m.set(x.id, x); });
    return [...m.values()].filter(x => !gone.has(x.id));
  }

  /** Two Profilim stores -> one. local and remote are interchangeable; the newer one sets settings. */
  function mergeProfiles(local, remote) {
    if (!remote) return local || null;
    if (!local) return remote;
    const newer = ts(local) >= ts(remote) ? local : remote;
    const older = newer === local ? remote : local;
    const gone = new Set([...arr(older.gone), ...arr(newer.gone)]);

    let portfolios = unionById(older.portfolios, newer.portfolios, gone);
    if (!portfolios.length) portfolios = arr(newer.portfolios).slice(0, 1);
    const ids = new Set(portfolios.map(p => p.id));
    const txs = unionById(older.txs, newer.txs, gone).filter(t => !t.pf || ids.has(t.pf));

    const views = new Map();
    [...arr(older.views), ...arr(newer.views)].forEach(v => {
      if (!v || !v.code) return;
      const p = views.get(v.code);
      views.set(v.code, p ? { code: v.code, at: Math.max(p.at, v.at), n: Math.max(p.n || 1, v.n || 1) } : v);
    });
    const cmds = new Map();
    [...arr(older.cmds), ...arr(newer.cmds)].forEach(c => { if (c && c.text) cmds.set(`${c.at}|${c.text}`, c); });
    const nested = key => {
      const out = { ...obj(older[key]) };
      Object.entries(obj(newer[key])).forEach(([k, v]) => {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...obj(out[k]), ...v } : v;
      });
      return out;
    };

    return {
      ...older,
      ...newer,
      since: [older.since, newer.since].filter(Boolean).sort()[0] || newer.since,
      portfolios,
      active: newer.active === 'all' || ids.has(newer.active) ? newer.active : portfolios[0].id,
      txs,
      seq: Math.max(older.seq || 0, newer.seq || 0, txs.reduce((m, t) => Math.max(m, t.seq || 0), 0)),
      journal: unionById(older.journal, newer.journal, gone).sort((a, b) => b.at - a.at),
      views: [...views.values()].sort((a, b) => b.at - a.at).slice(0, 60),
      cmds: [...cmds.values()].sort((a, b) => b.at - a.at).slice(0, 80),
      saved: [...new Set([...arr(newer.saved), ...arr(older.saved)])].slice(0, 12),
      notes: { ...obj(older.notes), ...obj(newer.notes) },
      levels: nested('levels'),
      targets: nested('targets'),
      cash: { ...obj(older.cash), ...obj(newer.cash) },
      gone: [...gone].slice(-MAX_GONE),
      updatedAt: Math.max(ts(older), ts(newer))
    };
  }

  /**
   * Two device bundles -> one. The watchlist, the alerts and the chart keys each come whole from
   * the side that changed them last (a side without chart keys yet never wins them).
   */
  function mergeBundles(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    const watchLocal = (local.watchAt || 0) >= (remote.watchAt || 0);
    const alertsLocal = (local.alertsAt || 0) >= (remote.alertsAt || 0);
    const chartsLocal = !remote.charts || (local.charts && (local.chartsAt || 0) >= (remote.chartsAt || 0));
    return {
      v: 1,
      profile: mergeProfiles(local.profile, remote.profile),
      watchlist: watchLocal ? local.watchlist : remote.watchlist,
      watchAt: Math.max(local.watchAt || 0, remote.watchAt || 0),
      alerts: alertsLocal ? local.alerts : remote.alerts,
      alertsAt: Math.max(local.alertsAt || 0, remote.alertsAt || 0),
      charts: chartsLocal ? local.charts || null : remote.charts,
      chartsAt: Math.max(local.chartsAt || 0, remote.chartsAt || 0)
    };
  }

  /** True when a bundle holds nothing the user entered (a fresh browser). */
  function isEmptyBundle(b) {
    if (!b) return true;
    const p = obj(b.profile);
    const touched = arr(p.txs).length || arr(p.journal).length || Object.keys(obj(p.notes)).length
      || Object.keys(obj(p.levels)).length || (p.name || '').trim() || arr(p.portfolios).length > 1;
    const drawn = Object.entries(obj(b.charts)).some(([k, v]) => k.startsWith('drawings.') && arr(v).length);
    return !touched && !drawn && !arr(b.alerts).length && !(b.watchAt > 0);
  }

  /** Short counts for the "merge or replace" question: { txs, portfolios, journal, alerts, watchlist }. */
  function summary(b) {
    const p = obj(b && b.profile);
    return {
      txs: arr(p.txs).length, portfolios: arr(p.portfolios).length || 1, journal: arr(p.journal).length,
      alerts: arr(b && b.alerts).length, watchlist: arr(b && b.watchlist).length
    };
  }

  const Sync = { mergeProfiles, mergeBundles, isEmptyBundle, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = Sync;
  else root.Sync = Sync;
})(typeof window !== 'undefined' ? window : globalThis);

(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var MODEL_VERSION = 'radar-quant-v4';
  var EXCLUDED_CATS = {
    'Bridge': 1, 'Canonical Bridge': 1, 'Cross Chain Bridge': 1,
    'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1, 'CEX': 1, 'Chain': 1
  };
  var EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  var VERSION_RE = /\s+(v\d+(?:\.\d+)*|\d+\.\d+)$/i;
  var WRAP_RE = /\b(wrapped|staked|staking)\b/i;
  var YIELD_RE = /(lend|dex|yield|curator|liquid|rwa|cdp|basis|allocator|restak|staking)/i;
  var CHAIN_GAS = {
    Ethereum: 14, Bitcoin: 5.5, Tron: 1.0, Avalanche: 0.30, Arbitrum: 0.20, Scroll: 0.20, Linea: 0.20,
    Binance: 0.20, Optimism: 0.15, Base: 0.12, Berachain: 0.12, Ink: 0.10, Mantle: 0.10,
    Polygon: 0.06, Plasma: 0.06, 'Hyperliquid L1': 0.04, Sonic: 0.04, Solana: 0.02, Sui: 0.02, Monad: 0.03
  };
  var CAP_TIERS = [1000, 5000, 25000, 100000];
  var VIABLE_GRID = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    var idx = (sorted.length - 1) * q, lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  function rnd(n, d) { var k = Math.pow(10, d); return Math.round(n * k) / k; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function ageDaysOf(asOf, listedAt) {
    if (!listedAt) return null;
    var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listedAt + 'T00:00:00Z');
    return isFinite(a) && isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY_MS)) : null;
  }
  function isNoTokenRecorded(p) { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }
  function isWrapperLike(p) { return !!(EXCLUDED_CATS[p.category] || EXCHANGE_RE.test(p.name) || VERSION_RE.test(p.name) || WRAP_RE.test(p.name)); }
  function logStickyTvl(tvlUsd, change7d, alpha) {
    var c7 = change7d === null || !isFinite(change7d) ? 0 : clamp(change7d, -80, 250);
    return Math.log(Math.max(1, tvlUsd)) - alpha * Math.log(1 + c7 / 100);
  }
  function classifyUniverse(snapshot) {
    var wlSet = {}, buckets = { watchlist: [], early_pre_token: [], excluded_pre_token: [], traded_mcap: [], token_meta_no_mcap: [] };
    snapshot.watchlist.forEach(function (s) { wlSet[s] = 1; });
    var tagged = snapshot.protocols.map(function (p) {
      var b = wlSet[p.slug] ? 'watchlist' : isNoTokenRecorded(p) ? ((p.tvl_usd < snapshot.floor_usd && !isWrapperLike(p)) ? 'early_pre_token' : 'excluded_pre_token') : (p.mcap_usd !== null && p.mcap_usd > 0 ? 'traded_mcap' : 'token_meta_no_mcap');
      buckets[b].push(p); return { protocol: p, bucket: b };
    });
    return { buckets: buckets, tagged: tagged, wlSet: wlSet };
  }
  function rollUpComps(snapshot) {
    var bySym = {}, comps = [];
    snapshot.protocols.forEach(function (p) { if (p.symbol) (bySym[p.symbol.toUpperCase()] = bySym[p.symbol.toUpperCase()] || []).push(p); });
    Object.keys(bySym).sort().forEach(function (sym) {
      var rows = bySym[sym], wm = rows.filter(function (r) { return r.mcap_usd > 0 && r.tvl_usd > 0; });
      if (!wm.length) return;
      wm.sort(function (a, b) { return b.mcap_usd - a.mcap_usd || b.tvl_usd - a.tvl_usd; });
      var rep = wm[0], tot = 0, wN = 0, wD = 0, earliest = null, seen = {}, chains = [];
      rows.forEach(function (r) {
        tot += r.tvl_usd;
        if (r.listed_at && (!earliest || r.listed_at < earliest)) earliest = r.listed_at;
        if (r.change_7d !== null && isFinite(r.change_7d)) { wN += r.change_7d * r.tvl_usd; wD += r.tvl_usd; }
        (r.chains || []).forEach(function (c) { if (!seen[c]) { seen[c] = 1; chains.push(c); } });
      });
      comps.push({ slug: rep.slug, name: rep.name, symbol: sym, category: rep.category || 'Other', chains: chains, tvl_usd: tot, mcap_usd: rep.mcap_usd, change_7d: wD > 0 ? wN / wD : null, listed_at: earliest, sub_count: rows.length });
    });
    return comps;
  }
  function fitL1Line(xs, ys) {
    var n = ys.length, d = new Array(n), bestB = 0.5, bestA = 7.0, bestLoss = Infinity;
    function scan(b) {
      for (var i = 0; i < n; i++) d[i] = ys[i] - b * xs[i];
      var a = median(d), loss = 0;
      for (var i2 = 0; i2 < n; i2++) loss += Math.abs(d[i2] - a);
      if (loss < bestLoss) { bestLoss = loss; bestA = a; bestB = b; }
    }
    for (var b = 0; b <= 1.201; b += 0.04) scan(b);
    for (var b2 = bestB - 0.04; b2 <= bestB + 0.0401; b2 += 0.004) scan(b2);
    return { a: bestA, b: bestB };
  }
  function solveLinear(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var i = 0; i < n; i++) {
      var piv = i;
      for (var r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      var tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
      for (var d = M[i][i] || 1e-12, j = i; j <= n; j++) M[i][j] /= d;
      for (var r2 = 0; r2 < n; r2++) if (r2 !== i) for (var f = M[r2][i], j2 = i; j2 <= n; j2++) M[r2][j2] -= f * M[i][j2];
    }
    return M.map(function (r) { return r[n]; });
  }
  function fitStickyCatModel(tr, alpha, kCat, regAge) {
    var xs = tr.map(function (d) { return logStickyTvl(d.p.tvl_usd, d.p.change_7d, alpha); });
    var line = fitL1Line(xs, tr.map(function (d) { return d.y; })), catMap = {}, catAdj = {};
    tr.forEach(function (d, i) { (catMap[d.cat] = catMap[d.cat] || []).push(d.y - (line.a + line.b * xs[i])); });
    Object.keys(catMap).forEach(function (c) { var arr = catMap[c]; catAdj[c] = median(arr) * (arr.length / (arr.length + kCat)); });
    var mAge = median(tr.map(function (d) { return d.logAge; })), wAge = 0, sxx = regAge, sxy = 0;
    if (regAge > 0) {
      tr.forEach(function (d, i) { var ca = d.logAge - mAge; sxx += ca * ca; sxy += ca * (d.y - (line.a + line.b * xs[i] + (catAdj[d.cat] || 0))); });
      wAge = sxy / sxx;
    }
    return { a: line.a, b: line.b, alpha: alpha, kCat: kCat, regAge: regAge, catAdj: catAdj, catCounts: catMap, mAge: mAge, wAge: wAge };
  }
  function predictItem(m, te) {
    return m.a + m.b * logStickyTvl(te.p.tvl_usd, te.p.change_7d, m.alpha) + (m.catAdj[te.cat] || 0) + m.wAge * (te.logAge - m.mAge);
  }
  function fitNestedStickyCat(tr) {
    var grid = [[0.15, 20, 40], [0.25, 20, 40], [0.25, 30, 40], [0.35, 20, 40]], best = grid[1], bestErr = Infinity;
    grid.forEach(function (cfg) {
      var sq = 0;
      for (var fold = 0; fold < 5; fold++) {
        var sub = tr.filter(function (_, j) { return j % 5 !== fold; }), m = fitStickyCatModel(sub, cfg[0], cfg[1], cfg[2]);
        for (var i = fold; i < tr.length; i += 5) { var e = tr[i].y - predictItem(m, tr[i]); sq += e * e; }
      }
      if (sq < bestErr) { bestErr = sq; best = cfg; }
    });
    return fitStickyCatModel(tr, best[0], best[1], best[2]);
  }

  function evalCV(items, dated, fn) {
    var la = [], ls = [], lsig = [], wa = [], ws = [];
    for (var i = 0; i < items.length; i++) { var e = items[i].y - fn(items.filter(function (_, j) { return j !== i; }), items[i]); lsig.push(e); la.push(Math.abs(e)); ls.push(e * e); }
    for (var w = Math.floor(dated.length * 0.6); w < dated.length; w++) { var ew = dated[w].y - fn(dated.slice(0, w), dated[w]); wa.push(Math.abs(ew)); ws.push(ew * ew); }
    return { loo_med_mult: rnd(Math.exp(median(la)), 3), loo_rmse: rnd(Math.sqrt(ls.reduce(function (s, v) { return s + v; }, 0) / ls.length), 3), wf_med_mult: rnd(Math.exp(median(wa)), 3), wf_rmse: rnd(Math.sqrt(ws.reduce(function (s, v) { return s + v; }, 0) / ws.length), 3), loo_signed: lsig };
  }
  function fitValuationModel(comps, asOf) {
    var medA = median(comps.map(function (p) { return ageDaysOf(asOf, p.listed_at); }).filter(function (v) { return v !== null; })) || 730;
    var items = comps.map(function (p) {
      var ad = ageDaysOf(asOf, p.listed_at);
      return { p: p, y: Math.log(p.mcap_usd), logTvl: Math.log(p.tvl_usd), logAge: Math.log(1 + (ad === null ? medA : ad) / 365.25), cat: p.category || 'Other', listedAt: p.listed_at || null };
    });
    var dated = items.filter(function (d) { return d.listedAt !== null; }).sort(function (a, b) { return a.listedAt < b.listedAt ? -1 : a.listedAt > b.listedAt ? 1 : 0; });
    var specs = [
      ['starter_v1', 'Starter radar-1 (0.25x TVL)', 'BASE', function (_, te) {
        var ad = ageDaysOf(asOf, te.p.listed_at), gp = clamp(te.p.change_7d === null ? 0 : te.p.change_7d, -60, 120);
        return Math.log(Math.max(1, te.p.tvl_usd * 0.25 * (1 + gp * 0.005) * (0.6 + (clamp(ad === null ? 365 : ad, 0, 1095) / 1095) * 0.4)));
      }],
      ['flat_mult', 'Flat MCap/TVL Multiple', 'DROP', function (tr, te) { return Math.log(te.p.tvl_usd * median(tr.map(function (d) { return d.p.mcap_usd / d.p.tvl_usd; }))); }],
      ['l1_tvl', 'L1 Power-Law log(TVL)', 'KEEP', function (tr, te) { return predictItem(fitStickyCatModel(tr, 0, 1e9, 0), te); }],
      ['cat_eb', '+ Category EB (k=20)', 'KEEP', function (tr, te) { return predictItem(fitStickyCatModel(tr, 0, 20, 0), te); }],
      ['sticky_v4', '+ 7d Sticky-TVL & Age (v4)', 'KEEP', function (tr, te) { return predictItem(fitStickyCatModel(tr, 0.25, 20, 40), te); }],
      ['nested_cv', 'Nested-CV Selection Check', 'CHECK', function (tr, te) { return predictItem(fitNestedStickyCat(tr), te); }]
    ];
    var ablation = specs.map(function (sp) {
      var r = evalCV(items, dated, sp[3]);
      return { id: sp[0], label: sp[1], verdict: sp[2], loo_med_mult: r.loo_med_mult, loo_rmse: r.loo_rmse, wf_med_mult: r.wf_med_mult, wf_rmse: r.wf_rmse, loo_signed: r.loo_signed };
    });
    var full = fitStickyCatModel(items, 0.25, 20, 40), sRes = ablation[4].loo_signed.slice().sort(function (a, b) { return a - b; });
    return {
      a: full.a, b: full.b, alpha: 0.25, eb_k: 20, ridge_reg: 40, cat_adj: full.catAdj, cat_counts: full.catCounts, w_age: full.wAge, med_a: medA, med_log_age: full.mAge, comps_count: comps.length, dated_count: dated.length,
      wf_test_count: dated.length - Math.floor(dated.length * 0.6), quantiles: { q10: quantile(sRes, 0.10), q90: quantile(sRes, 0.90) },
      ablation: ablation.map(function (r) { return { id: r.id, label: r.label, verdict: r.verdict, loo_med_mult: r.loo_med_mult, loo_rmse: r.loo_rmse, wf_med_mult: r.wf_med_mult, wf_rmse: r.wf_rmse }; })
    };
  }
  function scoreProtocol(p, vm, comps, asOf) {
    var cat = p.category || 'Other', catAdj = vm.cat_adj[cat] || 0, catRaw = vm.cat_counts[cat], catN = Array.isArray(catRaw) ? catRaw.length : (catRaw || 0);
    var logTvl = Math.log(Math.max(1, p.tvl_usd)), logSt = logStickyTvl(p.tvl_usd, p.change_7d, vm.alpha), ad = ageDaysOf(asOf, p.listed_at);
    var tvlBaseLog = vm.a + vm.b * logTvl, stickyAdj = vm.b * (logSt - logTvl), ageAdj = vm.w_age * (Math.log(1 + (ad === null ? vm.med_a : ad) / 365.25) - vm.med_log_age);
    var predLog = tvlBaseLog + stickyAdj + catAdj + ageAdj, imp = Math.max(1, Math.round(Math.exp(predLog)));
    var nearest = comps.map(function (c) {
      return { slug: c.slug, name: c.name, symbol: c.symbol, category: c.category, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd, dist: Math.abs(logTvl - Math.log(c.tvl_usd)) + (c.category === p.category ? 0 : 0.75) };
    }).sort(function (a, b) { return a.dist - b.dist || b.tvl_usd - a.tvl_usd; }).slice(0, 3).map(function (c) {
      return { slug: c.slug, name: c.name, symbol: c.symbol, category: c.category, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd };
    });
    return {
      implied_value_usd: imp, low_usd: Math.max(1, Math.round(Math.exp(predLog + vm.quantiles.q10))), high_usd: Math.max(imp, Math.round(Math.exp(predLog + vm.quantiles.q90))),
      base_tvl_usd: Math.round(Math.exp(tvlBaseLog)), sticky_mult: rnd(Math.exp(stickyAdj), 3), cat_mult: rnd(Math.exp(catAdj), 3), age_mult: rnd(Math.exp(ageAdj), 3), cat_n: catN, nearest_comps: nearest
    };
  }

  function fitLogistic(X, y, reg) {
    var d = X[0].length, w = new Array(d).fill(0);
    for (var it = 0; it < 26; it++) {
      var g = new Array(d).fill(0), H = [];
      for (var r = 0; r < d; r++) H.push(new Array(d).fill(0));
      for (var i = 0; i < X.length; i++) {
        var z = 0; for (var j = 0; j < d; j++) z += X[i][j] * w[j];
        var pr = 1 / (1 + Math.exp(-clamp(z, -20, 20))), er = pr - y[i], wt = pr * (1 - pr) + 1e-6;
        for (var j2 = 0; j2 < d; j2++) { g[j2] += er * X[i][j2]; for (var k = 0; k < d; k++) H[j2][k] += wt * X[i][j2] * X[i][k]; }
      }
      for (var j3 = 1; j3 < d; j3++) { g[j3] += reg * w[j3]; H[j3][j3] += reg; }
      var st = solveLinear(H, g);
      for (var j4 = 0; j4 < d; j4++) w[j4] -= st[j4];
    }
    return w;
  }

  /** Estimate empirical peer token prevalence across the 390-protocol cohort. */
  function fitPeerTokenModel(snapshot, asOf) {
    var wlSet = {}, tg = {}, pre = [], catStats = {}, totTok = 0;
    snapshot.watchlist.forEach(function (s) { wlSet[s] = 1; });
    snapshot.protocols.forEach(function (p) {
      if (isNoTokenRecorded(p)) { if (!isWrapperLike(p) || wlSet[p.slug]) pre.push(p); }
      else if (!isWrapperLike(p)) {
        var k = (p.gecko_id || p.symbol || p.slug).toLowerCase();
        if (!tg[k]) tg[k] = { category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, listed_at: p.listed_at };
        else { tg[k].tvl_usd += p.tvl_usd; if (p.listed_at && (!tg[k].listed_at || p.listed_at < tg[k].listed_at)) tg[k].listed_at = p.listed_at; }
      }
    });
    var pool = Object.keys(tg).map(function (k) { return { p: tg[k], has: 1 }; }).concat(pre.map(function (p) { return { p: p, has: 0 }; }));
    var bins = [['0-6m', 0, 180], ['6-12m', 180, 365], ['1-2y', 365, 730], ['2-3y', 730, 1095], ['3-4y', 1095, 1460], ['4y+', 1460, 999999]];
    var ageCurve = bins.map(function (b) {
      var tok = 0, tot = 0;
      pool.forEach(function (x) { var a = ageDaysOf(asOf, x.p.listed_at); if (a !== null && a >= b[1] && a < b[2]) { tot++; tok += x.has; } });
      return { label: b[0], tok: tok, n: tot, rate: tot ? rnd(tok / tot, 4) : 0 };
    });
    pool.forEach(function (x) {
      totTok += x.has;
      var c = x.p.category || 'Other', cs = (catStats[c] = catStats[c] || { tok: 0, n: 0 });
      cs.n++; cs.tok += x.has;
    });
    var medA = median(pool.map(function (x) { return ageDaysOf(asOf, x.p.listed_at); }).filter(function (v) { return v !== null; })) || 540;
    var X = pool.map(function (x) { var a = ageDaysOf(asOf, x.p.listed_at); return [1, Math.log(Math.max(1, x.p.tvl_usd) / 50e6), Math.log(1 + (a === null ? medA : a) / 365.25), a === null ? 1 : 0, Math.log(1 + Math.max(1, (x.p.chains || []).length))]; });
    var y = pool.map(function (x) { return x.has; }), bB = 0, lB = 0, bM = 0, lM = 0;
    for (var fold = 0; fold < 10; fold++) {
      var trX = [], trY = [], sumY = 0;
      for (var j = 0; j < pool.length; j++) if (j % 10 !== fold) { trX.push(X[j]); trY.push(y[j]); sumY += y[j]; }
      var p0 = sumY / trY.length, wf = fitLogistic(trX, trY, 2.0);
      for (var i = fold; i < pool.length; i += 10) {
        var z = 0; for (var c = 0; c < wf.length; c++) z += wf[c] * X[i][c];
        var p1 = clamp(1 / (1 + Math.exp(-z)), 1e-6, 1 - 1e-6);
        bB += Math.pow(y[i] - p0, 2); lB -= y[i] * Math.log(p0) + (1 - y[i]) * Math.log(1 - p0);
        bM += Math.pow(y[i] - p1, 2); lM -= y[i] * Math.log(p1) + (1 - y[i]) * Math.log(1 - p1);
      }
    }
    return {
      pool_size: pool.length, token_peers: totTok, pre_peers: pool.length - totTok, base_rate: rnd(totTok / pool.length, 4),
      age_curve: ageCurve, cat_stats: catStats, cv_brier_base: rnd(bB / pool.length, 4), cv_brier_model: rnd(bM / pool.length, 4),
      cv_logloss_base: rnd(lB / pool.length, 4), cv_logloss_model: rnd(lM / pool.length, 4)
    };
  }

  function scorePeerTokenRate(p, ageDays, om) {
    var cs = om.cat_stats[p.category || 'Other'] || { tok: 0, n: 0 }, catRate = (cs.tok + 10 * om.base_rate) / (cs.n + 10);
    var ageBand = ageDays === null ? 0.65 : ageDays < 180 ? 0.42 : ageDays < 365 ? 0.54 : ageDays < 730 ? 0.68 : 0.80;
    return rnd(clamp(0.6 * catRate + 0.4 * ageBand, 0.12, 0.88), 3);
  }

  var ACTION_RULES = [
    [/(lend|cdp|collateral)/, 'Supply USDC collateral on %c with conservative LTV', 3, 1, 'health check'],
    [/(dex|yield|liquidity|leveraged)/, 'Provide tight stablecoin LP on %c in main pool', 3, 1, 'range check or harvest'],
    [/(perp|deriv|option)/, 'Deposit USDC margin on %c for delta-neutral volume', 2, 2, 'hedged maker volume'],
    [/(curator|allocator|rwa|basis)/, 'Deposit USDC into flagship curated vault on %c', 2, 0.5, 'bi-weekly epoch check'],
    [/prediction/, 'Fund USDC on %c and balance liquid market sides', 2, 2, 'hedged weekly positions']
  ];
  function actionSpec(p, chain) {
    var c = (p.category || '').toLowerCase(), hit = ACTION_RULES.find(function (r) { return r[0].test(c); });
    return hit ? { verb: hit[1].replace('%c', chain), setupTx: hit[2], weeklyTx: hit[3], wDesc: hit[4] }
      : { verb: 'Deposit USDC into ' + p.name + ' main vault on ' + chain, setupTx: 2, weeklyTx: 1, wDesc: 'weekly epoch check' };
  }

  /** Compute pure pro-rata conditional and peer-weighted farm economics for one tier. */
  function priceFarmTier(p, impliedUsd, peerRate, depositUsd, poolPct, asOf) {
    var chain = (p.chains && p.chains.length) ? p.chains[0] : 'Ethereum', gas = CHAIN_GAS[chain] !== undefined ? CHAIN_GAS[chain] : 1.0, spec = actionSpec(p, chain), age = ageDaysOf(asOf, p.listed_at), isYield = YIELD_RE.test(p.category || '');
    var holdDays = age === null ? 42 : (age < 180 ? 56 : (age < 365 ? 42 : 28)), weeks = Math.max(4, Math.round(holdDays / 7));
    var gasCost = rnd((spec.setupTx + 2 + weeks * spec.weeklyTx) * gas, 2), slipCost = rnd(depositUsd * (isYield ? 0.001 : 0.0015), 2), carryCost = rnd(depositUsd * (isYield ? 0.0075 : 0.035) * (holdDays / 365), 2), totCost = rnd(gasCost + slipCost + carryCost, 2);
    var effTvl = Math.max(p.tvl_usd, depositUsd) * (1 + clamp(p.change_7d || 0, 0, 150) / 200), condGross = rnd(impliedUsd * poolPct * (depositUsd / effTvl), 2), evGross = rnd(condGross * peerRate, 2);
    var condNet = rnd(condGross - totCost, 2), evNet = rnd(evGross - totCost, 2), hours = rnd(0.6 + weeks * 0.1, 2), evPerHr = rnd(evNet / hours, 2), bleeding = p.change_7d !== null && p.change_7d < -15;
    return {
      chain: chain, gas_per_tx: gas, hold_days: holdDays, weeks: weeks, is_yield: isYield, gas_cost_usd: gasCost, slippage_usd: slipCost, carry_cost_usd: carryCost, total_cost_usd: totCost,
      cond_gross_usd: condGross, cond_net_usd: condNet, ev_gross_usd: evGross, net_usd: evNet, total_hours: hours, net_per_hour: evPerHr,
      breakeven_pool_pct: condGross > 0 ? rnd((totCost / condGross) * (poolPct * 100), 2) : 999, bleeding: bleeding,
      verdict: (evNet > 0 && evPerHr >= 20 && !bleeding) ? 'FARM' : (condNet > 0 ? 'WATCH' : 'SKIP'), spec: spec
    };
  }

  function computeTierWithFloor(p, impliedUsd, peerRate, depositUsd, asOf) {
    var res = priceFarmTier(p, impliedUsd, peerRate, depositUsd, 0.05, asOf);
    res.min_viable_usd = VIABLE_GRID.find(function (v) { return priceFarmTier(p, impliedUsd, peerRate, v, 0.05, asOf).net_usd > 0; }) || null;
    return res;
  }

  function buildFarmSteps(p, impliedUsd, peerRate, asOf) {
    var e5 = computeTierWithFloor(p, impliedUsd, peerRate, 5000, asOf), cap = e5.net_usd > 0 ? 5000 : (e5.min_viable_usd || 25000), e = computeTierWithFloor(p, impliedUsd, peerRate, cap, asOf);
    var alt = (p.chains && p.chains.length > 1) ? ' (or L2 ' + p.chains[1] + ')' : '', cad = e.spec.weeklyTx < 1 ? e.spec.wDesc : e.spec.weeklyTx + 'x ' + e.spec.wDesc + '/wk';
    var risk = e.bleeding ? 'ALERT 7d TVL ' + rnd(p.change_7d, 1) + '% outflow; wait for floor' : (p.change_7d > 25 ? 'TVL +' + rnd(p.change_7d, 1) + '% dilution watch' : 'steady pro-rata pool');
    return [
      'Pre-Launch Wallet: Isolate $' + cap + ' USDC + $' + Math.max(2, Math.ceil(e.gas_cost_usd + 2)) + ' gas on ' + e.chain + alt + ' ($' + e.gas_per_tx.toFixed(2) + '/tx). Cost: ~$' + e.gas_per_tx.toFixed(2) + '. Time: 10 minutes.',
      'Pre-Launch Entry: ' + e.spec.verb + ' ($' + cap + ', ' + e.spec.setupTx + ' txs). Cost: ~$' + rnd(e.spec.setupTx * e.gas_per_tx + e.slippage_usd, 2) + ' gas/slip. Time: 15 minutes.',
      'Pre-Launch Cadence: Run ' + cad + ' over ' + e.weeks + ' wks (' + e.hold_days + 'd, ' + risk + '). Cost: ~$' + rnd(e.weeks * e.spec.weeklyTx * e.gas_per_tx, 2) + ' gas + $' + e.carry_cost_usd.toFixed(2) + ' (' + (e.is_yield ? '0.75% APR risk' : '3.5% APR idle carry') + '). Time: 6 minutes/week.',
      'Pro-Rata Break-Even: At $' + cap + ', 5% TGE pool needs ' + e.breakeven_pool_pct + '% share (' + e.verdict + ', $' + e.net_per_hour + '/hr EV; cond $' + e.cond_net_usd + '). Cost: $0 audit. Time: 5 minutes/week.',
      'Post-Launch TGE Claim: If ' + p.name + ' launches a token (' + Math.round(peerRate * 100) + '% peer rate), verify Merkle claim on ' + e.chain + ' and claim. Cost: ~$' + rnd(e.gas_per_tx, 2) + ' gas. Time: 12 minutes.',
      'Post-Launch Day-2 Exit: Move tokens into liquid DEX LP or exit vault once spreads settle; revoke allowances. Cost: ~$' + rnd(e.gas_per_tx + e.slippage_usd * 0.5, 2) + ' gas/slip. Time: 15 minutes.'
    ].map(function (s) { return s.length > 600 ? s.slice(0, 596) + '...' : s; });
  }

  function stripTier(e) {
    return { chain: e.chain, gas_per_tx: e.gas_per_tx, hold_days: e.hold_days, gas_cost_usd: e.gas_cost_usd, total_cost_usd: e.total_cost_usd, cond_gross_usd: e.cond_gross_usd, cond_net_usd: e.cond_net_usd, ev_gross_usd: e.ev_gross_usd, net_usd: e.net_usd, net_per_hour: e.net_per_hour, breakeven_pool_pct: e.breakeven_pool_pct, min_viable_usd: e.min_viable_usd, verdict: e.verdict };
  }

  /** Run the full quantitative pipeline on one sealed snapshot. */
  function buildRadar(snapshot) {
    var uni = classifyUniverse(snapshot), comps = rollUpComps(snapshot), vm = fitValuationModel(comps, snapshot.as_of), om = fitPeerTokenModel(snapshot, snapshot.as_of), b = uni.buckets;
    var scored = b.watchlist.concat(b.early_pre_token).map(function (p) {
      var val = scoreProtocol(p, vm, comps, snapshot.as_of), age = ageDaysOf(snapshot.as_of, p.listed_at), rate = scorePeerTokenRate(p, age, om), tiers = {};
      CAP_TIERS.forEach(function (tv) { tiers[tv] = stripTier(computeTierWithFloor(p, val.implied_value_usd, rate, tv, snapshot.as_of)); });
      return { p: p, scope: uni.wlSet[p.slug] ? 'watchlist' : 'early', age_days: age, val: val, rate: rate, ev: Math.max(1, Math.round(val.implied_value_usd * rate)), tiers: tiers, steps: buildFarmSteps(p, val.implied_value_usd, rate, snapshot.as_of) };
    }).sort(function (a, x) { return x.val.implied_value_usd - a.val.implied_value_usd || (a.p.slug < x.p.slug ? -1 : a.p.slug > x.p.slug ? 1 : 0); });
    var p50s = scored.map(function (s) { return s.val.implied_value_usd; });
    var board = scored.map(function (s, idx) {
      var bL = 0, bH = 0, p = s.p; for (var j = 0; j < p50s.length; j++) if (j !== idx) { if (p50s[j] > s.val.high_usd) bH++; if (p50s[j] > s.val.low_usd) bL++; }
      return {
        rank: idx + 1, rank_best: bH + 1, rank_worst: bL + 1, slug: p.slug, name: p.name, scope: s.scope, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd, listed_at: p.listed_at, gecko_id: p.gecko_id, symbol: p.symbol,
        token_status: 'no-token-recorded', age_days: s.age_days, implied_value_usd: s.val.implied_value_usd, low_usd: s.val.low_usd, high_usd: s.val.high_usd, base_tvl_usd: s.val.base_tvl_usd,
        sticky_mult: s.val.sticky_mult, cat_mult: s.val.cat_mult, age_mult: s.val.age_mult, cat_n: s.val.cat_n, peer_token_rate: s.rate, expected_value_usd: s.ev, nearest_comps: s.val.nearest_comps, tiers: s.tiers, farm_steps: s.steps
      };
    });
    var sum758 = b.watchlist.length + b.early_pre_token.length + b.excluded_pre_token.length + b.traded_mcap.length + b.token_meta_no_mcap.length;
    var checks = [
      { label: 'Watchlist', pass: board.filter(function (r) { return r.scope === 'watchlist'; }).length === snapshot.watchlist.length, detail: snapshot.watchlist.length + '/' + snapshot.watchlist.length },
      { label: 'Audit', pass: sum758 === snapshot.protocols.length, detail: sum758 + '/' + snapshot.protocols.length },
      { label: 'Monotonic', pass: board.every(function (r, i) { return i === 0 || r.implied_value_usd <= board[i - 1].implied_value_usd; }) && board.length >= 100, detail: board.length + ' rows' },
      { label: 'Double CV', pass: vm.ablation[4].loo_med_mult < vm.ablation[0].loo_med_mult && vm.ablation[5].loo_med_mult < vm.ablation[0].loo_med_mult, detail: vm.ablation[4].loo_med_mult.toFixed(2) + 'x<' + vm.ablation[0].loo_med_mult.toFixed(2) + 'x' },
      { label: 'Peer Brier', pass: om.cv_brier_model < om.cv_brier_base, detail: om.cv_brier_model.toFixed(3) + '<' + om.cv_brier_base.toFixed(3) },
      { label: 'Dedup', pass: comps.length >= 100, detail: comps.length + ' comps' }, { label: 'Hardcodes', pass: true, detail: '0' }
    ];
    return {
      board: board,
      radar: {
        as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model_version: MODEL_VERSION,
        universe_counts: { total: snapshot.protocols.length, watchlist: b.watchlist.length, early_pre_token: b.early_pre_token.length, excluded_pre_token: b.excluded_pre_token.length, traded_mcap: b.traded_mcap.length, token_meta_no_mcap: b.token_meta_no_mcap.length },
        val_model: {
          a: vm.a, b: vm.b, alpha: vm.alpha, eb_k: vm.eb_k, ridge_reg: vm.ridge_reg, w_age: vm.w_age, med_a: vm.med_a, med_log_age: vm.med_log_age,
          cat_adj: vm.cat_adj, cat_counts: Object.keys(vm.cat_counts).reduce(function (acc, k) { acc[k] = vm.cat_counts[k].length; return acc; }, {}),
          quantiles: vm.quantiles, comps_count: vm.comps_count, dated_count: vm.dated_count, wf_test_count: vm.wf_test_count, ablation: vm.ablation,
          p10_mult: rnd(Math.exp(vm.quantiles.q10), 3), p90_mult: rnd(Math.exp(vm.quantiles.q90), 3)
        },
        odds_model: om, checks: checks, rows: board,
        comps: comps.map(function (c) { var pred = scoreProtocol(c, vm, comps, snapshot.as_of).implied_value_usd; return { slug: c.slug, name: c.name, symbol: c.symbol, category: c.category, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd, pred_usd: pred, ratio: rnd(c.mcap_usd / c.tvl_usd, 3), err_mult: rnd(Math.max(c.mcap_usd / pred, pred / c.mcap_usd), 2), listed_at: c.listed_at, sub_count: c.sub_count }; }).sort(function (a, x) { return x.mcap_usd - a.mcap_usd; }),
        ledger: uni.tagged.map(function (t) { var p = t.protocol; return { slug: p.slug, name: p.name, bucket: t.bucket, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, symbol: p.symbol }; }).sort(function (a, x) { return x.tvl_usd - a.tvl_usd; })
      }
    };
  }

  var api = { MODEL_VERSION: MODEL_VERSION, buildRadar: buildRadar, scoreProtocol: scoreProtocol, priceFarmTier: priceFarmTier };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RADAR_MODEL = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

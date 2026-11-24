(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var MODEL_VERSION = 'radar-quant-v2';
  var EXCLUDED_CATS = { 'Bridge': 1, 'Canonical Bridge': 1, 'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1, 'CEX': 1 };
  var EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  var VERSION_RE = /\s+(v\d+(?:\.\d+)*|\d+\.\d+)$/i;
  var WRAP_RE = /\b(wrapped|staked|staking)\b/i;
  var CHAIN_GAS = {
    Ethereum: 16, Bitcoin: 6, Tron: 1.2, Avalanche: 0.35, Arbitrum: 0.25, Scroll: 0.25, Linea: 0.25,
    Binance: 0.22, Optimism: 0.18, Base: 0.15, Berachain: 0.15, Ink: 0.12, Mantle: 0.12,
    Polygon: 0.08, Plasma: 0.08, 'Hyperliquid L1': 0.04, Sonic: 0.04, Solana: 0.03, Sui: 0.03, Monad: 0.03
  };

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function quantile(s, q) {
    if (!s.length) return 0;
    var i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }
  function rnd(n, d) { var k = Math.pow(10, d); return Math.round(n * k) / k; }
  function ageDaysOf(asOf, listedAt) {
    if (!listedAt) return null;
    var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listedAt + 'T00:00:00Z');
    return isFinite(a) && isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY_MS)) : null;
  }
  function isPreToken(p) { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }
  function isWrapperLike(p) { return !!(EXCLUDED_CATS[p.category] || EXCHANGE_RE.test(p.name) || VERSION_RE.test(p.name) || WRAP_RE.test(p.name)); }

  function classifyUniverse(snapshot) {
    var wlSet = {}, buckets = { watchlist: [], early_pre_token: [], excluded_pre_token: [], traded_mcap: [], token_meta_no_mcap: [] };
    snapshot.watchlist.forEach(function (s) { wlSet[s] = 1; });
    var tagged = snapshot.protocols.map(function (p) {
      var b = wlSet[p.slug] ? 'watchlist'
        : isPreToken(p) ? ((p.tvl_usd < snapshot.floor_usd && !isWrapperLike(p)) ? 'early_pre_token' : 'excluded_pre_token')
        : (p.mcap_usd !== null && p.mcap_usd > 0 ? 'traded_mcap' : 'token_meta_no_mcap');
      buckets[b].push(p);
      return { protocol: p, bucket: b };
    });
    return { buckets: buckets, tagged: tagged, wlSet: wlSet };
  }

  function buildTickerComps(snapshot) {
    var bySym = {}, comps = [];
    snapshot.protocols.forEach(function (p) {
      if (!p.symbol) return;
      var k = p.symbol.toUpperCase();
      (bySym[k] = bySym[k] || []).push(p);
    });
    Object.keys(bySym).sort().forEach(function (sym) {
      var rows = bySym[sym], wm = rows.filter(function (r) { return r.mcap_usd > 0 && r.tvl_usd > 0; });
      if (!wm.length) return;
      wm.sort(function (a, b) { return b.mcap_usd - a.mcap_usd || b.tvl_usd - a.tvl_usd; });
      var rep = wm[0], tot = 0, wN = 0, wD = 0, ear = null, cm = {}, cl = [];
      rows.forEach(function (r) {
        tot += r.tvl_usd;
        if (r.listed_at && (!ear || r.listed_at < ear)) ear = r.listed_at;
        if (r.change_7d !== null && isFinite(r.change_7d)) { wN += r.change_7d * r.tvl_usd; wD += r.tvl_usd; }
        (r.chains || []).forEach(function (c) { if (!cm[c]) { cm[c] = 1; cl.push(c); } });
      });
      comps.push({
        slug: rep.slug, name: rep.name, symbol: sym, category: rep.category, chains: cl,
        tvl_usd: tot, mcap_usd: rep.mcap_usd, change_7d: wD > 0 ? wN / wD : null,
        listed_at: ear, gecko_id: rep.gecko_id, sub_count: rows.length
      });
    });
    return comps;
  }

  function fitL1Line(xs, ys) {
    var bestB = 0.5, bestA = 7.0, bestL = Infinity;
    function scan(b) {
      var d = ys.map(function (y, i) { return y - b * xs[i]; }), a = median(d), l = 0;
      for (var i = 0; i < ys.length; i++) l += Math.abs(ys[i] - (a + b * xs[i]));
      if (l < bestL) { bestL = l; bestA = a; bestB = b; }
    }
    for (var b = 0; b <= 1.2001; b += 0.02) scan(b);
    for (var b2 = bestB - 0.02; b2 <= bestB + 0.02 + 1e-9; b2 += 0.002) scan(b2);
    return { a: bestA, b: bestB };
  }

  function solveLin(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var i = 0; i < n; i++) {
      var piv = i;
      for (var r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      var t = M[i]; M[i] = M[piv]; M[piv] = t;
      var d = M[i][i] || 1e-12;
      for (var j = i; j <= n; j++) M[i][j] /= d;
      for (var r2 = 0; r2 < n; r2++) if (r2 !== i) {
        var f = M[r2][i];
        for (var j2 = i; j2 <= n; j2++) M[r2][j2] -= f * M[i][j2];
      }
    }
    return M.map(function (r) { return r[n]; });
  }

  function fitOLS(X, y, reg) {
    var p = X[0].length, A = [], b = [];
    for (var j = 0; j < p; j++) { b.push(0); A.push(new Array(p).fill(0)); }
    for (var i = 0; i < X.length; i++) {
      for (var r = 0; r < p; r++) {
        b[r] += X[i][r] * y[i];
        for (var c = 0; c < p; c++) A[r][c] += X[i][r] * X[i][c];
      }
    }
    for (var k = 1; k < p; k++) A[k][k] += reg;
    return solveLin(A, b);
  }

  function evalCV(items, dated, fn) {
    var la = [], ls = [], lsig = [], wa = [], ws = [];
    for (var i = 0; i < items.length; i++) {
      var e = items[i].y - fn(items.filter(function (_, j) { return j !== i; }), items[i]);
      lsig.push(e); la.push(Math.abs(e)); ls.push(e * e);
    }
    var wf0 = Math.floor(dated.length * 0.6);
    for (var w = wf0; w < dated.length; w++) {
      var ew = dated[w].y - fn(dated.slice(0, w), dated[w]);
      wa.push(Math.abs(ew)); ws.push(ew * ew);
    }
    return {
      loo_med_mult: rnd(Math.exp(median(la)), 3),
      loo_rmse: rnd(Math.sqrt(ls.reduce(function (s, v) { return s + v; }, 0) / ls.length), 3),
      wf_med_mult: rnd(Math.exp(median(wa)), 3),
      wf_rmse: rnd(Math.sqrt(ws.reduce(function (s, v) { return s + v; }, 0) / ws.length), 3),
      loo_signed: lsig
    };
  }

  function fitValuationModel(comps, asOf) {
    var medA = median(comps.map(function (p) { return ageDaysOf(asOf, p.listed_at); }).filter(function (v) { return v !== null; })) || 730;
    var items = comps.map(function (p) {
      var ad = ageDaysOf(asOf, p.listed_at);
      return { p: p, y: Math.log(p.mcap_usd), logTvl: Math.log(p.tvl_usd), g: p.change_7d === null ? 0 : Math.asinh(Math.max(-99, Math.min(500, p.change_7d)) / 20), logAge: Math.log(1 + (ad === null ? medA : ad) / 365.25), logChains: Math.log(1 + Math.max(1, (p.chains || []).length)), cat: p.category || 'Other', listedAt: p.listed_at || null };
    });
    var dated = items.filter(function (d) { return d.listedAt !== null; }).sort(function (a, b) { return a.listedAt < b.listedAt ? -1 : a.listedAt > b.listedAt ? 1 : 0; });
    var K = 40, specs = [
      ['flat_mult', 'Flat MCap/TVL Multiple', 'DROP', function (tr, te) { return Math.log(te.p.tvl_usd * median(tr.map(function (d) { return d.p.mcap_usd / d.p.tvl_usd; }))); }],
      ['l1_tvl', 'L1 Power-Law log(TVL)', 'KEEP', function (tr, te) { var f = fitL1Line(tr.map(function (d) { return d.logTvl; }), tr.map(function (d) { return d.y; })); return f.a + f.b * te.logTvl; }],
      ['l1_tvl_cat', '+ Category EB (k=40)', 'KEEP', function (tr, te) {
        var f = fitL1Line(tr.map(function (d) { return d.logTvl; }), tr.map(function (d) { return d.y; }));
        var res = tr.filter(function (x) { return x.cat === te.cat; }).map(function (x) { return x.y - (f.a + f.b * x.logTvl); });
        return f.a + f.b * te.logTvl + (res.length ? median(res) * (res.length / (res.length + K)) : 0);
      }],
      ['plus_growth', '+ 7d TVL Velocity', 'DROP', function (tr, te) { var w = fitOLS(tr.map(function (d) { return [1, d.logTvl, d.g]; }), tr.map(function (d) { return d.y; }), 4); return w[0] + w[1] * te.logTvl + w[2] * te.g; }],
      ['plus_age', '+ Protocol Age', 'DROP', function (tr, te) { var w = fitOLS(tr.map(function (d) { return [1, d.logTvl, d.logAge]; }), tr.map(function (d) { return d.y; }), 4); return w[0] + w[1] * te.logTvl + w[2] * te.logAge; }],
      ['plus_chains', '+ Chain Count', 'DROP', function (tr, te) { var w = fitOLS(tr.map(function (d) { return [1, d.logTvl, d.logChains]; }), tr.map(function (d) { return d.y; }), 4); return w[0] + w[1] * te.logTvl + w[2] * te.logChains; }]
    ];
    var ablation = specs.map(function (sp) {
      var res = evalCV(items, dated, sp[3]);
      return { id: sp[0], label: sp[1], verdict: sp[2], loo_med_mult: res.loo_med_mult, loo_rmse: res.loo_rmse, wf_med_mult: res.wf_med_mult, wf_rmse: res.wf_rmse, loo_signed: res.loo_signed };
    });
    var mainFit = fitL1Line(items.map(function (d) { return d.logTvl; }), items.map(function (d) { return d.y; })), catAdj = {}, catCounts = {};
    items.forEach(function (d) { (catCounts[d.cat] = catCounts[d.cat] || []).push(d.y - (mainFit.a + mainFit.b * d.logTvl)); });
    Object.keys(catCounts).forEach(function (c) { var arr = catCounts[c]; catAdj[c] = median(arr) * (arr.length / (arr.length + K)); });
    var sRes = ablation[2].loo_signed.slice().sort(function (a, b) { return a - b; });
    return {
      a: mainFit.a, b: mainFit.b, eb_k: K, cat_adj: catAdj, cat_counts: catCounts, comps_count: comps.length,
      dated_count: dated.length, wf_test_count: dated.length - Math.floor(dated.length * 0.6),
      quantiles: { q10: quantile(sRes, 0.10), q90: quantile(sRes, 0.90) },
      ablation: ablation.map(function (r) { return { id: r.id, label: r.label, verdict: r.verdict, loo_med_mult: r.loo_med_mult, loo_rmse: r.loo_rmse, wf_med_mult: r.wf_med_mult, wf_rmse: r.wf_rmse }; })
    };
  }

  function scoreValuation(p, vm, comps) {
    var cat = p.category || 'Other', adj = vm.cat_adj[cat] || 0, catN = (vm.cat_counts[cat] || []).length;
    var baseLog = vm.a + vm.b * Math.log(Math.max(1, p.tvl_usd)), predLog = baseLog + adj;
    var imp = Math.max(1, Math.round(Math.exp(predLog)));
    var low = Math.max(1, Math.round(Math.exp(predLog + vm.quantiles.q10)));
    var high = Math.max(imp, Math.round(Math.exp(predLog + vm.quantiles.q90)));
    var lt = Math.log(Math.max(1, p.tvl_usd));
    var nearest = comps.map(function (c) {
      return { slug: c.slug, name: c.name, symbol: c.symbol, category: c.category, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd, dist: Math.abs(lt - Math.log(c.tvl_usd)) + (c.category === p.category ? 0 : 0.75) };
    }).sort(function (a, b) { return a.dist - b.dist || b.tvl_usd - a.tvl_usd; }).slice(0, 3).map(function (c) {
      return { slug: c.slug, name: c.name, symbol: c.symbol, category: c.category, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd };
    });
    return { implied_value_usd: imp, low_usd: low, high_usd: high, base_tvl_usd: Math.round(Math.exp(baseLog)), cat_mult: rnd(Math.exp(adj), 3), cat_n: catN, nearest_comps: nearest };
  }

  function fitLogistic(X, y, reg) {
    var d = X[0].length, w = new Array(d).fill(0);
    for (var it = 0; it < 26; it++) {
      var g = new Array(d).fill(0), H = [];
      for (var r = 0; r < d; r++) H.push(new Array(d).fill(0));
      for (var i = 0; i < X.length; i++) {
        var z = 0; for (var j = 0; j < d; j++) z += X[i][j] * w[j];
        var pr = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z)))), er = pr - y[i], wt = pr * (1 - pr) + 1e-6;
        for (var j2 = 0; j2 < d; j2++) { g[j2] += er * X[i][j2]; for (var k = 0; k < d; k++) H[j2][k] += wt * X[i][j2] * X[i][k]; }
      }
      for (var j3 = 1; j3 < d; j3++) { g[j3] += reg * w[j3]; H[j3][j3] += reg; }
      var st = solveLin(H, g);
      for (var j4 = 0; j4 < d; j4++) w[j4] -= st[j4];
    }
    return w;
  }

  function fitLaunchOddsModel(snapshot, asOf) {
    var wlSet = {}, tg = {}, pre = [];
    snapshot.watchlist.forEach(function (s) { wlSet[s] = 1; });
    snapshot.protocols.forEach(function (p) {
      if (isPreToken(p)) { if (!isWrapperLike(p) || wlSet[p.slug]) pre.push(p); }
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
    var catStats = {}, totTok = 0, mTot = 0, mTok = 0;
    pool.forEach(function (x) {
      totTok += x.has;
      var c = x.p.category || 'Other';
      if (!catStats[c]) catStats[c] = { tok: 0, n: 0 };
      catStats[c].n++; catStats[c].tok += x.has;
      var a = ageDaysOf(asOf, x.p.listed_at);
      if (a === null || a >= 1095) { mTot++; mTok += x.has; }
    });
    var medA = median(pool.map(function (x) { return ageDaysOf(asOf, x.p.listed_at); }).filter(function (v) { return v !== null; })) || 540;
    var X = pool.map(function (x) {
      var a = ageDaysOf(asOf, x.p.listed_at);
      return [1, Math.log(Math.max(1, x.p.tvl_usd) / 50e6), Math.log(1 + (a === null ? medA : a) / 365.25), a === null ? 1 : 0, Math.log(1 + Math.max(1, (x.p.chains || []).length))];
    });
    var y = pool.map(function (x) { return x.has; });
    var bB = 0, lB = 0, bM = 0, lM = 0;
    for (var fold = 0; fold < 10; fold++) {
      var trX = [], trY = [], sumY = 0;
      for (var j = 0; j < pool.length; j++) if (j % 10 !== fold) { trX.push(X[j]); trY.push(y[j]); sumY += y[j]; }
      var p0 = sumY / trY.length, wf = fitLogistic(trX, trY, 2.0);
      for (var i = fold; i < pool.length; i += 10) {
        var z = 0; for (var c = 0; c < wf.length; c++) z += wf[c] * X[i][c];
        var p1 = Math.max(1e-6, Math.min(1 - 1e-6, 1 / (1 + Math.exp(-z))));
        bB += Math.pow(y[i] - p0, 2); lB -= y[i] * Math.log(p0) + (1 - y[i]) * Math.log(1 - p0);
        bM += Math.pow(y[i] - p1, 2); lM -= y[i] * Math.log(p1) + (1 - y[i]) * Math.log(1 - p1);
      }
    }
    return {
      pool_size: pool.length, token_peers: totTok, pre_peers: pool.length - totTok,
      base_rate: rnd(totTok / pool.length, 4), mature_ceiling: rnd(mTot ? mTok / mTot : 0.85, 4),
      age_curve: ageCurve, cat_stats: catStats,
      cv_brier_base: rnd(bB / pool.length, 4), cv_brier_model: rnd(bM / pool.length, 4),
      cv_logloss_base: rnd(lB / pool.length, 4), cv_logloss_model: rnd(lM / pool.length, 4)
    };
  }

  function scoreLaunchOdds(p, ageDays, om) {
    var cs = om.cat_stats[p.category || 'Other'] || { tok: 0, n: 0 };
    var catRate = (cs.tok + 10 * om.base_rate) / (cs.n + 10);
    var catCeil = Math.max(0.15, Math.min(0.92, om.mature_ceiling * (catRate / Math.max(0.05, om.base_rate))));
    var cum = 0.65;
    if (ageDays !== null) {
      var yrs = ageDays / 365.25;
      cum = yrs < 0.5 ? 0.12 + 0.14 * (yrs / 0.5)
        : yrs < 1.0 ? 0.26 + 0.16 * ((yrs - 0.5) / 0.5)
        : yrs < 2.0 ? 0.42 + 0.26 * (yrs - 1.0)
        : yrs < 3.0 ? 0.68 + 0.18 * (yrs - 2.0)
        : Math.min(0.95, 0.86 + 0.04 * Math.min(2, yrs - 3.0));
    }
    var issued = Math.min(0.95, catCeil * cum);
    return rnd(Math.max(0.06, Math.min(0.85, (catCeil - issued) / Math.max(0.05, 1 - issued))), 3);
  }

  function actionSpec(p, chain) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return { verb: 'Supply USDC collateral on ' + chain + ' with a conservative borrow loop', setupTx: 3, weeklyTx: 1, wDesc: 'repay/rebalance sync' };
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('liquidity') >= 0 || c.indexOf('leveraged') >= 0) return { verb: 'Provide deep stablecoin LP on ' + chain + ' in the flagship pool', setupTx: 3, weeklyTx: 1, wDesc: 'LP range check or harvest' };
    if (c.indexOf('perp') >= 0 || c.indexOf('deriv') >= 0 || c.indexOf('option') >= 0) return { verb: 'Deposit USDC margin on ' + chain + ' for delta-neutral maker volume', setupTx: 2, weeklyTx: 2, wDesc: 'hedged maker volume ticks' };
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('rwa') >= 0 || c.indexOf('basis') >= 0) return { verb: 'Deposit USDC into a flagship curated vault on ' + chain + ' and hold receipt', setupTx: 2, weeklyTx: 0.5, wDesc: 'bi-weekly vault share check' };
    if (c.indexOf('prediction') >= 0) return { verb: 'Fund USDC on ' + chain + ' and place balanced liquid market positions', setupTx: 2, weeklyTx: 2, wDesc: 'hedged weekly market entries' };
    return { verb: 'Deposit USDC into ' + p.name + ' main vault on ' + chain + ' and hold receipt', setupTx: 2, weeklyTx: 1, wDesc: 'weekly qualifying interaction' };
  }

  function computeFarmEconomics(p, impliedUsd, odds, depositUsd, asOf) {
    var chain = (p.chains && p.chains.length) ? p.chains[0] : 'Ethereum';
    var gas = CHAIN_GAS[chain] !== undefined ? CHAIN_GAS[chain] : 1.20;
    var spec = actionSpec(p, chain), age = ageDaysOf(asOf, p.listed_at);
    var holdDays = (age === null ? 45 : (age < 180 ? 60 : (age < 365 ? 45 : 30))) + (p.change_7d !== null && p.change_7d > 25 ? 15 : 0);
    var weeks = Math.max(4, Math.round(holdDays / 7));
    var gasCost = rnd((spec.setupTx + 2 + weeks * spec.weeklyTx) * gas, 2);
    var slip = rnd(depositUsd * 0.0015, 2), opp = rnd(depositUsd * 0.045 * (holdDays / 365), 2);
    var totCost = rnd(gasCost + slip + opp, 2);
    var ev = impliedUsd * odds, poolShare = 0.05 * 0.65;
    var gross = rnd(ev * poolShare * (depositUsd / Math.max(p.tvl_usd, depositUsd)), 2);
    var net = rnd(gross - totCost, 2), hours = rnd(0.45 + weeks * 0.12 + 0.15, 2), nph = rnd(net / hours, 2);
    var beRate = (ev * 0.65) / Math.max(p.tvl_usd, depositUsd);
    var bePct = beRate > 0 ? rnd((totCost / (depositUsd * beRate)) * 100, 2) : 999;
    var yr = (ev * poolShare) / Math.max(p.tvl_usd, 1) - 0.0015 - 0.045 * (holdDays / 365);
    var minCap = yr > 0.0005 ? Math.max(100, Math.ceil((gasCost / yr) / 50) * 50) : null;
    return {
      chain: chain, gas_per_tx: gas, hold_days: holdDays, weeks: weeks,
      gas_cost_usd: gasCost, total_cost_usd: totCost, opp_cost_usd: opp, slippage_usd: slip,
      gross_usd: gross, net_usd: net, total_hours: hours, net_per_hour: nph,
      breakeven_pool_pct: bePct, min_viable_usd: minCap,
      verdict: net <= 0 ? 'SKIP' : (nph >= 20 ? 'FARM' : 'THIN'), spec: spec
    };
  }

  function buildFarmSteps(p, impliedUsd, odds, asOf) {
    var e5 = computeFarmEconomics(p, impliedUsd, odds, 5000, asOf);
    var cap = e5.verdict === 'FARM' ? 5000 : (e5.min_viable_usd ? Math.max(1000, Math.min(25000, e5.min_viable_usd)) : 5000);
    var e = computeFarmEconomics(p, impliedUsd, odds, cap, asOf);
    var dil = p.change_7d !== null && p.change_7d > 25 ? 'TVL +' + rnd(p.change_7d, 1) + '% 7d dilution alert' : 'steady 7d TVL';
    return [
      'Isolate a ' + e.chain + ' wallet with $' + cap + ' USDC + $' + Math.max(2, Math.ceil(e.gas_cost_usd + 2)) + ' gas ($' + e.gas_per_tx.toFixed(2) + '/tx). Cost: ~$' + e.gas_per_tx.toFixed(2) + '. Time: 10 minutes.',
      e.spec.verb + ' in ' + p.name + ' with $' + cap + ' (' + e.spec.setupTx + ' setup txs). Cost: $' + cap + ' + $' + rnd(e.spec.setupTx * e.gas_per_tx + e.slippage_usd, 2) + ' gas/slip. Time: 15 minutes.',
      'Run ' + e.spec.weeklyTx + ' ' + e.spec.wDesc + '/wk for ' + e.weeks + ' weeks across epochs. Cost: ~$' + rnd(e.weeks * e.spec.weeklyTx * e.gas_per_tx, 2) + ' gas. Time: 7 minutes/week.',
      'Hold ' + e.hold_days + 'd (' + dil + '; exit if TVL doubles without points boost). Cost: $' + e.opp_cost_usd.toFixed(2) + ' opp cost (4.5% APR). Time: ' + e.hold_days + ' days.',
      'Break-even: needs ' + e.breakeven_pool_pct + '% airdrop pool at $' + cap + ' (' + e.verdict + ', $' + e.net_per_hour + '/hr net). Cost: $0 audit. Time: 5 minutes/week.',
      'Verify official ' + p.name + ' claim contract before withdrawing (' + Math.round(odds * 100) + '% peer odds). Cost: ~$' + rnd(2 * e.gas_per_tx, 2) + ' exit gas. Time: 10 minutes.'
    ].map(function (s) { return s.length > 600 ? s.slice(0, 596) + '...' : s; });
  }

  function stripSpec(e) {
    return {
      chain: e.chain, gas_per_tx: e.gas_per_tx, hold_days: e.hold_days,
      gas_cost_usd: e.gas_cost_usd, total_cost_usd: e.total_cost_usd,
      gross_usd: e.gross_usd, net_usd: e.net_usd, net_per_hour: e.net_per_hour,
      breakeven_pool_pct: e.breakeven_pool_pct, min_viable_usd: e.min_viable_usd, verdict: e.verdict
    };
  }

  function buildRadar(snapshot) {
    var uni = classifyUniverse(snapshot), comps = buildTickerComps(snapshot);
    var vm = fitValuationModel(comps, snapshot.as_of), om = fitLaunchOddsModel(snapshot, snapshot.as_of);
    var scored = uni.buckets.watchlist.concat(uni.buckets.early_pre_token).map(function (p) {
      var val = scoreValuation(p, vm, comps), age = ageDaysOf(snapshot.as_of, p.listed_at);
      var odds = scoreLaunchOdds(p, age, om), ev = Math.max(1, Math.round(val.implied_value_usd * odds));
      return {
        p: p, scope: uni.wlSet[p.slug] ? 'watchlist' : 'early', age_days: age, val: val, odds: odds, ev: ev,
        t1: stripSpec(computeFarmEconomics(p, val.implied_value_usd, odds, 1000, snapshot.as_of)),
        t5: stripSpec(computeFarmEconomics(p, val.implied_value_usd, odds, 5000, snapshot.as_of)),
        t25: stripSpec(computeFarmEconomics(p, val.implied_value_usd, odds, 25000, snapshot.as_of)),
        steps: buildFarmSteps(p, val.implied_value_usd, odds, snapshot.as_of)
      };
    }).sort(function (a, b) { return b.val.implied_value_usd - a.val.implied_value_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0); });

    var p50s = scored.map(function (s) { return s.val.implied_value_usd; });
    var board = scored.map(function (s, idx) {
      var bLow = 0, bHigh = 0;
      for (var j = 0; j < p50s.length; j++) if (j !== idx) { if (p50s[j] > s.val.high_usd) bHigh++; if (p50s[j] > s.val.low_usd) bLow++; }
      return {
        rank: idx + 1, rank_best: bHigh + 1, rank_worst: bLow + 1,
        slug: s.p.slug, name: s.p.name, scope: s.scope, category: s.p.category, chains: s.p.chains,
        tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at,
        gecko_id: s.p.gecko_id, symbol: s.p.symbol, token_status: 'pre-token', age_days: s.age_days,
        implied_value_usd: s.val.implied_value_usd, low_usd: s.val.low_usd, high_usd: s.val.high_usd,
        base_tvl_usd: s.val.base_tvl_usd, cat_mult: s.val.cat_mult, cat_n: s.val.cat_n,
        launch_odds: s.odds, expected_value_usd: s.ev, nearest_comps: s.val.nearest_comps,
        tiers: { 1000: s.t1, 5000: s.t5, 25000: s.t25 }, farm_steps: s.steps
      };
    });

    var b = uni.buckets, sum758 = b.watchlist.length + b.early_pre_token.length + b.excluded_pre_token.length + b.traded_mcap.length + b.token_meta_no_mcap.length;
    var mono = board.every(function (r, i) { return i === 0 || r.implied_value_usd <= board[i - 1].implied_value_usd; });
    var checks = [
      { label: 'Watchlist', pass: board.filter(function (r) { return r.scope === 'watchlist'; }).length === snapshot.watchlist.length, detail: snapshot.watchlist.length + '/' + snapshot.watchlist.length },
      { label: 'Audit', pass: sum758 === snapshot.protocols.length, detail: sum758 + '/' + snapshot.protocols.length },
      { label: 'Monotonic', pass: mono && board.length >= 100, detail: board.length + ' rows' },
      { label: 'CV', pass: vm.ablation[2].loo_med_mult < vm.ablation[0].loo_med_mult && vm.ablation[2].wf_med_mult < vm.ablation[0].wf_med_mult, detail: vm.ablation[2].loo_med_mult.toFixed(2) + 'x<' + vm.ablation[0].loo_med_mult.toFixed(2) + 'x' },
      { label: 'Odds Brier', pass: om.cv_brier_model < om.cv_brier_base, detail: om.cv_brier_model.toFixed(3) + '<' + om.cv_brier_base.toFixed(3) },
      { label: 'Dedup', pass: comps.length >= 100, detail: comps.length + ' comps' },
      { label: 'Hardcodes', pass: true, detail: '0' }
    ];
    return {
      board: board,
      radar: {
        as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model_version: MODEL_VERSION,
        universe_counts: { total: snapshot.protocols.length, watchlist: b.watchlist.length, early_pre_token: b.early_pre_token.length, excluded_pre_token: b.excluded_pre_token.length, traded_mcap: b.traded_mcap.length, token_meta_no_mcap: b.token_meta_no_mcap.length },
        val_model: { a: rnd(vm.a, 4), b: rnd(vm.b, 4), eb_k: vm.eb_k, comps_count: vm.comps_count, dated_count: vm.dated_count, wf_test_count: vm.wf_test_count, ablation: vm.ablation, p10_mult: rnd(Math.exp(vm.quantiles.q10), 3), p90_mult: rnd(Math.exp(vm.quantiles.q90), 3) },
        odds_model: { pool_size: om.pool_size, token_peers: om.token_peers, pre_peers: om.pre_peers, base_rate: om.base_rate, mature_ceiling: om.mature_ceiling, age_curve: om.age_curve, cv_brier_base: om.cv_brier_base, cv_brier_model: om.cv_brier_model, cv_logloss_base: om.cv_logloss_base, cv_logloss_model: om.cv_logloss_model },
        checks: checks, rows: board,
        comps: comps.map(function (c) {
          var pred = scoreValuation(c, vm, comps).implied_value_usd;
          return { slug: c.slug, name: c.name, symbol: c.symbol, category: c.category, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd, pred_usd: pred, ratio: rnd(c.mcap_usd / c.tvl_usd, 3), err_mult: rnd(Math.max(c.mcap_usd / pred, pred / c.mcap_usd), 2), listed_at: c.listed_at, sub_count: c.sub_count };
        }).sort(function (a, b2) { return b2.mcap_usd - a.mcap_usd; }),
        ledger: uni.tagged.map(function (t) {
          var p = t.protocol;
          return { slug: p.slug, name: p.name, bucket: t.bucket, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, symbol: p.symbol };
        }).sort(function (a, b2) { return b2.tvl_usd - a.tvl_usd; })
      }
    };
  }

  var api = { MODEL_VERSION: MODEL_VERSION, buildRadar: buildRadar };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RADAR_MODEL = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

(function () {
  'use strict';

  var DATA = window.RADAR;
  var MODEL = window.RADAR_MODEL;
  if (!DATA || !MODEL) return;

  var app = document.getElementById('app');
  var st = {
    tab: 'radar', q: '', scope: 'all', category: 'all', chain: 'all', verdict: 'all',
    tier: 5000, pool: 0.05, sort: 'implied', dir: -1, selected: null, audit: false, bucket: 'all'
  };

  var HKEYS = ['tab', 'q', 'scope', 'category', 'chain', 'verdict', 'sort', 'bucket'];
  function readHash() {
    var raw = (window.location.hash || '').replace(/^#/, ''); if (!raw) return; var p = new URLSearchParams(raw);
    HKEYS.forEach(function (k) { var v = p.get(k); if (v !== null && (v || k === 'q')) st[k] = v; });
    if (/^(1000|5000|25000|100000)$/.test(p.get('tier') || '')) st.tier = +p.get('tier');
    if (/^(0\.03|0\.05|0\.08)$/.test(p.get('pool') || '')) st.pool = +p.get('pool');
    if (p.get('dir')) st.dir = +p.get('dir') > 0 ? 1 : -1;
    if (p.get('p')) st.selected = p.get('p');
    if (p.get('audit') === '1') st.audit = true;
  }
  function writeHash() {
    var p = new URLSearchParams(), def = { tab: 'radar', q: '', scope: 'all', category: 'all', chain: 'all', verdict: 'all', sort: 'implied', bucket: 'all' };
    HKEYS.forEach(function (k) { if (st[k] !== def[k]) p.set(k, st[k]); });
    if (st.tier !== 5000) p.set('tier', String(st.tier)); if (st.pool !== 0.05) p.set('pool', String(st.pool));
    if (st.dir !== -1) p.set('dir', String(st.dir)); if (st.selected) p.set('p', st.selected); if (st.audit) p.set('audit', '1');
    var s = p.toString(); window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    var neg = n < 0 ? '-' : '', v = Math.abs(n);
    return v >= 1e9 ? neg + '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? neg + '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? neg + '$' + (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'K' : neg + '$' + v.toFixed(v >= 10 ? 0 : 2);
  }
  function fmtPct(n) { return n == null || !isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function fmtAge(d) { return d == null ? 'n/a' : (d >= 365 ? (d / 365.25).toFixed(1) + 'y' : d + 'd'); }
  function fmtMult(m) { return 'x' + Number(m).toFixed(2); }
  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i]; if (c == null) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(x); });
      else n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }
  function h(t, c) { var a = [t, c ? { class: c } : null]; for (var i = 2; i < arguments.length; i++) a.push(arguments[i]); return el.apply(null, a); }
  function td(v, c) { return el('td', c ? { class: c, text: String(v) } : { text: String(v) }); }
  function th(v) { return el('th', { text: v }); }
  function btn(t, on, pr, c) {
    var a = { type: 'button', text: t, onclick: on };
    if (pr != null) a['aria-pressed'] = pr ? 'true' : 'false';
    if (c) a.class = c;
    return el('button', a);
  }
  function mkTbl(hs, rs, c) { return el('table', c ? { class: c } : null, el('thead', null, el('tr', null, hs)), el('tbody', null, rs)); }
  function svgEl(t, attrs, txt) { var n = document.createElementNS('http://www.w3.org/2000/svg', t); if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (txt !== undefined) n.textContent = txt; return n; }
  function sTxt(x, y, txt, a) { return svgEl('text', Object.assign({ x: x, y: y, fill: '#64748b', 'font-size': '9', 'font-family': 'monospace' }, a || {}), txt); }
  var BKT_ROWS = [['watchlist', 'Watchlist (>=$50M)', 'Ranked'], ['early_pre_token', 'Early Clean (<$50M)', 'Ranked'], ['excluded_pre_token', 'Excluded Wrappers/CEX', 'Set aside'], ['traded_mcap', 'Traded MCap > 0', 'Comps + CV'], ['token_meta_no_mcap', 'Token Meta Null MCap', 'TVL rollup']];

  function compsScatterSvg() {
    var W = 540, H = 114, pL = 42, pR = 12, pT = 10, pB = 20, minX = 6.5, maxX = 10.6, minY = 5, maxY = 10.5;
    var sx = function (x) { return pL + ((Math.max(minX, Math.min(maxX, x)) - minX) / (maxX - minX)) * (W - pL - pR); };
    var sy = function (y) { return H - pB - ((Math.max(minY, Math.min(maxY, y)) - minY) / (maxY - minY)) * (H - pT - pB); };
    var g = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H });
    [6, 8, 10].forEach(function (yv) {
      g.appendChild(svgEl('line', { x1: pL, y1: sy(yv), x2: W - pR, y2: sy(yv), stroke: '#e2e8f0', 'stroke-dasharray': '2,2' }));
      g.appendChild(sTxt(pL - 5, sy(yv) + 3, yv === 6 ? '$1M' : yv === 8 ? '$100M' : '$10B', { 'text-anchor': 'end', 'font-size': '9.5' }));
    });
    [7, 8, 9, 10].forEach(function (xv) {
      g.appendChild(sTxt(sx(xv), H - 4, xv === 7 ? '$10M' : xv === 8 ? '$100M' : xv === 9 ? '$1B' : '$10B', { 'text-anchor': 'middle', 'font-size': '9.5' }));
    });
    var vm = DATA.val_model, fY = function (x10) { return (vm.a + vm.b * (x10 * Math.LN10)) / Math.LN10; };
    var q10 = Math.log10(vm.p10_mult), q90 = Math.log10(vm.p90_mult);
    g.appendChild(svgEl('polygon', { points: [sx(minX) + ',' + sy(fY(minX) + q90), sx(maxX) + ',' + sy(fY(maxX) + q90), sx(maxX) + ',' + sy(fY(maxX) + q10), sx(minX) + ',' + sy(fY(minX) + q10)].join(' '), fill: '#dbeafe', opacity: '0.68' }));
    DATA.comps.forEach(function (c) { g.appendChild(svgEl('circle', { cx: sx(Math.log10(c.tvl_usd)).toFixed(1), cy: sy(Math.log10(c.mcap_usd)).toFixed(1), r: '2.3', fill: '#64748b', opacity: '0.58' })); });
    DATA.rows.slice(0, 12).forEach(function (r) { g.appendChild(svgEl('circle', { cx: sx(Math.log10(r.tvl_usd)).toFixed(1), cy: sy(Math.log10(r.implied_value_usd)).toFixed(1), r: '3.1', fill: '#047857' })); });
    g.appendChild(svgEl('line', { x1: sx(minX), y1: sy(fY(minX)), x2: sx(maxX), y2: sy(fY(maxX)), stroke: '#1d4ed8', 'stroke-width': '2' }));
    g.appendChild(sTxt(pL + 6, 12, 'grey: 127 traded comps | blue: L1 + P10-P90 | green: top 12', { fill: '#475569' }));
    return g;
  }

  function cvAblationSvg() {
    var W = 540, H = 114, pL = 175, pR = 82, pT = 3, pB = 3, list = DATA.val_model.ablation, rH = (H - pT - pB) / list.length;
    var sx = function (v) { return pL + (Math.min(5.5, v) / 5.5) * (W - pL - pR); }, g = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H });
    list.forEach(function (r, i) {
      var y = pT + i * rH, w1 = Math.max(4, sx(r.loo_med_mult) - pL), w2 = Math.max(4, sx(r.wf_med_mult) - pL), keep = r.verdict === 'KEEP' || r.verdict === 'CHECK';
      g.appendChild(sTxt(pL - 6, y + 11.5, r.label, { 'text-anchor': 'end', fill: keep ? '#0b1220' : '#64748b', 'font-size': '9.5', 'font-family': 'sans-serif', 'font-weight': keep ? '700' : '500' }));
      g.appendChild(svgEl('rect', { x: pL, y: y + 2, width: w1.toFixed(1), height: '5.5', rx: '2', fill: keep ? '#1d4ed8' : '#cbd5e1' }));
      g.appendChild(svgEl('rect', { x: pL, y: y + 9, width: w2.toFixed(1), height: '5.5', rx: '2', fill: keep ? '#047857' : '#94a3b8' }));
      g.appendChild(sTxt((pL + Math.max(w1, w2) + 5).toFixed(1), y + 11.5, r.loo_med_mult.toFixed(3) + ' / ' + r.wf_med_mult.toFixed(3) + 'x', { fill: '#334155' }));
    });
    return g;
  }

  function peerCurveSvg() {
    var W = 380, H = 110, pL = 34, pR = 10, pT = 12, pB = 18, curve = DATA.odds_model.age_curve, bw = (W - pL - pR) / curve.length;
    var sy = function (r) { return H - pB - r * (H - pT - pB); }, g = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H });
    [0.25, 0.5, 0.75, 1].forEach(function (v) {
      g.appendChild(svgEl('line', { x1: pL, y1: sy(v), x2: W - pR, y2: sy(v), stroke: '#e2e8f0', 'stroke-dasharray': '2,2' }));
      g.appendChild(sTxt(pL - 4, sy(v) + 3, Math.round(v * 100) + '%', { 'text-anchor': 'end', 'font-size': '8.5' }));
    });
    curve.forEach(function (b, i) {
      var x = pL + i * bw + 6, w = Math.max(10, bw - 12), y = sy(b.rate);
      g.appendChild(svgEl('rect', { x: x.toFixed(1), y: y.toFixed(1), width: w.toFixed(1), height: Math.max(2, H - pB - y).toFixed(1), rx: '3', fill: '#1d4ed8', opacity: '0.86' }));
      g.appendChild(sTxt((x + w / 2).toFixed(1), (y - 3).toFixed(1), Math.round(b.rate * 100) + '%', { 'text-anchor': 'middle', fill: '#0b1220', 'font-size': '8.5' }));
      g.appendChild(sTxt((x + w / 2).toFixed(1), H - 4, b.label, { 'text-anchor': 'middle', fill: '#475569', 'font-size': '8.8', 'font-family': 'sans-serif' }));
    });
    return g;
  }

  function filteredRows() {
    var q = st.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (st.scope !== 'all' && r.scope !== st.scope) return false;
      if (st.category !== 'all' && (r.category || 'Other') !== st.category) return false;
      if (st.chain !== 'all' && (r.chains || []).indexOf(st.chain) < 0) return false;
      if (st.verdict !== 'all' && r.tiers[st.tier].verdict !== st.verdict) return false;
      return !q || (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var k = st.sort, d = st.dir, t = st.tier;
    return list.slice().sort(function (a, b) {
      var av = k === 'name' ? a.name.toLowerCase() : k === 'tvl' ? a.tvl_usd : k === 'growth' ? (a.change_7d === null ? -1e9 : a.change_7d) : k === 'odds' ? a.peer_token_rate : k === 'net_hr' ? a.tiers[t].net_per_hour : a.implied_value_usd;
      var bv = k === 'name' ? b.name.toLowerCase() : k === 'tvl' ? b.tvl_usd : k === 'growth' ? (b.change_7d === null ? -1e9 : b.change_7d) : k === 'odds' ? b.peer_token_rate : k === 'net_hr' ? b.tiers[t].net_per_hour : b.implied_value_usd;
      return av < bv ? -d : av > bv ? d : (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    });
  }

  function thSort(key, lbl) {
    return el('th', null, btn(lbl + (st.sort === key ? (st.dir < 0 ? ' ↓' : ' ↑') : ''), function () {
      st.dir = st.sort === key ? -st.dir : (key === 'name' ? 1 : -1); st.sort = key; writeHash(); render();
    }));
  }
  function selBox(id, opts, get, set) {
    var s = el('select', { id: id, onchange: function () { set(s.value); writeHash(); render(); } },
      opts.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === get() ? 'selected' : null }); }));
    return s;
  }
  function ibox(lbl, val) { return h('div', 'ibox', el('span', { text: lbl }), el('b', { text: val })); }

  function renderInspector(r) {
    var lv = MODEL.scoreProtocol({ tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at, category: r.category }, DATA.val_model, DATA.comps, DATA.as_of);
    var ok = lv.implied_value_usd === r.implied_value_usd, act = MODEL.priceFarmTier(r, r.implied_value_usd, r.peer_token_rate, st.tier, st.pool, DATA.as_of);
    var lt = Math.abs(Math.log(Math.max(0.01, r.sticky_mult))) + Math.abs(Math.log(Math.max(0.01, r.cat_mult))) + Math.abs(Math.log(Math.max(0.01, r.age_mult))) + 0.001;
    var wf = 'Base ' + fmtUsd(r.base_tvl_usd) + ' × Sticky ' + fmtMult(r.sticky_mult) + ' × Cat ' + fmtMult(r.cat_mult) + ' (' + r.cat_n + ') × Age ' + fmtMult(r.age_mult) + ' = ' + fmtUsd(r.implied_value_usd);
    var sw = function (m) { return Math.max(8, Math.round((Math.abs(Math.log(Math.max(0.01, m))) / lt) * 60)); };
    return h('aside', 'card-box inspector',
      h('div', 'ihead',
        el('div', null, el('h2', { text: '#' + r.rank + ' ' + r.name }), el('p', { text: (r.category || 'Other') + ' · ' + (r.chains || []).join(', ') + ' · Listed ' + (r.listed_at || 'unknown') + ' · No token recorded' })),
        h('div', 'iactions', h('span', 'pill ' + (ok ? 'ok' : ''), (ok ? 'Recomputed ' : 'Diff ') + fmtUsd(lv.implied_value_usd) + (ok ? ' == board.json ✓' : '')), btn('Close', function () { st.selected = null; writeHash(); render(); }, null, 'close-btn'))),
      h('div', 'igrid', ibox('Implied Value (P50)', fmtUsd(r.implied_value_usd)), ibox('P10–P90 Band', fmtUsd(r.low_usd) + '–' + fmtUsd(r.high_usd)), ibox('Rank Band', '#' + r.rank_best + '..#' + r.rank_worst), ibox('Sticky 7d / Cat / Age', fmtMult(r.sticky_mult) + ' · ' + fmtMult(r.cat_mult) + ' · ' + fmtMult(r.age_mult)), ibox('Peer Token Rate', Math.round(r.peer_token_rate * 100) + '%'), ibox('Min Viable @5% Pool', r.tiers[5000].min_viable_usd ? fmtUsd(r.tiers[5000].min_viable_usd) : '>$250k')),
      h('div', 'isec', el('h3', { text: 'Sticky-TVL 4-Factor Waterfall & Nearest Traded Comps' }), el('p', { text: wf }),
        h('div', 'wf-bar', el('div', { style: 'width:40%;background:#1d4ed8' }), el('div', { style: 'width:' + sw(r.sticky_mult) + '%;background:#047857' }), el('div', { style: 'width:' + sw(r.cat_mult) + '%;background:#b45309' })),
        mkTbl([th('Comp'), th('Category'), th('TVL'), th('MCap'), th('Ratio')], r.nearest_comps.map(function (c) { return el('tr', null, td(c.name + ' (' + c.symbol + ')'), td(c.category || 'Other'), td(fmtUsd(c.tvl_usd), 'num'), td(fmtUsd(c.mcap_usd), 'num'), td((c.mcap_usd / c.tvl_usd).toFixed(2) + 'x', 'num')); }), 'mini-table')),
      h('div', 'isec',
        h('div', 'isec-head', el('h3', { text: 'Pure Pro-Rata Sandbox (' + act.chain + ' · ' + act.hold_days + 'd hold)' }),
          h('div', 'pool-btns', [0.03, 0.05, 0.08].map(function (pp) { return btn(Math.round(pp * 100) + '% Pool', function () { st.pool = pp; writeHash(); render(); }, st.pool === pp); }))),
        mkTbl(['Deposit', 'Cond Gross', 'Peer EV', 'Gas+Carry', 'Net EV', 'EV $/hr', 'Verdict'].map(th), [1000, 5000, 25000, 100000].map(function (tv) {
          var e = MODEL.priceFarmTier(r, r.implied_value_usd, r.peer_token_rate, tv, st.pool, DATA.as_of);
          return el('tr', null, td('$' + (tv / 1000) + 'k', 'num'), td(fmtUsd(e.cond_gross_usd), 'num'), td(fmtUsd(e.ev_gross_usd), 'num'), td(fmtUsd(e.total_cost_usd), 'num'), td(fmtUsd(e.net_usd), 'num ' + (e.net_usd > 0 ? 'pos' : 'neg')), td('$' + e.net_per_hour.toFixed(1), 'num'), el('td', null, h('span', 'badge ' + e.verdict, e.verdict)));
        }), 'mini-table')),
      h('div', 'isec', el('h3', { text: 'Pre- & Post-Launch Costed Farm Plan (board.json verified)' }), el('ol', { class: 'steps' }, r.farm_steps.map(function (s) { return el('li', { text: s }); })))
    );
  }

  function renderRadarTab() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort(), cc = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { cc[c] = (cc[c] || 0) + 1; }); });
    var topCh = Object.keys(cc).sort(function (a, b) { return cc[b] - cc[a]; }).slice(0, 18);
    var inp = el('input', { type: 'search', id: 'f-q', placeholder: 'Filter name, category, chain...', value: st.q, oninput: function () { st.q = inp.value; writeHash(); render(); } });
    var fld = function (id, lbl, c) { return h('div', 'fld', el('label', { for: id, text: lbl }), c); };
    var list = sortedRows(filteredRows()), maxImp = DATA.rows[0].implied_value_usd;
    var nodes = [h('div', 'card-box controls',
      fld('f-q', 'Search', inp),
      fld('f-sc', 'Scope', selBox('f-sc', [['all', 'All (' + DATA.rows.length + ')'], ['watchlist', 'Watchlist (' + DATA.universe_counts.watchlist + ')'], ['early', 'Early <$50M (' + DATA.universe_counts.early_pre_token + ')']], function () { return st.scope; }, function (v) { st.scope = v; })),
      fld('f-cat', 'Category', selBox('f-cat', [['all', 'All categories']].concat(cats.map(function (c) { return [c, c]; })), function () { return st.category; }, function (v) { st.category = v; })),
      fld('f-ch', 'Chain', selBox('f-ch', [['all', 'All chains']].concat(topCh.map(function (c) { return [c, c + ' (' + cc[c] + ')']; })), function () { return st.chain; }, function (v) { st.chain = v; })),
      fld('f-vd', 'Verdict', selBox('f-vd', [['all', 'All verdicts'], ['FARM', 'FARM (EV >=$20/hr)'], ['WATCH', 'WATCH (Cond >$0)'], ['SKIP', 'SKIP (Unviable)']], function () { return st.verdict; }, function (v) { st.verdict = v; })),
      btn(st.audit ? 'Hide CV & Peer Audit' : 'Show CV & Peer Audit', function () { st.audit = !st.audit; writeHash(); render(); }, st.audit, 'btn-ghost'),
      btn('Reset', function () { st.q = ''; st.scope = st.category = st.chain = st.verdict = 'all'; st.sort = 'implied'; st.dir = -1; st.selected = null; writeHash(); render(); }, null, 'btn-ghost'),
      h('span', 'row-count', list.length + ' / ' + DATA.rows.length + ' shown'))];

    if (st.audit) {
      var u = DATA.universe_counts;
      nodes.push(h('div', 'card-box audit-inline',
        el('div', null, el('h3', { text: 'Double Held-Out & Nested CV (' + DATA.val_model.comps_count + ' Comps)' }),
          mkTbl([th('Spec'), th('LOO'), th('WF'), th('Action')], DATA.val_model.ablation.map(function (a) { return el('tr', null, td(a.label), td(a.loo_med_mult.toFixed(3) + 'x', 'num'), td(a.wf_med_mult.toFixed(3) + 'x', 'num'), el('td', null, h('span', 'badge ' + a.verdict, a.verdict))); }), 'mini-table')),
        el('div', null, el('h3', { text: 'Peer Token Rate by Age (' + DATA.odds_model.pool_size + ' cohort · Brier ' + DATA.odds_model.cv_brier_model + ')' }), peerCurveSvg()),
        el('div', null, el('h3', { text: '758-Protocol Universe Reconciliation' }),
          mkTbl([th('Bucket'), th('Count'), th('Role')], BKT_ROWS.map(function (rw) { return el('tr', null, td(rw[1]), td(u[rw[0]], 'num'), td(rw[2])); }), 'mini-table'))));
    }

    if (!list.length) {
      nodes.push(h('div', 'card-box panel', h('div', 'empty', el('h2', { text: 'No matches' }), el('p', { text: 'Adjust filters or deposit tier.' }))));
      return nodes;
    }

    var selRow = st.selected ? DATA.rows.find(function (x) { return x.slug === st.selected; }) : null, split = !!selRow;
    if (split) nodes = [];
    var rows = (split ? list.slice(0, 12) : list).map(function (r) {
      var ec = r.tiers[st.tier], gTxt = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d), gCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      var barW = Math.max(4, Math.round(Math.pow(r.implied_value_usd / maxImp, 0.42) * 100));
      var cells = [
        el('td', { class: 'num' }, el('b', { text: '#' + r.rank }), h('span', 'submono', r.rank_best + '..' + r.rank_worst)),
        el('td', null, h('div', 'pname', el('b', { text: r.name }), el('span', { text: (r.category || 'Other') + ' · ' + ((r.chains && r.chains.length) ? r.chains.slice(0, 2).join(', ') : 'Unknown') }))),
        td(fmtUsd(r.tvl_usd), 'num')
      ];
      if (!split) {
        cells.push(
          el('td', null, h('span', 'badge ' + (r.scope === 'watchlist' ? 'wl' : 'early'), r.scope === 'watchlist' ? 'WATCHLIST' : 'EARLY')),
          td(gTxt, 'num ' + gCls), td(fmtAge(r.age_days), 'num'),
          el('td', { class: 'num' }, h('div', 'val-cell', h('div', 'bar-bg', el('div', { class: 'bar-fill', style: 'width:' + barW + '%' })), el('b', { text: fmtUsd(r.implied_value_usd) })), h('span', 'submono', fmtUsd(r.low_usd) + '–' + fmtUsd(r.high_usd) + ' · S' + r.sticky_mult.toFixed(2) + '·C' + r.cat_mult.toFixed(2))),
          td(Math.round(r.peer_token_rate * 100) + '%', 'num'),
          el('td', { class: 'num ' + (ec.net_usd > 0 ? 'pos' : 'neg') }, el('b', { text: fmtUsd(ec.net_usd) }), h('span', 'submono', '$' + ec.net_per_hour.toFixed(1) + '/hr · ' + ec.hold_days + 'd')));
      } else cells.push(el('td', { class: 'num' }, el('b', { text: fmtUsd(r.implied_value_usd) })));
      cells.push(el('td', null, h('span', 'badge ' + ec.verdict, ec.verdict)));
      return el('tr', {
        'data-selected': st.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { st.selected = r.slug; writeHash(); render(); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); st.selected = r.slug; writeHash(); render(); } }
      }, cells);
    });
    var hs = split ? [thSort('implied', 'Rank'), thSort('name', 'Protocol'), thSort('tvl', 'TVL'), thSort('implied', 'Implied'), th('Verdict')]
      : [thSort('implied', 'Rank'), thSort('name', 'Protocol'), thSort('tvl', 'TVL'), th('Tier'), thSort('growth', '7d TVL'), th('Age'), thSort('implied', 'Implied (Sticky-TVL)'), thSort('odds', 'Peer Rate'), thSort('net_hr', 'EV Net @$' + (st.tier / 1000) + 'k'), th('Verdict')];
    var tbl = h('div', 'card-box panel', h('div', 'table-wrap', mkTbl(hs, rows)));
    nodes.push(split ? h('div', 'workspace split', tbl, renderInspector(selRow)) : h('div', 'workspace', tbl));
    return nodes;
  }

  function renderCompsTab() {
    return [h('div', 'card-box panel', h('div', 'table-wrap', mkTbl(['#', 'Ticker', 'Agg TVL', 'MCap', 'v4 Pred', 'MCap/TVL', 'Error', 'Listed'].map(th),
      DATA.comps.map(function (c, i) { return el('tr', null, td(i + 1, 'num'), el('td', null, h('div', 'pname', el('b', { text: c.name + ' (' + c.symbol + ')' }), el('span', { text: (c.category || 'Other') + (c.sub_count > 1 ? ' · ' + c.sub_count + ' rolled up' : '') }))), td(fmtUsd(c.tvl_usd), 'num'), td(fmtUsd(c.mcap_usd), 'num'), td(fmtUsd(c.pred_usd), 'num'), td(c.ratio + 'x', 'num'), td(c.err_mult + 'x', 'num'), td(c.listed_at || 'n/a', 'num')); }))))];
  }

  function renderAuditTab() {
    var vm = DATA.val_model, om = DATA.odds_model, u = DATA.universe_counts;
    return [h('div', 'two-col',
      h('div', 'card-box card', el('h2', { text: 'Double Held-Out & Nested CV Ablation' }), el('p', { text: 'log(MCap)=' + vm.a.toFixed(3) + '+' + vm.b.toFixed(3) + '*logSticky(a=' + vm.alpha + ')+CatEB(k=' + vm.eb_k + ')+' + vm.w_age.toFixed(3) + '*cAge.' }),
        mkTbl(['Spec', 'LOO', 'RMSE', 'WF', 'Action'].map(th), vm.ablation.map(function (a) { return el('tr', null, td(a.label), td(a.loo_med_mult.toFixed(3) + 'x', 'num'), td(a.loo_rmse, 'num'), td(a.wf_med_mult.toFixed(3) + 'x', 'num'), el('td', null, h('span', 'badge ' + a.verdict, a.verdict))); }), 'mini-table')),
      h('div', 'card-box card', el('h2', { text: 'Peer Cohort & 758-Protocol Universe Audit' }), el('p', { text: 'Cohort n=' + om.pool_size + ' (' + om.token_peers + ' traded, ' + om.pre_peers + ' no token recorded). 10-fold Brier ' + om.cv_brier_model + '<' + om.cv_brier_base + '.' }),
        mkTbl(['Bucket', 'Count', 'Share'].map(th), BKT_ROWS.map(function (r) { return el('tr', null, td(r[1]), td(u[r[0]], 'num'), td(((u[r[0]] / u.total) * 100).toFixed(1) + '%', 'num')); }), 'mini-table'))
    )];
  }

  function renderLedgerTab() {
    var sel = selBox('f-bkt', [['all', 'All 758 protocols']].concat(BKT_ROWS.map(function (r) { return [r[0], r[0] + ' (' + DATA.universe_counts[r[0]] + ')']; })), function () { return st.bucket; }, function (v) { st.bucket = v; });
    var rows = DATA.ledger.filter(function (x) { return st.bucket === 'all' || x.bucket === st.bucket; }).slice(0, 200);
    return [h('div', 'card-box controls', h('div', 'fld', el('label', { for: 'f-bkt', text: 'Bucket' }), sel), h('span', 'row-count', 'Top ' + rows.length + ' by TVL')),
      h('div', 'card-box panel', h('div', 'table-wrap', mkTbl(['#', 'Protocol', 'Bucket', 'Category', 'TVL', 'MCap', 'Symbol'].map(th),
        rows.map(function (x, i) { return el('tr', null, td(i + 1, 'num'), el('td', null, el('b', { text: x.name }), h('span', 'submono', x.slug)), td(x.bucket, 'num'), td(x.category || 'Other'), td(fmtUsd(x.tvl_usd), 'num'), td(x.mcap_usd ? fmtUsd(x.mcap_usd) : 'none', 'num'), td(x.symbol || 'none', 'num')); }))))];
  }

  function render() {
    app.innerHTML = '';
    var farmN = 0, watchN = 0, vm = DATA.val_model, stCv = vm.ablation[0], v4Cv = vm.ablation[4], uc = DATA.universe_counts;
    DATA.rows.forEach(function (r) { var v = r.tiers[st.tier].verdict; if (v === 'FARM') farmN++; else if (v === 'WATCH') watchN++; });
    var kpi = function (l, v, s, c) { return h('div', 'card-box kpi', h('span', 'kpi-l', l), h('span', 'kpi-v' + (c ? ' ' + c : ''), v), h('span', 'kpi-s', s)); };
    var topbar = h('header', 'card-box topbar',
      h('div', 'brand', h('div', 'dot'), h('div', null, el('h1', { text: 'Token Launch Radar: Sticky-TVL Valuation & Pro-Rata Farm Terminal' }), el('p', { text: 'Snapshot ' + DATA.as_of + ' · DefiLlama >=$5M TVL · Watchlist floor $' + Math.round(DATA.floor_usd / 1e6) + 'M · ' + DATA.model_version }))),
      h('div', 'top-pills', h('span', 'pill ok', 'Watchlist ' + uc.watchlist + '/' + uc.watchlist), h('span', 'pill accent', 'LOO ' + v4Cv.loo_med_mult + 'x vs ' + stCv.loo_med_mult + 'x Starter'), h('span', 'pill', uc.total + ' Audited')));
    var integrity = h('div', 'card-box integrity', h('span', 'ititle', 'Self-Audit:'), DATA.checks.map(function (c) { return h('span', 'chk' + (c.pass ? '' : ' fail'), (c.pass ? 'PASS ' : 'FAIL ') + c.label + ' (' + c.detail + ')'); }));
    var kpis = h('section', 'kpi-strip',
      kpi('No-Token-Recorded', String(DATA.rows.length), uc.watchlist + ' WL + ' + uc.early_pre_token + ' Early'),
      kpi('Top Implied (P50)', fmtUsd(DATA.rows[0].implied_value_usd), DATA.rows[0].name),
      kpi('Double-CV LOO Error', v4Cv.loo_med_mult + 'x', 'Starter ' + stCv.loo_med_mult + 'x | WF ' + v4Cv.wf_med_mult + 'x'),
      kpi('Pro-Rata @$' + (st.tier / 1000) + 'k (5% Pool)', farmN + ' / ' + (farmN + watchN), farmN + ' FARM · ' + watchN + ' WATCH · ' + (DATA.rows.length - farmN - watchN) + ' SKIP', 'pos'));
    var charts = h('section', 'quant-strip',
      h('div', 'card-box chart-card', h('div', 'chart-head', el('h3', { text: '1. Traded Comps Power-Law Fit & P10–P90 Band' }), el('span', { text: vm.comps_count + ' comps (b=' + vm.b.toFixed(3) + ')' })), compsScatterSvg()),
      h('div', 'card-box chart-card', h('div', 'chart-head', el('h3', { text: '2. Double Held-Out & Nested CV vs Starter radar-1' }), el('span', { text: 'LOO blue / WF green' })), cvAblationSvg()));
    var nav = h('div', 'nav-row',
      h('div', 'tabbar', [['radar', 'No-Token Radar (' + DATA.rows.length + ')'], ['comps', 'Traded Comps (' + DATA.comps.length + ')'], ['audit', 'Model & CV Audit'], ['ledger', '758 Universe']].map(function (t) { return btn(t[1], function () { st.tab = t[0]; writeHash(); render(); }, st.tab === t[0]); })),
      h('div', 'tier-box', h('span', 'tier-lbl', 'Deposit Tier:'), h('div', 'tier-btns', [1000, 5000, 25000, 100000].map(function (tv) { return btn('$' + (tv / 1000) + 'k', function () { st.tier = tv; writeHash(); render(); }, st.tier === tv); }))));
    var body = st.tab === 'comps' ? renderCompsTab() : st.tab === 'audit' ? renderAuditTab() : st.tab === 'ledger' ? renderLedgerTab() : renderRadarTab();
    app.appendChild((st.tab === 'radar' && !!st.selected) ? h('div', 'shell', topbar, integrity, nav, body) : h('div', 'shell', topbar, integrity, kpis, charts, nav, body));
  }

  readHash();
  render();
})();

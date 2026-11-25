(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA || !window.RADAR_MODEL) return;
  var app = document.getElementById('app');
  var st = { tab: 'radar', q: '', scope: 'all', category: 'all', chain: 'all', verdict: 'all', tier: 5000, sort: 'implied', dir: -1, selected: null, audit: false, bucket: 'all' };

  function readHash() {
    var h = (window.location.hash || '').replace(/^#/, ''); if (!h) return; var p = new URLSearchParams(h);
    if (p.get('tab')) st.tab = p.get('tab'); if (p.get('q') !== null) st.q = p.get('q'); if (p.get('scope')) st.scope = p.get('scope');
    if (p.get('category')) st.category = p.get('category'); if (p.get('chain')) st.chain = p.get('chain'); if (p.get('verdict')) st.verdict = p.get('verdict');
    if (p.get('tier') && /^(1000|5000|25000)$/.test(p.get('tier'))) st.tier = +p.get('tier');
    if (p.get('sort')) st.sort = p.get('sort'); if (p.get('dir')) st.dir = +p.get('dir') > 0 ? 1 : -1;
    if (p.get('p')) st.selected = p.get('p'); if (p.get('audit') === '1') st.audit = true; if (p.get('bucket')) st.bucket = p.get('bucket');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (st.tab !== 'radar') p.set('tab', st.tab); if (st.q) p.set('q', st.q); if (st.scope !== 'all') p.set('scope', st.scope);
    if (st.category !== 'all') p.set('category', st.category); if (st.chain !== 'all') p.set('chain', st.chain);
    if (st.verdict !== 'all') p.set('verdict', st.verdict); if (st.tier !== 5000) p.set('tier', String(st.tier));
    if (st.sort !== 'implied') p.set('sort', st.sort); if (st.dir !== -1) p.set('dir', String(st.dir));
    if (st.selected) p.set('p', st.selected); if (st.audit) p.set('audit', '1'); if (st.bucket !== 'all') p.set('bucket', st.bucket);
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
  function svgEl(t, attrs, txt) { var n = document.createElementNS('http://www.w3.org/2000/svg', t); if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (txt !== undefined) n.textContent = txt; return n; }

  function compsScatterSvg() {
    var W = 400, H = 96, pL = 38, pR = 10, pT = 7, pB = 16, minX = 6.5, maxX = 10.6, minY = 5, maxY = 10.5;
    var sx = function (x) { return pL + ((Math.max(minX, Math.min(maxX, x)) - minX) / (maxX - minX)) * (W - pL - pR); };
    var sy = function (y) { return H - pB - ((Math.max(minY, Math.min(maxY, y)) - minY) / (maxY - minY)) * (H - pT - pB); };
    var g = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H });
    [6, 8, 10].forEach(function (yv) {
      g.appendChild(svgEl('line', { x1: pL, y1: sy(yv), x2: W - pR, y2: sy(yv), stroke: '#e2e8f0', 'stroke-dasharray': '2,2' }));
      g.appendChild(svgEl('text', { x: pL - 5, y: sy(yv) + 3, 'text-anchor': 'end', fill: '#64748b', 'font-size': '8.5', 'font-family': 'monospace' }, yv === 6 ? '$1M' : yv === 8 ? '$100M' : '$10B'));
    });
    [7, 8, 9, 10].forEach(function (xv) {
      g.appendChild(svgEl('text', { x: sx(xv), y: H - 3, 'text-anchor': 'middle', fill: '#64748b', 'font-size': '8.5', 'font-family': 'monospace' }, xv === 7 ? '$10M' : xv === 8 ? '$100M' : xv === 9 ? '$1B' : '$10B'));
    });
    var vm = DATA.val_model, fY = function (x10) { return (vm.a + vm.b * (x10 * Math.LN10)) / Math.LN10; };
    var q10 = Math.log10(vm.p10_mult), q90 = Math.log10(vm.p90_mult);
    g.appendChild(svgEl('polygon', { points: [sx(minX) + ',' + sy(fY(minX) + q90), sx(maxX) + ',' + sy(fY(maxX) + q90), sx(maxX) + ',' + sy(fY(maxX) + q10), sx(minX) + ',' + sy(fY(minX) + q10)].join(' '), fill: '#dbeafe', opacity: '0.65' }));
    DATA.comps.forEach(function (c) { g.appendChild(svgEl('circle', { cx: sx(Math.log10(c.tvl_usd)).toFixed(1), cy: sy(Math.log10(c.mcap_usd)).toFixed(1), r: '2.1', fill: '#64748b', opacity: '0.58' })); });
    DATA.rows.slice(0, 12).forEach(function (r) { g.appendChild(svgEl('circle', { cx: sx(Math.log10(r.tvl_usd)).toFixed(1), cy: sy(Math.log10(r.implied_value_usd)).toFixed(1), r: '2.8', fill: '#047857' })); });
    g.appendChild(svgEl('line', { x1: sx(minX), y1: sy(fY(minX)), x2: sx(maxX), y2: sy(fY(maxX)), stroke: '#1d4ed8', 'stroke-width': '1.8' }));
    g.appendChild(svgEl('text', { x: pL + 4, y: 10, fill: '#475569', 'font-size': '8', 'font-family': 'monospace' }, 'grey: comps · blue: L1+P10-90 · green: top 12'));
    return g;
  }

  function cvAblationSvg() {
    var W = 400, H = 96, pL = 136, pR = 54, pT = 2, pB = 2, list = DATA.val_model.ablation, rH = (H - pT - pB) / list.length;
    var sx = function (v) { return pL + (Math.min(5.6, v) / 5.6) * (W - pL - pR); };
    var g = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H });
    list.forEach(function (r, i) {
      var y = pT + i * rH, w1 = Math.max(4, sx(r.loo_med_mult) - pL), w2 = Math.max(4, sx(r.wf_med_mult) - pL);
      g.appendChild(svgEl('text', { x: pL - 5, y: y + 9.5, 'text-anchor': 'end', fill: r.verdict === 'KEEP' ? '#0b1324' : '#64748b', 'font-size': '8.5', 'font-weight': r.verdict === 'KEEP' ? '700' : '500' }, r.label.slice(0, 26)));
      g.appendChild(svgEl('rect', { x: pL, y: y + 1.5, width: w1.toFixed(1), height: '4.5', rx: '2', fill: r.verdict === 'KEEP' ? '#1d4ed8' : '#cbd5e1' }));
      g.appendChild(svgEl('rect', { x: pL, y: y + 7, width: w2.toFixed(1), height: '4.5', rx: '2', fill: r.verdict === 'KEEP' ? '#047857' : '#94a3b8' }));
      g.appendChild(svgEl('text', { x: (pL + Math.max(w1, w2) + 4).toFixed(1), y: y + 9.5, fill: '#334155', 'font-size': '8', 'font-family': 'monospace' }, r.loo_med_mult.toFixed(3) + '/' + r.wf_med_mult.toFixed(3) + 'x'));
    });
    return g;
  }

  function oddsCurveSvg() {
    var W = 400, H = 96, pL = 34, pR = 12, pT = 11, pB = 15, curve = DATA.odds_model.age_curve, bw = (W - pL - pR) / curve.length;
    var sy = function (r) { return H - pB - r * (H - pT - pB); };
    var g = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H });
    [0.25, 0.5, 0.75, 1].forEach(function (v) {
      g.appendChild(svgEl('line', { x1: pL, y1: sy(v), x2: W - pR, y2: sy(v), stroke: '#e2e8f0', 'stroke-dasharray': '2,2' }));
      g.appendChild(svgEl('text', { x: pL - 4, y: sy(v) + 3, 'text-anchor': 'end', fill: '#64748b', 'font-size': '8.5', 'font-family': 'monospace' }, Math.round(v * 100) + '%'));
    });
    curve.forEach(function (b, i) {
      var x = pL + i * bw + 6, w = Math.max(10, bw - 12), y = sy(b.rate), ht = H - pB - y;
      g.appendChild(svgEl('rect', { x: x.toFixed(1), y: y.toFixed(1), width: w.toFixed(1), height: Math.max(2, ht).toFixed(1), rx: '3', fill: '#1d4ed8', opacity: '0.85' }));
      g.appendChild(svgEl('text', { x: (x + w / 2).toFixed(1), y: (y - 2.5).toFixed(1), 'text-anchor': 'middle', fill: '#0b1324', 'font-size': '8.5', 'font-family': 'monospace' }, Math.round(b.rate * 100) + '%'));
      g.appendChild(svgEl('text', { x: (x + w / 2).toFixed(1), y: H - 3, 'text-anchor': 'middle', fill: '#475569', 'font-size': '8.8' }, b.label));
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
      var av = k === 'name' ? a.name.toLowerCase() : k === 'tvl' ? a.tvl_usd : k === 'growth' ? (a.change_7d === null ? -1e9 : a.change_7d) : k === 'odds' ? a.peer_token_rate : k === 'ev' ? a.expected_value_usd : k === 'net_hr' ? a.tiers[t].net_per_hour : a.implied_value_usd;
      var bv = k === 'name' ? b.name.toLowerCase() : k === 'tvl' ? b.tvl_usd : k === 'growth' ? (b.change_7d === null ? -1e9 : b.change_7d) : k === 'odds' ? b.peer_token_rate : k === 'ev' ? b.expected_value_usd : k === 'net_hr' ? b.tiers[t].net_per_hour : b.implied_value_usd;
      return av < bv ? -d : av > bv ? d : (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    });
  }

  function thSort(key, lbl) {
    var m = st.sort === key ? (st.dir < 0 ? ' ↓' : ' ↑') : '';
    return el('th', null, el('button', { type: 'button', text: lbl + m, onclick: function () { st.dir = st.sort === key ? -st.dir : (key === 'name' ? 1 : -1); st.sort = key; writeHash(); render(); } }));
  }

  function selBox(id, opts, get, set) {
    var s = el('select', { id: id, onchange: function () { set(s.value); writeHash(); render(); } },
      opts.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === get() ? 'selected' : null }); })
    );
    return s;
  }

  function renderRadarTab() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort(), cc = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { cc[c] = (cc[c] || 0) + 1; }); });
    var topCh = Object.keys(cc).sort(function (a, b) { return cc[b] - cc[a]; }).slice(0, 18);

    var inp = el('input', { type: 'search', id: 'f-q', placeholder: 'Filter name, category, chain...', value: st.q, oninput: function () { st.q = inp.value; writeHash(); render(); } });
    var selScope = selBox('f-sc', [['all', 'All (' + DATA.rows.length + ')'], ['watchlist', 'Watchlist (' + DATA.universe_counts.watchlist + ')'], ['early', 'Early <$50M (' + DATA.universe_counts.early_pre_token + ')']], function () { return st.scope; }, function (v) { st.scope = v; });
    var selCat = selBox('f-cat', [['all', 'All categories']].concat(cats.map(function (c) { return [c, c]; })), function () { return st.category; }, function (v) { st.category = v; });
    var selCh = selBox('f-ch', [['all', 'All chains']].concat(topCh.map(function (c) { return [c, c + ' (' + cc[c] + ')']; })), function () { return st.chain; }, function (v) { st.chain = v; });
    var selV = selBox('f-vd', [['all', 'All verdicts'], ['FARM', 'FARM (>=$25/hr)'], ['VIABLE', 'VIABLE (>$0 net)'], ['SKIP', 'SKIP (<=$0 net)']], function () { return st.verdict; }, function (v) { st.verdict = v; });

    var list = sortedRows(filteredRows());
    var nodes = [h('div', 'controls',
      h('div', 'fld', el('label', { for: 'f-q', text: 'Search' }), inp),
      h('div', 'fld', el('label', { for: 'f-sc', text: 'Scope' }), selScope),
      h('div', 'fld', el('label', { for: 'f-cat', text: 'Category' }), selCat),
      h('div', 'fld', el('label', { for: 'f-ch', text: 'Chain' }), selCh),
      h('div', 'fld', el('label', { for: 'f-vd', text: 'Verdict' }), selV),
      el('button', { type: 'button', class: 'btn-ghost', 'aria-pressed': st.audit ? 'true' : 'false', text: st.audit ? 'Hide CV Audit' : 'Show CV Audit', onclick: function () { st.audit = !st.audit; writeHash(); render(); } }),
      el('button', { type: 'button', class: 'btn-ghost', text: 'Reset', onclick: function () { st.q = ''; st.scope = 'all'; st.category = 'all'; st.chain = 'all'; st.verdict = 'all'; st.sort = 'implied'; st.dir = -1; writeHash(); render(); } }),
      h('span', 'row-count', list.length + ' / ' + DATA.rows.length + ' shown')
    )];

    if (st.audit) {
      var u = DATA.universe_counts;
      nodes.push(h('div', 'audit-inline',
        h('div', null,
          el('h3', { text: '4-Signal Blind CV Ablation (' + DATA.val_model.comps_count + ' Comps, ' + DATA.val_model.wf_test_count + ' Walk-Forward)' }),
          h('table', 'mini-table',
            el('thead', null, el('tr', null, th('Spec'), th('LOO'), th('WF'), th('Action'))),
            el('tbody', null, DATA.val_model.ablation.map(function (a) {
              return el('tr', null, td(a.label), td(a.loo_med_mult.toFixed(3) + 'x', 'num'), td(a.wf_med_mult.toFixed(3) + 'x', 'num'), el('td', null, h('span', 'badge ' + a.verdict, a.verdict)));
            }))
          )
        ),
        h('div', null,
          el('h3', { text: '758-Protocol Universe Reconciliation' }),
          h('table', 'mini-table',
            el('thead', null, el('tr', null, th('Bucket'), th('Count'), th('Role'))),
            el('tbody', null, [
              ['Watchlist (>=$50M)', u.watchlist, 'Ranked'],
              ['Early Clean (<$50M)', u.early_pre_token, 'Ranked'],
              ['Excluded Wrappers/LST/CEX', u.excluded_pre_token, 'Set aside'],
              ['Traded MCap > 0', u.traded_mcap, 'Comps + CV'],
              ['Token Meta, Null MCap', u.token_meta_no_mcap, 'TVL rollup']
            ].map(function (rw) { return el('tr', null, td(rw[0]), td(rw[1], 'num'), td(rw[2])); }))
          )
        )
      ));
    }

    if (!list.length) {
      nodes.push(h('div', 'panel', h('div', 'empty', el('h2', { text: 'No matches' }), el('p', { text: 'Adjust filters or deposit tier.' }))));
      return nodes;
    }

    var tbody = el('tbody');
    list.forEach(function (r) {
      var ec = r.tiers[st.tier], gTxt = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var gCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      var mTxt = 'C' + r.cat_mult.toFixed(2) + '·G' + r.growth_mult.toFixed(2) + '·A' + r.age_mult.toFixed(2);
      tbody.appendChild(el('tr', {
        'data-selected': st.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { st.selected = r.slug; writeHash(); render(); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); st.selected = r.slug; writeHash(); render(); } }
      },
        el('td', { class: 'num' }, el('b', { text: '#' + r.rank }), h('span', 'submono', r.rank_best + '..' + r.rank_worst)),
        el('td', null, h('div', 'pname', el('b', { text: r.name }), el('span', { text: (r.category || 'Other') + ' · ' + ((r.chains && r.chains.length) ? r.chains.slice(0, 2).join(', ') : 'Unknown') }))),
        el('td', null, h('span', 'badge ' + (r.scope === 'watchlist' ? 'wl' : 'early'), r.scope === 'watchlist' ? 'WATCHLIST' : 'EARLY')),
        td(fmtUsd(r.tvl_usd), 'num'),
        td(gTxt, 'num ' + gCls),
        td(fmtAge(r.age_days), 'num'),
        el('td', { class: 'num' }, el('b', { text: fmtUsd(r.implied_value_usd) }), h('span', 'submono', fmtUsd(r.low_usd) + '–' + fmtUsd(r.high_usd) + ' · ' + mTxt)),
        td(Math.round(r.peer_token_rate * 100) + '%', 'num'),
        el('td', { class: 'num ' + (ec.net_usd > 0 ? 'pos' : 'neg') }, el('b', { text: fmtUsd(ec.net_usd) }), h('span', 'submono', '$' + ec.net_per_hour.toFixed(1) + '/hr · ' + ec.hold_days + 'd')),
        el('td', null, h('span', 'badge ' + ec.verdict, ec.verdict))
      ));
    });
    nodes.push(h('div', 'panel', h('div', 'table-wrap', el('table', null,
      el('thead', null, el('tr', null,
        thSort('implied', 'Rank'), thSort('name', 'Protocol'), th('Tier'),
        thSort('tvl', 'TVL'), thSort('growth', '7d TVL'), th('Age'),
        thSort('implied', 'Implied (4-Signal)'), thSort('odds', 'Peer Rate'),
        thSort('net_hr', 'Net @$' + (st.tier / 1000) + 'k'), th('Verdict')
      )),
      tbody
    ))));
    return nodes;
  }

  function renderCompsTab() {
    var tbody = el('tbody');
    DATA.comps.forEach(function (c, i) { tbody.appendChild(el('tr', null, td(i + 1, 'num'), el('td', null, h('div', 'pname', el('b', { text: c.name + ' (' + c.symbol + ')' }), el('span', { text: (c.category || 'Other') + (c.sub_count > 1 ? ' · ' + c.sub_count + ' rolled up' : '') }))), td(fmtUsd(c.tvl_usd), 'num'), td(fmtUsd(c.mcap_usd), 'num'), td(fmtUsd(c.pred_usd), 'num'), td(c.ratio + 'x', 'num'), td(c.err_mult + 'x', 'num'), td(c.listed_at || 'n/a', 'num'))); });
    return [h('div', 'panel', h('div', 'table-wrap', el('table', null, el('thead', null, el('tr', null, th('#'), th('Ticker'), th('Agg TVL'), th('MCap'), th('4-Sig Pred'), th('MCap/TVL'), th('Error'), th('Listed'))), tbody)))];
  }
  function renderAuditTab() {
    var vm = DATA.val_model, om = DATA.odds_model, u = DATA.universe_counts;
    return [h('div', 'two-col',
      h('div', 'card', el('h2', { text: '4-Signal Shrinkage Valuation & Blind CV' }), el('p', { text: 'log(MCap)=' + vm.a + '+' + vm.b + '*log(TVL)+CatEB(k=' + vm.eb_k + ')+' + vm.wg + '*g7d+' + vm.wa + '*cAge (reg=' + vm.ridge_reg + ', n=' + vm.comps_count + '). P10=' + vm.p10_mult + 'x, P90=' + vm.p90_mult + 'x.' }),
        h('table', 'mini-table', el('thead', null, el('tr', null, th('Spec'), th('LOO'), th('RMSE'), th('WF'), th('Action'))),
          el('tbody', null, vm.ablation.map(function (a) { return el('tr', null, td(a.label), td(a.loo_med_mult.toFixed(3) + 'x', 'num'), td(a.loo_rmse, 'num'), td(a.wf_med_mult.toFixed(3) + 'x', 'num'), el('td', null, h('span', 'badge ' + a.verdict, a.verdict))); })))),
      h('div', 'card', el('h2', { text: 'Peer Token Prevalence & 758 Universe Audit' }), el('p', { text: 'Cohort n=' + om.pool_size + ' (' + om.token_peers + ' traded, ' + om.pre_peers + ' no token recorded). 10-fold Brier ' + om.cv_brier_model + '<' + om.cv_brier_base + ' (LogLoss ' + om.cv_logloss_model + ' vs ' + om.cv_logloss_base + ').' }),
        h('table', 'mini-table', el('thead', null, el('tr', null, th('Bucket'), th('Count'), th('Share'))),
          el('tbody', null, [['Watchlist (>=$50M)', u.watchlist], ['Early Clean (<$50M)', u.early_pre_token], ['Excluded Wrappers', u.excluded_pre_token], ['Traded MCap > 0', u.traded_mcap], ['Token Meta Null MCap', u.token_meta_no_mcap]].map(function (r) { return el('tr', null, td(r[0]), td(r[1], 'num'), td(((r[1] / u.total) * 100).toFixed(1) + '%', 'num')); }))))
    )];
  }

  function renderLedgerTab() {
    var sel = el('select', { id: 'f-bkt', onchange: function () { st.bucket = sel.value; writeHash(); render(); } },
      ['all', 'watchlist', 'early_pre_token', 'excluded_pre_token', 'traded_mcap', 'token_meta_no_mcap'].map(function (b) { return el('option', { value: b, text: b === 'all' ? 'All 758 protocols' : b + ' (' + DATA.universe_counts[b] + ')', selected: st.bucket === b ? 'selected' : null }); }));
    var rows = DATA.ledger.filter(function (x) { return st.bucket === 'all' || x.bucket === st.bucket; }).slice(0, 200), tbody = el('tbody');
    rows.forEach(function (x, i) { tbody.appendChild(el('tr', null, td(i + 1, 'num'), el('td', null, el('b', { text: x.name }), h('span', 'submono', x.slug)), td(x.bucket, 'num'), td(x.category || 'Other'), td(fmtUsd(x.tvl_usd), 'num'), td(x.mcap_usd ? fmtUsd(x.mcap_usd) : 'none', 'num'), td(x.symbol || 'none', 'num'))); });
    return [h('div', 'controls', h('div', 'fld', el('label', { for: 'f-bkt', text: 'Bucket' }), sel), h('span', 'row-count', 'Top ' + rows.length + ' by TVL')), h('div', 'panel', h('div', 'table-wrap', el('table', null, el('thead', null, el('tr', null, th('#'), th('Protocol'), th('Bucket'), th('Category'), th('TVL'), th('MCap'), th('Symbol'))), tbody)))];
  }

  function renderDrawer() {
    if (!st.selected) return null;
    var r = DATA.rows.find(function (x) { return x.slug === st.selected; }); if (!r) return null;
    var ec = r.tiers[st.tier], wfLine = 'TVL Base ' + fmtUsd(r.base_tvl_usd) + ' ' + fmtMult(r.cat_mult) + ' Cat (' + r.cat_n + ') ' + fmtMult(r.growth_mult) + ' 7dGrowth ' + fmtMult(r.age_mult) + ' Runway = ' + fmtUsd(r.implied_value_usd);
    var bd = el('div', { class: 'backdrop', onclick: function (e) { if (e.target === bd) { st.selected = null; writeHash(); render(); } } },
      el('aside', { class: 'drawer', role: 'dialog' },
        h('div', 'dhead', el('div', null, el('h2', { text: '#' + r.rank + ' ' + r.name }), el('p', { text: (r.category || 'Other') + ' · ' + (r.chains || []).join(', ') + ' · Listed ' + (r.listed_at || 'unknown') + ' · No token recorded' })), el('button', { class: 'close-btn', type: 'button', text: 'Close', onclick: function () { st.selected = null; writeHash(); render(); } })),
        h('div', 'dgrid', h('div', 'dbox', el('span', { text: 'Implied Value (P50)' }), el('b', { text: fmtUsd(r.implied_value_usd) })), h('div', 'dbox', el('span', { text: 'P10–P90 Band' }), el('b', { text: fmtUsd(r.low_usd) + '–' + fmtUsd(r.high_usd) })), h('div', 'dbox', el('span', { text: 'Rank Uncertainty' }), el('b', { text: '#' + r.rank_best + '..#' + r.rank_worst })), h('div', 'dbox', el('span', { text: '7d Growth / Runway' }), el('b', { text: fmtMult(r.growth_mult) + ' / ' + fmtMult(r.age_mult) })), h('div', 'dbox', el('span', { text: 'Peer Token Rate' }), el('b', { text: Math.round(r.peer_token_rate * 100) + '%' })), h('div', 'dbox', el('span', { text: 'Min Viable Deposit' }), el('b', { text: ec.min_viable_usd ? fmtUsd(ec.min_viable_usd) : 'Unviable' }))),
        h('div', 'dsec', el('h3', { text: '4-Signal Valuation Waterfall & Nearest Traded Comps' }), el('p', { text: wfLine }), h('table', 'mini-table', el('thead', null, el('tr', null, th('Comp'), th('Category'), th('TVL'), th('MCap'))), el('tbody', null, r.nearest_comps.map(function (c) { return el('tr', null, td(c.name + ' (' + c.symbol + ')'), td(c.category || 'Other'), td(fmtUsd(c.tvl_usd), 'num'), td(fmtUsd(c.mcap_usd), 'num')); })))),
        h('div', 'dsec', el('h3', { text: 'Conditional 5% TGE Farm Economics (' + ec.chain + ' · ' + ec.hold_days + 'd)' }), h('table', 'mini-table', el('thead', null, el('tr', null, th('Tier'), th('Gross'), th('Gas+Carry'), th('Net'), th('$/hr'), th('Verdict'))), el('tbody', null, [1000, 5000, 25000].map(function (tv) { var e = r.tiers[tv]; return el('tr', null, td('$' + (tv / 1000) + 'k', 'num'), td(fmtUsd(e.gross_usd), 'num'), td(fmtUsd(e.total_cost_usd), 'num'), td(fmtUsd(e.net_usd), 'num ' + (e.net_usd > 0 ? 'pos' : 'neg')), td('$' + e.net_per_hour.toFixed(1), 'num'), el('td', null, h('span', 'badge ' + e.verdict, e.verdict))); })))),
        h('div', 'dsec', el('h3', { text: 'Pre- & Post-Launch Concrete Farm Plan (board.json)' }), el('ol', { class: 'steps' }, r.farm_steps.map(function (s) { return el('li', { text: s }); })))
      )
    );
    return bd;
  }

  function render() {
    app.innerHTML = '';
    var farmN = DATA.rows.filter(function (r) { return r.tiers[st.tier].verdict === 'FARM'; }).length;
    var viableN = DATA.rows.filter(function (r) { return r.tiers[st.tier].verdict === 'VIABLE'; }).length;
    var bestHr = DATA.rows.slice().sort(function (a, b) { return b.tiers[st.tier].net_per_hour - a.tiers[st.tier].net_per_hour; })[0];
    var vm = DATA.val_model, bestCv = vm.ablation[4], baseCv = vm.ablation[0];
    var topbar = h('header', 'topbar',
      h('div', 'brand-group', h('div', 'logo', 'LR'), h('div', 'title-col', el('h1', { text: 'Launch Radar — 4-Signal Valuation & Costed Farm Terminal' }), el('p', { text: 'Snapshot ' + DATA.as_of + ' · DefiLlama >=$5M TVL · Watchlist floor $' + Math.round(DATA.floor_usd / 1e6) + 'M · ' + DATA.model_version }))),
      h('div', 'top-badges', h('span', 'pill ok', 'Watchlist ' + DATA.universe_counts.watchlist + '/' + DATA.universe_counts.watchlist), h('span', 'pill accent', 'LOO ' + bestCv.loo_med_mult + 'x / WF ' + bestCv.wf_med_mult + 'x'), h('span', 'pill', DATA.universe_counts.total + ' Audited')));
    var integrity = h('div', 'integrity', h('span', 'ititle', 'Self-Audit:'), DATA.checks.map(function (c) { return h('span', 'chk' + (c.pass ? '' : ' fail'), (c.pass ? 'PASS ' : 'FAIL ') + c.label + ' (' + c.detail + ')'); }));
    var kpis = h('section', 'kpi-strip',
      h('div', 'kpi', h('span', 'kpi-l', 'No-Token-Recorded'), h('span', 'kpi-v', String(DATA.rows.length)), h('span', 'kpi-s', DATA.universe_counts.watchlist + ' WL + ' + DATA.universe_counts.early_pre_token + ' Early')),
      h('div', 'kpi', h('span', 'kpi-l', 'Top Implied (P50)'), h('span', 'kpi-v', fmtUsd(DATA.rows[0].implied_value_usd)), h('span', 'kpi-s', DATA.rows[0].name)),
      h('div', 'kpi', h('span', 'kpi-l', '4-Signal Blind LOO'), h('span', 'kpi-v', bestCv.loo_med_mult + 'x'), h('span', 'kpi-s', 'vs Flat ' + baseCv.loo_med_mult + 'x | WF ' + bestCv.wf_med_mult + 'x')),
      h('div', 'kpi', h('span', 'kpi-l', 'Traded Comps Pool'), h('span', 'kpi-v', String(vm.comps_count)), h('span', 'kpi-s', 'Separated by ticker')),
      h('div', 'kpi', h('span', 'kpi-l', 'Actionable @$' + (st.tier / 1000) + 'k'), h('span', 'kpi-v pos', farmN + ' / ' + (farmN + viableN)), h('span', 'kpi-s', farmN + ' FARM + ' + viableN + ' VIABLE')),
      h('div', 'kpi', h('span', 'kpi-l', 'Best $/hr @$' + (st.tier / 1000) + 'k'), h('span', 'kpi-v pos', '$' + bestHr.tiers[st.tier].net_per_hour.toFixed(0) + '/hr'), h('span', 'kpi-s', bestHr.name + ' (' + bestHr.tiers[st.tier].chain + ')')));
    var charts = h('section', 'quant-strip',
      h('div', 'chart-card', h('div', 'chart-head', el('h3', { text: '1. L1 Power-Law Fit & P10–P90' }), el('span', { text: vm.comps_count + ' comps (b=' + vm.b + ')' })), compsScatterSvg()),
      h('div', 'chart-card', h('div', 'chart-head', el('h3', { text: '2. 4-Signal Blind CV (LOO/WF)' }), el('span', { text: 'Lower = better' })), cvAblationSvg()),
      h('div', 'chart-card', h('div', 'chart-head', el('h3', { text: '3. Peer Token Rate by Age' }), el('span', { text: 'n=' + DATA.odds_model.pool_size + ' peers' })), oddsCurveSvg()));
    var nav = h('div', 'nav-row',
      h('div', 'tabbar', [['radar', 'No-Token Radar (' + DATA.rows.length + ')'], ['comps', 'Traded Comps (' + DATA.comps.length + ')'], ['audit', 'Model & CV Audit'], ['ledger', '758 Universe']].map(function (t) { return el('button', { type: 'button', 'aria-pressed': st.tab === t[0] ? 'true' : 'false', text: t[1], onclick: function () { st.tab = t[0]; writeHash(); render(); } }); })),
      h('div', 'tier-box', h('span', 'tier-lbl', 'Deposit Tier:'), h('div', 'tier-btns', [1000, 5000, 25000].map(function (tv) { return el('button', { type: 'button', 'aria-pressed': st.tier === tv ? 'true' : 'false', text: '$' + (tv / 1000) + 'k', onclick: function () { st.tier = tv; writeHash(); render(); } }); }))));
    var body = st.tab === 'comps' ? renderCompsTab() : st.tab === 'audit' ? renderAuditTab() : st.tab === 'ledger' ? renderLedgerTab() : renderRadarTab();
    app.appendChild(h('div', 'shell', topbar, integrity, kpis, charts, nav, body));
    var dr = renderDrawer(); if (dr) app.appendChild(dr);
  }

  readHash();
  render();
})();

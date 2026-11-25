// Token Launch Radar's page logic. It reads window.RADAR — the dataset main.ts wrote beside this
// page from the same run that wrote board.json — and renders the ranked board, a sortable and
// filterable table, a per-protocol detail drawer with the model's own factors and the farm plan, a
// live-token view, and the method section. No network: every byte it shows came from the local file.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');

  var state = {
    q: '', category: 'all', chain: 'all', min: 0, wl: false,
    tab: 'board', sort: 'rank', dir: -1, selected: null
  };

  var MAXIMPLIED = 1;

  // ---------------------------------------------------------------- formats
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return '$' + Math.round(n / 1e3).toLocaleString('en-US') + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtFull(n) { return n === null || n === undefined ? 'n/a' : '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 1) return '<1d';
    if (days < 365) return Math.round(days) + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function fmtMult(m) { return (Math.round(m * 10000) / 10000) + 'x'; }

  // ------------------------------------------------------- the model, mirrored
  // The page recomputes each row's implied value from the same constants board.json used, so a
  // reader can see the page's arithmetic and the board's data agree.
  function momentumValue(row) {
    var m = DATA.model;
    var raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var clamped = Math.min(m.momentum_cap, Math.max(m.momentum_floor, raw));
    return 1 + (clamped / 100) * m.momentum_weight;
  }
  function readinessValue(ageDays) {
    var m = DATA.model;
    if (ageDays < m.readiness_ramp_end) {
      return m.readiness_day0 + (m.readiness_at_ramp_end - m.readiness_day0) * (Math.max(0, ageDays) / m.readiness_ramp_end);
    }
    if (ageDays <= m.prime_end_day) return 1;
    if (ageDays <= m.stale_end_day) {
      return 1 - (1 - m.readiness_stale) * ((ageDays - m.prime_end_day) / (m.stale_end_day - m.prime_end_day));
    }
    return m.readiness_stale;
  }
  function readinessForRow(row) {
    var age = row.age_days === null || row.age_days === undefined ? (DATA.median_pre_token_age || 365) : row.age_days;
    return readinessValue(age);
  }
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * momentumValue(row) * readinessForRow(row)));
  }

  // ---------------------------------------------------------------- hash state
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('min')) state.min = Number(p.get('min')) || 0;
    state.wl = p.get('wl') === '1';
    if (p.get('tab')) state.tab = p.get('tab') === 'live' ? 'live' : 'board';
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir')) state.dir = Number(p.get('dir')) === 1 ? 1 : -1;
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.min) p.set('min', String(state.min));
    if (state.wl) p.set('wl', '1');
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.dir !== -1) p.set('dir', String(state.dir));
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    try { window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search); } catch (e) { /* file:// pages may refuse; filters stay applied in memory */ }
  }

  // ---------------------------------------------------------------- filtering + sorting
  var catList = null, chainList = null;
  function categories() {
    if (!catList) {
      var seen = {};
      catList = [];
      DATA.rows.forEach(function (r) {
        var c = r.category || 'Other';
        if (!seen[c]) { seen[c] = true; catList.push(c); }
      });
      catList.sort();
    }
    return catList;
  }
  function chains() {
    if (!chainList) {
      var seen = {};
      chainList = [];
      DATA.rows.forEach(function (r) {
        (r.chains || []).forEach(function (c) { if (!seen[c]) { seen[c] = true; chainList.push(c); } });
      });
      chainList.sort();
    }
    return chainList;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.min && r.tvl_usd < state.min) return false;
      if (state.wl && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function valueOf(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null || r.change_7d === undefined ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null || r.age_days === undefined ? Infinity : r.age_days;
    if (key === 'multiple') return r.multiple;
    if (key === 'mcap') return r.mcap_usd === null || r.mcap_usd === undefined ? -Infinity : r.mcap_usd;
    if (key === 'ratio') return r.mcap_tvl_ratio === null || r.mcap_tvl_ratio === undefined ? -Infinity : r.mcap_tvl_ratio;
    return r.implied_value_usd;
  }
  function sortedRows(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = valueOf(a, key), bv = valueOf(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---------------------------------------------------------------- dom helper
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------------------------------------------------------------- header + lede
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', null, el('span', { class: 'brand-name', text: 'Token Launch Radar' }), el('span', { class: 'brand-sub', text: 'pre-token protocols · implied value · farm plans' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of + ' · model ' + DATA.model_version }),
        el('span', { class: 'src', text: DATA.source })
      )
    );
  }
  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, 'Which pre-token protocol is worth farming next, ', el('span', { class: 'dim', text: 'and what to do about it' })),
        el('p', { text: 'Every protocol here records no token in DefiLlama’s index and is not a wrapped, staked or bridged product of one that trades. The watchlist (protocols at or above $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL) is the floor: ' + DATA.early_size + ' early protocols below it are ranked beside them, so a launch can be spotted before it is news. Implied value is a model’s claim — never a price, never a promise.' }),
        top ? el('p', { class: 'fine', text: 'Top of the board: ' + top.name + ' at ' + fmtUsd(top.implied_value_usd) + ' implied — ' + fmtUsd(top.tvl_usd) + ' of TVL, ' + (top.change_7d === null ? 'weekly flows unreported' : fmtPct(top.change_7d) + ' on the week') + ', ' + fmtAge(top.age_days) + ' with no token.' }) : null
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact gold' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + '/' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early, below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live tokens set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Calibrated from live peers' }), el('b', { text: String(DATA.global_count) })),
        el('div', { class: 'fact' }, el('span', { text: 'Board implied value' }), el('b', { text: fmtUsd(DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0)) }))
      )
    );
  }

  // ---------------------------------------------------------------- controls
  function controls() {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain…', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories().map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); renderTable(); });
    var fields = [
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel)
    ];
    if (state.tab === 'board') {
      var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
        el('option', { value: 'all', text: 'All chains' }),
        chains().map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
      );
      chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); renderTable(); });
      var minSel = el('select', { id: 'min', 'aria-label': 'Filter by minimum TVL' },
        [[0, 'Any TVL'], [5e7, '≥ $50M (floor)'], [1e8, '≥ $100M'], [2.5e8, '≥ $250M'], [1e9, '≥ $1B']].map(function (o) {
          return el('option', { value: String(o[0]), text: o[1], selected: state.min === o[0] ? 'selected' : null });
        })
      );
      minSel.addEventListener('change', function () { state.min = Number(minSel.value) || 0; writeHash(); renderTable(); });
      var wl = el('label', { class: 'toggle', 'aria-pressed': state.wl ? 'true' : 'false' },
        el('input', { type: 'checkbox', 'aria-label': 'Watchlist only', checked: state.wl ? 'checked' : null }),
        'Watchlist only'
      );
      wl.addEventListener('click', function (e) { e.preventDefault(); state.wl = !state.wl; writeHash(); renderTable(); });
      fields.push(el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel));
      fields.push(el('div', { class: 'field' }, el('label', { for: 'min', text: 'Min TVL' }), minSel));
      fields.push(wl);
    }
    var boardBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board' });
    var liveBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens' });
    boardBtn.addEventListener('click', function () { if (state.tab !== 'board') { state.tab = 'board'; state.sort = 'rank'; state.dir = -1; writeHash(); render(); } });
    liveBtn.addEventListener('click', function () { if (state.tab !== 'live') { state.tab = 'live'; state.sort = 'mcap'; state.dir = -1; writeHash(); render(); } });
    fields.push(el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, boardBtn, liveBtn)));
    var n = state.tab === 'board' ? rows().length : DATA.live.length;
    fields.push(el('span', { class: 'count', text: state.tab === 'board' ? n + ' of ' + DATA.board_size + ' rows shown' : n + ' live-token protocols' }));
    return el('div', { class: 'controls' }, fields);
  }

  // ---------------------------------------------------------------- board table
  function sortHeader(key, label, extraClass) {
    var active = state.sort === key;
    return el('th', { scope: 'col', class: extraClass || null },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        writeHash(); renderTable();
      } }, label, active ? el('span', { class: 'dir', 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null)
    );
  }
  function chainChips(r, max) {
    var list = (r.chains || []).slice(0, max || 2).map(function (c) { return el('span', { class: 'badge', text: c }); });
    if (r.chains && r.chains.length > (max || 2)) list.push(el('span', { class: 'badge', text: '+' + (r.chains.length - (max || 2)) }));
    return list;
  }
  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Loosen the search or clear a filter to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.min = 0; state.wl = false; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthCls = r.change_7d === null || r.change_7d === undefined ? '' : r.change_7d >= 0 ? 'growth-pos' : 'growth-neg';
      var w = Math.max(2, Math.round((r.implied_value_usd / MAXIMPLIED) * 100));
      tbody.appendChild(el('tr', {
        class: 'row' + (r.rank <= 3 ? ' top3' : ''),
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', { class: 'proto' }, el('div', { class: 'nm' },
          el('b', { text: r.name }),
          r.watchlist ? el('span', { class: 'badge wl', text: 'watchlist' }) : el('span', { class: 'badge early', text: 'early' })
        ), el('div', { class: 'meta', text: r.category || 'Uncategorized' }), el('div', { class: 'meta chips' }, chainChips(r, 2))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthCls, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num mult-cell' }, r.multiple + 'x', el('span', { class: 'src', text: r.multiple_source === 'category' ? 'n=' + r.multiple_sample : 'global' })),
        el('td', { class: 'bar-cell' }, el('div', { class: 'bar' },
          el('span', { class: 'rail', 'aria-hidden': 'true' }, el('i', { class: 'fill', style: 'width:' + w + '%' })),
          el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) })
        ))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL', 'num'),
            sortHeader('growth', '7d', 'num'),
            sortHeader('age', 'No-token age', 'num'),
            sortHeader('multiple', 'Multiple', 'num'),
            sortHeader('implied', 'Implied value', 'num')
          )),
          tbody
        )
      )
    );
  }

  // ---------------------------------------------------------------- live tokens
  function liveFiltered() {
    var q = state.q.trim().toLowerCase();
    return DATA.live.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function liveTable() {
    var list = sortedRows(liveFiltered());
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthCls = r.change_7d === null || r.change_7d === undefined ? '' : r.change_7d >= 0 ? 'growth-pos' : 'growth-neg';
      tbody.appendChild(el('tr', { class: 'row' },
        el('td', { class: 'proto' },
          el('div', { class: 'nm' }, el('b', { text: r.name })),
          el('div', { class: 'meta', text: r.category || 'Uncategorized' }),
          el('div', { class: 'meta chips' }, chainChips(r, 2))
        ),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : r.mcap_tvl_ratio + 'x' }),
        el('td', { class: 'num ' + growthCls, text: fmtPct(r.change_7d) })
      ));
    });
    return el('div', null,
      el('p', { class: 'live-note', text: 'The ' + DATA.live_size + ' protocols that already trade are set aside from the board: a market cap is a fact, so there is nothing to imply. They are the calibration — their mcap÷TVL ratios price every category above.' }),
      el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
        el('caption', { text: 'Live-token protocols, largest market cap first. These are the peers the multiple is read from.' }),
        el('thead', null, el('tr', null,
          sortHeader('name', 'Protocol'),
          sortHeader('mcap', 'Market cap', 'num'),
          sortHeader('tvl', 'TVL', 'num'),
          sortHeader('ratio', 'Mcap÷TVL', 'num'),
          sortHeader('growth', '7d', 'num')
        )),
        tbody
      )))
    );
  }

  // ---------------------------------------------------------------- detail dialog
  var dialog = null;
  function ensureDialog() {
    if (!dialog) {
      dialog = el('dialog', { class: 'detail', 'aria-label': 'Protocol detail' });
      document.body.appendChild(dialog);
      dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDetail(); });
      dialog.addEventListener('cancel', function (e) { e.preventDefault(); closeDetail(); });
    }
    return dialog;
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    if (dialog && dialog.open) dialog.close();
    renderTable();
  }
  function kvRow(label, value, note) {
    return el('tr', null,
      el('td', null, label, note ? el('span', { class: 'note', text: note, style: 'display:block' }) : null),
      el('td', { text: value })
    );
  }
  function whySentence(r) {
    var mult = r.multiple_source === 'category'
      ? 'the snapshot’s own live ' + (r.category || 'peer') + ' protocols trade at a median ' + r.multiple + 'x TVL (n=' + r.multiple_sample + ')'
      : 'too few live peers in ' + (r.category || 'its category') + ' to calibrate, so the snapshot-wide median ' + r.multiple + 'x (n=' + DATA.global_count + ') stands in';
    var growth = r.change_7d === null || r.change_7d === undefined
      ? 'weekly flows are unreported, so momentum sits at its neutral ' + r.momentum + 'x'
      : 'flows moved ' + fmtPct(r.change_7d) + ' on the week, a ' + r.momentum + 'x momentum factor';
    var age = r.age_days === null
      ? 'with no known launch date, readiness uses the pre-token median age of ' + (DATA.median_pre_token_age || 0) + ' days (' + r.readiness + 'x)'
      : 'at ' + fmtAge(r.age_days) + ' with no token, readiness is ' + r.readiness + 'x';
    return r.name + ' holds ' + fmtUsd(r.tvl_usd) + ' of TVL; ' + mult + '; ' + growth + '; and ' + age + '. Multiplied out, a token here would imply about ' + fmtUsd(r.implied_value_usd) + '.';
  }
  function parseStep(text) {
    var costAt = text.indexOf('Cost: ');
    var timeAt = text.indexOf('Time: ');
    var cost = costAt < 0 ? null : (timeAt > costAt ? text.slice(costAt + 6, timeAt) : text.slice(costAt + 6)).trim().replace(/\.$/, '');
    var time = timeAt < 0 ? null : text.slice(timeAt + 6).trim().replace(/\.$/, '');
    var cut = costAt >= 0 && timeAt >= 0 ? Math.min(costAt, timeAt) : costAt >= 0 ? costAt : timeAt;
    var act = cut > 0 ? text.slice(0, cut) : text;
    return { act: act.trim(), cost: cost, time: time };
  }
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { r = DATA.rows[i]; break; }
    if (!r) return;
    state.selected = slug;
    writeHash();
    var m = DATA.model;
    var clamped = r.change_7d === null ? null : Math.min(m.momentum_cap, Math.max(m.momentum_floor, r.change_7d));
    var recomputed = impliedOf(r);
    var kv = el('table', { class: 'kv' }, el('tbody', null,
      kvRow('TVL', fmtFull(r.tvl_usd), null),
      kvRow('× multiple', r.multiple + 'x', r.multiple_source === 'category' ? 'median of ' + r.multiple_sample + ' live peers in ' + (r.category || 'its category') : 'global median over ' + DATA.global_count + ' live peers (thin sample)'),
      kvRow('× momentum', r.momentum + 'x', r.change_7d === null ? 'flows unreported → neutral' : '7d ' + fmtPct(r.change_7d) + (clamped !== r.change_7d ? ' → clamped to ' + fmtPct(clamped) : '')),
      kvRow('× readiness', r.readiness + 'x', r.age_days === null ? 'age unknown → pre-token median ' + (DATA.median_pre_token_age || 0) + 'd' : fmtAge(r.age_days) + ' without a token'),
      el('tr', { class: 'total' }, el('td', { text: '= implied value' }), el('td', { text: fmtFull(r.implied_value_usd) }))
    ));
    var steps = el('ol', { class: 'steps' });
    r.farm_steps.forEach(function (s) {
      var p = parseStep(s);
      steps.appendChild(el('li', null,
        el('div', { class: 'act', text: p.act }),
        el('div', { class: 'cost' },
          p.cost ? el('span', { class: 'pill c', text: 'Cost: ' + p.cost }) : null,
          p.time ? el('span', { class: 'pill', text: 'Time: ' + p.time }) : null
        )
      ));
    });
    var head = el('div', { class: 'detail-head' },
      el('div', null,
        el('div', { class: 'kicker', text: 'Rank ' + r.rank + (r.watchlist ? ' · watchlist' : ' · early, below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor') }),
        el('h2', { text: r.name }),
        el('div', { class: 'meta' },
          el('span', { class: 'chip', text: r.category || 'Uncategorized' }),
          el('span', { text: ' · listed ' + (r.listed_at || 'unknown') + ' · ' + (r.age_days === null ? 'no known launch date' : fmtAge(r.age_days) + ' without a token') })
        ),
        el('span', { class: 'chips' }, chainChips(r, 6))
      ),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: closeDetail })
    );
    var body = el('div', { class: 'detail-body' },
      el('div', { class: 'why', text: whySentence(r) }),
      el('div', { class: 'detail-grid' },
        el('div', null,
          el('h3', { text: 'Model breakdown' }),
          kv,
          el('p', { class: 'detail-note', text: 'The page recomputes this row from the same constants: ' + fmtFull(recomputed) + (recomputed === r.implied_value_usd ? ' — matches board.json.' : ' — differs from board.json; that would be a bug.') })
        ),
        el('div', null,
          el('h3', { text: 'Farm plan' }),
          el('p', { class: 'detail-note', text: 'What a retroactive position here takes. Costs are bands read off the protocol’s chains and size, not quotes; times are the calendar the steps realistically need.' }),
          steps
        )
      ),
      el('p', { class: 'detail-note', text: 'Implied value is this model’s estimate of what a token launch would imply — never a price, never a promise, never advice. “Records no token” means the snapshot’s index carries no token today; it is not proof that none exists.' })
    );
    var d = ensureDialog();
    d.textContent = '';
    d.appendChild(head);
    d.appendChild(body);
    if (!d.open) d.showModal();
    renderTable();
  }

  // ---------------------------------------------------------------- method
  function methodP(term, text) {
    return el('p', { class: 'sub' }, el('b', { text: term + ' — ' }), text);
  }
  function readinessCurve() {
    var days = [0, 45, 90, 180, 365, 540, 730, 913, 1095, 1300];
    var wrap = el('div', { class: 'ready-curve', role: 'img', 'aria-label': 'Readiness by age in days: 0.4 at day 0, 0.7 by day 90, 1.0 through day 730, easing to 0.6 by day 1095' });
    days.forEach(function (d) {
      var v = readinessValue(d);
      wrap.appendChild(el('div', { class: 'rc-col' },
        el('span', { class: 'rc-val', text: v.toFixed(2) }),
        el('span', { class: 'rc-bar', style: 'height:' + Math.round(v * 64) + 'px' }),
        el('span', { class: 'rc-day', text: String(d) })
      ));
    });
    return wrap;
  }
  function calibTable() {
    var tbody = el('tbody');
    DATA.calibration.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { text: String(c.sample_count) }),
        el('td', { text: c.median_ratio === null ? 'n/a' : c.median_ratio + 'x' }),
        el('td', { text: c.multiple + 'x' }),
        el('td', null, c.source === 'category' ? el('span', { text: 'own sample' }) : el('span', { class: 'src-g', text: 'global fallback' }))
      ));
    });
    return el('div', { class: 'calib-wrap' }, el('table', { class: 'calib' },
      el('thead', null, el('tr', null,
        el('th', { text: 'Category' }),
        el('th', { text: 'Live peers' }),
        el('th', { text: 'Median mcap÷TVL' }),
        el('th', { text: 'Multiple used' }),
        el('th', { text: 'Source' })
      )),
      tbody
    ));
  }
  function methodPanel() {
    var m = DATA.model;
    var panelA = el('div', { class: 'panel' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every factor comes from the snapshot itself — no hardcoded prices, no special-cased names. The same function scores all ' + DATA.board_size + ' rows.' }),
      el('div', { class: 'formula' },
        'implied = ', el('b', { text: 'TVL' }), ' × ', el('b', { text: 'multiple' }), ' × ', el('b', { text: 'momentum' }), ' × ', el('b', { text: 'readiness' })
      ),
      el('div', { style: 'margin-top:12px' },
        methodP('multiple', 'What live tokens actually pay for a dollar of TVL: the median mcap÷TVL of the snapshot’s own live-token protocols in the same category. Categories with fewer than ' + m.min_calibration_sample + ' live peers use the whole-snapshot median; the result is clamped to ' + m.multiple_min + '–' + m.multiple_max + 'x at use.'),
        methodP('momentum', 'Flow direction: 1 + clamp(7-day TVL change, ' + m.momentum_floor + '%, +' + m.momentum_cap + '%)÷100 × ' + m.momentum_weight + '. Unreported flows sit at a neutral 1.0x.'),
        methodP('readiness', 'How much retroactive value a farm position can still accrue: ' + m.readiness_day0 + 'x at day 0 rising to ' + m.readiness_at_ramp_end + 'x by day ' + m.readiness_ramp_end + '; 1.0x from day ' + m.readiness_ramp_end + ' through day ' + m.prime_end_day + '; easing linearly to ' + m.readiness_stale + 'x by day ' + m.stale_end_day + '; ' + m.readiness_stale + 'x after. Unknown age uses the pre-token median, ' + (DATA.median_pre_token_age || 0) + ' days.')
      ),
      el('h3', { text: 'Readiness by age with no token', style: 'margin-top:16px' }),
      readinessCurve()
    );
    var panelB = el('div', { class: 'panel' },
      el('h2', { text: 'Calibration: what live tokens say TVL is worth' }),
      el('p', { class: 'sub', text: 'The ' + DATA.global_count + ' live protocols in the snapshot carry both a TVL and a market cap, so their mcap÷TVL ratio is a fact. One row per category the board ranks:' }),
      calibTable(),
      el('p', { class: 'sub', style: 'margin-top:12px', text: 'Baseline: the snapshot-wide median is ' + DATA.global_median + 'x (' + DATA.global_count + ' live peers). Categories marked global fallback had fewer than ' + m.min_calibration_sample + ' live peers of their own.' }),
      el('div', { class: 'legend' },
        el('span', null, el('i', { style: 'background:var(--accent)' }), 'model factor'),
        el('span', null, el('i', { style: 'background:var(--pos)' }), 'early row (below the floor)'),
        el('span', null, el('i', { style: 'background:var(--neg)' }), 'declining 7-day flows')
      )
    );
    return el('div', { class: 'method' }, panelA, panelB);
  }
  function foot() {
    return el('footer', { class: 'foot' },
      el('span', null, 'Data: ', el('span', { class: 'src', text: DATA.source })),
      el('span', null, 'Snapshot ' + DATA.as_of + ' · model ' + DATA.model_version),
      el('span', null, 'Sorted by implied value, ties by slug — two runs write identical bytes.')
    );
  }

  // ---------------------------------------------------------------- render + init
  function fillTable(slot) {
    slot.textContent = '';
    slot.appendChild(state.tab === 'board' ? boardTable() : liveTable());
  }
  function updateCount() {
    var c = document.querySelector('.count');
    if (!c) return;
    c.textContent = state.tab === 'board'
      ? rows().length + ' of ' + DATA.board_size + ' rows shown'
      : liveFiltered().length + ' of ' + DATA.live_size + ' live protocols';
  }
  function renderTable() {
    var slot = document.getElementById('table-slot');
    if (!slot) { render(); return; }
    fillTable(slot);
    updateCount();
  }
  function render() {
    app.setAttribute('aria-busy', 'false');
    app.textContent = '';
    app.appendChild(header());
    app.appendChild(lede());
    var ctl = el('div', { id: 'controls-slot' });
    ctl.appendChild(controls());
    app.appendChild(ctl);
    var slot = el('div', { id: 'table-slot' });
    app.appendChild(slot);
    app.appendChild(methodPanel());
    app.appendChild(foot());
    fillTable(slot);
    updateCount();
    if (state.selected) openDetail(state.selected);
  }
  function init() {
    if (!DATA || !DATA.rows || !DATA.live) {
      app.setAttribute('aria-busy', 'false');
      app.appendChild(el('div', { class: 'panel empty', style: 'margin:32px' },
        el('h2', { text: 'No dataset loaded' }),
        el('p', { text: 'The page found no window.RADAR dataset. Run the pipeline first — MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json> — then open out/dashboard/index.html, which reads ../data.js from the same run.' })
      ));
      return;
    }
    MAXIMPLIED = DATA.rows.reduce(function (mx, r) { return Math.max(mx, r.implied_value_usd); }, 1);
    readHash();
    render();
    window.addEventListener('hashchange', function () {
      state.selected = null;
      readHash();
      render();
    });
  }
  init();
})();

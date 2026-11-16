/* The radar's page: board, detail view, comparables and method. Hash-routed, no network. */
(function () {
  var R = window.RADAR, S = R.stats;
  var app = document.getElementById('view');
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function usd(n) { var a = Math.abs(n); if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'; if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'; return '$' + Math.round(n); }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) { return v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function short(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function med(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor((s.length - 1) / 2)]; }
  var bySlug = {}; R.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var B = S.beta;

  // ---- headline and diagnostics -----------------------------------------------------------------
  $('headline').innerHTML = '<b>' + S.protocols + '</b> protocols in the sealed snapshot, <b>' + S.rows +
    '</b> of them record no token. Here is what each launch would be worth.';
  $('subhead').innerHTML = 'Snapshot ' + esc(R.as_of) + ' · floor ' + usd(R.floor_usd) + ' · all ' + S.watch + ' protocols the house rule kept, plus every pre-token protocol the model can price · ' +
    'each value is a comparable fitted from the ' + S.live + ' protocols whose token already trades. Not a forecast, not advice.';

  function card(k, v, d, good) { return '<div class="card' + (good ? ' good' : '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + d + '</div></div>'; }
  $('strip').innerHTML =
    card('On the board', S.rows.toLocaleString('en-US'), S.watch + ' watchlist + ' + (S.rows - S.watch) + ' below the floor') +
    card('Watchlist covered', S.watch + '/' + S.watch, 'every protocol the house rule kept, at least once', true) +
    card('Total implied value', usd(S.total), 'sum of the board: a comparable, not a promise') +
    card('Checked within 3×', (S.within3x * 100).toFixed(0) + '%', 'leave-one-out over ' + S.live + ' live protocols') +
    card('Median comparable', S.globalMultiple.toFixed(2) + '×', 'market cap per $1 of TVL, live rows') +
    card('Worth farming at size', S.worthFarming + ' of ' + S.rows, 'rows covering a $' + S.testCapital.toLocaleString('en-US') + ' position after gas');

  // ---- the fitted curve -------------------------------------------------------------------------
  (function curve() {
    var c = $('curve'), x = c.getContext('2d'), W = c.width, H = c.height, pad = 44;
    x.fillStyle = '#0e141f'; x.fillRect(0, 0, W, H);
    var pts = R.live.filter(function (p) { return p.tvl_usd > 0 && p.mcap_usd > 0; });
    var xs = pts.map(function (p) { return Math.log10(p.tvl_usd); }), ys = pts.map(function (p) { return Math.log10(p.mcap_usd); });
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs), miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var X = function (v) { return pad + (v - minx) / (maxx - minx) * (W - pad - 16); };
    var Y = function (v) { return H - pad - (v - miny) / (maxy - miny) * (H - pad - 18); };
    x.strokeStyle = '#1b2537'; x.fillStyle = '#6b7c99'; x.font = '11px ui-monospace,Menlo,monospace';
    for (var g = Math.ceil(minx); g <= maxx; g++) { x.beginPath(); x.moveTo(X(g), Y(miny)); x.lineTo(X(g), Y(maxy)); x.stroke(); x.fillText(usd(Math.pow(10, g)), X(g) + 2, H - pad + 14); }
    x.fillStyle = '#2f5f80';
    pts.forEach(function (p, i) { x.beginPath(); x.arc(X(xs[i]), Y(ys[i]), 2.4, 0, 6.3); x.fill(); });
    var ages = R.live.filter(function (p) { return p.tvl_usd > 0; }).length ? R.rows.map(function (r) { return r.model.ageDays || 0; }) : [0];
    var ageMid = med(ages);
    x.strokeStyle = '#f0b429'; x.lineWidth = 2; x.beginPath();
    for (var v = minx; v <= maxx; v += 0.05) {
      var lnTvl = v * Math.LN10;
      var lmcap = B[0] + (1 + B[1]) * lnTvl + B[2] * ageMid;
      var y = lmcap / Math.LN10;
      if (v === minx) x.moveTo(X(v), Y(y)); else x.lineTo(X(v), Y(y));
    }
    x.stroke();
    R.rows.slice(0, 12).forEach(function (r) {
      x.fillStyle = '#2fd6a5'; x.beginPath(); x.arc(X(Math.log10(r.tvl_usd)), Y(Math.log10(r.implied_value_usd)), 3.2, 0, 6.3); x.fill();
      x.strokeStyle = '#2fd6a566'; x.beginPath(); x.moveTo(X(Math.log10(r.tvl_usd)), Y(Math.log10(r.implied_value_usd))); x.lineTo(X(Math.log10(r.tvl_usd)), Y(Math.log10(r.tvl_usd * S.globalMultiple))); x.stroke();
    });
    x.fillStyle = '#93a3bd'; x.font = '11px ui-sans-serif,system-ui,sans-serif';
    x.fillText('market cap (log)', 6, 14); x.fillText('TVL (log)', W - 58, H - 6);
    $('curvecaption').innerHTML = '<span style="color:#5ec2ff">●</span> ' + pts.length + ' live protocols · ' +
      '<span style="color:#f0b429">fitted line</span> ln(mcap/TVL) = ' + B[0].toFixed(3) + (B[1] < 0 ? ' − ' : ' + ') + Math.abs(B[1]).toFixed(3) + '·ln TVL' +
      (B[2] < 0 ? ' − ' : ' + ') + Math.abs(B[2]).toFixed(3) + '·ln(1+age days), drawn at the median age (' + Math.round(ageMid) + ' days) · ' +
      '<span style="color:#2fd6a5">●</span> this board’s top 12 with their lift over the field median ' + S.globalMultiple.toFixed(2) + '×';
  })();

  // ---- filters and board ------------------------------------------------------------------------
  var cats = {}; R.rows.forEach(function (r) { cats[r.category || 'Unclassified'] = (cats[r.category || 'Unclassified'] || 0) + 1; });
  var catList = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
  var state = { cat: '', tvl: '0', sort: 'value', watch: false, q: '' };
  function parseHash() {
    var h = location.hash || '#/board';
    var qs = h.indexOf('?') >= 0 ? h.slice(h.indexOf('?') + 1) : '';
    var path = h.replace(/^#/, '').split('?')[0];
    var o = {};
    qs.split('&').forEach(function (kv) { if (!kv) return; var kvp = kv.split('='); o[decodeURIComponent(kvp[0])] = decodeURIComponent(kvp[1] || ''); });
    return { path: path, q: o };
  }
  function setState(o) {
    if (o.cat !== undefined) state.cat = o.cat;
    if (o.tvl !== undefined) state.tvl = o.tvl;
    if (o.sort !== undefined) state.sort = o.sort;
    if (o.watch !== undefined) state.watch = o.watch === '1';
    if (o.q !== undefined) state.q = o.q;
  }
  function writeHash(path) {
    location.hash = path + '?cat=' + encodeURIComponent(state.cat) + '&tvl=' + state.tvl + '&sort=' + state.sort +
      '&watch=' + (state.watch ? '1' : '0') + '&q=' + encodeURIComponent(state.q);
  }
  function filtered() {
    return R.rows.filter(function (r) {
      if (state.cat && (r.category || 'Unclassified') !== state.cat) return false;
      if (r.tvl_usd < Number(state.tvl)) return false;
      if (state.watch && !r.watch) return false;
      if (state.q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(state.q.toLowerCase()) < 0) return false;
      return true;
    });
  }
  function sortedRows() {
    var f = filtered();
    var cmp = {
      value: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      farm: function (a, b) { return b.scenario_net - a.scenario_net; },
      rank: function (a, b) { return a.rank - b.rank; }
    }[state.sort];
    return f.sort(cmp);
  }
  function renderBoard() {
    var rows = sortedRows();
    var cols = [['rank', 'Rank', 'num'], ['', 'Protocol', ''], ['', 'Category', ''], ['tvl', 'TVL', 'num'], ['change', '7 days', 'num'], ['value', 'Implied value', 'num'], ['farm', 'Worth it', 'num'], ['', 'Farm plan', '']];
    var widths = ['52', '188', '146', '86', '78', '122', '104', 'auto'];
    var head = cols.map(function (c) {
      var on = c[0] && state.sort === c[0];
      return '<th class="' + c[2] + (on ? ' on' : '') + '"' + (c[0] ? ' data-sort="' + c[0] + '"' : '') + '>' + c[1] + (on ? (c[0] === 'rank' ? ' ↑' : ' ↓') : '') + '</th>';
    }).join('');
    var top = rows[0];
    var html = '<div class="note"><b>' + rows.length + '</b> of ' + S.rows + ' rows' +
      (top ? ' · highest <b>' + esc(top.name) + '</b> ' + usd(top.implied_value_usd) + ' (' + money(top.low) + '–' + money(top.high) + ')' : '') +
      ' · sorted by <b>' + (state.sort === 'value' ? 'implied value' : state.sort) + '</b> · the watchlist is the floor, never the ceiling · click a row for its detail view.</div>';
    html += '<table id="board"><colgroup>' + widths.map(function (w) { return '<col' + (w === 'auto' ? '' : ' style="width:' + w + 'px"') + '>'; }).join('') + '</colgroup><thead><tr>' + head + '</tr></thead><tbody>';
    var max = rows.length ? rows[0].implied_value_usd : 1;
    rows.forEach(function (r) {
      html += '<tr class="row" data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td><span class="tag">' + esc(r.category || 'Unclassified') + '</span> <span class="tag' + (r.watch ? ' watch' : '') + '">' + (r.watch ? 'watchlist' : 'below floor') + '</span></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + ((r.change_7d || 0) >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num"><span class="val">' + usd(r.implied_value_usd) + '</span><div class="band">' + usd(r.low) + '–' + usd(r.high) + '</div><div class="bar" style="width:' + Math.max(4, r.implied_value_usd / max * 100).toFixed(1) + '%"></div></td>' +
        '<td class="num ' + (r.scenario_net > 0 ? 'pos' : 'neg') + '">' + (r.scenario_net > 0 ? 'pays ' : 'needs ') + money(Math.abs(r.scenario_net)) + '<div class="band">break-even $' + r.break_even.toLocaleString('en-US') + '</div></td>' +
        '<td class="plan">' + esc(r.plan.chain) + ' · ' + esc(r.plan.short) + ' · ' + esc(r.plan.capitalLine) + ' · ' + esc(r.plan.holdLine) + ' · $' + r.plan.gas + ' gas</td>' +
        '</tr>';
    });
    return html + '</tbody></table>';
  }

  // ---- detail -------------------------------------------------------------------------------------
  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) return '<div class="note">No protocol named ' + esc(slug) + ' on this board.</div>';
    var m = r.model;
    var peers = R.live.filter(function (p) { return p.category === r.category; }).sort(function (a, b) { return b.multiple - a.multiple; }).slice(0, 8);
    var h = '<div class="detail-head"><h2>' + esc(r.name) + '</h2><span class="tag">' + esc(r.category || 'Unclassified') + '</span>' +
      '<span class="tag' + (r.watch ? ' watch' : '') + '">' + (r.watch ? 'on the house watchlist' : 'below the floor') + '</span>' +
      '<span class="tag">rank ' + r.rank + ' of ' + S.rows + '</span></div>';
    h += '<p class="subline">This snapshot records no token for ' + esc(r.name) + ' — no gecko id, no symbol — so it belongs on a radar of protocols whose launch has not happened yet. ' +
      'The record is DefiLlama’s and it is not proof: a protocol can carry a token its record does not show.</p>';
    h += '<div class="kv">' +
      '<div><div class="k">Implied launch value</div><div class="v bigval">' + usd(r.implied_value_usd) + '</div><div class="band">' + money(r.low) + ' – ' + money(r.high) + ' · leave-one-out quartile band</div></div>' +
      '<div><div class="k">TVL</div><div class="v">' + usd(r.tvl_usd) + '</div><div class="band">' + pct(r.change_7d) + ' over seven days · ' + esc((r.chains || []).join(', ') || 'chains unlisted') + '</div></div>' +
      '<div><div class="k">Multiple applied</div><div class="v">' + m.multiple.toFixed(2) + '×</div><div class="band">fit ' + m.baseline.toFixed(2) + '× × category ' + m.category.toFixed(2) + '× × growth ' + m.growth.toFixed(2) + '×</div></div>' +
      '<div><div class="k">Tracked with no token</div><div class="v">' + (m.ageDays === null ? 'unreported' : Math.round(m.ageDays) + ' days') + '</div><div class="band">since ' + esc(r.listed_at || 'an unknown day') + ' · ' + m.members + ' live peers in its category</div></div>' +
      '</div>';
    h += '<h3>The working</h3><div class="formula">ln(mcap/TVL) = ' + B[0].toFixed(4) + (B[1] < 0 ? ' − ' : ' + ') + Math.abs(B[1]).toFixed(4) + '·ln(TVL) + ' +
      (B[2] < 0 ? ' − ' : ' + ') + Math.abs(B[2]).toFixed(4) + '·ln(1+age)<br>' +
      'baseline = exp(' + B[0].toFixed(4) + (B[1] < 0 ? ' − ' : ' + ') + Math.abs(B[1]).toFixed(4) + '·ln(' + Math.round(r.tvl_usd) + ') ' +
      (B[2] < 0 ? '− ' : '+ ') + Math.abs(B[2]).toFixed(4) + '·ln(1+' + Math.round(m.ageDays || 0) + ')) = ' + m.baseline.toFixed(3) + '×<br>' +
      'category pull = (median ' + m.categoryMultiple.toFixed(2) + '× / field ' + S.globalMultiple.toFixed(2) + '×)^' + S.catWeight + ' = ' + m.category.toFixed(3) + '×<br>' +
      'growth = clamp(1 + ' + (r.change_7d === null ? 0 : r.change_7d.toFixed(2)) + '/' + S.growthDivisor + ', ' + (1 - S.growthCap) + ', ' + (1 + S.growthCap) + ') = ' + m.growth.toFixed(3) + '×<br>' +
      'implied = ' + Math.round(r.tvl_usd) + ' × ' + m.baseline.toFixed(3) + ' × ' + m.category.toFixed(3) + ' × ' + m.growth.toFixed(3) + ' = ' + usd(r.implied_value_usd) + '</div>';
    h += '<p class="subline">It ranks ' + r.rank + ' of ' + S.rows + ': ' + (r.rank <= 10 ? 'among the most valuable launches the model sees' :
      r.watch ? 'inside the watchlist the house rule kept' : 'a pre-token protocol below the house floor the radar still prices') +
      '. The number assumes the protocol’s record holds still and that a launched token would be valued like the live protocols its category holds — a comparable, never a forecast, and no airdrop is promised.</p>';
    h += '<h3>Farm plan · ' + esc(r.plan.chain) + ' · ' + esc(r.plan.capital) + ' · ' + esc(r.plan.hold) + ' · about $' + r.plan.gas + ' of network cost</h3><ol class="steps">';
    r.farm_steps.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; });
    h += '</ol>';
    h += '<p class="subline">At a $' + S.testCapital.toLocaleString('en-US') + ' position the model implies ' + money(Math.abs(r.scenario_net)) + ' net of the plan’s own $' + r.plan.gas +
      ' of cost (' + (r.scenario_net > 0 ? 'it pays' : 'it needs a bigger position') + '; break-even near $' + r.break_even.toLocaleString('en-US') + ') on the ' + (S.share * 100) +
      '% community-allocation assumption this board states. Rewards may never come and the principal can be lost.</p>';
    if (peers.length) {
      h += '<h3>Its comparables, from the snapshot’s own live rows</h3><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">×</th></tr></thead><tbody>';
      peers.forEach(function (p) { h += '<tr><td>' + esc(p.name) + '<span class="slug">' + esc(p.slug) + '</span></td><td>' + esc(p.category || 'Unclassified') + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + p.multiple.toFixed(2) + '×</td></tr>'; });
      h += '</tbody></table>';
    }
    h += '<p><a href="#/board">← back to the board</a></p>';
    return h;
  }

  // ---- comparables --------------------------------------------------------------------------------
  function renderComparables() {
    var h = '<div class="note">Where the numbers come from. Every protocol whose token already trades and whose market cap this snapshot records — ' + S.live + ' of them — grouped by the category DefiLlama gives it. ' +
      'The fitted line gives the level; the category median multiples below are pulled onto it at half strength (^' + S.catWeight + '), so a category with few live members cannot dominate the fit and a 400× outlier cannot price it either, because every median is a median.</div>';
    h += '<table><thead><tr><th>Category</th><th class="num">Live protocols</th><th class="num">Median ×</th><th class="num">Median TVL</th><th class="num">Largest live</th><th class="num">Board rows</th></tr></thead><tbody>';
    R.categories.forEach(function (c) {
      h += '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.members + '</td><td class="num">' + c.medianMultiple.toFixed(2) + '×</td>' +
        '<td class="num">' + usd(c.medianTvl) + '</td><td class="num">' + esc(c.largest) + '</td><td class="num">' + c.boardRows + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<h3>Every live protocol behind the fit</h3><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">×</th></tr></thead><tbody>';
    R.live.slice().sort(function (a, b) { return b.mcap_usd - a.mcap_usd; }).forEach(function (p) {
      h += '<tr><td>' + esc(p.name) + '<span class="slug">' + esc(p.slug) + '</span></td><td>' + esc(p.category || 'Unclassified') + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + p.multiple.toFixed(2) + '×</td></tr>';
    });
    return h + '</tbody></table><p><a href="#/board">← back to the board</a></p>';
  }

  // ---- method -------------------------------------------------------------------------------------
  function renderMethod() {
    var h = '<div class="note">The model, in full. Every constant below is computed from the sealed snapshot when the program runs; none is hand-picked and no protocol name is hard-coded.</div>';
    h += '<h3>What this radar is</h3><p class="subline">A protocol’s launch is the token it may issue one day. This board asks what such a token would be worth if the protocol’s record stayed as it is, and what a reader should do to farm the protocol before or after a token appears. ' +
      'It does not predict whether or when a token is issued: a value here is this entry’s own comparable, never a promise and never one make.fun makes.</p>';
    h += '<h3>The arithmetic</h3><div class="formula">implied_value = TVL × baseline_multiple × category_pull × growth<br><br>' +
      'ln(mcap/TVL) = ' + B[0].toFixed(4) + (B[1] < 0 ? ' − ' : ' + ') + Math.abs(B[1]).toFixed(4) + '·ln(TVL) ' + (B[2] < 0 ? '− ' : '+ ') + Math.abs(B[2]).toFixed(4) + '·ln(1 + days tracked)<br>' +
      'baseline_multiple = exp(that line at this protocol’s TVL and age)<br>' +
      'category_pull = (median(mcap/TVL of live rows in its category) / ' + S.globalMultiple.toFixed(4) + ')^' + S.catWeight + '<br>' +
      'growth = clamp(1 + change_7d/' + S.growthDivisor + ', ' + (1 - S.growthCap).toFixed(2) + ', ' + (1 + S.growthCap).toFixed(2) + ')<br>' +
      'clamp: implied_value ∈ [1, ' + S.valueCap.toExponential(0) + '] dollars</div>';
    h += '<h3>Why each term is there</h3><ul class="subline">' +
      '<li><b>TVL</b> — the size of the protocol, straight from the snapshot. The fitted elasticity is ' + B[1].toFixed(4) + ': below 1, so market cap per dollar of TVL falls as TVL rises, and a pure TVL ranking would be wrong.</li>' +
      '<li><b>Days tracked with no token</b> — DefiLlama’s <span class="mono">listed_at</span>, as ln(1 + days). Coefficient ' + B[2].toFixed(4) + ': treated as maturity, not as a payout guarantee.</li>' +
      '<li><b>Category pull</b> — the median market cap per $1 of TVL among the live protocols in the same category, pulled onto the fit at half strength. Medians, so one 400× outlier cannot price a category, and half strength, so a thin category cannot override the fit.</li>' +
      '<li><b>Growth</b> — the snapshot’s own seven-day TVL change, clamped to ±' + (S.growthCap * 100).toFixed(0) + '% through a divisor of ' + S.growthDivisor + ': a weak momentum term, deliberately, so one good week cannot carry a row.</li>' +
      '<li><b>The cap</b> — the gate’s own ceiling, so no arithmetic slip can print a fantasy number.</li>' +
      '<li><b>Farm plans</b> — steps, cost and duration per protocol, built from its category and its chains, and stated as a scenario with the principal at risk.</li></ul>';
    h += '<h3>How well the comparable holds up</h3><p class="subline">Leave-one-out: each of the ' + S.live + ' live protocols is priced from the <i>other</i> live protocols by exactly the rule above — the line refitted, the category median recomputed — and the result compared with the market cap it really has. ' +
      '<b>' + (S.within3x * 100).toFixed(0) + '%</b> land within a factor of three, the median ratio is ' + S.medianError.toFixed(2) + '×, and the quartile band ' + S.q25.toFixed(2) + '×–' + S.q75.toFixed(2) + '× is quoted as each row’s range. ' +
      'The fit and the check share rows, which flatters the figure: read it as an upper bound on the comparable’s accuracy, not as evidence about any launch price.</p>';
    h += '<h3>What it refuses to claim</h3><p class="subline">A protocol that records no token may still carry one the record does not show, so the board says “records no token”, never “has none”. ' +
      'A protocol below the watchlist floor is no worse a subject — the floor is the house rule’s, not the model’s — which is why ' + (S.rows - S.watch) + ' of this board’s ' + S.rows + ' rows sit below it. ' +
      'Nothing here says an airdrop will happen, and nothing here is financial advice.</p>';
    return h;
  }

  // ---- router -------------------------------------------------------------------------------------
  function render() {
    var r = parseHash();
    var tab = r.path.indexOf('/protocol/') === 0 ? 'board' : r.path.replace('/', '');
    document.querySelectorAll('#tabs a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === tab); });
    $('controls').style.display = r.path.indexOf('/protocol/') === 0 ? 'none' : 'flex';
    if (r.path.indexOf('/protocol/') === 0) { app.innerHTML = renderDetail(r.path.slice('/protocol/'.length)); window.scrollTo(0, 0); return; }
    if (r.path === '/method') { app.innerHTML = renderMethod(); return; }
    if (r.path === '/comparables') { app.innerHTML = renderComparables(); return; }
    setState(r.q);
    $('controls').innerHTML =
      '<label>Category</label><select id="f-cat"><option value="">all</option>' + catList.map(function (c) { return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<label>Min TVL</label><select id="f-tvl">' + ['0', '5000000', '50000000', '250000000'].map(function (v) { return '<option value="' + v + '"' + (state.tvl === v ? ' selected' : '') + '>' + usd(Number(v)) + '</option>'; }).join('') + '</select>' +
      '<label>Sort</label><select id="f-sort">' + [['value', 'implied value'], ['tvl', 'TVL'], ['change', '7-day change'], ['farm', 'worth farming'], ['rank', 'rank']].map(function (o) { return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<button id="f-watch" class="' + (state.watch ? 'on' : '') + '">' + (state.watch ? '✓ ' : '') + 'watchlist only</button>' +
      '<input id="f-q" placeholder="search name, slug, category" value="' + esc(state.q) + '" size="24">' +
      '<button id="f-reset">reset</button>';
    app.innerHTML = renderBoard();
    $('f-cat').onchange = function () { state.cat = this.value; writeHash('/board'); };
    $('f-tvl').onchange = function () { state.tvl = this.value; writeHash('/board'); };
    $('f-sort').onchange = function () { state.sort = this.value; writeHash('/board'); };
    $('f-q').oninput = function () { state.q = this.value; clearTimeout(window.__t); window.__t = setTimeout(function () { writeHash('/board'); }, 250); };
    $('f-watch').onclick = function () { state.watch = !state.watch; writeHash('/board'); };
    $('f-reset').onclick = function () { state = { cat: '', tvl: '0', sort: 'value', watch: false, q: '' }; writeHash('/board'); };
    document.querySelectorAll('#board th[data-sort]').forEach(function (th) { th.onclick = function () { state.sort = th.getAttribute('data-sort'); writeHash('/board'); }; });
    document.querySelectorAll('#board tbody tr').forEach(function (tr) { tr.onclick = function () { location.hash = '/protocol/' + encodeURIComponent(tr.getAttribute('data-slug')); }; });
  }
  window.addEventListener('hashchange', render);

  $('foot').innerHTML = S.rows + '/' + S.rows + ' board rows agree with board.json · watchlist ' + S.watch + '/' + S.watch + ' covered · ' +
    'sealed input sha256 <span class="mono">' + R.sha256.slice(0, 16) + '…</span> read, never written · snapshot ' + esc(R.as_of) +
    ' · ' + R.live.length + ' live comparables fitted · values are comparables derived from the snapshot, not forecasts, and not financial advice.';
  render();
})();

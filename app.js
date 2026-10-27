/* ═══════════ CONFIGURAÇÃO ═══════════
 * Cole aqui a URL do Web App (termina em /exec) gerada no Apps Script. */
var CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyGp8eVaNR2jAK1cRKIeamvFveIGfb3C7K_XAvfDWFCbFIN03eaw6e2Tyhjx38UZFs/exec',   // ex.: 'https://script.google.com/macros/s/AKfycb.../exec'
  TOKEN: ''      // só se você definiu CONFIG.TOKEN no Cod
};

(function () {
  'use strict';

  /* ───────── Constantes ───────── */
  var MONTHS = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  var MON = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  var DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  var STATUS = {
    VALIDO:                  { label: 'Válido',                 g: 'ok'   },
    AGUARDANDO_ANALISE:      { label: 'Aguardando análise',     g: 'pend' },
    REPROVADO_COMPORTAMENTO: { label: 'Reprov. comportamento',  g: 'fail' },
    REPROVADO_FACE:          { label: 'Reprov. face',           g: 'fail' },
    REPROVADO_GERAL:         { label: 'Reprov. geral',          g: 'fail' },
    IDENTIDADE_INCONCLUSIVA: { label: 'Identidade inconclusiva',g: 'other'},
    NAO_AVALIADO:            { label: 'Não avaliado',           g: 'other'}
  };
  var GROUPS = { ok: 'Válido', pend: 'Aguardando análise', fail: 'Reprovado', other: 'Outros' };
  var PAGE_SIZE = 12;

  var $ = function (s) { return document.querySelector(s); };
  var fmt = function (n) { return Number(n).toLocaleString('pt-BR'); };
  var pct = function (a, b) { return b ? (a / b * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '0%'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); };
  var stInfo = function (s) { return STATUS[s] || { label: s ? s.replace(/_/g, ' ').toLowerCase() : '—', g: 'other' }; };
  var cssVar = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };

  /* ───────── Estado ───────── */
  var DB = null;                    // dados completos
  var rows = [];                    // linhas já tratadas
  var filialName = {};              // cod -> nome
  var charts = {};
  var S = { months: new Set(), filial: '', status: '', q: '', page: 1, dailyMonth: null };

  /* ───────── Carga (via API) ───────── */
  function load(force) {
    var btn = $('#refreshBtn');
    btn.classList.add('is-loading'); btn.disabled = true;
    var done = function () { btn.classList.remove('is-loading'); btn.disabled = false; };

    var url = CONFIG.API_URL || 'data.json';          // sem API_URL: usa data.json local (demo)
    if (CONFIG.API_URL) {
      var qs = [];
      if (force) qs.push('refresh=1');
      if (CONFIG.TOKEN) qs.push('token=' + encodeURIComponent(CONFIG.TOKEN));
      if (qs.length) url += (url.indexOf('?') < 0 ? '?' : '&') + qs.join('&');
    }

    // GET simples (sem headers) para não gerar preflight de CORS no Apps Script
    fetch(url, { redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { if (data.error) throw new Error(data.error); done(); init(data); })
      .catch(function (err) {
        done(); $('#loader').hidden = true;
        if (DB) { alert('Falha ao atualizar: ' + err.message); return; }
        $('#errorMsg').textContent = err.message + (CONFIG.API_URL ? '' : ' (configure API_URL no app.js)');
        $('#error').hidden = false;
      });
  }

  function init(data) {
    DB = data;
    filialName = data.filiais || {};
    rows = data.rows.map(function (r) {
      var p = r[0].split('-'), y = +p[0], m = +p[1], d = +p[2];
      var alco = r[5], ra = r[6];
      return {
        d: r[0], m: m, day: d, dow: new Date(y, m - 1, d).getDay(),
        cod: r[1], cel: r[2], nome: data.names[r[3]], mat: r[4],
        alco: alco, pos: alco > 0 || ra === 1, st: r[7], g: stInfo(r[7]).g
      };
    });
    $('#updated').textContent = 'Atualizado em ' + data.updated + ' · ' + fmt(rows.length) + ' testes';
    $('#updated2').textContent = data.updated;

    buildFilters();
    $('#loader').hidden = true; $('#error').hidden = true; $('#app').hidden = false;
    render();
  }

  /* ───────── Filtros ───────── */
  function buildFilters() {
    var months = uniq(rows.map(function (r) { return r.m; })).sort(function (a, b) { return a - b; });
    var box = $('#monthChips'); box.innerHTML = '';
    var all = chip('Todos', function () { S.months.clear(); render(); }, 'all');
    box.appendChild(all);
    months.forEach(function (m) {
      box.appendChild(chip(MON[m - 1], function () {
        if (S.months.has(m)) S.months.delete(m); else S.months.add(m);
        render();
      }, m));
    });

    var cods = uniq(rows.map(function (r) { return r.cod; })).sort(function (a, b) { return a - b; });
    var f = $('#fFilial'); f.innerHTML = '<option value="">Todas as filiais</option>' +
      cods.map(function (c) { return '<option value="' + c + '">' + esc(fname(c)) + '</option>'; }).join('');
    f.value = S.filial;

    var sts = uniq(rows.map(function (r) { return r.st; })).sort();
    var s = $('#fStatus'); s.innerHTML = '<option value="">Todos os status</option>' +
      sts.map(function (x) { return '<option value="' + esc(x) + '">' + esc(stInfo(x).label) + '</option>'; }).join('');
    s.value = S.status;

    var dm = $('#dailyMonth');
    dm.innerHTML = months.map(function (m) { return '<option value="' + m + '">' + MONTHS[m - 1].charAt(0) + MONTHS[m - 1].slice(1).toLowerCase() + '</option>'; }).join('');
    if (!S.dailyMonth || months.indexOf(S.dailyMonth) < 0) S.dailyMonth = months[months.length - 1];
    dm.value = S.dailyMonth;
  }
  function chip(text, fn, key) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = text; b.dataset.key = key; b.onclick = fn;
    return b;
  }
  function syncChips() {
    document.querySelectorAll('#monthChips .chip').forEach(function (c) {
      var on = c.dataset.key === 'all' ? S.months.size === 0 : S.months.has(+c.dataset.key);
      c.classList.toggle('is-on', on);
    });
  }

  function filtered() {
    var q = S.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (S.months.size && !S.months.has(r.m)) return false;
      if (S.filial && String(r.cod) !== S.filial) return false;
      if (S.status && r.st !== S.status) return false;
      if (q && (r.nome.toLowerCase().indexOf(q) < 0 && String(r.mat).indexOf(q) < 0)) return false;
      return true;
    });
  }

  /* ───────── Render geral ───────── */
  function render() {
    syncChips();
    var data = filtered();
    renderKpis(data);
    renderMonthly(data);
    renderStatus(data);
    renderDaily(data);
    renderFilial(data);
    renderDow(data);
    renderMonthMatrix(data);
    renderDayMatrix();
    renderOcc(data);
    renderInactive();
    renderTop(data);
    renderDetail(data);
  }

  /* ───────── KPIs ───────── */
  function renderKpis(d) {
    var total = d.length;
    var people = uniq(d.map(function (r) { return r.mat; })).length;
    var pos = d.filter(function (r) { return r.pos; }).length;
    var fail = d.filter(function (r) { return r.g === 'fail'; }).length;
    var pend = d.filter(function (r) { return r.g === 'pend'; }).length;
    var valid = d.filter(function (r) { return r.g === 'ok'; }).length;
    var days = uniq(d.map(function (r) { return r.d; })).length;
    var branches = uniq(d.map(function (r) { return r.cod; })).length;

    var k = [
      { l: 'Testes realizados', v: fmt(total), s: branches + ' filiais · ' + days + ' dias com leitura', c: 'var(--accent)' },
      { l: 'Média por dia', v: days ? fmt(Math.round(total / days)) : '0', s: 'em dias com atividade', c: 'var(--accent2)' },
      { l: 'Colaboradores testados', v: fmt(people), s: people ? (total / people).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' testes por pessoa' : '—', c: 'var(--violet)' },
      { l: 'Álcool detectado', v: fmt(pos), s: pct(pos, total) + ' dos testes', c: 'var(--danger)', cls: pos ? 'kpi--danger' : '' },
      { l: 'Reprovados', v: fmt(fail), s: pct(fail, total) + ' dos testes', c: 'var(--warn)' },
      { l: 'Aguardando análise', v: fmt(pend), s: pct(pend, total) + ' · válidos: ' + pct(valid, total), c: 'var(--ok)' }
    ];
    $('#kpis').innerHTML = k.map(function (x, i) {
      return '<div class="kpi ' + (x.cls || '') + '" style="--c:' + x.c + ';animation-delay:' + (i * 40) + 'ms">' +
        '<div class="kpi__label">' + x.l + '</div><div class="kpi__value">' + x.v + '</div><div class="kpi__sub">' + x.s + '</div></div>';
    }).join('');
  }

  /* ───────── Gráficos ───────── */
  function baseOpts(extra) {
    var o = {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: cssVar('--muted'), usePointStyle: true, boxWidth: 8, font: { family: 'Manrope', size: 12 } } },
        tooltip: { backgroundColor: cssVar('--bg'), titleColor: cssVar('--text'), bodyColor: cssVar('--text'), borderColor: cssVar('--line'), borderWidth: 1, padding: 10, cornerRadius: 10, titleFont: { family: 'Manrope', weight: '700' }, bodyFont: { family: 'Manrope' } }
      },
      scales: {
        x: { ticks: { color: cssVar('--muted'), font: { family: 'Manrope', size: 11 }, maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false }, border: { display: false } },
        y: { beginAtZero: true, ticks: { color: cssVar('--muted'), font: { family: 'Manrope', size: 11 } }, grid: { color: cssVar('--grid') }, border: { display: false } }
      }
    };
    return merge(o, extra || {});
  }
  function merge(a, b) {
    Object.keys(b).forEach(function (k) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]);
      else a[k] = b[k];
    });
    return a;
  }
  function mk(id, cfg) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), cfg);
  }
  var groupColor = function () { return { ok: cssVar('--ok'), pend: cssVar('--warn'), fail: cssVar('--danger'), other: cssVar('--violet') }; };

  function renderMonthly(d) {
    var ms = uniq(d.map(function (r) { return r.m; })).sort(function (a, b) { return a - b; });
    var col = groupColor();
    var ds = Object.keys(GROUPS).map(function (g) {
      return {
        label: GROUPS[g], backgroundColor: col[g], borderRadius: 4, borderSkipped: false, maxBarThickness: 46,
        data: ms.map(function (m) { return d.filter(function (r) { return r.m === m && r.g === g; }).length; })
      };
    }).filter(function (s) { return s.data.some(Boolean); });
    mk('chMonthly', {
      type: 'bar',
      data: { labels: ms.map(function (m) { return MON[m - 1]; }), datasets: ds },
      options: baseOpts({ scales: { x: { stacked: true }, y: { stacked: true } } })
    });
  }

  function renderStatus(d) {
    var count = {};
    d.forEach(function (r) { count[r.st] = (count[r.st] || 0) + 1; });
    var keys = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
    var col = groupColor();
    var shades = keys.map(function (k, i) {
      var base = col[stInfo(k).g];
      return base;
    });
    // diferencia status do mesmo grupo variando a opacidade
    var seen = {};
    var colors = keys.map(function (k) {
      var g = stInfo(k).g; seen[g] = (seen[g] || 0) + 1;
      return withAlpha(col[g], Math.max(.45, 1 - (seen[g] - 1) * .22));
    });
    var total = d.length;
    mk('chStatus', {
      type: 'doughnut',
      data: { labels: keys.map(function (k) { return stInfo(k).label; }), datasets: [{ data: keys.map(function (k) { return count[k]; }), backgroundColor: colors, borderColor: cssVar('--surface'), borderWidth: 3, hoverOffset: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: baseOpts().plugins.tooltip } }
    });
    $('#donutCenter').innerHTML = '<b>' + fmt(total) + '</b><span>testes</span>';
    $('#statusLegend').innerHTML = keys.map(function (k, i) {
      return '<li><i style="background:' + colors[i] + '"></i><span>' + esc(stInfo(k).label) + '</span><b>' + fmt(count[k]) + '</b><em>' + pct(count[k], total) + '</em></li>';
    }).join('') || '<li><span>Sem dados</span></li>';
  }
  function withAlpha(hex, a) {
    if (hex.charAt(0) !== '#') return hex;
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function renderDaily(d) {
    var by = {};
    d.forEach(function (r) { var o = by[r.d] || (by[r.d] = { t: 0, p: 0 }); o.t++; if (r.pos) o.p++; });
    var days = Object.keys(by).sort();
    mk('chDaily', {
      data: {
        labels: days.map(function (x) { return x.slice(8) + '/' + x.slice(5, 7); }),
        datasets: [
          { type: 'line', label: 'Testes', data: days.map(function (x) { return by[x].t; }), borderColor: cssVar('--accent'), backgroundColor: withAlpha(cssVar('--accent'), .14), fill: true, tension: .35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, yAxisID: 'y', order: 2 },
          { type: 'bar', label: 'Álcool detectado', data: days.map(function (x) { return by[x].p; }), backgroundColor: cssVar('--danger'), borderRadius: 3, barThickness: 6, yAxisID: 'y2', order: 1 }
        ]
      },
      options: baseOpts({ scales: { y2: { position: 'right', beginAtZero: true, suggestedMax: 4, ticks: { color: cssVar('--danger'), precision: 0, font: { family: 'Manrope', size: 11 } }, grid: { display: false }, border: { display: false } } } })
    });
  }

  function renderFilial(d) {
    var by = {};
    d.forEach(function (r) { var o = by[r.cod] || (by[r.cod] = { t: 0, p: 0, f: 0 }); o.t++; if (r.pos) o.p++; if (r.g === 'fail') o.f++; });
    var cods = Object.keys(by).sort(function (a, b) { return by[b].t - by[a].t; });
    mk('chFilial', {
      type: 'bar',
      data: { labels: cods.map(function (c) { return fname(c).replace(' - GARAGEM', ''); }), datasets: [{ label: 'Testes', data: cods.map(function (c) { return by[c].t; }), backgroundColor: cods.map(function (c, i) { return withAlpha(cssVar('--accent'), 1 - i * .07); }), borderRadius: 6, borderSkipped: false, maxBarThickness: 26 }] },
      options: baseOpts({
        indexAxis: 'y',
        interaction: { mode: 'nearest', axis: 'y', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: function (c) { var o = by[cods[c.dataIndex]]; return ['Álcool detectado: ' + o.p, 'Reprovados: ' + o.f]; } } } },
        scales: { x: { grid: { color: cssVar('--grid') } }, y: { grid: { display: false } } }
      })
    });
  }

  function renderDow(d) {
    var c = [0,0,0,0,0,0,0];
    d.forEach(function (r) { c[r.dow]++; });
    var max = Math.max.apply(null, c);
    mk('chDow', {
      type: 'bar',
      data: { labels: DOW, datasets: [{ label: 'Testes', data: c, backgroundColor: c.map(function (v) { return v === max && max ? cssVar('--accent2') : withAlpha(cssVar('--accent2'), .45); }), borderRadius: 6, borderSkipped: false, maxBarThickness: 40 }] },
      options: baseOpts({ plugins: { legend: { display: false } } })
    });
  }

  /* ───────── Matrizes ───────── */
  function renderMonthMatrix(d) {
    var ms = uniq(d.map(function (r) { return r.m; })).sort(function (a, b) { return a - b; });
    var cods = uniq(d.map(function (r) { return r.cod; })).sort(function (a, b) { return fname(a).localeCompare(fname(b)); });
    var cell = {}, max = 0, tot = {}, colTot = {}, grand = 0;
    d.forEach(function (r) {
      var k = r.cod + '|' + r.m; cell[k] = (cell[k] || 0) + 1; if (cell[k] > max) max = cell[k];
      tot[r.cod] = (tot[r.cod] || 0) + 1; colTot[r.m] = (colTot[r.m] || 0) + 1; grand++;
    });
    var h = '<thead><tr><th>Filial</th>' + ms.map(function (m) { return '<th>' + MON[m - 1] + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>';
    cods.forEach(function (c) {
      h += '<tr><td><span class="mono muted">' + c + '</span> &nbsp;' + esc(fname(c)) + '</td>';
      ms.forEach(function (m) { h += heatCell(cell[c + '|' + m] || 0, max); });
      h += '<td class="num"><b>' + fmt(tot[c]) + '</b></td></tr>';
    });
    h += '<tr class="total"><td>Total</td>' + ms.map(function (m) { return '<td>' + fmt(colTot[m] || 0) + '</td>'; }).join('') + '<td class="num">' + fmt(grand) + '</td></tr></tbody>';
    $('#monthMatrix').innerHTML = cods.length ? h : '<tbody><tr><td class="empty">Sem dados para os filtros.</td></tr></tbody>';
  }

  function renderDayMatrix() {
    var m = S.dailyMonth;
    var base = rows.filter(function (r) {
      if (r.m !== m) return false;
      if (S.filial && String(r.cod) !== S.filial) return false;
      if (S.status && r.st !== S.status) return false;
      var q = S.q.trim().toLowerCase();
      if (q && r.nome.toLowerCase().indexOf(q) < 0 && String(r.mat).indexOf(q) < 0) return false;
      return true;
    });
    var year = rows.length ? +rows[0].d.slice(0, 4) : new Date().getFullYear();
    var nDays = new Date(year, m, 0).getDate();
    var cods = uniq(rows.map(function (r) { return r.cod; })).filter(function (c) { return !S.filial || String(c) === S.filial; })
      .sort(function (a, b) { return fname(a).localeCompare(fname(b)); });
    var cell = {}, max = 0, colTot = {};
    base.forEach(function (r) { var k = r.cod + '|' + r.day; cell[k] = (cell[k] || 0) + 1; if (cell[k] > max) max = cell[k]; colTot[r.day] = (colTot[r.day] || 0) + 1; });
    var h = '<thead><tr><th>Filial</th>';
    for (var i = 1; i <= nDays; i++) h += '<th>' + i + '</th>';
    h += '<th>Total</th></tr></thead><tbody>';
    cods.forEach(function (c) {
      var t = 0; h += '<tr><td>' + esc(fname(c)) + '</td>';
      for (var i = 1; i <= nDays; i++) { var v = cell[c + '|' + i] || 0; t += v; h += heatCell(v, max, 'dia ' + i); }
      h += '<td class="num"><b>' + fmt(t) + '</b></td></tr>';
    });
    h += '<tr class="total"><td>Total</td>';
    var g = 0;
    for (var j = 1; j <= nDays; j++) { g += colTot[j] || 0; h += '<td>' + (colTot[j] || '') + '</td>'; }
    h += '<td class="num">' + fmt(g) + '</td></tr></tbody>';
    $('#dayMatrix').innerHTML = h;
  }
  function heatCell(v, max, tip) {
    if (!v) return '<td class="zero">0</td>';
    var a = (.12 + .68 * (v / (max || 1))).toFixed(2);
    return '<td class="heat" style="--a:' + a + '"' + (tip ? ' title="' + tip + ': ' + v + '"' : '') + '>' + fmt(v) + '</td>';
  }

  /* ───────── Tabelas ───────── */
  function badge(st) { var i = stInfo(st); return '<span class="badge badge--' + i.g + '">' + esc(i.label) + '</span>'; }
  var brDate = function (iso) { return iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); };

  function renderOcc(d) {
    var occ = d.filter(function (r) { return r.pos; }).sort(function (a, b) { return a.d < b.d ? 1 : -1; });
    $('#occCount').textContent = occ.length;
    var h = '<thead><tr><th>Data</th><th>Filial</th><th>Colaborador</th><th class="num">Alcoolemia</th><th>Status</th></tr></thead><tbody>';
    occ.slice(0, 40).forEach(function (r) {
      h += '<tr><td>' + brDate(r.d) + '</td><td>' + esc(fname(r.cod).replace(' - GARAGEM', '')) + '</td><td>' + esc(r.nome) + ' <span class="muted mono">#' + r.mat + '</span></td><td class="num alc">' + r.alco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) + '</td><td>' + badge(r.st) + '</td></tr>';
    });
    if (!occ.length) h += '<tr><td colspan="5" class="empty">Nenhuma ocorrência para os filtros atuais 🎉</td></tr>';
    $('#occTable').innerHTML = h + '</tbody>';
  }

  function renderInactive() {
    var last = {}; var latest = '';
    rows.forEach(function (r) { if (!last[r.cod] || r.d > last[r.cod]) last[r.cod] = r.d; if (r.d > latest) latest = r.d; });
    var ref = new Date(latest + 'T00:00:00');
    $('#inactiveRef').textContent = 'ref. ' + brDate(latest);
    var list = Object.keys(last).map(function (c) {
      return { c: c, d: last[c], gap: Math.round((ref - new Date(last[c] + 'T00:00:00')) / 864e5) };
    }).sort(function (a, b) { return b.gap - a.gap; });
    $('#inactiveList').innerHTML = list.map(function (x) {
      var cls = x.gap > 30 ? 'hot' : x.gap > 7 ? 'mid' : 'ok';
      return '<li><div><b>' + esc(fname(x.c)) + '</b><small>último teste em ' + brDate(x.d) + '</small></div><span class="days ' + cls + '">' + (x.gap ? x.gap + ' d' : 'ativa') + '</span></li>';
    }).join('');
  }

  function renderTop(d) {
    var by = {};
    d.forEach(function (r) {
      var o = by[r.mat] || (by[r.mat] = { nome: r.nome, mat: r.mat, t: 0, p: 0, f: {} });
      o.t++; if (r.pos) o.p++; o.f[r.cod] = (o.f[r.cod] || 0) + 1;
    });
    var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.t - a.t; }).slice(0, 10);
    var max = list.length ? list[0].t : 1;
    var h = '<thead><tr><th>#</th><th>Colaborador</th><th>Matrícula</th><th>Filial principal</th><th>Testes</th><th class="num">Álcool</th></tr></thead><tbody>';
    list.forEach(function (o, i) {
      var main = Object.keys(o.f).sort(function (a, b) { return o.f[b] - o.f[a]; })[0];
      h += '<tr><td class="muted">' + (i + 1) + '</td><td>' + esc(o.nome) + '</td><td class="mono">' + o.mat + '</td><td>' + esc(fname(main).replace(' - GARAGEM', '')) + '</td><td><span class="bar" style="width:' + Math.max(6, o.t / max * 120) + 'px"></span><b>' + fmt(o.t) + '</b></td><td class="num">' + (o.p ? '<span class="alc">' + o.p + '</span>' : '0') + '</td></tr>';
    });
    if (!list.length) h += '<tr><td colspan="6" class="empty">Sem dados.</td></tr>';
    $('#topTable').innerHTML = h + '</tbody>';
  }

  function renderDetail(d) {
    var sorted = d.slice().sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : 0; });
    var pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (S.page > pages) S.page = pages;
    var from = (S.page - 1) * PAGE_SIZE;
    var h = '<thead><tr><th>Data</th><th>Filial</th><th>Equip.</th><th>Colaborador</th><th>Matrícula</th><th class="num">Alcoolemia</th><th>Status</th></tr></thead><tbody>';
    sorted.slice(from, from + PAGE_SIZE).forEach(function (r) {
      h += '<tr><td>' + brDate(r.d) + '</td><td>' + esc(fname(r.cod).replace(' - GARAGEM', '')) + '</td><td class="mono">' + r.cod + '</td><td>' + esc(r.nome) + '</td><td class="mono">' + r.mat + '</td><td class="num' + (r.pos ? ' alc' : '') + '">' + r.alco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) + '</td><td>' + badge(r.st) + '</td></tr>';
    });
    if (!sorted.length) h += '<tr><td colspan="7" class="empty">Nenhum registro para os filtros atuais.</td></tr>';
    $('#detailTable').innerHTML = h + '</tbody>';
    $('#detailInfo').textContent = fmt(sorted.length) + ' registros';
    $('#pageInfo').textContent = 'Página ' + S.page + ' de ' + pages;
    $('#prevBtn').disabled = S.page <= 1;
    $('#nextBtn').disabled = S.page >= pages;
    renderDetail.last = sorted;
  }

  function exportCsv() {
    var data = renderDetail.last || [];
    var head = ['Data','Filial','Equipamento','Colaborador','Matrícula','Alcoolemia','Status'];
    var lines = [head.join(';')].concat(data.map(function (r) {
      return [brDate(r.d), fname(r.cod), r.cod, '"' + r.nome.replace(/"/g, '""') + '"', r.mat, String(r.alco).replace('.', ','), stInfo(r.st).label].join(';');
    }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'bafometro_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ───────── Utilidades ───────── */
  function uniq(a) { return Array.from(new Set(a)); }
  function fname(c) { return filialName[c] || ('Equipamento ' + c); }

  /* ───────── Eventos ───────── */
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }

  $('#fFilial').onchange = function (e) { S.filial = e.target.value; S.page = 1; render(); };
  $('#fStatus').onchange = function (e) { S.status = e.target.value; S.page = 1; render(); };
  $('#fSearch').oninput = debounce(function (e) { S.q = e.target.value; S.page = 1; render(); }, 220);
  $('#dailyMonth').onchange = function (e) { S.dailyMonth = +e.target.value; renderDayMatrix(); };
  $('#clearBtn').onclick = function () {
    S.months.clear(); S.filial = ''; S.status = ''; S.q = ''; S.page = 1;
    $('#fFilial').value = ''; $('#fStatus').value = ''; $('#fSearch').value = ''; render();
  };
  $('#prevBtn').onclick = function () { S.page--; renderDetail(filtered()); };
  $('#nextBtn').onclick = function () { S.page++; renderDetail(filtered()); };
  $('#csvBtn').onclick = exportCsv;
  $('#refreshBtn').onclick = function () { load(true); };
  $('#retryBtn').onclick = function () { $('#error').hidden = true; $('#loader').hidden = false; load(true); };

  // Tema (claro/escuro) — lembra a escolha quando o navegador permite
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('baf-theme', t); } catch (e) {}
    if (DB) render();
  }
  var saved = null; try { saved = localStorage.getItem('baf-theme'); } catch (e) {}
  if (!saved && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) saved = 'light';
  document.documentElement.setAttribute('data-theme', saved || 'dark');
  $('#themeBtn').onclick = function () { setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); };

  load(false);
})();

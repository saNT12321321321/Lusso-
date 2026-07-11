/* IBIZA studio — Panel de gestión (CRM), conectado a Supabase en tiempo real */
(function () {
  const PALETTE = ['#2563eb', '#4f7f9c', '#4f8865', '#93708a', '#4f9c94', '#6b6f9c', '#b3703f', '#7c9c4f'];
  function jsStr(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  const app = document.getElementById('app');
  let DATA = null;
  let state = {
    auth: null, loginMode: 'admin', loginUser: 'admin', loginPass: '', loginBarberId: null, loginPin: '', loginBusy: false,
    tab: 'gerente', openClientKey: null, clientDraft: null, clientSearch: '',
    showAddClient: false, newClientForm: { nombre: '', tel: '', email: '' },
    newBarberForm: { nombre: '', alias: '', esp: '', color: PALETTE[0] },
    manualForm: { cliente: '', tel: '', servicioId: null, barberoId: null, fecha: todayKey(), hora: '10:00', customPrecio: '' },
    pipelineBarberFilter: 'all',
    configDraft: null, adminChangePass: { actual: '', nueva: '' }, resetPinFor: null, resetPinVal: '',
    sidebarOpen: false, metricsPeriod: 30,
    calView: 'month', calAnchor: todayKey(), calSelectedDay: todayKey(), calActiveBarberos: null, calDetailId: null, calModalOpen: false
  };
  let metricsCharts = {};

  try { const saved = JSON.parse(localStorage.getItem('ibiza_auth') || 'null'); if (saved) state.auth = saved; } catch (e) { }

  function barb(id) { return DATA.barberos.find(b => b.id === id) || DATA.barberos[0] || { id: '', alias: '?', color: '#2563eb', especialidad: '' }; }
  function servById(id) { return DATA.servicios.find(s => s.id === id) || DATA.servicios[0]; }
  function monthBounds(ref) { const d = new Date(ref); const first = keyOf(new Date(d.getFullYear(), d.getMonth(), 1)); const last = keyOf(new Date(d.getFullYear(), d.getMonth() + 1, 0)); return { first, last }; }
  function inMonth(fecha, ref) { const { first, last } = monthBounds(ref || new Date()); return fecha >= first && fecha <= last; }

  // ---- Agregaciones ----
  function directory() {
    const agg = {};
    DATA.turnos.forEach(t => {
      const k = (t.cliente_nombre || '').trim().toLowerCase(); if (!k) return;
      if (!agg[k]) agg[k] = { nombre: t.cliente_nombre, visitas: 0, gasto: 0, byB: {} };
      if (t.estado !== 'cancelado') { agg[k].visitas++; agg[k].gasto += Number(t.precio) || 0; }
      agg[k].byB[t.barbero_id] = (agg[k].byB[t.barbero_id] || 0) + 1;
    });
    const dir = {};
    Object.keys(agg).forEach(k => {
      const a = agg[k];
      const topB = Object.keys(a.byB).sort((x, y) => a.byB[y] - a.byB[x])[0];
      dir[k] = { key: k, nombre: a.nombre, visitas: a.visitas, gasto: a.gasto, barbero: topB, tel: '', email: '', cumpleanos: '', notas: '', tags: [], puntos: 0, id: null };
    });
    DATA.clientes.forEach(c => {
      const k = c.nombre_key;
      if (!dir[k]) dir[k] = { key: k, nombre: c.nombre, visitas: 0, gasto: 0, barbero: null };
      Object.assign(dir[k], { id: c.id, tel: c.telefono || '', email: c.email || '', cumpleanos: c.cumpleanos || '', notas: c.notas || '', tags: c.tags || [], puntos: c.puntos || 0 });
    });
    return Object.values(dir).sort((a, b) => b.gasto - a.gasto);
  }
  function barberStats(id) {
    const bt = DATA.turnos.filter(t => t.barbero_id === id && t.estado !== 'cancelado');
    const rev = bt.reduce((a, t) => a + (Number(t.precio) || 0), 0);
    const clis = {}, bm = {};
    bt.forEach(t => { const k = (t.cliente_nombre || '').toLowerCase(); clis[k] = 1; if (!bm[k]) bm[k] = { nombre: t.cliente_nombre, visitas: 0, gasto: 0 }; bm[k].visitas++; bm[k].gasto += Number(t.precio) || 0; });
    const top = Object.values(bm).sort((a, b) => b.visitas - a.visitas || b.gasto - a.gasto).slice(0, 5);
    const totalRev = DATA.turnos.filter(t => t.estado !== 'cancelado').reduce((a, t) => a + (Number(t.precio) || 0), 0);
    return { rev, turnos: bt.length, clientes: Object.keys(clis).length, ticket: bt.length ? rev / bt.length : 0, top, share: totalRev ? rev / totalRev : 0 };
  }
  function agendaStatsMes() {
    const turnos = DATA.turnos.filter(t => inMonth(t.fecha));
    const total = turnos.length;
    const cancelados = turnos.filter(t => t.estado === 'cancelado').length;
    const noshows = turnos.filter(t => t.estado === 'no-show').length;
    const completados = turnos.filter(t => t.estado === 'completado').length;
    const finalizados = completados + noshows;
    const dateKeys = [...new Set(turnos.map(t => t.fecha))];
    const bookedMin = turnos.filter(t => t.estado !== 'cancelado').reduce((s, t) => s + (t.duracion_min || 0), 0);
    const capacityMin = dateKeys.length * DATA.barberos.length * (DATA.config.cierre_min - DATA.config.apertura_min);
    return { tasaCancel: total ? Math.round(cancelados / total * 100) : 0, tasaNoShow: finalizados ? Math.round(noshows / finalizados * 100) : 0, ocupacion: capacityMin ? Math.round(bookedMin / capacityMin * 100) : 0, dias: dateKeys.length };
  }
  function retencion() { const dir = directory(); const con2 = dir.filter(c => c.visitas >= 2).length; return dir.length ? Math.round(con2 / dir.length * 100) : 0; }
  function pctChange(curr, prev) { if (!prev) return curr ? 100 : 0; return Math.round((curr - prev) / prev * 100); }
  function statsForMonth(monthOffset) {
    const ref = new Date(); ref.setDate(1); ref.setMonth(ref.getMonth() + monthOffset);
    const turnos = DATA.turnos.filter(t => inMonth(t.fecha, ref));
    const validTurnos = turnos.filter(t => t.estado !== 'cancelado' && t.estado !== 'no-show');
    const revenue = validTurnos.reduce((a, t) => a + Number(t.precio), 0);
    const cancelados = turnos.filter(t => t.estado === 'cancelado').length;
    const noshows = turnos.filter(t => t.estado === 'no-show').length;
    const nuevos = DATA.clientes.filter(c => inMonth((c.creado_en || '').slice(0, 10), ref)).length;
    const dateKeys = [...new Set(turnos.map(t => t.fecha))];
    const bookedMin = turnos.filter(t => t.estado !== 'cancelado').reduce((s, t) => s + (t.duracion_min || 0), 0);
    const capacityMin = dateKeys.length * DATA.barberos.length * (DATA.config.cierre_min - DATA.config.apertura_min);
    const ocupacion = capacityMin ? Math.round(bookedMin / capacityMin * 100) : 0;
    const porServicio = {};
    validTurnos.forEach(t => { const k = t.servicio_id || 'otro'; if (!porServicio[k]) porServicio[k] = { nombre: t.servicio_nombre, count: 0, revenue: 0 }; porServicio[k].count++; porServicio[k].revenue += Number(t.precio); });
    const porBarbero = {};
    validTurnos.forEach(t => { const k = t.barbero_id; if (!k) return; if (!porBarbero[k]) porBarbero[k] = { count: 0, revenue: 0 }; porBarbero[k].count++; porBarbero[k].revenue += Number(t.precio); });
    return { ref, revenue, turnos: validTurnos.length, ticket: validTurnos.length ? revenue / validTurnos.length : 0, cancelados, noshows, totalTurnos: turnos.length, nuevos, ocupacion, porServicio, porBarbero, label: MM[ref.getMonth()] + ' ' + ref.getFullYear() };
  }
  function shortDayLabel(dateKey) {
    const parts = dateKey.split('-'); const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return d.getDate() + ' ' + MM[d.getMonth()];
  }
  function dailySeries(days, offsetDays) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(new Date(), -(i + offsetDays));
      const key = keyOf(d);
      const dayTurnos = DATA.turnos.filter(t => t.fecha === key);
      const validos = dayTurnos.filter(t => t.estado !== 'cancelado' && t.estado !== 'no-show');
      out.push({ date: key, revenue: validos.reduce((a, t) => a + Number(t.precio), 0), turnos: validos.length, label: shortDayLabel(key) });
    }
    return out;
  }
  function buildInsights(cur, prev) {
    const items = [];
    function add(label, curVal, prevVal, fmt, higherIsBetter, minPct) {
      const change = pctChange(curVal, prevVal);
      if (Math.abs(change) < (minPct || 4)) return;
      items.push({ label, change, isGood: higherIsBetter ? change > 0 : change < 0, curFmt: fmt(curVal), prevFmt: fmt(prevVal) });
    }
    add('Ingresos', cur.revenue, prev.revenue, fmtMoney.format, true, 3);
    add('Turnos realizados', cur.turnos, prev.turnos, fmtN.format, true, 3);
    add('Clientes nuevos', cur.nuevos, prev.nuevos, fmtN.format, true, 5);
    add('Ticket promedio', cur.ticket, prev.ticket, fmtMoney.format, true, 3);
    add('Ocupación de agenda', cur.ocupacion, prev.ocupacion, v => Math.round(v) + '%', true, 3);
    const perdCur = cur.totalTurnos ? (cur.cancelados + cur.noshows) / cur.totalTurnos * 100 : 0;
    const perdPrev = prev.totalTurnos ? (prev.cancelados + prev.noshows) / prev.totalTurnos * 100 : 0;
    add('Turnos cancelados / no-show', perdCur, perdPrev, v => Math.round(v) + '%', false, 3);
    items.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    return items;
  }
  function insightsCard(cur, prev) {
    const items = buildInsights(cur, prev);
    const positivos = items.filter(x => x.isGood), negativos = items.filter(x => !x.isGood);
    function row(x) {
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #ece5d8">
        <div style="width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex:none;background:${x.isGood ? 'rgba(79,136,101,0.14)' : 'rgba(168,81,66,0.14)'};color:${x.isGood ? '#3f7a55' : '#a04236'}">${x.isGood ? '▲' : '▼'}</div>
        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700;color:#241d14">${esc(x.label)}</div><div style="font-size:11.5px;color:#8a7c68">${x.prevFmt} → ${x.curFmt}</div></div>
        <div style="font-size:13px;font-weight:800;color:${x.isGood ? '#3f7a55' : '#a04236'};white-space:nowrap">${x.change > 0 ? '+' : ''}${x.change}%</div>
      </div>`;
    }
    const negBlock = negativos.length
      ? `<div><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#a04236;margin-bottom:2px">⚠ Esto te está frenando</div>${negativos.map(row).join('')}</div>`
      : `<div style="font-size:12.5px;color:#3f7a55;padding:8px 0">✓ No hay señales de alerta importantes este período.</div>`;
    const posBlock = positivos.length
      ? `<div style="margin-top:16px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#3f7a55;margin-bottom:2px">✓ Esto te está haciendo crecer</div>${positivos.map(row).join('')}</div>` : '';
    return `<div class="chart-card">
      <h3>Diagnóstico del mes</h3>
      <div class="chart-sub">Qué está empujando y qué está frenando tu crecimiento vs. el mes anterior</div>
      ${negBlock}${posBlock}
    </div>`;
  }
  function trendChartsSection() {
    const period = state.metricsPeriod || 30;
    return `<div class="chart-card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div><h3 style="margin-bottom:2px">Ingresos por día</h3><div class="chart-sub" style="margin-bottom:0">Período actual vs. período anterior equivalente</div></div>
        <div class="chart-toggle">
          <button type="button" class="${period === 7 ? 'active' : ''}" onclick="Crm.setMetricsPeriod(7)">7 días</button>
          <button type="button" class="${period === 30 ? 'active' : ''}" onclick="Crm.setMetricsPeriod(30)">30 días</button>
        </div>
      </div>
      <div style="height:260px;margin-top:14px"><canvas id="chartTrendRevenue"></canvas></div>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="chart-card"><h3>Turnos por día</h3><div class="chart-sub">Cantidad realizada, mismo período</div><div style="height:220px;margin-top:10px"><canvas id="chartTrendTurnos"></canvas></div></div>
      ${insightsCard(statsForMonth(0), statsForMonth(-1))}
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="chart-card"><h3>Ingresos por cliente (este mes)</h3><div class="chart-sub">Quién representa cuánto de la facturación</div><div style="height:230px;margin-top:10px"><canvas id="chartByClient"></canvas></div></div>
      <div class="chart-card"><h3>Ingresos por servicio (este mes)</h3><div class="chart-sub">Qué servicios generan más facturación</div><div style="height:230px;margin-top:10px"><canvas id="chartByService"></canvas></div></div>
    </div>`;
  }
  function destroyMetricsChart(key) { if (metricsCharts[key]) { metricsCharts[key].destroy(); delete metricsCharts[key]; } }
  function renderMetricsCharts() {
    if (typeof Chart === 'undefined' || !DATA) return;
    const period = state.metricsPeriod || 30;
    const curSeries = dailySeries(period, 0), prevSeries = dailySeries(period, period);
    const cur = statsForMonth(0);

    const trendCanvas = document.getElementById('chartTrendRevenue');
    if (trendCanvas) {
      destroyMetricsChart('trend');
      metricsCharts.trend = new Chart(trendCanvas, {
        type: 'line',
        data: {
          labels: curSeries.map(d => d.label),
          datasets: [
            { label: 'Período actual', data: curSeries.map(d => d.revenue), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.14)', tension: 0.35, fill: true, pointRadius: 2, pointBackgroundColor: '#2563eb' },
            { label: 'Período anterior', data: prevSeries.map(d => d.revenue), borderColor: '#a9987f', backgroundColor: 'transparent', borderDash: [5, 4], tension: 0.35, fill: false, pointRadius: 0 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#5a4f40', usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + fmtMoney.format(ctx.parsed.y) } }
          },
          scales: {
            x: { ticks: { color: '#8a7c68', font: { size: 10 } }, grid: { color: '#f0e9db' } },
            y: { ticks: { color: '#8a7c68', font: { size: 10 }, callback: v => fmtMoney.format(v) }, grid: { color: '#f0e9db' } }
          }
        }
      });
    }
    const turnosCanvas = document.getElementById('chartTrendTurnos');
    if (turnosCanvas) {
      destroyMetricsChart('turnos');
      metricsCharts.turnos = new Chart(turnosCanvas, {
        type: 'bar',
        data: { labels: curSeries.map(d => d.label), datasets: [{ label: 'Turnos', data: curSeries.map(d => d.turnos), backgroundColor: '#4f7f9c', borderRadius: 4, maxBarThickness: 26 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { ticks: { color: '#8a7c68', font: { size: 10 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: '#8a7c68', font: { size: 10 }, precision: 0 }, grid: { color: '#f0e9db' } } }
        }
      });
    }
    const clientCanvas = document.getElementById('chartByClient');
    if (clientCanvas) {
      destroyMetricsChart('client');
      const byClient = {};
      DATA.turnos.filter(t => inMonth(t.fecha) && t.estado !== 'cancelado' && t.estado !== 'no-show').forEach(t => {
        const k = (t.cliente_nombre || '').trim().toLowerCase(); if (!k) return;
        if (!byClient[k]) byClient[k] = { nombre: t.cliente_nombre, val: 0 };
        byClient[k].val += Number(t.precio);
      });
      const arr = Object.values(byClient).sort((a, b) => b.val - a.val);
      const top = arr.slice(0, 5), otros = arr.slice(5).reduce((s, x) => s + x.val, 0);
      const labels = top.map(x => x.nombre).concat(otros > 0 ? ['Otros'] : []);
      const data = top.map(x => x.val).concat(otros > 0 ? [otros] : []);
      metricsCharts.client = new Chart(clientCanvas, {
        type: 'doughnut',
        data: { labels: labels.length ? labels : ['Sin datos'], datasets: [{ data: data.length ? data : [1], backgroundColor: ['#2563eb', '#4f7f9c', '#4f8865', '#93708a', '#b3703f', '#c9c0ae'], borderColor: '#fff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#5a4f40', font: { size: 10.5 }, boxWidth: 10 } }, tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmtMoney.format(ctx.parsed) } } } }
      });
    }
    const serviceCanvas = document.getElementById('chartByService');
    if (serviceCanvas) {
      destroyMetricsChart('service');
      const svData = Object.values(cur.porServicio).sort((a, b) => b.revenue - a.revenue);
      metricsCharts.service = new Chart(serviceCanvas, {
        type: 'doughnut',
        data: { labels: svData.length ? svData.map(s => s.nombre) : ['Sin datos'], datasets: [{ data: svData.length ? svData.map(s => s.revenue) : [1], backgroundColor: ['#2563eb', '#4f7f9c', '#4f8865', '#93708a', '#4f9c94', '#b3703f', '#6b6f9c'], borderColor: '#fff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#5a4f40', font: { size: 10.5 }, boxWidth: 10 } }, tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmtMoney.format(ctx.parsed) } } } }
      });
    }
  }
  function compareCard(icon, label, curr, prev, fmt) {
    const change = pctChange(curr, prev);
    const isUp = change >= 0;
    const color = isUp ? 'var(--green)' : 'var(--red)';
    const arrow = isUp ? '▲' : '▼';
    return `<div class="card" style="padding:18px">
      <div style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;background:rgba(37,99,235,0.16);color:var(--gold);font-size:15px">${icon}</div>
      <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:25px;letter-spacing:-0.3px">${fmt(curr)}</div>
      <div style="font-size:13px;font-weight:700;margin-top:4px">${label}</div>
      <div style="font-size:12px;font-weight:700;margin-top:6px;color:${color};display:flex;align-items:center;gap:4px;flex-wrap:wrap">${arrow} ${Math.abs(change)}% <span style="color:var(--muted2);font-weight:500">vs. mes anterior (${fmt(prev)})</span></div>
    </div>`;
  }
  function tabMetricas() {
    const cur = statsForMonth(0), prev = statsForMonth(-1);
    const cards = [
      compareCard('💰', 'Ingresos', cur.revenue, prev.revenue, fmtMoney.format),
      compareCard('📅', 'Turnos realizados', cur.turnos, prev.turnos, fmtN.format),
      compareCard('🎫', 'Ticket promedio', cur.ticket, prev.ticket, fmtMoney.format),
      compareCard('🧑', 'Clientes nuevos', cur.nuevos, prev.nuevos, fmtN.format),
      compareCard('📊', 'Ocupación', cur.ocupacion, prev.ocupacion, v => v + '%')
    ].join('');
    const perdidosCur = cur.cancelados + cur.noshows, perdidosPrev = prev.cancelados + prev.noshows;
    const perdidosPctCur = cur.totalTurnos ? Math.round(perdidosCur / cur.totalTurnos * 100) : 0;
    const perdidosPctPrev = prev.totalTurnos ? Math.round(perdidosPrev / prev.totalTurnos * 100) : 0;
    const perdidosBetter = perdidosPctCur <= perdidosPctPrev;
    const svRows = Object.values(cur.porServicio).sort((a, b) => b.revenue - a.revenue).map(s => {
      const pct = cur.revenue ? Math.round(s.revenue / cur.revenue * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-top:1px solid var(--border)">
        <div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600">${esc(s.nombre)}</div>
          <div style="height:6px;border-radius:6px;background:var(--panel2);margin-top:5px;overflow:hidden"><span style="display:block;height:100%;border-radius:6px;width:${pct}%;background:var(--gold)"></span></div></div>
        <div style="font-size:12px;color:var(--muted2);white-space:nowrap">${s.count} turnos</div>
        <div style="font-size:12.5px;font-weight:700;text-align:right;white-space:nowrap;width:90px">${fmtMoney.format(s.revenue)}</div>
      </div>`;
    }).join('') || `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:20px 10px">Sin datos este mes.</div>`;
    const bRows = DATA.barberos.map(b => {
      const c = cur.porBarbero[b.id] || { count: 0, revenue: 0 };
      const p = prev.porBarbero[b.id] || { count: 0, revenue: 0 };
      const change = pctChange(c.revenue, p.revenue);
      const isUp = change >= 0;
      return `<div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-top:1px solid var(--border)">
        <div style="width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:800;flex:none;background:${b.color}22;color:${b.color}">${initials(b.alias)}</div>
        <div style="flex:1;min-width:0;font-size:13.5px;font-weight:600">${esc(b.alias)}</div>
        <div style="font-size:12px;color:var(--muted2);white-space:nowrap">${c.count} turnos</div>
        <div style="font-size:12.5px;font-weight:700;text-align:right;white-space:nowrap;width:90px">${fmtMoney.format(c.revenue)}</div>
        <div style="font-size:11px;font-weight:700;width:60px;text-align:right;color:${isUp ? 'var(--green)' : 'var(--red)'}">${isUp ? '▲' : '▼'}${Math.abs(change)}%</div>
      </div>`;
    }).join('');
    const hist = (DATA.config.historico || []).slice(); hist.push(cur.revenue);
    const refD = new Date(); const trendLabels = []; for (let i = 5; i >= 0; i--) { const d = new Date(refD.getFullYear(), refD.getMonth() - i, 1); trendLabels.push(MM[d.getMonth()]); }
    const maxH = Math.max(...hist, 1);
    const trendBars = hist.map((v, i) => ({ height: Math.max(4, Math.round(v / maxH * 100)), label: trendLabels[i] || '', color: i === hist.length - 1 ? 'var(--gold)' : 'rgba(37,99,235,0.4)' }));
    return `
    <div style="font-size:12.5px;color:var(--muted);margin-bottom:14px">Comparando <b style="color:var(--text)">${cur.label}</b> contra <b style="color:var(--text)">${prev.label}</b></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:18px">${cards}</div>

    ${trendChartsSection()}

    <div class="grid-2" style="margin-bottom:16px">
      <section class="card">
        <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Turnos perdidos</h3>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0">
          <div><div style="font-size:22px;font-weight:800">${perdidosPctCur}%</div><div style="font-size:11.5px;color:var(--muted2)">cancelados + no-show (${perdidosCur} turnos)</div></div>
          <div style="text-align:right;font-size:12px;font-weight:700;color:${perdidosBetter ? 'var(--green)' : 'var(--red)'}">${perdidosBetter ? '▼' : '▲'}${Math.abs(perdidosPctCur - perdidosPctPrev)} pts vs mes anterior</div>
        </div>
      </section>
      <section class="card">
        <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Retención de clientes</h3>
        <div style="font-size:22px;font-weight:800">${retencion()}%</div>
        <div style="font-size:11.5px;color:var(--muted2)">clientes con 2+ visitas (histórico)</div>
      </section>
    </div>
    <section class="card" style="margin-bottom:16px">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Ingresos por servicio — detalle</h3>
      ${svRows}
    </section>
    <section class="card">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Rendimiento por barbero (este mes vs. anterior)</h3>
      ${bRows}
    </section>`;
  }
  function rankRowView(i, c, valStr, pct, colorOverride) {
    const bColor = colorOverride || (c.barbero ? barb(c.barbero).color : '#2563eb');
    return { rank: i + 1, nombre: c.nombre, ini: initials(c.nombre), val: valStr, color: bColor, barWidth: Math.max(6, Math.round(pct * 100)) };
  }
  function agendaItemView(a, opts) {
    const b = barb(a.barbero_id), meta = statusMeta(a.estado);
    const editable = !!(opts && opts.editable);
    return { id: a.id, time: minToStr(a.hora_min), cliente: a.cliente_nombre, servicioNombre: a.servicio_nombre, precioFmt: fmtMoney.format(a.precio), meta, barbero: b, showActions: editable && a.estado === 'confirmado' };
  }
  function groupByDay(list, opts) {
    const days = [...new Set(list.map(a => a.fecha))].sort();
    return days.map(dk => {
      const items = list.filter(a => a.fecha === dk).sort((x, y) => x.hora_min - y.hora_min);
      return { key: dk, label: dayLabel(dk), countStr: items.length + (items.length === 1 ? ' turno' : ' turnos'), items: items.map(a => agendaItemView(a, opts)) };
    });
  }

  // ---- Acciones de datos ----
  async function setEstado(id, estado) {
    const t = DATA.turnos.find(x => x.id === id);
    await sb.from('turnos').update({ estado }).eq('id', id);
    if (estado === 'completado' && t) {
      const key = (t.cliente_nombre || '').trim().toLowerCase();
      const cli = DATA.clientes.find(c => c.nombre_key === key);
      if (cli) await sb.from('clientes').update({ puntos: (cli.puntos || 0) + 1 }).eq('id', cli.id);
    }
    showToast('Turno actualizado'); await refresh();
  }

  async function loginAdmin() {
    if (!state.loginUser.trim() || !state.loginPass.trim()) return;
    state.loginBusy = true; renderLogin();
    const { data, error } = await sb.rpc('login_admin', { p_usuario: state.loginUser.trim(), p_clave: state.loginPass });
    state.loginBusy = false;
    if (error || !data) { showToast('Usuario o clave incorrectos'); renderLogin(); return; }
    state.auth = { role: 'admin' }; state.tab = 'gerente';
    localStorage.setItem('ibiza_auth', JSON.stringify(state.auth));
    render();
  }
  async function loginBarbero() {
    if (!state.loginBarberId || !state.loginPin.trim()) return;
    state.loginBusy = true; renderLogin();
    const { data, error } = await sb.rpc('login_barbero', { p_barbero_id: state.loginBarberId, p_pin: state.loginPin });
    state.loginBusy = false;
    if (error || !data) { showToast('PIN incorrecto'); renderLogin(); return; }
    state.auth = { role: 'barbero', id: state.loginBarberId }; state.tab = state.loginBarberId;
    localStorage.setItem('ibiza_auth', JSON.stringify(state.auth));
    render();
  }
  function logout() { state.auth = null; localStorage.removeItem('ibiza_auth'); state.loginPass = ''; state.loginPin = ''; render(); }

  async function refresh() { DATA = await loadAllData(); render(); }

  // ============ LOGIN SCREEN ============
  function renderLogin() {
    const isAdmin = state.loginMode === 'admin';
    const barberBtns = DATA.barberos.map(b => {
      const isOn = state.loginBarberId === b.id;
      return `<button onclick="Crm.pickBarbero('${b.id}')" style="display:flex;align-items:center;gap:9px;border-radius:11px;padding:10px;cursor:pointer;border:1.5px solid ${isOn ? b.color : 'var(--border-strong)'};background:${isOn ? tint(b.color, 0.16) : 'var(--panel2)'}">
        <span style="width:30px;height:30px;flex:none;border-radius:9px;display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-weight:700;font-size:11px;background:${tint(b.color, 0.16)};color:${b.color}">${initials(b.alias)}</span>
        <span style="font-size:12.5px;font-weight:700;color:var(--text)">${esc(b.alias)}</span>
      </button>`;
    }).join('');
    const adminValid = state.loginUser.trim() && state.loginPass.trim();
    const barberoValid = state.loginBarberId && state.loginPin.trim();
    app.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
      <div style="width:100%;max-width:420px;background:var(--panel);border:1px solid var(--border);border-radius:20px;padding:32px;box-shadow:0 30px 80px rgba(0,0,0,0.5)">
        <div style="display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:24px">
          <div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(160deg,var(--gold-soft),#1d4ed8);display:flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:22px">✂️</div>
          <div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:21px">IBIZA studio</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">Iniciá sesión en el panel de gestión</div>
        </div>
        <div style="display:flex;gap:4px;background:var(--panel2);padding:4px;border-radius:11px;border:1px solid var(--border);margin-bottom:20px">
          <button onclick="Crm.setLoginMode('admin')" style="flex:1;border:none;padding:9px;border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer;background:${isAdmin ? 'var(--gold)' : 'transparent'};color:${isAdmin ? '#ffffff' : 'var(--muted)'}">Administrador</button>
          <button onclick="Crm.setLoginMode('barbero')" style="flex:1;border:none;padding:9px;border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer;background:${!isAdmin ? 'var(--gold)' : 'transparent'};color:${!isAdmin ? '#ffffff' : 'var(--muted)'}">Soy barbero</button>
        </div>
        ${isAdmin ? `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div><label style="display:block;font-size:11.5px;font-weight:600;margin-bottom:6px;color:var(--muted)">Usuario</label><input class="input" value="${esc(state.loginUser)}" oninput="Crm.setLoginField('loginUser',this.value)"></div>
          <div><label style="display:block;font-size:11.5px;font-weight:600;margin-bottom:6px;color:var(--muted)">Contraseña</label><input class="input" type="password" value="${esc(state.loginPass)}" oninput="Crm.setLoginField('loginPass',this.value)"></div>
          <button id="adminSubmitBtn" class="btn" ${adminValid && !state.loginBusy ? '' : 'disabled'} onclick="Crm.loginAdmin()" style="margin-top:6px;${adminValid ? 'background:linear-gradient(160deg,var(--gold-soft),#1d4ed8);color:#ffffff' : ''}">${state.loginBusy ? 'Entrando...' : 'Ingresar como administrador'}</button>
          <div style="font-size:10.5px;color:var(--muted2);text-align:center">Primera vez: la clave que escribas queda guardada para siempre.</div>
        </div>` : `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">${barberBtns}</div>
        ${state.loginBarberId ? `<div style="margin-bottom:12px"><label style="display:block;font-size:11.5px;font-weight:600;margin-bottom:6px;color:var(--muted)">PIN</label><input class="input" type="password" inputmode="numeric" value="${esc(state.loginPin)}" oninput="Crm.setLoginField('loginPin',this.value)"></div>` : ''}
        <button id="barberoSubmitBtn" class="btn" ${barberoValid && !state.loginBusy ? '' : 'disabled'} onclick="Crm.loginBarbero()" style="width:100%;${barberoValid ? 'background:linear-gradient(160deg,var(--gold-soft),#1d4ed8);color:#ffffff' : ''}">${state.loginBusy ? 'Entrando...' : 'Ingresar'}</button>
        <div style="font-size:10.5px;color:var(--muted2);text-align:center;margin-top:10px">Primera vez: el PIN que escribas queda guardado para siempre.</div>`}
      </div>
    </div>`;
  }

  // ============ LAYOUT ============
  function sidebar() {
    const auth = state.auth, isAdmin = auth.role === 'admin', myId = auth.role === 'barbero' ? auth.id : null;
    const navBarbers = DATA.barberos.map(b => {
      const isOn = state.tab === b.id;
      return `<button onclick="Crm.selectTab('${b.id}')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:8px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${isOn ? 'rgba(37,99,235,0.14)' : 'transparent'};color:${isOn ? 'var(--text)' : 'var(--muted)'}">
        <span style="width:22px;height:22px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-weight:600;font-size:9px;background:${tint(b.color, 0.16)};color:${b.color}">${initials(b.alias)}</span>${esc(b.alias)}
      </button>`;
    }).join('');
    const manageItems = [
      { id: 'pipeline', label: 'Pipeline' }, { id: 'clientes', label: 'Clientes' }
    ].map(it => { const isOn = state.tab === it.id; return `<button onclick="Crm.selectTab('${it.id}')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${isOn ? 'rgba(37,99,235,0.14)' : 'transparent'};color:${isOn ? 'var(--text)' : 'var(--muted)'}">${it.label}</button>`; }).join('');
    const authIni = isAdmin ? 'AD' : initials(barb(myId).alias);
    const authLabel = isAdmin ? 'Administrador' : barb(myId).alias;
    const authColor = isAdmin ? 'var(--gold)' : barb(myId).color;
    return `<aside class="crm-sidebar${state.sidebarOpen ? ' open' : ''}" id="crmSidebar">
      <div style="display:flex;align-items:center;gap:11px;padding:4px 6px 22px">
        <div style="width:40px;height:40px;flex:none;border-radius:11px;background:linear-gradient(160deg,var(--gold-soft),#1d4ed8);display:flex;align-items:center;justify-content:center;font-size:18px">✂️</div>
        <div style="flex:1;min-width:0"><div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:16.5px">IBIZA studio</div><div style="font-size:11px;color:var(--muted2);font-weight:500">Panel de gestión</div></div>
        <button onclick="Crm.closeSidebar()" style="display:none" class="crm-burger crm-sidebar-close">✕</button>
      </div>
      ${isAdmin ? `<button onclick="Crm.selectTab('gerente')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${state.tab === 'gerente' ? 'rgba(37,99,235,0.14)' : 'transparent'};color:${state.tab === 'gerente' ? 'var(--text)' : 'var(--muted)'}">Panel general</button>
      <button onclick="Crm.selectTab('calendario')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:14px;background:${state.tab === 'calendario' ? 'rgba(37,99,235,0.14)' : 'transparent'};color:${state.tab === 'calendario' ? 'var(--text)' : 'var(--muted)'}">Calendario</button>
      <div style="font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted2);padding:6px 12px 7px">Gestión</div>${manageItems}
      <div style="font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted2);padding:16px 12px 7px">Barberos</div>${navBarbers}
      <div style="font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted2);padding:16px 12px 7px">Sistema</div>
      <button onclick="Crm.selectTab('config')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;background:${state.tab === 'config' ? 'rgba(37,99,235,0.14)' : 'transparent'};color:${state.tab === 'config' ? 'var(--text)' : 'var(--muted)'}">Configuración</button>` : `
      <button onclick="Crm.selectTab('${myId}')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${state.tab === myId ? 'rgba(37,99,235,0.14)' : 'transparent'};color:${state.tab === myId ? 'var(--text)' : 'var(--muted)'}">Mi Panel</button>
      <button onclick="Crm.selectTab('calendario')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${state.tab === 'calendario' ? 'rgba(37,99,235,0.14)' : 'transparent'};color:${state.tab === 'calendario' ? 'var(--text)' : 'var(--muted)'}">Calendario</button>
      <button onclick="Crm.selectTab('pipeline')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${state.tab === 'pipeline' ? 'rgba(37,99,235,0.14)' : 'transparent'};color:${state.tab === 'pipeline' ? 'var(--text)' : 'var(--muted)'}">Mi Pipeline</button>
      <button onclick="Crm.selectTab('clientes')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;background:${state.tab === 'clientes' ? 'rgba(37,99,235,0.14)' : 'transparent'};color:${state.tab === 'clientes' ? 'var(--text)' : 'var(--muted)'}">Clientes</button>`}
      <div style="flex:1"></div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:var(--panel2);border:1px solid var(--border)">
        <div style="width:24px;height:24px;flex:none;border-radius:7px;background:${tint(authColor, 0.16)};display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:800;color:${authColor}">${authIni}</div>
        <div style="flex:1;min-width:0;font-size:11.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(authLabel)}</div>
      </div>
      <button onclick="Crm.logout()" style="margin-top:6px;width:100%;text-align:center;font-size:11px;font-weight:700;color:var(--muted);background:transparent;border:1px solid var(--border-strong);border-radius:9px;padding:7px;cursor:pointer">Cerrar sesión</button>
    </aside>`;
  }

  function kpiCard(icon, value, label, sub) {
    return `<div class="card" style="padding:18px">
      <div style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;background:rgba(37,99,235,0.16);color:var(--gold);font-size:15px">${icon}</div>
      <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:25px;letter-spacing:-0.3px">${value}</div>
      <div style="font-size:13px;font-weight:700;margin-top:4px">${label}</div>
      <div style="font-size:11.5px;color:var(--muted2);margin-top:1px">${sub}</div>
    </div>`;
  }
  function rankList(rows) {
    if (!rows.length) return `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:20px 10px">Sin datos.</div>`;
    return rows.map(r => `<div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-top:1px solid var(--border)">
      <div style="width:18px;text-align:center;font-weight:800;font-size:12.5px;color:var(--muted2)">${r.rank}</div>
      <div style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:800;flex:none;background:${r.color}22;color:${r.color}">${r.ini}</div>
      <div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.nombre)}</div>
        <div style="height:6px;border-radius:6px;background:var(--panel2);margin-top:5px;overflow:hidden"><span style="display:block;height:100%;border-radius:6px;width:${r.barWidth}%;background:${r.color}"></span></div></div>
      <div style="font-size:12.5px;font-weight:700;text-align:right;white-space:nowrap">${r.val}</div>
    </div>`).join('');
  }

  function tabGerente() {
    const turnosMes = DATA.turnos.filter(t => inMonth(t.fecha));
    const revMes = turnosMes.filter(t => t.estado !== 'cancelado' && t.estado !== 'no-show').reduce((a, t) => a + Number(t.precio), 0);
    const cuentaMes = turnosMes.filter(t => t.estado !== 'cancelado' && t.estado !== 'no-show').length;
    const turnosHoy = DATA.turnos.filter(t => t.fecha === todayKey() && t.estado !== 'cancelado').length;
    const dir = directory();
    const nuevos = DATA.clientes.filter(c => inMonth((c.creado_en || '').slice(0, 10))).length;
    const perdidos = turnosMes.filter(t => t.estado === 'cancelado' || t.estado === 'no-show').length;
    const svCount = {}; turnosMes.forEach(t => { if (t.servicio_id) svCount[t.servicio_id] = (svCount[t.servicio_id] || 0) + 1; });
    const topSvId = Object.keys(svCount).sort((a, b) => svCount[b] - svCount[a])[0];
    const topSv = topSvId ? servById(topSvId) : null;
    const st = agendaStatsMes(), ret = retencion();

    const topVisitas = dir.slice().sort((a, b) => b.visitas - a.visitas || b.gasto - a.gasto).slice(0, 6);
    const topGasto = dir.slice().sort((a, b) => b.gasto - a.gasto).slice(0, 6);
    const totalRevAll = dir.reduce((a, c) => a + c.gasto, 0) || 1;

    const barberCards = DATA.barberos.map(bb => {
      const s = barberStats(bb.id);
      return `<div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;gap:11px">
          <div style="width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13.5px;flex:none;background:${bb.color}22;color:${bb.color}">${initials(bb.alias)}</div>
          <div style="min-width:0"><div style="font-weight:700;font-size:14px">${esc(bb.alias)}</div><div style="font-size:11.5px;color:var(--muted)">${esc(bb.especialidad)}</div></div>
          <div style="margin-left:auto;font-family:'Oswald',sans-serif;font-weight:700;font-size:19px;color:${bb.color}">${Math.round(s.share * 100)}%</div>
        </div>
        <div style="display:flex;gap:6px;margin-top:14px">
          <div style="flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:9px 8px;text-align:center"><span style="display:block;font-weight:800;font-size:13.5px">${fmtMoney.format(s.rev)}</span><small style="font-size:10px;color:var(--muted2)">Ingresos</small></div>
          <div style="flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:9px 8px;text-align:center"><span style="display:block;font-weight:800;font-size:13.5px">${fmtN.format(s.turnos)}</span><small style="font-size:10px;color:var(--muted2)">Turnos</small></div>
          <div style="flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:9px 8px;text-align:center"><span style="display:block;font-weight:800;font-size:13.5px">${fmtMoney.format(s.ticket)}</span><small style="font-size:10px;color:var(--muted2)">Ticket prom.</small></div>
        </div>
        <div style="height:8px;border-radius:6px;background:var(--panel2);margin-top:12px;overflow:hidden"><span style="display:block;height:100%;border-radius:6px;width:${Math.max(4, Math.round(s.share * 100))}%;background:${bb.color}"></span></div>
      </div>`;
    }).join('');

    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:18px">
      ${kpiCard('💰', fmtMoney.format(revMes), 'Ingresos del mes', 'mes en curso')}
      ${kpiCard('📅', fmtN.format(turnosHoy), 'Turnos de hoy', 'agendados para hoy')}
      ${kpiCard('🎫', fmtMoney.format(cuentaMes ? revMes / cuentaMes : 0), 'Ticket promedio', 'por turno')}
      ${kpiCard('📊', st.ocupacion + '%', 'Ocupación de agenda', 'próximos ' + st.dias + ' días')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:18px">
      ${kpiCard('🧑', fmtN.format(nuevos), 'Clientes nuevos', 'este mes')}
      ${kpiCard('🔁', ret + '%', 'Retención', 'clientes con 2+ visitas')}
      ${kpiCard('⚠️', (turnosMes.length ? Math.round(perdidos / turnosMes.length * 100) : 0) + '%', 'Turnos perdidos', 'cancelados + no-show')}
      ${kpiCard('⭐', topSv ? topSv.nombre : '—', 'Servicio estrella', topSv ? Math.round(svCount[topSvId] / turnosMes.length * 100) + '% de los turnos' : 'sin datos')}
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Clientes que más vienen</h3>${rankList(topVisitas.map((c, i) => rankRowView(i, c, c.visitas + ' visitas', c.visitas / (topVisitas[0] ? topVisitas[0].visitas || 1 : 1))))}</section>
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Participación en la ganancia</h3>${rankList(topGasto.map((c, i) => rankRowView(i, c, fmtMoney.format(c.gasto) + ' · ' + (c.gasto / totalRevAll * 100).toFixed(1) + '%', c.gasto / (topGasto[0] ? topGasto[0].gasto || 1 : 1))))}</section>
    </div>
    <section class="card" style="margin-bottom:16px"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:14px">Reparto de facturación por barbero</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">${barberCards}</div></section>
    <div style="margin:28px 0 16px;padding-top:18px;border-top:1px solid var(--border-strong)">
      <h2 style="font-family:'Oswald',sans-serif;font-weight:600;font-size:18px;margin-bottom:2px">Métricas y comparación mensual</h2>
      <div style="font-size:12px;color:var(--muted)">Crecimiento, diagnóstico y desglose detallado del mes</div>
    </div>
    ${tabMetricas()}`;
  }

  function agendaRow(it, showBarbero) {
    return `<div style="display:flex;align-items:center;gap:12px;background:var(--panel2);border:1px solid var(--border);border-radius:11px;padding:10px 13px;margin-bottom:6px">
      <div style="font-weight:800;font-size:13px;width:46px;flex:none">${it.time}</div>
      <div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600">${esc(it.cliente)}</div>
        <div style="font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px">${esc(it.servicioNombre)}<span class="badge" style="color:${it.meta.color};background:${it.meta.bg}">${it.meta.label}</span></div>
        ${it.showActions ? `<div style="display:flex;gap:5px;margin-top:7px;flex-wrap:wrap">
          <button onclick="Crm.setEstado(${it.id},'completado')" style="font-size:10.5px;font-weight:700;padding:4px 8px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel);color:var(--green);cursor:pointer">✓ Completado</button>
          <button onclick="Crm.setEstado(${it.id},'no-show')" style="font-size:10.5px;font-weight:700;padding:4px 8px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel);color:var(--purple);cursor:pointer">No-show</button>
          <button onclick="Crm.setEstado(${it.id},'cancelado')" style="font-size:10.5px;font-weight:700;padding:4px 8px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel);color:var(--red);cursor:pointer">Cancelar</button>
        </div>` : ''}
      </div>
      ${showBarbero ? `<div style="font-size:11.5px;font-weight:600;display:flex;align-items:center;gap:6px;color:${it.barbero.color};flex:none"><span style="width:8px;height:8px;border-radius:50%;background:${it.barbero.color}"></span>${esc(it.barbero.alias)}</div>` : ''}
      <div style="font-size:12.5px;font-weight:700;width:82px;text-align:right;flex:none">${it.precioFmt}</div>
    </div>`;
  }

  function tabBarbero(id) {
    const b = barb(id), s = barberStats(id);
    const own = DATA.turnos.filter(a => a.barbero_id === id);
    const ownFuture = own.filter(a => a.fecha >= todayKey());
    const hoy = ownFuture.filter(a => a.fecha === todayKey()).length;
    const cancel = own.filter(a => a.estado === 'cancelado').length, noshow = own.filter(a => a.estado === 'no-show').length;
    const days = groupByDay(ownFuture, { editable: true });
    return `<div style="display:flex;align-items:center;gap:18px;background:linear-gradient(120deg,${tint(b.color, 0.16)},var(--panel) 75%);border:1px solid var(--border);border-radius:16px;padding:20px 22px;margin-bottom:18px">
      <div style="width:58px;height:58px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-weight:700;font-size:21px;color:#ffffff;flex:none;background:${b.color}">${initials(b.alias)}</div>
      <div><div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:20px">${esc(b.nombre)}</div><div style="font-size:12.5px;color:var(--muted);margin-top:2px">${esc(b.especialidad)} · ${hoy} turno${hoy === 1 ? '' : 's'} hoy</div></div>
      <div style="margin-left:auto;text-align:right"><div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:27px;color:${b.color}">${Math.round(s.share * 100)}%</div><div style="font-size:10.5px;color:var(--muted2)">de la facturación del local</div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:16px">
      ${kpiCard('💰', fmtMoney.format(s.rev), 'Mis ingresos', 'este mes')}
      ${kpiCard('📅', fmtN.format(s.turnos), 'Mis turnos', 'realizados')}
      ${kpiCard('🧑', fmtN.format(s.clientes), 'Clientes atendidos', 'distintos')}
      ${kpiCard('🎫', fmtMoney.format(s.ticket), 'Ticket promedio', 'por turno')}
    </div>
    <div style="margin-bottom:16px;font-size:12px;color:var(--muted);background:var(--panel);border:1px dashed var(--border-strong);border-radius:10px;padding:10px 12px">Cancelaciones: <b style="color:var(--gold-soft)">${cancel}</b> · No-shows: <b style="color:var(--gold-soft)">${noshow}</b></div>
    <div class="grid-2">
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Mi agenda</h3>
        ${days.length ? days.map(day => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:700;color:var(--gold);text-transform:uppercase;padding:6px 0"><span>${day.label}</span><span style="color:var(--muted2);font-weight:500">${day.countStr}</span></div>${day.items.map(it => agendaRow(it, false)).join('')}</div>`).join('') : `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:24px 10px">Sin turnos próximos cargados.</div>`}
      </section>
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Mis mejores clientes</h3>${rankList(s.top.map((c, i) => rankRowView(i, c, c.visitas + ' vis · ' + fmtMoney.format(c.gasto), c.visitas / (s.top[0] ? s.top[0].visitas : 1), b.color)))}</section>
    </div>`;
  }

  function tabPipeline() {
    const isAdmin = state.auth.role === 'admin';
    const today = todayKey();
    const barberFilter = isAdmin ? state.pipelineBarberFilter : state.auth.id;
    const dayItems = DATA.turnos.filter(a => a.fecha === today && (barberFilter === 'all' || a.barbero_id === barberFilter)).sort((x, y) => x.hora_min - y.hora_min);
    const dayAll = DATA.turnos.filter(a => a.fecha === today);
    const dayRevenue = dayAll.filter(a => a.estado !== 'cancelado').reduce((s, a) => s + Number(a.precio), 0);
    function card(a) { const b = barb(a.barbero_id); return `<div style="background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px"><span style="font-weight:800;font-size:12.5px">${minToStr(a.hora_min)}</span><span style="font-size:11.5px;font-weight:700;color:var(--muted)">${fmtMoney.format(a.precio)}</span></div>
      <div style="font-size:12.5px;font-weight:700;margin-top:4px">${esc(a.cliente_nombre)}</div><div style="font-size:11px;color:var(--muted2)">${esc(a.servicio_nombre)}</div>
      <div style="font-size:10.5px;font-weight:600;display:flex;align-items:center;gap:5px;margin-top:5px;color:${b.color}"><span style="width:6px;height:6px;border-radius:50%;background:${b.color}"></span>${esc(b.alias)}</div>
      ${a.estado === 'confirmado' ? `<button onclick="Crm.setEstado(${a.id},'completado')" style="width:100%;margin-top:9px;border:none;border-radius:8px;padding:8px;font-weight:800;font-size:11.5px;cursor:pointer;background:var(--green);color:#ffffff">✓ Marcar como finalizado</button>
        <div style="display:flex;gap:5px;margin-top:5px"><button onclick="Crm.setEstado(${a.id},'no-show')" style="flex:1;font-size:10px;font-weight:700;padding:5px;border-radius:7px;border:1px solid var(--border-strong);background:var(--panel);color:var(--purple);cursor:pointer">No-show</button><button onclick="Crm.setEstado(${a.id},'cancelado')" style="flex:1;font-size:10px;font-weight:700;padding:5px;border-radius:7px;border:1px solid var(--border-strong);background:var(--panel);color:var(--red);cursor:pointer">Cancelar</button></div>` : ''}
    </div>`; }
    const cols = [
      { key: 'confirmado', label: 'Confirmados', color: 'var(--blue)' }, { key: 'completado', label: 'Completados', color: 'var(--green)' },
      { key: 'no-show', label: 'No-show', color: 'var(--purple)' }, { key: 'cancelado', label: 'Cancelados', color: 'var(--red)' }
    ].map(col => { const items = dayItems.filter(a => a.estado === col.key); return `<div style="background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:12px;min-height:140px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:${col.color}">${col.label}</div><div style="font-size:10.5px;font-weight:700;color:var(--muted2);background:var(--panel2);padding:2px 7px;border-radius:20px">${items.length}</div></div>
      ${items.length ? items.map(card).join('') : `<div style="text-align:center;color:var(--muted2);font-size:11px;padding:16px 4px">Sin turnos</div>`}
    </div>`; }).join('');
    const chips = isAdmin ? [{ id: 'all', label: 'Todos' }, ...DATA.barberos.map(b => ({ id: b.id, label: b.alias, color: b.color }))].map(ch => {
      const isOn = state.pipelineBarberFilter === ch.id;
      return `<button onclick="Crm.setPipelineFilter('${ch.id}')" style="font-size:11.5px;font-weight:700;padding:6px 12px;border-radius:20px;cursor:pointer;border:1px solid ${isOn ? (ch.color || 'var(--gold)') : 'var(--border-strong)'};background:${isOn ? tint(ch.color || '#2563eb', 0.16) : 'var(--panel2)'};color:${isOn ? (ch.color || 'var(--gold)') : 'var(--muted)'}">${ch.label}</button>`;
    }).join('') : '';
    return `<div class="card" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:17px">${dayLabel(today)}</div><div style="font-size:11.5px;color:var(--muted);margin-top:2px">${dayAll.length} turno${dayAll.length === 1 ? '' : 's'} hoy</div></div>
      <div style="text-align:right"><div style="font-size:10.5px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px">Ingreso estimado del día</div><div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:25px;color:var(--gold-soft)">${fmtMoney.format(dayRevenue)}</div></div>
    </div>
    ${chips ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${chips}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">${cols}</div>`;
  }

  function tabClientes() {
    const q = state.clientSearch.trim().toLowerCase();
    const dir = directory();
    const filtered = q ? dir.filter(c => c.nombre.toLowerCase().includes(q)) : dir;
    const allTags = ['VIP', 'Recurrente', 'Nuevo', 'Riesgo de fuga'];
    const rows = filtered.map((c, idx) => {
      const isOpen = state.openClientKey === c.key;
      const bb = c.barbero ? barb(c.barbero) : { tint: 'rgba(37,99,235,0.16)', color: 'var(--gold)' };
      const rowBg = idx % 2 === 0 ? 'var(--panel)' : 'var(--panel2)';
      return `<div style="background:${rowBg};border:1px solid var(--border-strong);border-radius:13px;padding:14px 16px">
        <div onclick="Crm.toggleClient('${jsStr(c.key)}')" style="display:flex;align-items:center;gap:12px;cursor:pointer">
          <div style="width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex:none;background:${tint(bb.color, 0.16)};color:${bb.color}">${initials(c.nombre)}</div>
          <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">${esc(c.nombre)}</div><div style="font-size:11.5px;color:var(--muted)">${c.visitas} visitas · ${fmtMoney.format(c.gasto)}</div></div>
          <div style="font-size:16px;color:var(--muted2);transform:rotate(${isOpen ? 90 : 0}deg)">›</div>
        </div>
        ${isOpen ? clientEditForm(c) : `<div style="display:flex;gap:5px;margin-top:8px;flex-wrap:wrap;padding-left:50px">${(c.tags && c.tags.length ? c.tags : ['Sin tags']).map(t => `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;background:var(--panel2);border:1px solid var(--border);color:var(--muted)">${esc(t)}</span>`).join('')}</div>`}
      </div>`;
    }).join('');
    return `<div style="margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <input id="clientSearchInput" class="input" style="flex:1;min-width:240px;max-width:420px" placeholder="Buscar cliente por nombre..." value="${esc(state.clientSearch)}" oninput="Crm.searchClients(this.value)">
      <span id="clientCountSpan" style="font-size:12px;font-weight:600;color:var(--muted)">${filtered.length} cliente${filtered.length === 1 ? '' : 's'} encontrado${filtered.length === 1 ? '' : 's'}</span>
      <button onclick="Crm.toggleAddClient()" style="margin-left:auto;font-size:12.5px;font-weight:800;padding:10px 16px;border-radius:11px;border:none;cursor:pointer;background:linear-gradient(160deg,var(--gold-soft),#1d4ed8);color:#ffffff">+ Agregar cliente</button>
    </div>
    ${state.showAddClient ? `<div class="card grid-3" style="margin-bottom:14px">
      <input class="input" placeholder="Nombre completo" value="${esc(state.newClientForm.nombre)}" oninput="Crm.newClientField('nombre',this.value)">
      <input class="input" placeholder="Teléfono" value="${esc(state.newClientForm.tel)}" oninput="Crm.newClientField('tel',this.value)">
      <input class="input" placeholder="Email (opcional)" value="${esc(state.newClientForm.email)}" oninput="Crm.newClientField('email',this.value)">
      <div style="grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px"><button class="btn btn-ghost" onclick="Crm.toggleAddClient()">Cancelar</button><button class="btn btn-gold" onclick="Crm.addClient()">Guardar cliente</button></div>
    </div>` : ''}
    <div id="clientListBody" style="display:flex;flex-direction:column;gap:10px">${rows || `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:24px 10px">No se encontraron clientes.</div>`}</div>`;
  }
  function clientVisitHistory(key) {
    return DATA.turnos.filter(t => (t.cliente_nombre || '').trim().toLowerCase() === key)
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora_min - a.hora_min);
  }
  function clientEditForm(c) {
    const allTags = ['VIP', 'Recurrente', 'Nuevo', 'Riesgo de fuga'];
    const hist = clientVisitHistory(c.key);
    const first = hist.length ? hist[hist.length - 1] : null;
    const ticketProm = c.visitas ? c.gasto / c.visitas : 0;
    const favB = c.barbero ? barb(c.barbero) : null;
    const statsRow = `<div style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
      <div style="background:var(--panel2);border-radius:10px;padding:10px 12px"><div style="font-size:9.5px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px">Cliente desde</div><div style="font-size:13px;font-weight:700;margin-top:2px">${first ? dayLabel(first.fecha).replace('Hoy · ', '') : '—'}</div></div>
      <div style="background:var(--panel2);border-radius:10px;padding:10px 12px"><div style="font-size:9.5px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px">Ticket promedio</div><div style="font-size:13px;font-weight:700;margin-top:2px">${fmtMoney.format(ticketProm)}</div></div>
      <div style="background:var(--panel2);border-radius:10px;padding:10px 12px"><div style="font-size:9.5px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px">Barbero favorito</div><div style="font-size:13px;font-weight:700;margin-top:2px">${favB ? esc(favB.alias) : '—'}</div></div>
    </div>`;
    const timeline = `<div style="grid-column:1/-1">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted2);margin-bottom:8px">Historial de visitas</div>
      ${hist.length ? `<div style="display:flex;flex-direction:column;max-height:220px;overflow-y:auto">
        ${hist.slice(0, 12).map(t => { const sm = statusMeta(t.estado); const bb = barb(t.barbero_id); return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border)">
          <div style="width:6px;height:6px;border-radius:50%;background:${bb.color};flex:none"></div>
          <div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:700">${esc(t.servicio_nombre)} <span style="font-weight:500;color:var(--muted)">· ${esc(bb.alias)}</span></div><div style="font-size:11px;color:var(--muted2)">${dayLabel(t.fecha)} · ${minToStr(t.hora_min)}</div></div>
          <div style="font-size:12px;font-weight:700;color:var(--text);white-space:nowrap">${fmtMoney.format(t.precio)}</div>
          <span class="badge" style="background:${sm.bg};color:${sm.color}">${sm.label}</span>
        </div>`; }).join('')}
      </div>` : `<div style="text-align:center;color:var(--muted2);font-size:12px;padding:10px 0">Sin turnos registrados aún.</div>`}
    </div>`;
    return `<div onclick="event.stopPropagation()" class="grid-2" style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border-strong);gap:10px">
      ${statsRow}
      ${timeline}
      <div><label style="display:block;font-size:11px;font-weight:600;margin-bottom:5px;color:var(--muted)">Teléfono</label><input class="input" id="cf_tel" value="${esc(c.tel)}"></div>
      <div><label style="display:block;font-size:11px;font-weight:600;margin-bottom:5px;color:var(--muted)">Email</label><input class="input" id="cf_email" value="${esc(c.email)}"></div>
      <div><label style="display:block;font-size:11px;font-weight:600;margin-bottom:5px;color:var(--muted)">Cumpleaños (MM-DD)</label><input class="input" id="cf_cumple" placeholder="07-15" value="${esc(c.cumpleanos)}"></div>
      <div><label style="display:block;font-size:11px;font-weight:600;margin-bottom:5px;color:var(--muted)">Puntos</label><input class="input" type="number" id="cf_puntos" value="${c.puntos}"></div>
      <div style="grid-column:1/-1"><label style="display:block;font-size:11px;font-weight:600;margin-bottom:5px;color:var(--muted)">Notas</label><textarea class="input" id="cf_notas" style="min-height:56px;resize:vertical">${esc(c.notas)}</textarea></div>
      <div style="grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap">${allTags.map(tg => { const on = (c.tags || []).includes(tg); return `<button type="button" onclick="Crm.toggleClientTag(this,'${tg}')" data-on="${on}" style="font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;cursor:pointer;border:1px solid ${on ? 'var(--gold)' : 'var(--border-strong)'};background:${on ? 'var(--gold)' : 'var(--panel2)'};color:${on ? '#ffffff' : 'var(--muted)'}">${tg}</button>`; }).join('')}</div>
      <div style="grid-column:1/-1;display:flex;justify-content:flex-end"><button class="btn btn-gold" onclick="Crm.saveClient('${jsStr(c.key)}')">Guardar ficha</button></div>
    </div>`;
  }

  // ============ CALENDARIO (vista mes / semana / día) ============
  function calActiveIds() { return state.calActiveBarberos || DATA.barberos.map(b => b.id); }
  function calTurnosForDay(dateKey) {
    const active = calActiveIds();
    return DATA.turnos.filter(a => a.fecha === dateKey && active.includes(a.barbero_id)).sort((x, y) => x.hora_min - y.hora_min);
  }
  function calWeekStartKey(dateKey) { const d = keyToDate(dateKey); return keyOf(addDays(d, -d.getDay())); }
  function calHourRange() {
    const startH = Math.max(0, Math.floor((DATA.config.apertura_min || 540) / 60));
    const endH = Math.min(24, Math.ceil((DATA.config.cierre_min || 1200) / 60));
    const hours = []; for (let h = startH; h < endH; h++) hours.push(h);
    return hours.length ? hours : [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  }
  function calPeriodLabel() {
    if (state.calView === 'month') { const d = keyToDate(state.calAnchor); return MM[d.getMonth()] + ' ' + d.getFullYear(); }
    if (state.calView === 'day') { const d = keyToDate(state.calSelectedDay); return DW[d.getDay()] + ' ' + d.getDate() + ' de ' + MM[d.getMonth()]; }
    const start = keyToDate(calWeekStartKey(state.calAnchor)), end = addDays(start, 6);
    return start.getDate() + ' – ' + end.getDate() + ' de ' + MM[end.getMonth()] + ' ' + end.getFullYear();
  }
  function calToolbar() {
    const views = [['month', 'Mes'], ['week', 'Semana'], ['day', 'Día']];
    const viewBtns = views.map(([v, label]) => `<button onclick="Crm.calSetView('${v}')" style="font-size:11.5px;font-weight:700;padding:6px 12px;border-radius:7px;border:none;cursor:pointer;background:${state.calView === v ? 'var(--gold)' : 'transparent'};color:${state.calView === v ? '#ffffff' : 'var(--muted)'}">${label}</button>`).join('');
    return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      <button onclick="Crm.calToday()" style="font-size:12px;font-weight:700;padding:8px 14px;border-radius:9px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--text);cursor:pointer">Hoy</button>
      <button onclick="Crm.calNav(-1)" style="width:32px;height:32px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--text);cursor:pointer">‹</button>
      <button onclick="Crm.calNav(1)" style="width:32px;height:32px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--text);cursor:pointer">›</button>
      <div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:17px;text-transform:capitalize;margin-right:auto">${calPeriodLabel()}</div>
      <div style="display:inline-flex;gap:2px;background:var(--panel2);padding:3px;border-radius:10px">${viewBtns}</div>
      <button onclick="Crm.calOpenModal()" style="font-size:12px;font-weight:800;padding:8px 14px;border-radius:9px;border:none;cursor:pointer;background:linear-gradient(160deg,var(--gold-soft),#1d4ed8);color:#ffffff">+ Nuevo turno</button>
    </div>`;
  }
  function calMiniCalendar() {
    const d = keyToDate(state.calAnchor); const y = d.getFullYear(), m = d.getMonth();
    const first = new Date(y, m, 1); const startOff = first.getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
    const wd = ['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(w => `<div style="text-align:center;font-size:8.5px;color:var(--muted2);font-weight:700">${w}</div>`).join('');
    let cells = ''; for (let i = 0; i < startOff; i++) cells += '<div></div>';
    for (let dd = 1; dd <= daysInMonth; dd++) {
      const key = y + '-' + pad(m + 1) + '-' + pad(dd);
      const isToday = key === todayKey(), isSel = key === state.calSelectedDay;
      const has = DATA.turnos.some(a => a.fecha === key);
      cells += `<button onclick="Crm.calSelectDay('${key}')" style="aspect-ratio:1;border-radius:6px;border:1px solid ${isToday && !isSel ? 'rgba(37,99,235,0.5)' : 'transparent'};background:${isSel ? 'var(--gold)' : (isToday ? 'var(--panel2)' : 'transparent')};color:${isSel ? '#ffffff' : (isToday ? 'var(--gold-soft)' : 'var(--text)')};font-size:10px;font-weight:700;cursor:pointer;position:relative">${dd}${has && !isSel ? `<span style="position:absolute;bottom:1px;left:50%;transform:translateX(-50%);width:3px;height:3px;border-radius:50%;background:var(--gold)"></span>` : ''}</button>`;
    }
    return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <button onclick="Crm.calMiniMonth(-1)" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--text);cursor:pointer;font-size:11px">‹</button>
      <span style="font-size:11px;font-weight:700;text-transform:capitalize">${MM[m]} ${y}</span>
      <button onclick="Crm.calMiniMonth(1)" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--text);cursor:pointer;font-size:11px">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:3px">${wd}</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">${cells}</div>`;
  }
  function calBarberFilters() {
    const active = calActiveIds();
    return DATA.barberos.map(b => { const on = active.includes(b.id);
      return `<label onclick="Crm.calToggleBarber('${b.id}')" style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;color:${on ? 'var(--text)' : 'var(--muted2)'}">
        <span style="width:14px;height:14px;border-radius:4px;border:1.5px solid ${b.color};background:${on ? b.color : 'transparent'};display:inline-flex;align-items:center;justify-content:center;font-size:9.5px;color:#ffffff;flex:none">${on ? '✓' : ''}</span>
        ${esc(b.alias)}
      </label>`;
    }).join('');
  }
  function calMonthView() {
    const d = keyToDate(state.calAnchor); const y = d.getFullYear(), m = d.getMonth();
    const first = new Date(y, m, 1); const startOff = first.getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
    const wd = ['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(w => `<div style="text-align:center;font-size:10px;font-weight:700;color:var(--muted2);padding:6px 0;background:var(--panel)">${w}</div>`).join('');
    let cells = ''; for (let i = 0; i < startOff; i++) cells += `<div style="background:var(--bg);min-height:92px"></div>`;
    for (let dd = 1; dd <= daysInMonth; dd++) {
      const key = y + '-' + pad(m + 1) + '-' + pad(dd);
      const isToday = key === todayKey();
      const items = calTurnosForDay(key);
      const shown = items.slice(0, 3);
      const chips = shown.map(t => { const b = barb(t.barbero_id);
        return `<div onclick="event.stopPropagation();Crm.calShowDetail(${t.id})" style="font-size:9.5px;font-weight:600;padding:2px 5px;border-radius:5px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;background:${tint(b.color, 0.16)};color:${b.color};border-left:2px solid ${b.color}">${minToStr(t.hora_min)} ${esc(t.cliente_nombre)}</div>`;
      }).join('');
      cells += `<div onclick="Crm.calSelectDay('${key}')" style="background:var(--panel);min-height:92px;padding:5px;cursor:pointer">
        <div style="font-size:11px;font-weight:700;margin-bottom:3px;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${isToday ? 'var(--gold)' : 'transparent'};color:${isToday ? '#ffffff' : 'var(--text)'}">${dd}</div>
        ${chips}${items.length > 3 ? `<div style="font-size:9px;color:var(--muted2);font-weight:700">+${items.length - 3} más</div>` : ''}
      </div>`;
    }
    return `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:12px;overflow:hidden">${wd}${cells}</div>`;
  }
  function calWeekView() {
    const start = keyToDate(calWeekStartKey(state.calAnchor));
    const hours = calHourRange(); const rowH = 42;
    let head = `<div></div>`;
    for (let i = 0; i < 7; i++) { const dd = addDays(start, i); const key = keyOf(dd); const isToday = key === todayKey();
      head += `<div onclick="Crm.calSelectDay('${key}')" style="text-align:center;padding:4px 0 8px;cursor:pointer">
        <div style="font-size:9.5px;color:var(--muted);font-weight:700">${DW[dd.getDay()]}</div>
        <div style="font-size:14px;font-weight:700;color:${isToday ? 'var(--gold-soft)' : 'var(--text)'}">${dd.getDate()}</div>
      </div>`;
    }
    let body = `<div>${hours.map(h => `<div style="height:${rowH}px;font-size:9.5px;color:var(--muted2);text-align:right;padding-right:6px;transform:translateY(-6px)">${h}:00</div>`).join('')}</div>`;
    for (let i = 0; i < 7; i++) {
      const dd = addDays(start, i); const key = keyOf(dd);
      const items = calTurnosForDay(key);
      let col = `<div style="position:relative;border-left:1px solid var(--border);height:${rowH * hours.length}px">`;
      hours.forEach((h, hi) => { col += `<div onclick="Crm.calOpenModal('${key}','${pad(h)}:00')" style="position:absolute;top:${hi * rowH}px;left:0;right:0;height:${rowH}px;border-top:1px solid var(--border);cursor:pointer"></div>`; });
      items.forEach(t => {
        const b = barb(t.barbero_id);
        const top = ((t.hora_min - hours[0] * 60) / 60) * rowH;
        const h = Math.max((t.duracion_min / 60) * rowH - 2, 16);
        col += `<div onclick="event.stopPropagation();Crm.calShowDetail(${t.id})" style="position:absolute;left:2px;right:2px;top:${top}px;height:${h}px;background:${tint(b.color, 0.18)};border-left:2px solid ${b.color};border-radius:4px;padding:2px 4px;font-size:8.5px;font-weight:600;color:${b.color};overflow:hidden;cursor:pointer;z-index:2">${minToStr(t.hora_min)} ${esc(t.cliente_nombre)}</div>`;
      });
      col += `</div>`; body += col;
    }
    return `<div style="display:grid;grid-template-columns:44px repeat(7,1fr)">${head}</div><div style="display:grid;grid-template-columns:44px repeat(7,1fr)">${body}</div>`;
  }
  function calDayView() {
    const key = state.calSelectedDay;
    const barberos = DATA.barberos.filter(b => calActiveIds().includes(b.id));
    if (!barberos.length) return `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:30px 10px">Activá al menos un barbero en el filtro de la izquierda.</div>`;
    const hours = calHourRange(); const rowH = 46;
    let head = `<div></div>` + barberos.map(b => `<div style="text-align:center;padding:4px 0 8px;font-size:12.5px;font-weight:700;color:${b.color}">${esc(b.alias)}</div>`).join('');
    let body = `<div>${hours.map(h => `<div style="height:${rowH}px;font-size:9.5px;color:var(--muted2);text-align:right;padding-right:6px;transform:translateY(-6px)">${h}:00</div>`).join('')}</div>`;
    barberos.forEach(b => {
      const items = DATA.turnos.filter(a => a.fecha === key && a.barbero_id === b.id);
      let col = `<div style="position:relative;border-left:1px solid var(--border);height:${rowH * hours.length}px">`;
      hours.forEach((h, hi) => { col += `<div onclick="Crm.calOpenModal('${key}','${pad(h)}:00','${b.id}')" style="position:absolute;top:${hi * rowH}px;left:0;right:0;height:${rowH}px;border-top:1px solid var(--border);cursor:pointer"></div>`; });
      items.forEach(t => {
        const top = ((t.hora_min - hours[0] * 60) / 60) * rowH;
        const h2 = Math.max((t.duracion_min / 60) * rowH - 2, 22);
        col += `<div onclick="event.stopPropagation();Crm.calShowDetail(${t.id})" style="position:absolute;left:3px;right:3px;top:${top}px;height:${h2}px;background:${tint(b.color, 0.18)};border-left:2px solid ${b.color};border-radius:5px;padding:3px 5px;font-size:9.5px;font-weight:600;color:var(--text);overflow:hidden;cursor:pointer;z-index:2"><div style="font-weight:700;color:${b.color}">${minToStr(t.hora_min)}</div>${esc(t.cliente_nombre)}</div>`;
      });
      col += `</div>`; body += col;
    });
    return `<div style="display:grid;grid-template-columns:44px repeat(${barberos.length},1fr)">${head}</div><div style="display:grid;grid-template-columns:44px repeat(${barberos.length},1fr)">${body}</div>`;
  }
  function calFormModal() {
    if (!state.calModalOpen) return '';
    const mf = state.manualForm;
    const svOpts = DATA.servicios.map(s => `<option value="${s.id}">${esc(s.nombre)} · ${fmtMoney.format(s.precio_base)}</option>`).join('') + `<option value="custom">Otro importe (personalizado)</option>`;
    const bOpts = DATA.barberos.map(b => `<option value="${b.id}" ${mf.barberoId === b.id ? 'selected' : ''}>${esc(b.alias)}</option>`).join('');
    return `<div onclick="Crm.calCloseModal()" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px">
      <div class="card" onclick="event.stopPropagation()" style="width:420px;max-width:100%;max-height:90vh;overflow-y:auto">
        <div style="font-weight:700;font-size:15px;margin-bottom:14px">Nuevo turno</div>
        <div class="grid-2" style="gap:10px">
          <input class="input" id="mf_cliente" placeholder="Nombre del cliente" value="${esc(mf.cliente)}" style="grid-column:1/-1">
          <input class="input" id="mf_tel" placeholder="Teléfono (opcional)" value="${esc(mf.tel)}" style="grid-column:1/-1">
          <select class="input" id="mf_servicio">${svOpts}</select>
          <select class="input" id="mf_barbero">${bOpts}</select>
          <input class="input" type="date" id="mf_fecha" value="${mf.fecha}">
          <input class="input" type="time" id="mf_hora" value="${mf.hora}">
          <input class="input" type="number" step="500" id="mf_custom" placeholder="Importe personalizado ($)" style="grid-column:1/-1">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="Crm.calCloseModal()">Cancelar</button>
          <button class="btn btn-gold" onclick="Crm.addManual()">Guardar turno</button>
        </div>
      </div>
    </div>`;
  }
  function calDetailModal() {
    if (!state.calDetailId) return '';
    const t = DATA.turnos.find(x => x.id === state.calDetailId);
    if (!t) return '';
    const b = barb(t.barbero_id), meta = statusMeta(t.estado);
    return `<div onclick="Crm.calCloseDetail()" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px">
      <div class="card" onclick="event.stopPropagation()" style="width:360px;max-width:100%">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-weight:800;font-size:16px">${minToStr(t.hora_min)}</span>
          <span class="badge" style="color:${meta.color};background:${meta.bg}">${meta.label}</span>
        </div>
        <div style="font-weight:700;font-size:15px">${esc(t.cliente_nombre)}</div>
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:4px">${esc(t.cliente_tel || 'Sin teléfono')}</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px">${esc(t.servicio_nombre)} · ${fmtMoney.format(t.precio)}</div>
        <div style="font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;color:${b.color};margin-bottom:14px"><span style="width:8px;height:8px;border-radius:50%;background:${b.color}"></span>${esc(b.alias)}</div>
        ${t.estado === 'confirmado' ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          <button onclick="Crm.calCloseDetail();Crm.setEstado(${t.id},'completado')" style="flex:1;font-size:11.5px;font-weight:700;padding:8px;border-radius:8px;border:none;cursor:pointer;background:var(--green);color:#ffffff">✓ Completado</button>
          <button onclick="Crm.calCloseDetail();Crm.setEstado(${t.id},'no-show')" style="flex:1;font-size:11.5px;font-weight:700;padding:8px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--purple);cursor:pointer">No-show</button>
          <button onclick="Crm.calCloseDetail();Crm.setEstado(${t.id},'cancelado')" style="flex:1;font-size:11.5px;font-weight:700;padding:8px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--red);cursor:pointer">Cancelar</button>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px dashed var(--border-strong);padding-top:10px">
          <button onclick="Crm.deleteTurno(${t.id})" style="font-size:11px;font-weight:700;color:var(--red);background:none;border:none;cursor:pointer">Eliminar definitivamente</button>
          <button class="btn btn-ghost" onclick="Crm.calCloseDetail()">Cerrar</button>
        </div>
      </div>
    </div>`;
  }
  function tabCalendario() {
    return `${calToolbar()}
    <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div class="card" style="width:230px;max-width:100%;flex:none">
        ${calMiniCalendar()}
        <div style="font-size:10.5px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px">Barberos</div>
        <div style="display:flex;flex-direction:column;gap:8px">${calBarberFilters()}</div>
      </div>
      <div class="card" style="flex:1;min-width:280px;overflow-x:auto">
        ${state.calView === 'month' ? calMonthView() : state.calView === 'week' ? calWeekView() : calDayView()}
      </div>
    </div>
    ${calFormModal()}
    ${calDetailModal()}`;
  }

  function tabMarketing() {
    const dir = directory();
    const withBday = dir.filter(c => c.cumpleanos).map(c => ({ c, d: daysToBirthday(c.cumpleanos, new Date()) })).filter(x => x.d !== null && x.d <= 30).sort((a, b) => a.d - b.d);
    const unica = dir.filter(c => c.visitas === 1).sort((a, b) => b.gasto - a.gasto).slice(0, 8);
    const noshowList = DATA.turnos.filter(a => a.estado === 'no-show');
    const ranking = dir.slice().sort((a, b) => (b.puntos || 0) - (a.puntos || 0)).slice(0, 5);
    return `<div class="grid-2" style="margin-bottom:16px">
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Cumpleaños próximos (30 días)</h3>
        ${withBday.length ? withBday.map(x => `<div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-top:1px solid var(--border)"><div style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:800;flex:none;background:rgba(37,99,235,0.16);color:var(--gold)">${initials(x.c.nombre)}</div><div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600">${esc(x.c.nombre)}</div><div style="font-size:11.5px;color:var(--muted2)">en ${x.d} día${x.d === 1 ? '' : 's'}</div></div></div>`).join('') : `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:20px 10px">No hay cumpleaños próximos.</div>`}
      </section>
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Riesgo de fuga (1 sola visita)</h3>${rankList(unica.map((c, i) => rankRowView(i, c, '1 visita', 0.4)))}</section>
    </div>
    <div class="grid-2">
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">No-shows recientes</h3>
        ${noshowList.length ? noshowList.map(a => `<div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-top:1px solid var(--border)"><div style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:800;flex:none;background:rgba(147,112,138,0.16);color:var(--purple)">${initials(a.cliente_nombre)}</div><div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600">${esc(a.cliente_nombre)}</div><div style="font-size:11.5px;color:var(--muted2)">${dayLabel(a.fecha)} · ${esc(a.servicio_nombre)}</div></div></div>`).join('') : `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:20px 10px">Sin no-shows recientes.</div>`}
      </section>
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Programa de puntos <small style="color:var(--muted2);font-weight:500">(10 pts = corte gratis)</small></h3>
        ${ranking.map((p, i) => { const can = (p.puntos || 0) >= 10; return `<div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-top:1px solid var(--border)"><div style="width:18px;text-align:center;font-weight:800;font-size:12.5px;color:var(--muted2)">${i + 1}</div><div style="flex:1;min-width:0;font-size:13.5px;font-weight:600">${esc(p.nombre)}</div><div style="font-size:12px;font-weight:700;color:var(--muted)">${p.puntos || 0} pts</div>${can ? `<button onclick="Crm.canjear('${jsStr(p.key)}')" style="margin-left:8px;font-size:10.5px;font-weight:700;padding:5px 10px;border-radius:8px;border:none;cursor:pointer;background:rgba(37,99,235,0.16);color:var(--gold)">Canjear</button>` : `<span style="margin-left:8px;font-size:10.5px;color:var(--muted2)">Faltan ${10 - (p.puntos || 0)} pts</span>`}</div>`; }).join('')}
      </section>
    </div>`;
  }

  function tabConfig() {
    const sv = DATA.servicios.map(s => `<div style="display:grid;grid-template-columns:1.4fr 0.8fr 0.7fr;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--border)">
      <input class="input" id="sv_n_${s.id}" value="${esc(s.nombre)}">
      <input class="input" type="number" step="500" id="sv_p_${s.id}" value="${s.precio_base}">
      <input class="input" type="number" id="sv_d_${s.id}" value="${s.duracion_min}">
    </div>`).join('');
    const bs = DATA.barberos.map(b => `<div style="display:grid;grid-template-columns:1.6fr 0.6fr auto;gap:8px;align-items:center;padding:9px 0;border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;min-width:0"><span style="width:8px;height:8px;border-radius:50%;background:${b.color};flex:none"></span><div style="min-width:0"><div style="font-weight:700;color:${b.color};font-size:13px">${esc(b.alias)}</div><div style="font-size:10.5px;color:var(--muted2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.especialidad)}</div></div></div>
      <input class="input" type="number" step="0.05" id="bf_${b.id}" value="${b.factor}">
      <button onclick="Crm.showResetPin('${b.id}')" style="font-size:10.5px;font-weight:700;padding:6px 10px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--muted);cursor:pointer;white-space:nowrap">Resetear PIN</button>
      <input class="input" type="email" id="be_${b.id}" placeholder="Email (para avisos de turno)" value="${esc(b.email || '')}" style="grid-column:1/-1;margin-top:2px">
    </div>${state.resetPinFor === b.id ? `<div style="grid-column:1/-1;display:flex;gap:8px;padding:8px 0"><input class="input" id="resetPinVal" placeholder="Nuevo PIN" style="max-width:160px"><button class="btn btn-gold" onclick="Crm.confirmResetPin('${b.id}')">Confirmar</button><button class="btn btn-ghost" onclick="Crm.showResetPin(null)">Cancelar</button></div>` : ''}`).join('');
    return `<section class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px">Servicios y precios</h3><span style="font-size:11px;color:var(--muted);background:var(--panel2);border:1px solid var(--border);padding:3px 10px;border-radius:20px">nombre · precio base · duración (min)</span></div>
      ${sv}
    </section>
    <section class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px">Equipo de barberos</h3><span style="font-size:11px;color:var(--muted);background:var(--panel2);border:1px solid var(--border);padding:3px 10px;border-radius:20px">factor multiplica el precio base</span></div>
      ${bs}
      <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--border-strong)">
        <div style="font-weight:700;font-size:13px;margin-bottom:10px">+ Agregar barbero</div>
        <div class="grid-2" style="gap:8px;margin-bottom:8px">
          <input class="input" id="nb_nombre" placeholder="Nombre completo">
          <input class="input" id="nb_alias" placeholder="Alias (opcional)">
        </div>
        <input class="input" id="nb_esp" placeholder="Especialidad (ej. Fades & clásico)" style="margin-bottom:10px">
        <button class="btn btn-gold" style="width:100%" onclick="Crm.addBarber()">Agregar barbero</button>
      </div>
    </section>
    <section class="card" style="margin-bottom:16px">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Horario de atención</h3>
      <div class="grid-2" style="gap:14px">
        <div><label style="font-size:11.5px;color:var(--muted);display:block;margin-bottom:6px">Apertura</label><input class="input" type="time" id="cfg_open" value="${minToStr(DATA.config.apertura_min)}"></div>
        <div><label style="font-size:11.5px;color:var(--muted);display:block;margin-bottom:6px">Cierre</label><input class="input" type="time" id="cfg_close" value="${minToStr(DATA.config.cierre_min)}"></div>
      </div>
    </section>
    <section class="card" style="margin-bottom:16px">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Cambiar mi contraseña de administrador</h3>
      <div class="grid-2" style="gap:10px;margin-bottom:10px">
        <input class="input" type="password" id="adm_actual" placeholder="Contraseña actual">
        <input class="input" type="password" id="adm_nueva" placeholder="Contraseña nueva">
      </div>
      <button class="btn btn-gold" onclick="Crm.changeAdminPass()">Cambiar contraseña</button>
    </section>
    <div style="display:flex;justify-content:flex-end"><button class="btn btn-gold" onclick="Crm.saveConfig()">Guardar cambios</button></div>`;
  }

  function content() {
    const isAdmin = state.auth.role === 'admin';
    let title = '', sub = '', body = '';
    if (state.tab === 'gerente' && isAdmin) { title = 'Panel general'; sub = 'Resumen del mes y rendimiento del equipo'; body = tabGerente(); }
    else if (state.tab === 'pipeline') { title = 'Pipeline'; sub = 'Turnos del día, organizados por estado'; body = tabPipeline(); }
    else if (state.tab === 'clientes') { title = 'Clientes'; sub = 'Historial, fichas y contacto'; body = tabClientes(); }
    else if (state.tab === 'calendario') { title = 'Calendario'; sub = 'Vista mensual, semanal y diaria — se actualiza solo cuando entra una reserva'; body = tabCalendario(); }
    else if (state.tab === 'marketing' && isAdmin) { title = 'Marketing'; sub = 'Cumpleaños, riesgo de fuga y puntos'; body = tabMarketing(); }
    else if (state.tab === 'config' && isAdmin) { title = 'Configuración'; sub = 'Servicios, precios y horario del local'; body = tabConfig(); }
    else { const b = barb(state.tab); title = b.nombre; sub = 'Agenda y desempeño individual'; body = tabBarbero(state.tab); }
    const d = new Date(); const todayLong = DW[d.getDay()] + ' ' + d.getDate() + ' ' + MM[d.getMonth()];
    return `<main style="flex:1;min-width:0;display:flex;flex-direction:column">
      <div class="crm-header-bar">
        <div><div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:23px">${esc(title)}</div><div style="font-size:12.5px;color:var(--muted);margin-top:2px;font-weight:500">${esc(sub)}</div></div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);background:var(--panel2);border:1px solid var(--border);padding:7px 14px;border-radius:20px;white-space:nowrap">${todayLong}</div>
      </div>
      <div class="crm-content-body">${body}</div>
    </main>`;
  }

  function mobileTopbar() {
    return `<div class="crm-topbar">
      <button class="crm-burger" onclick="Crm.toggleSidebar()">☰</button>
      <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:15px;letter-spacing:0.3px;text-transform:uppercase">IBIZA studio</div>
    </div>`;
  }

  function render() {
    if (!state.auth) { renderLogin(); return; }
    if (state.auth.role === 'barbero' && !DATA.barberos.some(b => b.id === state.auth.id)) { state.tab = DATA.barberos[0] ? DATA.barberos[0].id : 'clientes'; }
    if (state.tab === 'metricas') state.tab = 'gerente';
    if (!state.tab || (state.tab === 'gerente' && state.auth.role !== 'admin')) state.tab = state.auth.role === 'admin' ? 'gerente' : (state.auth.id || 'clientes');
    app.innerHTML = `<div class="crm-layout">
      ${mobileTopbar()}
      <div class="crm-body-row">
        <div class="crm-overlay${state.sidebarOpen ? ' open' : ''}" onclick="Crm.closeSidebar()"></div>
        ${sidebar()}
        ${content()}
      </div>
    </div>`;
    if (state.tab === 'gerente' && state.auth.role === 'admin') setTimeout(renderMetricsCharts, 0);
  }

  // ============ API pública para los onclick ============
  window.Crm = {
    setLoginMode: (m) => { state.loginMode = m; renderLogin(); },
    setLoginField: (f, v) => {
      state[f] = v;
      if (f === 'loginUser' || f === 'loginPass') {
        const valid = state.loginUser.trim() && state.loginPass.trim();
        const btn = document.getElementById('adminSubmitBtn');
        if (btn) { btn.disabled = !valid || state.loginBusy; btn.style.background = valid ? 'linear-gradient(160deg,var(--gold-soft),#1d4ed8)' : ''; btn.style.color = valid ? '#ffffff' : ''; }
      } else if (f === 'loginPin') {
        const valid = state.loginBarberId && state.loginPin.trim();
        const btn = document.getElementById('barberoSubmitBtn');
        if (btn) { btn.disabled = !valid || state.loginBusy; btn.style.background = valid ? 'linear-gradient(160deg,var(--gold-soft),#1d4ed8)' : ''; btn.style.color = valid ? '#ffffff' : ''; }
      }
    },
    pickBarbero: (id) => { state.loginBarberId = id; renderLogin(); },
    loginAdmin, loginBarbero, logout,
    selectTab: (t) => { state.tab = t; state.openClientKey = null; state.sidebarOpen = false; render(); },
    toggleSidebar: () => { state.sidebarOpen = !state.sidebarOpen; render(); },
    closeSidebar: () => { state.sidebarOpen = false; render(); },
    setMetricsPeriod: (p) => { state.metricsPeriod = p; render(); },
    setEstado,
    setPipelineFilter: (id) => { state.pipelineBarberFilter = id; render(); },
    calSetView: (v) => { state.calView = v; render(); },
    calNav: (delta) => {
      if (state.calView === 'month') { const d = keyToDate(state.calAnchor); state.calAnchor = keyOf(new Date(d.getFullYear(), d.getMonth() + delta, 1)); }
      else if (state.calView === 'week') { state.calAnchor = keyOf(addDays(keyToDate(state.calAnchor), 7 * delta)); }
      else { state.calSelectedDay = keyOf(addDays(keyToDate(state.calSelectedDay), delta)); state.calAnchor = state.calSelectedDay; }
      render();
    },
    calToday: () => { const t = todayKey(); state.calAnchor = t; state.calSelectedDay = t; render(); },
    calSelectDay: (key) => { state.calSelectedDay = key; state.calAnchor = key; state.calView = 'day'; render(); },
    calMiniMonth: (delta) => { const d = keyToDate(state.calAnchor); state.calAnchor = keyOf(new Date(d.getFullYear(), d.getMonth() + delta, 1)); render(); },
    calToggleBarber: (id) => {
      const active = calActiveIds().slice(); const idx = active.indexOf(id);
      if (idx >= 0) active.splice(idx, 1); else active.push(id);
      state.calActiveBarberos = active; render();
    },
    calShowDetail: (id) => { state.calDetailId = id; render(); },
    calCloseDetail: () => { state.calDetailId = null; render(); },
    calOpenModal: (fecha, hora, barberoId) => {
      state.manualForm = { cliente: '', tel: '', servicioId: null, barberoId: barberoId || (DATA.barberos[0] && DATA.barberos[0].id) || null, fecha: fecha || state.calSelectedDay || todayKey(), hora: hora || '10:00', customPrecio: '' };
      state.calModalOpen = true; render();
    },
    calCloseModal: () => { state.calModalOpen = false; render(); },
    deleteTurno: async (id) => {
      if (!confirm('¿Eliminar este turno definitivamente? Esta acción no se puede deshacer.')) return;
      await sb.from('turnos').delete().eq('id', id);
      state.calDetailId = null; showToast('Turno eliminado'); await refresh();
    },
    searchClients: (v) => {
      state.clientSearch = v;
      const body = document.getElementById('clientListBody'), countEl = document.getElementById('clientCountSpan');
      if (!body) return;
      const html = tabClientes();
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      body.innerHTML = tmp.querySelector('#clientListBody').innerHTML;
      if (countEl) countEl.textContent = tmp.querySelector('#clientCountSpan').textContent;
    },
    toggleAddClient: () => { state.showAddClient = !state.showAddClient; render(); },
    newClientField: (f, v) => { state.newClientForm[f] = v; },
    addClient: async () => {
      const f = state.newClientForm;
      if (!f.nombre.trim()) { showToast('Poné un nombre'); return; }
      const { error } = await sb.from('clientes').insert({ nombre: f.nombre.trim(), telefono: f.tel || '', email: f.email || '', tags: ['Nuevo'] });
      if (error) { showToast('No se pudo guardar (¿nombre repetido?)'); return; }
      state.newClientForm = { nombre: '', tel: '', email: '' }; state.showAddClient = false;
      showToast('Cliente agregado'); await refresh();
    },
    toggleClient: (key) => { state.openClientKey = state.openClientKey === key ? null : key; render(); },
    toggleClientTag: (btnEl) => { btnEl.dataset.on = btnEl.dataset.on === 'true' ? 'false' : 'true'; const on = btnEl.dataset.on === 'true'; btnEl.style.background = on ? 'var(--gold)' : 'var(--panel2)'; btnEl.style.color = on ? '#ffffff' : 'var(--muted)'; btnEl.style.borderColor = on ? 'var(--gold)' : 'var(--border-strong)'; },
    saveClient: async (key) => {
      const dir = directory(); const c = dir.find(x => x.key === key);
      const tel = document.getElementById('cf_tel').value, email = document.getElementById('cf_email').value,
        cumple = document.getElementById('cf_cumple').value, puntos = parseInt(document.getElementById('cf_puntos').value, 10) || 0,
        notas = document.getElementById('cf_notas').value;
      const tagBtns = document.querySelectorAll('[onclick^="Crm.toggleClientTag"]');
      const tags = Array.from(tagBtns).filter(b => b.dataset.on === 'true').map(b => b.textContent.trim());
      const payload = { nombre: c.nombre, telefono: tel, email, cumpleanos: cumple, puntos, notas, tags };
      if (c.id) await sb.from('clientes').update(payload).eq('id', c.id);
      else await sb.from('clientes').insert(payload);
      state.openClientKey = null; showToast('Ficha guardada'); await refresh();
    },
    addManual: async () => {
      const cliente = document.getElementById('mf_cliente').value, tel = document.getElementById('mf_tel').value,
        servicioId = document.getElementById('mf_servicio').value, barberoId = document.getElementById('mf_barbero').value,
        fecha = document.getElementById('mf_fecha').value, hora = document.getElementById('mf_hora').value,
        customPrecio = document.getElementById('mf_custom').value;
      if (!cliente.trim() || !fecha || !hora) { showToast('Completá cliente, fecha y hora'); return; }
      const b = barb(barberoId);
      let servicioNombre, precio, dur;
      if (servicioId === 'custom') { if (!customPrecio || isNaN(parseInt(customPrecio, 10))) { showToast('Poné el importe personalizado'); return; } servicioNombre = 'Otro importe'; precio = parseInt(customPrecio, 10); dur = 30; }
      else { const sv = servById(servicioId); servicioNombre = sv.nombre; precio = precioFinal(sv.precio_base, b.factor); dur = sv.duracion_min; }
      const parts = hora.split(':'); const horaMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      await sb.from('clientes').upsert({ nombre: cliente.trim(), telefono: tel || '' }, { onConflict: 'nombre_key', ignoreDuplicates: true });
      await sb.from('turnos').insert({ cliente_nombre: cliente.trim(), cliente_tel: tel || '', barbero_id: barberoId, servicio_id: servicioId === 'custom' ? null : servicioId, servicio_nombre: servicioNombre, precio, duracion_min: dur, fecha, hora_min: horaMin, estado: 'confirmado', origen: 'manual' });
      state.manualForm = { cliente: '', tel: '', servicioId: null, barberoId: null, fecha: todayKey(), hora: '10:00', customPrecio: '' };
      state.calModalOpen = false;
      showToast('Turno agregado al calendario'); await refresh();
    },
    canjear: async (key) => {
      const dir = directory(); const c = dir.find(x => x.key === key);
      if (!c || (c.puntos || 0) < 10) return;
      if (c.id) await sb.from('clientes').update({ puntos: c.puntos - 10 }).eq('id', c.id);
      showToast('Corte gratis canjeado'); await refresh();
    },
    addBarber: async () => {
      const nombre = document.getElementById('nb_nombre').value.trim(), alias = document.getElementById('nb_alias').value.trim() || nombre.split(' ')[0],
        esp = document.getElementById('nb_esp').value.trim() || 'Estilo general';
      if (!nombre) { showToast('Poné un nombre'); return; }
      const color = PALETTE[DATA.barberos.length % PALETTE.length];
      const id = 'b_' + Date.now().toString(36);
      await sb.from('barberos').insert({ id, nombre, alias, especialidad: esp, factor: 1, color, orden: DATA.barberos.length + 1 });
      showToast('Barbero agregado al equipo'); await refresh();
    },
    showResetPin: (id) => { state.resetPinFor = id; render(); },
    confirmResetPin: async (barberoId) => {
      const pin = document.getElementById('resetPinVal').value.trim();
      if (!pin) { showToast('Poné un PIN'); return; }
      const adminPass = prompt('Confirmá tu contraseña de administrador para resetear el PIN:');
      if (!adminPass) return;
      const { data, error } = await sb.rpc('admin_set_barbero_pin', { p_admin_usuario: state.loginUser || 'admin', p_admin_clave: adminPass, p_barbero_id: barberoId, p_nuevo_pin: pin });
      if (error || !data) { showToast('Contraseña de administrador incorrecta'); return; }
      state.resetPinFor = null; showToast('PIN actualizado'); render();
    },
    changeAdminPass: async () => {
      const actual = document.getElementById('adm_actual').value, nueva = document.getElementById('adm_nueva').value;
      if (!actual || !nueva) { showToast('Completá ambos campos'); return; }
      const { data, error } = await sb.rpc('admin_change_password', { p_admin_usuario: 'admin', p_clave_actual: actual, p_nueva_clave: nueva });
      if (error || !data) { showToast('Contraseña actual incorrecta'); return; }
      showToast('Contraseña actualizada');
    },
    saveConfig: async () => {
      for (const s of DATA.servicios) {
        const nEl = document.getElementById('sv_n_' + s.id), pEl = document.getElementById('sv_p_' + s.id), dEl = document.getElementById('sv_d_' + s.id);
        if (nEl) await sb.from('servicios').update({ nombre: nEl.value, precio_base: parseFloat(pEl.value) || 0, duracion_min: parseInt(dEl.value, 10) || 0 }).eq('id', s.id);
      }
      for (const b of DATA.barberos) {
        const fEl = document.getElementById('bf_' + b.id), eEl = document.getElementById('be_' + b.id);
        if (fEl) await sb.from('barberos').update({ factor: parseFloat(fEl.value) || 1, email: eEl ? eEl.value.trim() : b.email }).eq('id', b.id);
      }
      const openEl = document.getElementById('cfg_open'), closeEl = document.getElementById('cfg_close');
      if (openEl && closeEl) {
        const op = openEl.value.split(':'), cl = closeEl.value.split(':');
        await sb.from('config').update({ apertura_min: parseInt(op[0], 10) * 60 + parseInt(op[1], 10), cierre_min: parseInt(cl[0], 10) * 60 + parseInt(cl[1], 10) }).eq('id', 1);
      }
      showToast('Cambios guardados'); await refresh();
    }
  };

  async function init() {
    try { DATA = await loadAllData(); } catch (e) {
      app.innerHTML = `<div style="padding:60px 20px;text-align:center;color:var(--muted)">No se pudo conectar con la base de datos.<br>Probá recargar la página.</div>`; return;
    }
    render();
    subscribeRealtime(async () => { DATA = await loadAllData(); render(); });
  }
  init();
})();

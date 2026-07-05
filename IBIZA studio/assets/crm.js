/* IBIZA studio — Panel de gestión (CRM), conectado a Supabase en tiempo real */
(function () {
  const PALETTE = ['#c99a3f', '#4f7f9c', '#4f8865', '#93708a', '#4f9c94', '#6b6f9c', '#b3703f', '#7c9c4f'];
  function jsStr(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  const app = document.getElementById('app');
  let DATA = null;
  let state = {
    auth: null, loginMode: 'admin', loginUser: 'admin', loginPass: '', loginBarberId: null, loginPin: '', loginBusy: false,
    tab: 'gerente', openClientKey: null, clientDraft: null, clientSearch: '',
    showAddClient: false, newClientForm: { nombre: '', tel: '', email: '' },
    newBarberForm: { nombre: '', alias: '', esp: '', color: PALETTE[0] },
    manualForm: { cliente: '', tel: '', servicioId: null, barberoId: null, fecha: todayKey(), hora: '10:00', customPrecio: '' },
    pipelineDate: todayKey(), pipelineMonthCursor: todayKey(), pipelineBarberFilter: 'all',
    configDraft: null, adminChangePass: { actual: '', nueva: '' }, resetPinFor: null, resetPinVal: ''
  };

  try { const saved = JSON.parse(localStorage.getItem('ibiza_auth') || 'null'); if (saved) state.auth = saved; } catch (e) { }

  function barb(id) { return DATA.barberos.find(b => b.id === id) || DATA.barberos[0] || { id: '', alias: '?', color: '#c99a3f', especialidad: '' }; }
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
  function rankRowView(i, c, valStr, pct, colorOverride) {
    const bColor = colorOverride || (c.barbero ? barb(c.barbero).color : '#c99a3f');
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
          <div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(160deg,var(--gold-soft),#a97c2c);display:flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:22px">✂️</div>
          <div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:21px">IBIZA studio</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">Iniciá sesión en el panel de gestión</div>
        </div>
        <div style="display:flex;gap:4px;background:var(--panel2);padding:4px;border-radius:11px;border:1px solid var(--border);margin-bottom:20px">
          <button onclick="Crm.setLoginMode('admin')" style="flex:1;border:none;padding:9px;border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer;background:${isAdmin ? 'var(--gold)' : 'transparent'};color:${isAdmin ? '#17130f' : 'var(--muted)'}">Administrador</button>
          <button onclick="Crm.setLoginMode('barbero')" style="flex:1;border:none;padding:9px;border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer;background:${!isAdmin ? 'var(--gold)' : 'transparent'};color:${!isAdmin ? '#17130f' : 'var(--muted)'}">Soy barbero</button>
        </div>
        ${isAdmin ? `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div><label style="display:block;font-size:11.5px;font-weight:600;margin-bottom:6px;color:var(--muted)">Usuario</label><input class="input" value="${esc(state.loginUser)}" oninput="Crm.setLoginField('loginUser',this.value)"></div>
          <div><label style="display:block;font-size:11.5px;font-weight:600;margin-bottom:6px;color:var(--muted)">Contraseña</label><input class="input" type="password" value="${esc(state.loginPass)}" oninput="Crm.setLoginField('loginPass',this.value)"></div>
          <button class="btn" ${adminValid && !state.loginBusy ? '' : 'disabled'} onclick="Crm.loginAdmin()" style="margin-top:6px;${adminValid ? 'background:linear-gradient(160deg,var(--gold-soft),#b9862f);color:#17130f' : ''}">${state.loginBusy ? 'Entrando...' : 'Ingresar como administrador'}</button>
          <div style="font-size:10.5px;color:var(--muted2);text-align:center">Primera vez: la clave que escribas queda guardada para siempre.</div>
        </div>` : `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">${barberBtns}</div>
        ${state.loginBarberId ? `<div style="margin-bottom:12px"><label style="display:block;font-size:11.5px;font-weight:600;margin-bottom:6px;color:var(--muted)">PIN</label><input class="input" type="password" inputmode="numeric" value="${esc(state.loginPin)}" oninput="Crm.setLoginField('loginPin',this.value)"></div>` : ''}
        <button class="btn" ${barberoValid && !state.loginBusy ? '' : 'disabled'} onclick="Crm.loginBarbero()" style="width:100%;${barberoValid ? 'background:linear-gradient(160deg,var(--gold-soft),#b9862f);color:#17130f' : ''}">${state.loginBusy ? 'Entrando...' : 'Ingresar'}</button>
        <div style="font-size:10.5px;color:var(--muted2);text-align:center;margin-top:10px">Primera vez: el PIN que escribas queda guardado para siempre.</div>`}
      </div>
    </div>`;
  }

  // ============ LAYOUT ============
  function sidebar() {
    const auth = state.auth, isAdmin = auth.role === 'admin', myId = auth.role === 'barbero' ? auth.id : null;
    const navBarbers = DATA.barberos.map(b => {
      const isOn = state.tab === b.id;
      return `<button onclick="Crm.selectTab('${b.id}')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:8px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${isOn ? 'rgba(201,154,63,0.14)' : 'transparent'};color:${isOn ? 'var(--text)' : 'var(--muted)'}">
        <span style="width:22px;height:22px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-weight:600;font-size:9px;background:${tint(b.color, 0.16)};color:${b.color}">${initials(b.alias)}</span>${esc(b.alias)}
      </button>`;
    }).join('');
    const manageItems = [
      { id: 'pipeline', label: 'Pipeline' }, { id: 'clientes', label: 'Clientes' }, { id: 'calendario', label: 'Calendario' }, { id: 'marketing', label: 'Marketing' }
    ].map(it => { const isOn = state.tab === it.id; return `<button onclick="Crm.selectTab('${it.id}')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${isOn ? 'rgba(201,154,63,0.14)' : 'transparent'};color:${isOn ? 'var(--text)' : 'var(--muted)'}">${it.label}</button>`; }).join('');
    const authIni = isAdmin ? 'AD' : initials(barb(myId).alias);
    const authLabel = isAdmin ? 'Administrador' : barb(myId).alias;
    const authColor = isAdmin ? 'var(--gold)' : barb(myId).color;
    return `<aside style="width:250px;flex:none;border-right:1px solid var(--border);padding:22px 16px;display:flex;flex-direction:column;gap:2px;position:sticky;top:0;height:100vh;overflow-y:auto">
      <div style="display:flex;align-items:center;gap:11px;padding:4px 6px 22px">
        <div style="width:40px;height:40px;flex:none;border-radius:11px;background:linear-gradient(160deg,var(--gold-soft),#a97c2c);display:flex;align-items:center;justify-content:center;font-size:18px">✂️</div>
        <div><div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:16.5px">IBIZA studio</div><div style="font-size:11px;color:var(--muted2);font-weight:500">Panel de gestión</div></div>
      </div>
      ${isAdmin ? `<button onclick="Crm.selectTab('gerente')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:14px;background:${state.tab === 'gerente' ? 'rgba(201,154,63,0.14)' : 'transparent'};color:${state.tab === 'gerente' ? 'var(--text)' : 'var(--muted)'}">Panel general</button>
      <div style="font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted2);padding:6px 12px 7px">Gestión</div>${manageItems}
      <div style="font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted2);padding:16px 12px 7px">Barberos</div>${navBarbers}
      <div style="font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted2);padding:16px 12px 7px">Sistema</div>
      <button onclick="Crm.selectTab('config')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;background:${state.tab === 'config' ? 'rgba(201,154,63,0.14)' : 'transparent'};color:${state.tab === 'config' ? 'var(--text)' : 'var(--muted)'}">Configuración</button>` : `
      <button onclick="Crm.selectTab('${myId}')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${state.tab === myId ? 'rgba(201,154,63,0.14)' : 'transparent'};color:${state.tab === myId ? 'var(--text)' : 'var(--muted)'}">Mi Panel</button>
      <button onclick="Crm.selectTab('pipeline')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${state.tab === 'pipeline' ? 'rgba(201,154,63,0.14)' : 'transparent'};color:${state.tab === 'pipeline' ? 'var(--text)' : 'var(--muted)'}">Mi Pipeline</button>
      <button onclick="Crm.selectTab('clientes')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:2px;background:${state.tab === 'clientes' ? 'rgba(201,154,63,0.14)' : 'transparent'};color:${state.tab === 'clientes' ? 'var(--text)' : 'var(--muted)'}">Clientes</button>
      <button onclick="Crm.selectTab('calendario')" style="display:flex;align-items:center;gap:10px;border:none;text-align:left;width:100%;padding:9px 12px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;background:${state.tab === 'calendario' ? 'rgba(201,154,63,0.14)' : 'transparent'};color:${state.tab === 'calendario' ? 'var(--text)' : 'var(--muted)'}">Calendario</button>`}
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
      <div style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;background:rgba(201,154,63,0.16);color:var(--gold);font-size:15px">${icon}</div>
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

    const hist = (DATA.config.historico || []).slice(); hist.push(revMes);
    const ref = new Date(); const labels = []; for (let i = 5; i >= 0; i--) { const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1); labels.push(MM[d.getMonth()]); }
    const maxH = Math.max(...hist, 1);
    const trendBars = hist.map((v, i) => ({ height: Math.max(4, Math.round(v / maxH * 100)), label: labels[i] || '', color: i === hist.length - 1 ? 'var(--gold)' : 'rgba(201,154,63,0.4)' }));

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

    const upcoming = DATA.turnos.filter(a => a.fecha >= todayKey());
    const upcomingDays = groupByDay(upcoming, { editable: true, showBarbero: true });

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
    <section class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px">Tendencia de ingresos</h3><span style="font-size:11px;color:var(--muted);background:var(--panel2);border:1px solid var(--border);padding:3px 10px;border-radius:20px">últimos 6 meses</span></div>
      <div style="display:flex;align-items:flex-end;gap:10px;height:110px;padding-bottom:22px;position:relative">
        ${trendBars.map(tb => `<div style="flex:1;height:100%;display:flex;align-items:flex-end;position:relative"><div style="width:100%;border-radius:6px 6px 2px 2px;height:${tb.height}%;background:${tb.color}"></div><div style="position:absolute;bottom:-20px;left:0;right:0;text-align:center;font-size:10.5px;color:var(--muted2);font-weight:600">${tb.label}</div></div>`).join('')}
      </div>
    </section>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Clientes que más vienen</h3>${rankList(topVisitas.map((c, i) => rankRowView(i, c, c.visitas + ' visitas', c.visitas / (topVisitas[0] ? topVisitas[0].visitas || 1 : 1))))}</section>
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Participación en la ganancia</h3>${rankList(topGasto.map((c, i) => rankRowView(i, c, fmtMoney.format(c.gasto) + ' · ' + (c.gasto / totalRevAll * 100).toFixed(1) + '%', c.gasto / (topGasto[0] ? topGasto[0].gasto || 1 : 1))))}</section>
    </div>
    <section class="card" style="margin-bottom:16px"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:14px">Rendimiento por barbero</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">${barberCards}</div></section>
    <section class="card">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:14px">Próximos turnos</h3>
      ${upcomingDays.length ? upcomingDays.map(day => `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:0.6px;padding:6px 0"><span>${day.label}</span><span style="color:var(--muted2);font-weight:500">${day.countStr}</span></div>
        ${day.items.map(it => agendaRow(it, true)).join('')}</div>`).join('') : `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:24px 10px">No hay turnos próximos cargados.</div>`}
    </section>`;
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
      <div style="width:58px;height:58px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-weight:700;font-size:21px;color:#17130f;flex:none;background:${b.color}">${initials(b.alias)}</div>
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
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Mi agenda</h3>
        ${days.length ? days.map(day => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:700;color:var(--gold);text-transform:uppercase;padding:6px 0"><span>${day.label}</span><span style="color:var(--muted2);font-weight:500">${day.countStr}</span></div>${day.items.map(it => agendaRow(it, false)).join('')}</div>`).join('') : `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:24px 10px">Sin turnos próximos cargados.</div>`}
      </section>
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Mis mejores clientes</h3>${rankList(s.top.map((c, i) => rankRowView(i, c, c.visitas + ' vis · ' + fmtMoney.format(c.gasto), c.visitas / (s.top[0] ? s.top[0].visitas : 1), b.color)))}</section>
    </div>`;
  }

  function buildMonthGrid(anchorKey) {
    const parts = anchorKey.split('-'); const y = +parts[0], m = +parts[1] - 1;
    const first = new Date(y, m, 1); const startOffset = first.getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
    const counts = {}; DATA.turnos.forEach(a => { if (a.estado !== 'cancelado') counts[a.fecha] = (counts[a.fecha] || 0) + 1; });
    const cells = []; for (let i = 0; i < startOffset; i++) cells.push({ empty: true });
    for (let d = 1; d <= daysInMonth; d++) { const key = y + '-' + pad(m + 1) + '-' + pad(d); cells.push({ empty: false, key, day: d, count: counts[key] || 0, isToday: key === todayKey(), isSelected: key === state.pipelineDate }); }
    return { cells, label: MM[m] + ' ' + y };
  }

  function tabPipeline() {
    const isAdmin = state.auth.role === 'admin';
    const grid = buildMonthGrid(state.pipelineMonthCursor);
    const wdLabels = ['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(w => `<div style="text-align:center;font-size:9.5px;font-weight:700;color:var(--muted2)">${w}</div>`).join('');
    const cellsHtml = grid.cells.map(c => {
      if (c.empty) return `<div></div>`;
      const bg = c.isSelected ? 'var(--gold)' : (c.isToday ? 'var(--panel2)' : 'transparent');
      const fg = c.isSelected ? '#17130f' : (c.isToday ? 'var(--gold-soft)' : '#e9dfce');
      const border = (c.isToday && !c.isSelected) ? 'rgba(201,154,63,0.5)' : 'var(--border)';
      return `<button onclick="Crm.selectPipelineDate('${c.key}')" style="position:relative;aspect-ratio:1;border-radius:8px;border:1px solid ${border};background:${bg};color:${fg};font-size:11.5px;font-weight:700;cursor:pointer">${c.day}${c.count > 0 && !c.isSelected ? `<span style="position:absolute;bottom:3px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:var(--gold)"></span>` : ''}</button>`;
    }).join('');
    const barberFilter = isAdmin ? state.pipelineBarberFilter : state.auth.id;
    const dayItems = DATA.turnos.filter(a => a.fecha === state.pipelineDate && (barberFilter === 'all' || a.barbero_id === barberFilter)).sort((x, y) => x.hora_min - y.hora_min);
    const dayAll = DATA.turnos.filter(a => a.fecha === state.pipelineDate);
    const dayRevenue = dayAll.filter(a => a.estado !== 'cancelado').reduce((s, a) => s + Number(a.precio), 0);
    const dayPending = dayAll.filter(a => a.estado === 'confirmado').length;
    function card(a) { const b = barb(a.barbero_id); return `<div style="background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px"><span style="font-weight:800;font-size:12.5px">${minToStr(a.hora_min)}</span><span style="font-size:11.5px;font-weight:700;color:var(--muted)">${fmtMoney.format(a.precio)}</span></div>
      <div style="font-size:12.5px;font-weight:700;margin-top:4px">${esc(a.cliente_nombre)}</div><div style="font-size:11px;color:var(--muted2)">${esc(a.servicio_nombre)}</div>
      <div style="font-size:10.5px;font-weight:600;display:flex;align-items:center;gap:5px;margin-top:5px;color:${b.color}"><span style="width:6px;height:6px;border-radius:50%;background:${b.color}"></span>${esc(b.alias)}</div>
      ${a.estado === 'confirmado' ? `<button onclick="Crm.setEstado(${a.id},'completado')" style="width:100%;margin-top:9px;border:none;border-radius:8px;padding:8px;font-weight:800;font-size:11.5px;cursor:pointer;background:var(--green);color:#0e140f">✓ Marcar como finalizado</button>
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
      return `<button onclick="Crm.setPipelineFilter('${ch.id}')" style="font-size:11.5px;font-weight:700;padding:6px 12px;border-radius:20px;cursor:pointer;border:1px solid ${isOn ? (ch.color || 'var(--gold)') : 'var(--border-strong)'};background:${isOn ? tint(ch.color || '#c99a3f', 0.16) : 'var(--panel2)'};color:${isOn ? (ch.color || 'var(--gold)') : 'var(--muted)'}">${ch.label}</button>`;
    }).join('') : '';
    return `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px">
      <div class="card" style="width:300px;flex:none">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <button onclick="Crm.pipelineMonth(-1)" style="width:28px;height:28px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--text);cursor:pointer">‹</button>
          <div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:14px;text-transform:capitalize">${grid.label}</div>
          <button onclick="Crm.pipelineMonth(1)" style="width:28px;height:28px;border-radius:8px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--text);cursor:pointer">›</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px">${wdLabels}</div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${cellsHtml}</div>
        <button onclick="Crm.pipelineToday()" style="margin-top:12px;width:100%;text-align:center;font-size:11.5px;font-weight:700;color:var(--gold);background:rgba(201,154,63,0.12);border:1px solid rgba(201,154,63,0.3);border-radius:9px;padding:8px;cursor:pointer">Ir a hoy</button>
      </div>
      <div class="card" style="flex:1;min-width:240px;display:flex;flex-direction:column;justify-content:center">
        <div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:16px;margin-bottom:12px">${dayLabel(state.pipelineDate)}</div>
        <div style="display:flex;gap:8px">
          <div style="flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:11px;text-align:center"><span style="display:block;font-weight:800;font-size:17px">${dayAll.length}</span><small style="font-size:10px;color:var(--muted2)">turnos</small></div>
          <div style="flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:11px;text-align:center"><span style="display:block;font-weight:800;font-size:17px">${fmtMoney.format(dayRevenue)}</span><small style="font-size:10px;color:var(--muted2)">facturación</small></div>
          <div style="flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:11px;text-align:center"><span style="display:block;font-weight:800;font-size:17px;color:var(--blue)">${dayPending}</span><small style="font-size:10px;color:var(--muted2)">pendientes</small></div>
        </div>
      </div>
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
      const bb = c.barbero ? barb(c.barbero) : { tint: 'rgba(201,154,63,0.16)', color: 'var(--gold)' };
      const rowBg = idx % 2 === 0 ? '#1c1610' : '#201811';
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
      <button onclick="Crm.toggleAddClient()" style="margin-left:auto;font-size:12.5px;font-weight:800;padding:10px 16px;border-radius:11px;border:none;cursor:pointer;background:linear-gradient(160deg,var(--gold-soft),#b9862f);color:#17130f">+ Agregar cliente</button>
    </div>
    ${state.showAddClient ? `<div class="card" style="margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <input class="input" placeholder="Nombre completo" value="${esc(state.newClientForm.nombre)}" oninput="Crm.newClientField('nombre',this.value)">
      <input class="input" placeholder="Teléfono" value="${esc(state.newClientForm.tel)}" oninput="Crm.newClientField('tel',this.value)">
      <input class="input" placeholder="Email (opcional)" value="${esc(state.newClientForm.email)}" oninput="Crm.newClientField('email',this.value)">
      <div style="grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px"><button class="btn btn-ghost" onclick="Crm.toggleAddClient()">Cancelar</button><button class="btn btn-gold" onclick="Crm.addClient()">Guardar cliente</button></div>
    </div>` : ''}
    <div id="clientListBody" style="display:flex;flex-direction:column;gap:10px">${rows || `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:24px 10px">No se encontraron clientes.</div>`}</div>`;
  }
  function clientEditForm(c) {
    const allTags = ['VIP', 'Recurrente', 'Nuevo', 'Riesgo de fuga'];
    return `<div onclick="event.stopPropagation()" style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border-strong);display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label style="display:block;font-size:11px;font-weight:600;margin-bottom:5px;color:var(--muted)">Teléfono</label><input class="input" id="cf_tel" value="${esc(c.tel)}"></div>
      <div><label style="display:block;font-size:11px;font-weight:600;margin-bottom:5px;color:var(--muted)">Email</label><input class="input" id="cf_email" value="${esc(c.email)}"></div>
      <div><label style="display:block;font-size:11px;font-weight:600;margin-bottom:5px;color:var(--muted)">Cumpleaños (MM-DD)</label><input class="input" id="cf_cumple" placeholder="07-15" value="${esc(c.cumpleanos)}"></div>
      <div><label style="display:block;font-size:11px;font-weight:600;margin-bottom:5px;color:var(--muted)">Puntos</label><input class="input" type="number" id="cf_puntos" value="${c.puntos}"></div>
      <div style="grid-column:1/-1"><label style="display:block;font-size:11px;font-weight:600;margin-bottom:5px;color:var(--muted)">Notas</label><textarea class="input" id="cf_notas" style="min-height:56px;resize:vertical">${esc(c.notas)}</textarea></div>
      <div style="grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap">${allTags.map(tg => { const on = (c.tags || []).includes(tg); return `<button type="button" onclick="Crm.toggleClientTag(this,'${tg}')" data-on="${on}" style="font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;cursor:pointer;border:1px solid ${on ? 'var(--gold)' : 'var(--border-strong)'};background:${on ? 'var(--gold)' : 'var(--panel2)'};color:${on ? '#17130f' : 'var(--muted)'}">${tg}</button>`; }).join('')}</div>
      <div style="grid-column:1/-1;display:flex;justify-content:flex-end"><button class="btn btn-gold" onclick="Crm.saveClient('${jsStr(c.key)}')">Guardar ficha</button></div>
    </div>`;
  }

  function tabCalendario() {
    const svOpts = DATA.servicios.map(s => `<option value="${s.id}">${esc(s.nombre)} · ${fmtMoney.format(s.precio_base)}</option>`).join('') + `<option value="custom">Otro importe (personalizado)</option>`;
    const bOpts = DATA.barberos.map(b => `<option value="${b.id}">${esc(b.alias)}</option>`).join('');
    const mf = state.manualForm;
    const dateKeys = [...new Set(DATA.turnos.map(a => a.fecha))].sort();
    const days = dateKeys.map(dk => {
      const cols = DATA.barberos.map(bb => {
        const items = DATA.turnos.filter(a => a.fecha === dk && a.barbero_id === bb.id).sort((x, y) => x.hora_min - y.hora_min);
        return `<div class="card" style="padding:11px">
          <div style="font-weight:700;font-size:12.5px;margin-bottom:9px;text-transform:uppercase;color:${bb.color}">${esc(bb.alias)}</div>
          ${items.length ? items.map(a => { const meta = statusMeta(a.estado); return `<div style="background:var(--panel2);border:1px solid var(--border);border-radius:9px;padding:9px 10px;margin-bottom:7px">
            <div style="font-weight:800;font-size:12px;display:flex;align-items:center;gap:6px;justify-content:space-between"><span>${minToStr(a.hora_min)}</span><span class="badge" style="color:${meta.color};background:${meta.bg};font-size:9.5px">${meta.label}</span></div>
            <div style="font-size:12px;font-weight:600;margin-top:3px">${esc(a.cliente_nombre)}</div><div style="font-size:10.5px;color:var(--muted2)">${esc(a.servicio_nombre)} · ${fmtMoney.format(a.precio)}</div>
            ${a.estado === 'confirmado' ? `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap"><button onclick="Crm.setEstado(${a.id},'completado')" style="font-size:9.5px;font-weight:700;padding:3px 6px;border-radius:7px;border:1px solid var(--border-strong);background:var(--panel);color:var(--green);cursor:pointer">✓</button><button onclick="Crm.setEstado(${a.id},'no-show')" style="font-size:9.5px;font-weight:700;padding:3px 6px;border-radius:7px;border:1px solid var(--border-strong);background:var(--panel);color:var(--purple);cursor:pointer">No-show</button><button onclick="Crm.setEstado(${a.id},'cancelado')" style="font-size:9.5px;font-weight:700;padding:3px 6px;border-radius:7px;border:1px solid var(--border-strong);background:var(--panel);color:var(--red);cursor:pointer">Cancelar</button></div>` : ''}
          </div>`; }).join('') : `<div style="font-size:11.5px;color:var(--muted2);text-align:center;padding:14px 4px">Sin turnos</div>`}
        </div>`;
      }).join('');
      return `<div style="font-size:12.5px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px">${dayLabel(dk)}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:6px">${cols}</div>`;
    }).join('');
    const projTotal = DATA.turnos.filter(a => a.estado !== 'cancelado').reduce((s, a) => s + Number(a.precio), 0);
    return `<div class="card" style="margin-bottom:22px;display:grid;grid-template-columns:1fr 1fr;gap:11px">
      <div style="grid-column:1/-1;font-weight:700;font-size:13.5px;margin-bottom:2px">Agregar turno manual (telefónico / mostrador)</div>
      <input class="input" id="mf_cliente" placeholder="Nombre del cliente" value="${esc(mf.cliente)}">
      <input class="input" id="mf_tel" placeholder="Teléfono (opcional)" value="${esc(mf.tel)}">
      <select class="input" id="mf_servicio">${svOpts}</select>
      <select class="input" id="mf_barbero">${bOpts}</select>
      <input class="input" type="date" id="mf_fecha" value="${mf.fecha}">
      <input class="input" type="time" id="mf_hora" value="${mf.hora}">
      <input class="input" type="number" step="500" id="mf_custom" placeholder="Importe personalizado ($) — solo si elegís 'Otro importe'" style="grid-column:1/-1">
      <button class="btn btn-gold" style="grid-column:1/-1" onclick="Crm.addManual()">Agregar al calendario</button>
    </div>
    ${dateKeys.length ? days : `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:24px 10px">No hay turnos cargados todavía.</div>`}
    ${dateKeys.length ? `<div style="margin-top:18px;background:linear-gradient(120deg,rgba(201,154,63,0.14),var(--panel) 70%);border:1px solid var(--border-strong);border-radius:14px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
      <div><div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:13.5px;text-transform:uppercase;color:var(--gold-soft)">Proyección de ingresos</div><div style="font-size:11.5px;color:var(--muted);margin-top:2px">Sumando los turnos cargados (sin contar cancelados)</div></div>
      <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:26px;color:var(--gold-soft)">${fmtMoney.format(projTotal)}</div>
    </div>` : ''}`;
  }

  function tabMarketing() {
    const dir = directory();
    const withBday = dir.filter(c => c.cumpleanos).map(c => ({ c, d: daysToBirthday(c.cumpleanos, new Date()) })).filter(x => x.d !== null && x.d <= 30).sort((a, b) => a.d - b.d);
    const unica = dir.filter(c => c.visitas === 1).sort((a, b) => b.gasto - a.gasto).slice(0, 8);
    const noshowList = DATA.turnos.filter(a => a.estado === 'no-show');
    const ranking = dir.slice().sort((a, b) => (b.puntos || 0) - (a.puntos || 0)).slice(0, 5);
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Cumpleaños próximos (30 días)</h3>
        ${withBday.length ? withBday.map(x => `<div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-top:1px solid var(--border)"><div style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:800;flex:none;background:rgba(201,154,63,0.16);color:var(--gold)">${initials(x.c.nombre)}</div><div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600">${esc(x.c.nombre)}</div><div style="font-size:11.5px;color:var(--muted2)">en ${x.d} día${x.d === 1 ? '' : 's'}</div></div></div>`).join('') : `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:20px 10px">No hay cumpleaños próximos.</div>`}
      </section>
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Riesgo de fuga (1 sola visita)</h3>${rankList(unica.map((c, i) => rankRowView(i, c, '1 visita', 0.4)))}</section>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">No-shows recientes</h3>
        ${noshowList.length ? noshowList.map(a => `<div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-top:1px solid var(--border)"><div style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:800;flex:none;background:rgba(147,112,138,0.16);color:var(--purple)">${initials(a.cliente_nombre)}</div><div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600">${esc(a.cliente_nombre)}</div><div style="font-size:11.5px;color:var(--muted2)">${dayLabel(a.fecha)} · ${esc(a.servicio_nombre)}</div></div></div>`).join('') : `<div style="text-align:center;color:var(--muted2);font-size:12.5px;padding:20px 10px">Sin no-shows recientes.</div>`}
      </section>
      <section class="card"><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Programa de puntos <small style="color:var(--muted2);font-weight:500">(10 pts = corte gratis)</small></h3>
        ${ranking.map((p, i) => { const can = (p.puntos || 0) >= 10; return `<div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-top:1px solid var(--border)"><div style="width:18px;text-align:center;font-weight:800;font-size:12.5px;color:var(--muted2)">${i + 1}</div><div style="flex:1;min-width:0;font-size:13.5px;font-weight:600">${esc(p.nombre)}</div><div style="font-size:12px;font-weight:700;color:var(--muted)">${p.puntos || 0} pts</div>${can ? `<button onclick="Crm.canjear('${jsStr(p.key)}')" style="margin-left:8px;font-size:10.5px;font-weight:700;padding:5px 10px;border-radius:8px;border:none;cursor:pointer;background:rgba(201,154,63,0.16);color:var(--gold)">Canjear</button>` : `<span style="margin-left:8px;font-size:10.5px;color:var(--muted2)">Faltan ${10 - (p.puntos || 0)} pts</span>`}</div>`; }).join('')}
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <input class="input" id="nb_nombre" placeholder="Nombre completo">
          <input class="input" id="nb_alias" placeholder="Alias (opcional)">
        </div>
        <input class="input" id="nb_esp" placeholder="Especialidad (ej. Fades & clásico)" style="margin-bottom:10px">
        <button class="btn btn-gold" style="width:100%" onclick="Crm.addBarber()">Agregar barbero</button>
      </div>
    </section>
    <section class="card" style="margin-bottom:16px">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Horario de atención</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div><label style="font-size:11.5px;color:var(--muted);display:block;margin-bottom:6px">Apertura</label><input class="input" type="time" id="cfg_open" value="${minToStr(DATA.config.apertura_min)}"></div>
        <div><label style="font-size:11.5px;color:var(--muted);display:block;margin-bottom:6px">Cierre</label><input class="input" type="time" id="cfg_close" value="${minToStr(DATA.config.cierre_min)}"></div>
      </div>
    </section>
    <section class="card" style="margin-bottom:16px">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Cambiar mi contraseña de administrador</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
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
    else if (state.tab === 'calendario') { title = 'Calendario'; sub = 'Turnos por día y por barbero'; body = tabCalendario(); }
    else if (state.tab === 'marketing' && isAdmin) { title = 'Marketing'; sub = 'Cumpleaños, riesgo de fuga y puntos'; body = tabMarketing(); }
    else if (state.tab === 'config' && isAdmin) { title = 'Configuración'; sub = 'Servicios, precios y horario del local'; body = tabConfig(); }
    else { const b = barb(state.tab); title = b.nombre; sub = 'Agenda y desempeño individual'; body = tabBarbero(state.tab); }
    const d = new Date(); const todayLong = DW[d.getDay()] + ' ' + d.getDate() + ' ' + MM[d.getMonth()];
    return `<main style="flex:1;min-width:0;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 36px;border-bottom:1px solid var(--border)">
        <div><div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:23px">${esc(title)}</div><div style="font-size:12.5px;color:var(--muted);margin-top:2px;font-weight:500">${esc(sub)}</div></div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);background:var(--panel2);border:1px solid var(--border);padding:7px 14px;border-radius:20px;white-space:nowrap">${todayLong}</div>
      </div>
      <div style="flex:1;padding:28px 36px 52px;max-width:1180px;width:100%;animation:fadeIn .28s ease">${body}</div>
    </main>`;
  }

  function render() {
    if (!state.auth) { renderLogin(); return; }
    if (state.auth.role === 'barbero' && !DATA.barberos.some(b => b.id === state.auth.id)) { state.tab = DATA.barberos[0] ? DATA.barberos[0].id : 'clientes'; }
    if (!state.tab || (state.tab === 'gerente' && state.auth.role !== 'admin')) state.tab = state.auth.role === 'admin' ? 'gerente' : (state.auth.id || 'clientes');
    app.innerHTML = `<div style="min-height:100vh;background:var(--bg);display:flex;align-items:stretch">${sidebar()}${content()}</div>`;
  }

  // ============ API pública para los onclick ============
  window.Crm = {
    setLoginMode: (m) => { state.loginMode = m; renderLogin(); },
    setLoginField: (f, v) => { state[f] = v; },
    pickBarbero: (id) => { state.loginBarberId = id; renderLogin(); },
    loginAdmin, loginBarbero, logout,
    selectTab: (t) => { state.tab = t; state.openClientKey = null; render(); },
    setEstado,
    pipelineMonth: (delta) => { const parts = state.pipelineMonthCursor.split('-'); const d = new Date(+parts[0], +parts[1] - 1 + delta, 1); state.pipelineMonthCursor = keyOf(d); render(); },
    pipelineToday: () => { state.pipelineDate = todayKey(); state.pipelineMonthCursor = todayKey(); render(); },
    selectPipelineDate: (k) => { state.pipelineDate = k; render(); },
    setPipelineFilter: (id) => { state.pipelineBarberFilter = id; render(); },
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
    toggleClientTag: (btnEl) => { btnEl.dataset.on = btnEl.dataset.on === 'true' ? 'false' : 'true'; const on = btnEl.dataset.on === 'true'; btnEl.style.background = on ? 'var(--gold)' : 'var(--panel2)'; btnEl.style.color = on ? '#17130f' : 'var(--muted)'; btnEl.style.borderColor = on ? 'var(--gold)' : 'var(--border-strong)'; },
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
        const fEl = document.getElementById('bf_' + b.id);
        if (fEl) await sb.from('barberos').update({ factor: parseFloat(fEl.value) || 1 }).eq('id', b.id);
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

/* IBIZA studio — Reserva de turnos (paso a paso), conectado a Supabase en tiempo real.
   Tema urbano/streetwear: oscuro + acento volt. La lógica de datos es la misma de siempre. */
(function () {
  let DATA = null; // {servicios, barberos, clientes, turnos, config, bloqueos}
  let state = {
    step: 1, servicioId: null, barberoSel: null, assigned: null,
    dateKey: null, time: null, nombre: '', tel: '', email: ''
  };
  const N8N_WEBHOOK_URL = 'https://santiagogmnz.app.n8n.cloud/webhook/ibiza-turno-confirmado';
  const CRM_LINK = 'https://ibiza-studio.netlify.app/crm';

  const app = document.getElementById('app');

  function servById(id) { return DATA.servicios.find(s => s.id === id) || DATA.servicios[0]; }
  function barbById(id) { return DATA.barberos.find(b => b.id === id) || DATA.barberos[0]; }

  function buildDays() {
    const out = []; const d = new Date(); d.setHours(0, 0, 0, 0); let i = 0;
    while (out.length < 10 && i < 25) {
      const x = new Date(d); x.setDate(d.getDate() + i);
      out.push({ key: keyOf(x), dw: DW[x.getDay()], dn: x.getDate(), dm: MM[x.getMonth()], isToday: i === 0 });
      i++;
    }
    return out;
  }
  const DIAS = buildDays();

  function rango(sv) {
    const ps = DATA.barberos.map(b => precioFinal(sv.precio_base, b.factor));
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }

  function bookedIntervals(bId, dateKey) {
    return DATA.turnos
      .filter(t => t.barbero_id === bId && t.fecha === dateKey && t.estado !== 'cancelado')
      .map(t => [t.hora_min, t.hora_min + t.duracion_min]);
  }
  function blockedIntervals(bId, dateKey) {
    return (DATA.bloqueos || [])
      .filter(x => x.fecha === dateKey && (!x.barbero_id || x.barbero_id === bId))
      .map(x => [x.hora_inicio_min, x.hora_fin_min]);
  }
  function isFree(bId, dateKey, dur, t) {
    const cfg = DATA.config;
    if (t + dur > cfg.cierre_min) return false;
    const now = new Date();
    if (dateKey === keyOf(now)) { const nowMin = now.getHours() * 60 + now.getMinutes(); if (t < nowMin + 30) return false; }
    const booked = bookedIntervals(bId, dateKey);
    for (const [s, e] of booked) { if (t < e && (t + dur) > s) return false; }
    const blocked = blockedIntervals(bId, dateKey);
    for (const [s, e] of blocked) { if (t < e && (t + dur) > s) return false; }
    return true;
  }
  function freeSlots(servicioId, barberoSel, dateKey) {
    const sv = servById(servicioId), dur = sv.duracion_min, slots = [];
    const cfg = DATA.config;
    for (let t = cfg.apertura_min; t + dur <= cfg.cierre_min; t += 15) {
      if (barberoSel === 'any') {
        const free = DATA.barberos.filter(b => isFree(b.id, dateKey, dur, t));
        if (free.length) slots.push({ t, barberos: free });
      } else {
        if (isFree(barberoSel, dateKey, dur, t)) slots.push({ t, barberos: [barbById(barberoSel)] });
      }
    }
    return slots;
  }

  function selectServicio(id) { state.servicioId = id; state.step = 2; render(); }
  function selectBarbero(sel) { state.barberoSel = sel; state.dateKey = state.dateKey || DIAS[0].key; state.step = 3; render(); }
  function selectDay(key) { state.dateKey = key; state.time = null; render(); }
  function selectSlot(t) {
    let assigned;
    if (state.barberoSel === 'any') {
      const slots = freeSlots(state.servicioId, 'any', state.dateKey);
      const found = slots.find(s => s.t === t);
      assigned = found ? found.barberos[0].id : DATA.barberos[0].id;
    } else assigned = state.barberoSel;
    state.time = t; state.assigned = assigned; state.step = 4; render();
  }
  function goBack() {
    if (state.step <= 1) return;
    if (state.step === 3) state.time = null;
    state.step -= 1; render();
  }

  async function confirmar(btn) {
    const sv = servById(state.servicioId), b = barbById(state.assigned);
    const precio = precioFinal(sv.precio_base, b.factor);
    btn.disabled = true; btn.textContent = 'Confirmando...';
    try {
      // Re-chequeo de disponibilidad justo antes de guardar (evita choques de turnos)
      const { data: freshTurnos } = await sb.from('turnos').select('*').eq('barbero_id', b.id).eq('fecha', state.dateKey).neq('estado', 'cancelado');
      const clash = (freshTurnos || []).some(t => state.time < (t.hora_min + t.duracion_min) && (state.time + sv.duracion_min) > t.hora_min);
      if (clash) { showToast('Ese horario se acaba de ocupar. Elegí otro.'); state.step = 3; state.time = null; render(); return; }

      await sb.from('clientes').upsert({ nombre: state.nombre.trim(), telefono: state.tel.trim(), email: state.email.trim() }, { onConflict: 'nombre_key', ignoreDuplicates: true });
      const { error } = await sb.from('turnos').insert({
        cliente_nombre: state.nombre.trim(), cliente_tel: state.tel.trim(), cliente_email: state.email.trim(), barbero_id: b.id,
        servicio_id: sv.id, servicio_nombre: sv.nombre, precio, duracion_min: sv.duracion_min,
        fecha: state.dateKey, hora_min: state.time, estado: 'confirmado', origen: 'online'
      });
      if (error) throw error;
      notifyTurnoConfirmado(sv, b, precio);
      state.step = 5; render();
    } catch (e) {
      showToast('No se pudo guardar el turno. Probá de nuevo.');
      btn.disabled = false; btn.textContent = 'Confirmar turno';
    }
  }
  function reset() { state = { step: 1, servicioId: null, barberoSel: null, assigned: null, dateKey: null, time: null, nombre: '', tel: '', email: '' }; render(); }

  function notifyTurnoConfirmado(sv, b, precio) {
    // Fire-and-forget: avisa al barbero y confirma al cliente por email vía n8n. No bloquea la reserva si falla.
    try {
      fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_nombre: state.nombre.trim(),
          cliente_tel: state.tel.trim(),
          cliente_email: state.email.trim(),
          barbero_nombre: b.alias,
          barbero_email: b.email || '',
          servicio_nombre: sv.nombre,
          fecha: dayLabel(state.dateKey),
          hora: minToStr(state.time),
          precio,
          crm_link: CRM_LINK
        })
      }).catch(() => {});
    } catch (e) {}
  }

  function gcalLink() {
    const sv = servById(state.servicioId), b = barbById(state.assigned);
    const d = state.dateKey.replace(/-/g, '');
    const hm = m => pad(Math.floor(m / 60)) + pad(m % 60) + '00';
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
      + '&text=' + encodeURIComponent('✂️ IBIZA studio — ' + sv.nombre)
      + '&dates=' + d + 'T' + hm(state.time) + '/' + d + 'T' + hm(state.time + sv.duracion_min)
      + '&details=' + encodeURIComponent('Turno con ' + b.alias + ' en IBIZA studio.');
  }

  const STEP_META = {
    1: { kicker: 'Paso 01 — Servicio', title: '¿Qué te vas<br>a hacer?', sub: 'Elegí el servicio. Los precios varían según el barbero.' },
    2: { kicker: 'Paso 02 — Barbero', title: 'Elegí a<br>tu barbero', sub: '' },
    3: { kicker: 'Paso 03 — Día y hora', title: 'Cuándo<br>te esperamos', sub: 'Solo se muestran los horarios libres.' },
    4: { kicker: 'Paso 04 — Confirmar', title: 'Últimos<br>datos', sub: 'Revisá tu reserva y dejanos tu contacto.' }
  };

  function header() {
    const showBack = state.step > 1 && state.step <= 4;
    const segs = [0, 1, 2, 3].map(i => `<i class="${i < state.step ? 'on' : ''}"></i>`).join('');
    return `
    <div class="bk-header">
      <div style="display:flex;align-items:center;gap:11px">
        ${showBack ? `<button class="bk-back" onclick="Booking.back()" aria-label="Volver">←</button>` : `<div style="width:36px;height:36px;flex:none;border-radius:11px;background:var(--volt);color:#101010;display:flex;align-items:center;justify-content:center;font-size:16px">✂️</div>`}
        <div style="min-width:0">
          <div class="bk-logo">IBIZA <em>studio</em></div>
          <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-top:3px">Reservá tu turno online</div>
        </div>
      </div>
      <div class="bk-progress">${segs}</div>
    </div>`;
  }

  function stepHead(n, subOverride) {
    const m = STEP_META[n];
    const sub = subOverride != null ? subOverride : m.sub;
    return `<div class="bk-kicker">${m.kicker}</div>
      <h1 class="bk-title">${m.title}</h1>
      ${sub ? `<div class="bk-sub">${sub}</div>` : `<div style="height:10px"></div>`}`;
  }

  function step1() {
    const rows = DATA.servicios.map((sv, i) => {
      const r = rango(sv);
      const priceLabel = r.min === r.max ? fmtMoney.format(r.min) : `${fmtMoney.format(r.min)} – ${fmtMoney.format(r.max)}`;
      const isSel = state.servicioId === sv.id;
      return `<button class="bk-option${isSel ? ' sel' : ''}" onclick="Booking.selServicio('${sv.id}')">
        <div class="bk-num">${pad(i + 1)}</div>
        <div style="flex:1;min-width:0">
          <div class="bk-opt-name">${esc(sv.nombre)}</div>
          <div class="bk-opt-meta">⏱ ${sv.duracion_min} min</div>
        </div>
        <div class="bk-opt-price">${priceLabel}<small>según barbero</small></div>
      </button>`;
    }).join('');
    return stepHead(1) + `<div class="bk-stagger">${rows}</div>`;
  }

  function step2() {
    const sv = servById(state.servicioId);
    const anySel = state.barberoSel === 'any';
    let opts = `<button class="bk-option${anySel ? ' sel' : ''}" onclick="Booking.selBarbero('any')">
      <div class="bk-avatar" style="background:var(--panel2);color:var(--muted);font-size:18px">⚡</div>
      <div style="flex:1;min-width:0">
        <div class="bk-opt-name">Primero disponible</div>
        <div class="bk-opt-meta">Te asignamos al que tenga lugar antes</div>
      </div>
    </button>`;
    opts += DATA.barberos.map(b => {
      const p = precioFinal(sv.precio_base, b.factor);
      const isSel = state.barberoSel === b.id;
      return `<button class="bk-option${isSel ? ' sel' : ''}" onclick="Booking.selBarbero('${b.id}')">
        <div class="bk-avatar" style="background:${tint(b.color, 0.18)};color:${b.color};box-shadow:inset 0 0 0 1.5px ${tint(b.color, 0.5)}">${initials(b.alias)}</div>
        <div style="flex:1;min-width:0">
          <div class="bk-opt-name">${esc(b.alias)}</div>
          <div style="margin-top:4px"><span class="bk-chip">${esc(b.especialidad)}</span></div>
        </div>
        <div class="bk-opt-price">${fmtMoney.format(p)}</div>
      </button>`;
    }).join('');
    return stepHead(2, `${esc(sv.nombre)} · ${sv.duracion_min} min`) + `<div class="bk-stagger">${opts}</div>`;
  }

  function step3() {
    const dateKey = state.dateKey || DIAS[0].key;
    const dayBtns = DIAS.map(d => {
      const isSel = dateKey === d.key;
      return `<button class="bk-day${isSel ? ' sel' : ''}" onclick="Booking.selDay('${d.key}')">
        <div class="d-dw">${d.isToday ? 'Hoy' : d.dw}</div>
        <div class="d-dn">${d.dn}</div>
        <div class="d-dm">${d.dm}</div>
      </button>`;
    }).join('');
    const slots = freeSlots(state.servicioId, state.barberoSel, dateKey);
    const manana = slots.filter(s => s.t < 720), tarde = slots.filter(s => s.t >= 720);
    function slotBtn(s) {
      const isSel = state.time === s.t;
      return `<button class="bk-slot${isSel ? ' sel' : ''}" onclick="Booking.selSlot(${s.t})">${minToStr(s.t)}</button>`;
    }
    let body = '';
    if (slots.length === 0) body += `<div class="bk-empty" style="margin-top:14px">😕 No quedan turnos libres este día.<br>Probá con otra fecha.</div>`;
    if (manana.length) body += `<div class="bk-slot-label">🌅 Mañana</div><div class="bk-slots">${manana.map(slotBtn).join('')}</div>`;
    if (tarde.length) body += `<div class="bk-slot-label">🌆 Tarde</div><div class="bk-slots">${tarde.map(slotBtn).join('')}</div>`;
    return stepHead(3) + `<div class="bk-days">${dayBtns}</div>${body}`;
  }

  function step4() {
    const sv = servById(state.servicioId), b = barbById(state.assigned);
    const precio = precioFinal(sv.precio_base, b.factor);
    const d = DIAS.find(x => x.key === state.dateKey);
    const telDigits = (state.tel || '').replace(/\D/g, '');
    const valid = (state.nombre || '').trim().length >= 2 && telDigits.length >= 6;
    return stepHead(4) + `
      <div class="bk-ticket bk-stagger">
        <div class="bk-ticket-row"><span class="k">Servicio</span><span class="v">${esc(sv.nombre)}</span></div>
        <div class="bk-ticket-row"><span class="k">Barbero</span><span class="v">${esc(b.alias)}${state.barberoSel === 'any' ? ' <small style="color:var(--muted2)">(asignado)</small>' : ''}</span></div>
        <div class="bk-ticket-row"><span class="k">Día</span><span class="v">${d ? d.dw + ' ' + d.dn + ' ' + d.dm : ''}</span></div>
        <div class="bk-ticket-row"><span class="k">Hora</span><span class="v">${minToStr(state.time)} hs · ${sv.duracion_min} min</span></div>
        <div class="bk-ticket-total"><span class="k" style="color:var(--muted);font-size:13.5px">Total</span><span class="tot">${fmtMoney.format(precio)}</span></div>
      </div>
      <div style="margin-bottom:14px"><label class="bk-label">Nombre</label>
        <input class="input" placeholder="Tu nombre" value="${esc(state.nombre)}" oninput="Booking.setField('nombre', this.value)"></div>
      <div style="margin-bottom:14px"><label class="bk-label">Teléfono</label>
        <input class="input" type="tel" placeholder="Ej. 11 5541 2233" value="${esc(state.tel)}" oninput="Booking.setField('tel', this.value)">
        <div class="bk-hint">Lo usamos para recordarte el turno.</div></div>
      <div style="margin-bottom:6px"><label class="bk-label">Email <span style="color:var(--muted2);letter-spacing:0;font-weight:600;text-transform:none">(opcional)</span></label>
        <input class="input" type="email" placeholder="tu@email.com" value="${esc(state.email)}" oninput="Booking.setField('email', this.value)">
        <div class="bk-hint">Te mandamos la confirmación por acá.</div></div>`;
  }
  function footerCta(valid) {
    return `<div class="bk-footer">
      <button class="bk-cta" ${valid ? '' : 'disabled'} onclick="Booking.confirmar(this)">Confirmar turno</button>
    </div>`;
  }

  function confettiHtml() {
    const colors = ['var(--volt)', '#ffffff', '#8b8b95', 'var(--volt)'];
    let out = '<div class="bk-confetti">';
    for (let i = 0; i < 16; i++) {
      const left = 8 + Math.round(Math.random() * 84);
      const delay = (Math.random() * 0.5).toFixed(2);
      const dur = (1.1 + Math.random() * 0.9).toFixed(2);
      out += `<i style="left:${left}%;background:${colors[i % colors.length]};animation-delay:${delay}s;animation-duration:${dur}s"></i>`;
    }
    return out + '</div>';
  }

  function step5() {
    const sv = servById(state.servicioId), b = barbById(state.assigned);
    const d = DIAS.find(x => x.key === state.dateKey);
    return `<div style="text-align:center;padding:34px 20px 10px">
      ${confettiHtml()}
      <div class="bk-success-check">✓</div>
      <div class="bk-kicker" style="margin-bottom:4px">Reserva confirmada</div>
      <h1 class="bk-title" style="font-size:30px">¡Te esperamos!</h1>
      <div style="color:var(--muted);font-size:13.5px;margin:10px auto 22px;max-width:300px">${esc(state.nombre)}, tenés turno el <b style="color:var(--text)">${d ? d.dw + ' ' + d.dn + ' ' + d.dm : ''} a las ${minToStr(state.time)} hs</b> con <b style="color:var(--volt)">${esc(b.alias)}</b>.</div>
      <div class="bk-ticket" style="text-align:left;max-width:320px;margin:0 auto 20px">
        <div class="bk-ticket-row"><span class="k">Servicio</span><span class="v">${esc(sv.nombre)}</span></div>
        <div class="bk-ticket-row"><span class="k">Duración</span><span class="v">${sv.duracion_min} min</span></div>
        <div class="bk-ticket-total"><span style="color:var(--muted);font-size:13.5px">Total</span><span class="tot" style="font-size:20px">${fmtMoney.format(precioFinal(sv.precio_base, b.factor))}</span></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <a class="bk-ghostbtn" href="${gcalLink()}" target="_blank" rel="noopener">📅 Agendar en Google Calendar</a>
        <button class="bk-ghostbtn" onclick="Booking.reset()">Reservar otro turno</button>
      </div>
    </div>`;
  }

  function marquee() {
    const txt = 'IBIZA STUDIO — CORTES · FADES · DISEÑO · COLOR — '.repeat(4);
    return `<div class="bk-marquee"><span>${txt}</span></div>`;
  }

  function render() {
    let body, footer = '';
    if (state.step === 1) body = marquee() + step1();
    else if (state.step === 2) body = step2();
    else if (state.step === 3) body = step3();
    else if (state.step === 4) {
      body = step4();
      const telDigits = (state.tel || '').replace(/\D/g, '');
      footer = footerCta((state.nombre || '').trim().length >= 2 && telDigits.length >= 6);
    }
    else body = step5();
    app.innerHTML = header() + `<div style="flex:1;padding:18px;overflow-y:auto;animation:fadeIn .25s ease">${body}</div>` + footer;
  }

  async function init() {
    try {
      DATA = await loadAllData();
    } catch (e) {
      app.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--muted)">No se pudo conectar con la base de datos.<br>Probá recargar la página.</div>`;
      return;
    }
    render();
    subscribeRealtime(async () => { DATA = await loadAllData(); render(); });
  }

  function setField(f, v) {
    state[f] = v;
    const telDigits = (state.tel || '').replace(/\D/g, '');
    const valid = (state.nombre || '').trim().length >= 2 && telDigits.length >= 6;
    const btn = document.querySelector('.bk-cta');
    if (btn) btn.disabled = !valid;
  }

  window.Booking = {
    selServicio: selectServicio, selBarbero: selectBarbero, selDay: selectDay, selSlot: selectSlot,
    back: goBack, confirmar, reset, setField
  };
  init();
})();

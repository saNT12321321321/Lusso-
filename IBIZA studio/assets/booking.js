/* IBIZA studio — Reserva de turnos (paso a paso), conectado a Supabase en tiempo real */
(function () {
  const ACCENT = '#c99a3f';
  let DATA = null; // {servicios, barberos, clientes, turnos, config}
  let state = {
    step: 1, servicioId: null, barberoSel: null, assigned: null,
    dateKey: null, time: null, nombre: '', tel: ''
  };

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
  function isFree(bId, dateKey, dur, t) {
    const cfg = DATA.config;
    if (t + dur > cfg.cierre_min) return false;
    const now = new Date();
    if (dateKey === keyOf(now)) { const nowMin = now.getHours() * 60 + now.getMinutes(); if (t < nowMin + 30) return false; }
    const booked = bookedIntervals(bId, dateKey);
    for (const [s, e] of booked) { if (t < e && (t + dur) > s) return false; }
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

      await sb.from('clientes').upsert({ nombre: state.nombre.trim(), telefono: state.tel.trim() }, { onConflict: 'nombre_key', ignoreDuplicates: true });
      const { error } = await sb.from('turnos').insert({
        cliente_nombre: state.nombre.trim(), cliente_tel: state.tel.trim(), barbero_id: b.id,
        servicio_id: sv.id, servicio_nombre: sv.nombre, precio, duracion_min: sv.duracion_min,
        fecha: state.dateKey, hora_min: state.time, estado: 'confirmado', origen: 'online'
      });
      if (error) throw error;
      state.step = 5; render();
    } catch (e) {
      showToast('No se pudo guardar el turno. Probá de nuevo.');
      btn.disabled = false; btn.textContent = 'Confirmar turno';
    }
  }
  function reset() { state = { step: 1, servicioId: null, barberoSel: null, assigned: null, dateKey: null, time: null, nombre: '', tel: '' }; render(); }

  function progressBar() {
    const segs = [0, 1, 2, 3].map(i => `<i style="flex:1;height:4px;border-radius:4px;background:${i < state.step ? ACCENT : '#211a12'};display:block"></i>`).join('');
    return `<div style="display:flex;gap:5px;margin-top:14px">${segs}</div>`;
  }

  function header() {
    const showBack = state.step > 1 && state.step <= 4;
    return `
    <div style="padding:16px 18px 12px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg);z-index:5;flex:none">
      <div style="display:flex;align-items:center;gap:10px">
        ${showBack ? `<button onclick="Booking.back()" aria-label="Volver" style="width:34px;height:34px;border-radius:10px;border:1px solid var(--border-strong);background:var(--panel2);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;padding:0">←</button>` : `<div style="width:34px;height:34px;flex:none"></div>`}
        <div style="min-width:0">
          <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:18px;letter-spacing:0.4px;text-transform:uppercase;white-space:nowrap">IBIZA studio</div>
          <div style="font-size:11px;color:var(--muted);font-weight:500">Reservá tu turno online</div>
        </div>
      </div>
      ${progressBar()}
    </div>`;
  }

  function step1() {
    const rows = DATA.servicios.map(sv => {
      const r = rango(sv);
      const priceLabel = r.min === r.max ? fmtMoney.format(r.min) : `${fmtMoney.format(r.min)} – ${fmtMoney.format(r.max)}`;
      const isSel = state.servicioId === sv.id;
      return `<button onclick="Booking.selServicio('${sv.id}')" style="width:100%;text-align:left;background:${isSel ? ACCENT + '1a' : 'var(--panel)'};border:1.5px solid ${isSel ? ACCENT : 'var(--border-strong)'};border-radius:14px;padding:14px;margin-bottom:10px;cursor:pointer;display:flex;align-items:center;gap:13px;color:var(--text)">
        <div style="width:44px;height:44px;border-radius:12px;background:var(--panel2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex:none;color:${ACCENT}">✂️</div>
        <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:15px">${esc(sv.nombre)}</div><div style="font-size:12px;color:var(--muted);margin-top:1px">${sv.duracion_min} min</div></div>
        <div style="text-align:right;font-weight:700;font-size:14px;white-space:nowrap;flex:none">${priceLabel}<small style="display:block;font-size:10.5px;color:var(--muted);font-weight:500">según barbero</small></div>
      </button>`;
    }).join('');
    return `<div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:20px;margin:2px 0 3px">¿Qué te querés hacer?</div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:16px">Elegí el servicio. Los precios varían según el barbero.</div>${rows}`;
  }

  function step2() {
    const sv = servById(state.servicioId);
    const anySel = state.barberoSel === 'any';
    let opts = `<button onclick="Booking.selBarbero('any')" style="width:100%;text-align:left;background:${anySel ? ACCENT + '1a' : 'var(--panel)'};border:1.5px solid ${anySel ? ACCENT : 'var(--border-strong)'};border-radius:14px;padding:14px;margin-bottom:10px;cursor:pointer;display:flex;align-items:center;gap:13px;color:var(--text)">
      <div style="width:44px;height:44px;border-radius:12px;background:var(--panel2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex:none;color:var(--muted)">👥</div>
      <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:15px">Cualquiera disponible</div><div style="font-size:12px;color:var(--muted);margin-top:1px">El primero que tenga lugar</div></div>
    </button>`;
    opts += DATA.barberos.map(b => {
      const p = precioFinal(sv.precio_base, b.factor);
      const isSel = state.barberoSel === b.id;
      return `<button onclick="Booking.selBarbero('${b.id}')" style="width:100%;text-align:left;background:${isSel ? b.color + '1a' : 'var(--panel)'};border:1.5px solid ${isSel ? b.color : 'var(--border-strong)'};border-radius:14px;padding:14px;margin-bottom:10px;cursor:pointer;display:flex;align-items:center;gap:13px;color:var(--text)">
        <div style="width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:none;font-family:'Oswald',sans-serif;font-weight:700;font-size:16px;background:${tint(b.color, 0.16)};color:${b.color}">${initials(b.alias)}</div>
        <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:15px">${esc(b.alias)}</div><div style="font-size:12px;color:var(--muted);margin-top:1px">${esc(b.especialidad)}</div></div>
        <div style="text-align:right;font-weight:700;font-size:14px;white-space:nowrap;flex:none">${fmtMoney.format(p)}</div>
      </button>`;
    }).join('');
    return `<div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:20px;margin:2px 0 3px">¿Con quién te querés cortar?</div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:16px">${esc(sv.nombre)} · ${sv.duracion_min} min</div>${opts}`;
  }

  function step3() {
    const dateKey = state.dateKey || DIAS[0].key;
    const dayBtns = DIAS.map(d => {
      const isSel = dateKey === d.key;
      return `<button onclick="Booking.selDay('${d.key}')" style="flex:none;width:60px;background:${isSel ? ACCENT + '1a' : 'var(--panel)'};border:1.5px solid ${isSel ? ACCENT : 'var(--border-strong)'};border-radius:12px;padding:10px 6px;text-align:center;cursor:pointer;color:var(--text)">
        <div style="font-size:11px;color:${isSel ? 'var(--gold-soft)' : 'var(--muted)'};text-transform:uppercase">${d.isToday ? 'Hoy' : d.dw}</div>
        <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:20px;line-height:1.1;margin-top:2px">${d.dn}</div>
        <div style="font-size:10px;color:${isSel ? 'var(--gold-soft)' : 'var(--muted)'}">${d.dm}</div>
      </button>`;
    }).join('');
    const slots = freeSlots(state.servicioId, state.barberoSel, dateKey);
    const manana = slots.filter(s => s.t < 720), tarde = slots.filter(s => s.t >= 720);
    function slotBtn(s) {
      const isSel = state.time === s.t;
      return `<button onclick="Booking.selSlot(${s.t})" style="background:${isSel ? ACCENT : 'var(--panel)'};border:1.5px solid ${isSel ? ACCENT : 'var(--border-strong)'};border-radius:10px;padding:11px 4px;text-align:center;font-weight:700;font-size:13.5px;cursor:pointer;color:${isSel ? '#17130f' : 'var(--text)'}">${minToStr(s.t)}</button>`;
    }
    let body = '';
    if (slots.length === 0) body += `<div style="text-align:center;color:var(--muted);font-size:13px;padding:30px 10px;background:var(--panel);border:1px dashed var(--border-strong);border-radius:12px">No quedan turnos libres este día. Probá con otra fecha.</div>`;
    if (manana.length) body += `<div style="font-size:11.5px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:0.6px;margin:16px 0 8px">Mañana</div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${manana.map(slotBtn).join('')}</div>`;
    if (tarde.length) body += `<div style="font-size:11.5px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:0.6px;margin:16px 0 8px">Tarde</div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${tarde.map(slotBtn).join('')}</div>`;
    return `<div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:20px;margin:2px 0 3px">Elegí día y horario</div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:16px">Solo se muestran los horarios libres.</div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding:2px 2px 10px">${dayBtns}</div>${body}`;
  }

  function step4() {
    const sv = servById(state.servicioId), b = barbById(state.assigned);
    const precio = precioFinal(sv.precio_base, b.factor);
    const d = DIAS.find(x => x.key === state.dateKey);
    const telDigits = (state.tel || '').replace(/\D/g, '');
    const valid = (state.nombre || '').trim().length >= 2 && telDigits.length >= 6;
    return `<div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:20px;margin:2px 0 3px">Tus datos</div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:16px">Confirmá tu reserva.</div>
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;font-size:13.5px"><span style="color:var(--muted)">Servicio</span><span style="font-weight:600">${esc(sv.nombre)}</span></div>
        <div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;font-size:13.5px;border-top:1px solid var(--border)"><span style="color:var(--muted)">Barbero</span><span style="font-weight:600">${esc(b.alias)}${state.barberoSel === 'any' ? ' (asignado)' : ''}</span></div>
        <div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;font-size:13.5px;border-top:1px solid var(--border)"><span style="color:var(--muted)">Día</span><span style="font-weight:600">${d ? d.dw + ' ' + d.dn + ' ' + d.dm : ''}</span></div>
        <div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;font-size:13.5px;border-top:1px solid var(--border)"><span style="color:var(--muted)">Hora</span><span style="font-weight:600">${minToStr(state.time)} hs</span></div>
        <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:10px;display:flex;justify-content:space-between;align-items:center"><span style="color:var(--muted);font-size:13.5px">Total</span><span style="font-family:'Oswald',sans-serif;font-weight:700;font-size:22px;color:var(--gold-soft)">${fmtMoney.format(precio)}</span></div>
      </div>
      <div style="margin-bottom:14px"><label style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px">Nombre</label>
        <input class="input" placeholder="Tu nombre" value="${esc(state.nombre)}" oninput="Booking.setField('nombre', this.value)"></div>
      <div style="margin-bottom:14px"><label style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px">Teléfono</label>
        <input class="input" type="tel" placeholder="Ej. 11 5541 2233" value="${esc(state.tel)}" oninput="Booking.setField('tel', this.value)">
        <div style="font-size:11px;color:var(--muted2);margin-top:5px">Lo usamos para recordarte el turno.</div></div>
      ${footerCta(valid)}`;
  }
  function footerCta(valid) {
    return `<div style="padding:14px 18px 20px;border-top:1px solid var(--border);background:var(--bg)">
      <button class="btn" ${valid ? '' : 'disabled'} onclick="Booking.confirmar(this)" style="width:100%;${valid ? 'background:linear-gradient(160deg,var(--gold-soft),#b9862f);color:#17130f' : ''}">Confirmar turno</button>
    </div>`;
  }

  function step5() {
    const b = barbById(state.assigned);
    const d = DIAS.find(x => x.key === state.dateKey);
    return `<div style="text-align:center;padding:40px 20px 10px">
      <div style="width:80px;height:80px;border-radius:50%;background:rgba(79,136,101,0.14);border:2px solid var(--green);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:36px;animation:pulseRing 1.8s ease-out 1">✓</div>
      <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:26px;margin-bottom:6px">¡Turno reservado!</div>
      <div style="color:var(--muted);font-size:13.5px;margin:0 auto 20px;max-width:300px">${esc(state.nombre)}, te esperamos el <b style="color:var(--text)">${d ? d.dw + ' ' + d.dn + ' ' + d.dm : ''} a las ${minToStr(state.time)} hs</b> con ${esc(b.alias)}.</div>
      <button onclick="Booking.reset()" style="background:none;border:none;color:var(--gold-soft);font-weight:700;font-size:13.5px;cursor:pointer;margin-top:14px;padding:6px">Reservar otro turno</button>
    </div>`;
  }

  function render() {
    let body;
    if (state.step === 1) body = step1();
    else if (state.step === 2) body = step2();
    else if (state.step === 3) body = step3();
    else if (state.step === 4) body = step4();
    else body = step5();
    app.innerHTML = header() + `<div style="flex:1;padding:18px;overflow-y:auto;animation:fadeIn .25s ease">${body}</div>`;
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
    const btn = document.querySelector('#app > div:last-child button.btn');
    if (btn) {
      btn.disabled = !valid;
      btn.style.background = valid ? 'linear-gradient(160deg,var(--gold-soft),#b9862f)' : '';
      btn.style.color = valid ? '#17130f' : '';
    }
  }

  window.Booking = {
    selServicio: selectServicio, selBarbero: selectBarbero, selDay: selectDay, selSlot: selectSlot,
    back: goBack, confirmar, reset, setField
  };
  init();
})();

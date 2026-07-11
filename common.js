/* IBIZA studio — lógica compartida (Supabase + helpers) */

// ⚠️ La anon/publishable key es pública por diseño (Supabase la protege con RLS, no con secreto).
const SUPABASE_URL = "https://abyjxmdiifbvhhwezyuy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFieWp4bWRpaWZidmhod2V6eXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNzMyMjEsImV4cCI6MjA5ODc0OTIyMX0.-3wntSoplHP9mVyEZEp4SNFp3Aa2vAR77dlSX-AZQKg";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 5 } }
});

const fmtMoney = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const fmtN = new Intl.NumberFormat('es-AR');
const DW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MM = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayKey() { return keyOf(new Date()); }
function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d; }
function keyToDate(key) { const p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function minToStr(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
function dayLabel(dateKey) {
  const parts = dateKey.split('-'); const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  const prefix = dateKey === todayKey() ? 'Hoy · ' : '';
  return prefix + DW[d.getDay()] + ' ' + d.getDate() + ' ' + MM[d.getMonth()];
}
function precioFinal(base, factor) { return Math.round((base * factor) / 500) * 500; }
function initials(n) { return (n || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(); }
function hexToRgb(hex) { hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(c => c + c).join(''); const n = parseInt(hex, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
function tint(hex, alpha) { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${alpha})`; }
function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

function daysToBirthday(mmddStr, ref) {
  if (!mmddStr || mmddStr.indexOf('-') < 0) return null;
  const parts = mmddStr.split('-'); const m = parseInt(parts[0], 10) - 1, d = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(d)) return null;
  const refD = new Date(ref); refD.setHours(0, 0, 0, 0);
  let next = new Date(refD.getFullYear(), m, d);
  if (next < refD) next = new Date(refD.getFullYear() + 1, m, d);
  return Math.round((next - refD) / 86400000);
}

const STATUS_META = {
  confirmado: { label: 'Confirmado', color: 'var(--blue)', bg: 'rgba(8,145,178,0.13)' },
  completado: { label: 'Completado', color: 'var(--green)', bg: 'rgba(22,163,74,0.13)' },
  cancelado: { label: 'Cancelado', color: 'var(--red)', bg: 'rgba(220,38,38,0.11)' },
  'no-show': { label: 'No-show', color: 'var(--purple)', bg: 'rgba(147,51,234,0.11)' }
};
function statusMeta(estado) { return STATUS_META[estado] || { label: estado, color: 'var(--muted)', bg: 'rgba(100,116,139,0.13)' }; }

// ---- Carga de datos base desde Supabase ----
async function loadAllData() {
  const [servicios, barberos, clientes, turnos, config, bloqueos, productos, ventasProductos] = await Promise.all([
    sb.from('servicios').select('*').order('orden'),
    sb.from('barberos').select('*').eq('activo', true).order('orden'),
    sb.from('clientes').select('*'),
    sb.from('turnos').select('*').order('hora_min'),
    sb.from('config').select('*').eq('id', 1).single(),
    sb.from('bloqueos_horario').select('*'),
    sb.from('productos').select('*').eq('activo', true).order('orden'),
    sb.from('ventas_productos').select('*').order('fecha', { ascending: false })
  ]);
  return {
    servicios: servicios.data || [],
    barberos: barberos.data || [],
    clientes: clientes.data || [],
    turnos: turnos.data || [],
    config: config.data || { apertura_min: 600, cierre_min: 1200, historico: [] },
    bloqueos: bloqueos.data || [],
    productos: productos.data || [],
    ventasProductos: ventasProductos.data || []
  };
}

function subscribeRealtime(onChange) {
  return sb.channel('ibiza-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'barberos' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bloqueos_horario' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas_productos' }, onChange)
    .subscribe();
}

function showToast(msg) {
  let el = document.getElementById('globalToast');
  if (!el) { el = document.createElement('div'); el.id = 'globalToast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2400);
}

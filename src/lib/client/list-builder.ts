import type { AttendanceStatus, EventFull, EventType, Shift, Staff } from '../supabase';
import {
  copyToClipboard,
  eventFileName,
  eventsToExcel,
  eventsToPdf,
  eventsToWhatsApp,
  formatDate,
  type ExportEvent,
} from '../exporters';
import {
  addEventType,
  getEventDays,
  getEvent,
  getEventTypes,
  listEvents,
  listStaff,
  saveEvent,
  saveStaff,
  syncAssignments,
  todayISO,
} from './api';
import { norm } from './filters';
import { safe, toast } from './ui';

type Selection = Record<string, { status: AttendanceStatus }>;
type DaySelection = Record<Shift, Selection>;

const emptyDaySelection = (): DaySelection => ({ DIA: {}, NOCHE: {} });

/** Constructor de listas de asistencia en 3 pasos (/crear-lista). */
export function listBuilder() {
  return {
    step: 1 as 1 | 2 | 3,
    loading: true,

    // Paso 1
    types: [] as EventType[],
    typeId: '',
    addingType: false,
    newType: '',

    // Paso 2
    eventMode: 'existing' as 'existing' | 'new',
    events: [] as EventFull[],
    eventQ: '',
    newEvent: { title: '', location: '', event_date: todayISO(), end_date: todayISO() },
    creatingEvent: false,

    // Paso 3
    event: null as EventFull | null,
    activeDay: '',
    staff: [] as Staff[],
    staffQ: '',
    shift: 'DIA' as Shift,
    sel: {} as Record<string, DaySelection>,
    quickName: '',
    quickCreating: false,
    saving: false,
    dirty: false,

    async init() {
      window.addEventListener('beforeunload', (e) => {
        if (this.dirty) {
          e.preventDefault();
          e.returnValue = '';
        }
      });

      await safe(async () => {
        const [types, events, staff] = await Promise.all([getEventTypes(), listEvents('all'), listStaff()]);
        this.types = types;
        this.events = events;
        this.staff = staff;
        if (!this.typeId && types.length) this.typeId = types[0].id;

        // Entrada directa desde /eventos: /crear-lista?evento=<id>
        const wanted = new URLSearchParams(location.search).get('evento');
        if (wanted) {
          const ev = events.find((e) => e.id === wanted) ?? (await getEvent(wanted));
          if (ev) this.openEvent(ev);
          else toast('No se encontró el evento solicitado.', 'error');
        }
      });
      this.loading = false;
    },

    /* --------------------------------- Paso 1 --------------------------------- */

    get typeName(): string {
      return this.types.find((t) => t.id === this.typeId)?.name ?? '';
    },

    async addType() {
      const created = await safe(() => addEventType(this.newType), 'Tipo guardado');
      if (!created) return;
      if (!this.types.some((t) => t.id === created.id)) {
        this.types = [...this.types, created].sort((a, b) => a.name.localeCompare(b.name, 'es'));
      }
      this.typeId = created.id;
      this.newType = '';
      this.addingType = false;
    },

    /* --------------------------------- Paso 2 --------------------------------- */

    get eventOptions(): EventFull[] {
      const today = todayISO();
      const q = norm(this.eventQ);
      const match = this.events.filter(
        (e) =>
          (!this.typeId || e.event_type_id === this.typeId) &&
          (!q ||
            norm(e.title).includes(q) ||
            norm(e.location).includes(q) ||
            e.event_date.includes(q) ||
            e.end_date.includes(q))
      );
      const upcoming = match
        .filter((e) => e.end_date >= today)
        .sort((a, b) => a.event_date.localeCompare(b.event_date));
      const past = match.filter((e) => e.end_date < today).slice(0, 20);
      return [...upcoming, ...past];
    },

    fmt: formatDate,

    get eventDays(): string[] {
      return this.event ? getEventDays(this.event) : [];
    },

    isPast(ev: EventFull) {
      return ev.end_date < todayISO();
    },

    syncNewEndDate() {
      if (this.newEvent.end_date < this.newEvent.event_date) {
        this.newEvent.end_date = this.newEvent.event_date;
      }
    },

    dayLabel(day: string) {
      return new Date(`${day}T12:00:00`).toLocaleDateString('es', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
    },

    dayTotalCount(day: string) {
      const selection = this.sel[day];
      return selection ? Object.keys(selection.DIA).length + Object.keys(selection.NOCHE).length : 0;
    },

    ensureDay(day: string): DaySelection {
      if (!this.sel[day]) this.sel[day] = emptyDaySelection();
      return this.sel[day];
    },

    copyPreviousDay() {
      const index = this.eventDays.indexOf(this.activeDay);
      if (index <= 0) return;
      const previous = this.ensureDay(this.eventDays[index - 1]);
      this.sel[this.activeDay] = {
        DIA: Object.fromEntries(Object.entries(previous.DIA).map(([id, value]) => [id, { ...value }])),
        NOCHE: Object.fromEntries(Object.entries(previous.NOCHE).map(([id, value]) => [id, { ...value }])),
      };
      this.dirty = true;
    },

    openEvent(ev: EventFull) {
      this.event = ev;
      if (ev.event_type_id) this.typeId = ev.event_type_id;
      const sel: Record<string, DaySelection> = {};
      getEventDays(ev).forEach((day) => (sel[day] = emptyDaySelection()));
      ev.event_assignments.forEach((a) => {
        const day = a.event_day ?? ev.event_date;
        if (!sel[day]) sel[day] = emptyDaySelection();
        sel[day][a.shift][a.staff_id] = { status: a.status ?? (a.attended ? 'ASISTIO' : 'FALTA') };
        // asegura que el trabajador esté disponible aunque esté inactivo
        if (a.staff && !this.staff.some((s) => s.id === a.staff_id)) this.staff.push(a.staff);
      });
      this.sel = sel;
      this.activeDay = getEventDays(ev)[0] ?? ev.event_date;
      this.dirty = false;
      this.step = 3;
      history.replaceState(null, '', `?evento=${ev.id}`);
    },

    async createEvent() {
      this.creatingEvent = true;
      const row = await safe(
        () => saveEvent({ ...this.newEvent, event_type_id: this.typeId || null }),
        'Evento creado'
      );
      this.creatingEvent = false;
      if (!row) return;
      const full = await safe(() => getEvent(row.id));
      if (full) {
        this.events = [full, ...this.events];
        this.newEvent = { title: '', location: '', event_date: todayISO(), end_date: todayISO() };
        this.openEvent(full);
      }
    },

    /* --------------------------------- Paso 3 --------------------------------- */

    get staffOptions(): Staff[] {
      const q = norm(this.staffQ);
      return this.staff
        .filter(
          (s) =>
            s.is_active ||
            Object.values(this.sel).some((day) => day.DIA[s.id] || day.NOCHE[s.id])
        )
        .filter(
          (s) =>
            !q ||
            norm(`${s.first_name} ${s.last_name ?? ''}`).includes(q) ||
            norm(s.dni).includes(q) ||
            norm(s.affiliation).includes(q)
        )
        .sort((a, b) => a.first_name.localeCompare(b.first_name, 'es'));
    },

    fullName(s: Staff) {
      return [s.first_name, s.last_name].filter(Boolean).join(' ');
    },

    isSel(id: string, shift?: Shift, day?: string) {
      return Boolean(this.ensureDay(day ?? this.activeDay)[shift ?? this.shift][id]);
    },

    toggle(id: string) {
      const bucket = this.ensureDay(this.activeDay)[this.shift];
      if (bucket[id]) delete bucket[id];
      else bucket[id] = { status: 'FALTA' };
      this.dirty = true;
    },

    setStatus(id: string, status: AttendanceStatus, shift?: Shift) {
      const item = this.ensureDay(this.activeDay)[shift ?? this.shift][id];
      if (!item) return;
      item.status = status;
      this.dirty = true;
    },

    count(shift: Shift) {
      return Object.keys(this.ensureDay(this.activeDay)[shift]).length;
    },

    presentCount(shift: Shift) {
      return Object.values(this.ensureDay(this.activeDay)[shift]).filter((v) => v.status === 'ASISTIO').length;
    },

    /** Trabajadores seleccionados en un turno (ordenados) para el panel de asistencia. */
    selected(shift: Shift, day?: string): { staff: Staff; status: AttendanceStatus }[] {
      return Object.entries(this.ensureDay(day ?? this.activeDay)[shift])
        .map(([id, v]) => ({ staff: this.staff.find((s) => s.id === id), status: v.status }))
        .filter((x): x is { staff: Staff; status: AttendanceStatus } => Boolean(x.staff))
        .sort((a, b) => a.staff.first_name.localeCompare(b.staff.first_name, 'es'));
    },

    markAllStatus(status: AttendanceStatus) {
      Object.values(this.ensureDay(this.activeDay)[this.shift]).forEach((v) => (v.status = status));
      this.dirty = true;
    },

    statusText(status: AttendanceStatus) {
      return status === 'ASISTIO' ? 'Asistió' : status === 'VACACIONES' ? 'Vacaciones' : 'Falta';
    },

    /** Crea un trabajador solo con el nombre y lo asigna al turno activo. */
    async quickCreate() {
      const name = this.quickName.trim();
      if (!name) return;
      this.quickCreating = true;
      const created = await safe(() => saveStaff({ first_name: name }), 'Trabajador creado');
      this.quickCreating = false;
      if (!created) return;
      this.staff = [...this.staff, created];
      this.ensureDay(this.activeDay)[this.shift][created.id] = { status: 'FALTA' };
      this.quickName = '';
      this.staffQ = '';
      this.dirty = true;
    },

    async save() {
      if (!this.event) return;
      this.saving = true;
      const desired = this.eventDays.flatMap((event_day) =>
        (['DIA', 'NOCHE'] as Shift[]).flatMap((shift) =>
          Object.entries(this.ensureDay(event_day)[shift]).map(([staff_id, v]) => ({
            staff_id,
            event_day,
            shift,
            status: v.status,
          }))
        )
      );
      const ok = await safe(() => syncAssignments(this.event!.id, desired), 'Lista guardada');
      this.saving = false;
      if (!ok) return; // el error ya se mostró en un toast; se conservan los cambios sin guardar
      const fresh = await safe(() => getEvent(this.event!.id));
      if (fresh) {
        this.event = fresh;
        this.events = this.events.map((e) => (e.id === fresh.id ? fresh : e));
        this.dirty = false;
      }
    },

    changeEvent() {
      if (this.dirty && !confirm('Tienes cambios sin guardar. ¿Salir de todos modos?')) return;
      this.dirty = false;
      this.event = null;
      this.step = 2;
      history.replaceState(null, '', location.pathname);
    },

    goStep(n: 1 | 2 | 3) {
      if (n === 3 && !this.event) return;
      if (n === 2 && !this.typeId) return;
      if (n < 3 && this.step === 3 && this.dirty && !confirm('Tienes cambios sin guardar. ¿Salir de todos modos?')) return;
      if (n < 3) this.dirty = false;
      this.step = n;
    },

    /* ------------------------------- Exportación ------------------------------- */

    exportData(): ExportEvent {
      const ev = this.event!;
      const rows = this.eventDays.flatMap((event_day) =>
        (['DIA', 'NOCHE'] as Shift[]).flatMap((shift) =>
          this.selected(shift, event_day).map(({ staff: s, status }) => ({
            staff_id: s.id,
            event_day,
            first_name: s.first_name,
            last_name: s.last_name,
            dni: s.dni,
            shift,
            status,
          }))
        )
      );
      return {
        title: ev.title,
        location: ev.location,
        event_date: ev.event_date,
        end_date: ev.end_date,
        type: this.types.find((t) => t.id === ev.event_type_id)?.name ?? this.typeName ?? 'Evento',
        rows,
      };
    },

    exportPdf() {
      const d = this.exportData();
      return safe(() => eventsToPdf([d], eventFileName(d)), 'PDF generado');
    },
    exportExcel() {
      const d = this.exportData();
      return safe(() => eventsToExcel([d], eventFileName(d)), 'Excel generado');
    },
    async copyList() {
      const ok = await copyToClipboard(eventsToWhatsApp([this.exportData()]));
      toast(ok ? 'Lista copiada. Pégala en WhatsApp.' : 'No se pudo copiar.', ok ? 'ok' : 'error');
    },
  };
}

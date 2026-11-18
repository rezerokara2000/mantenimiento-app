import type { AttendanceStatus, EventFull, EventType, Shift } from '../supabase';
import {
  eventFileName,
  eventsToExcel,
  eventsToPdf,
  eventsToWhatsApp,
  formatDate,
} from '../exporters';
import {
  deleteEvent,
  getEventDays,
  getEventTypes,
  listEvents,
  saveEvent,
  toExportEvent,
  todayISO,
} from './api';
import {
  activeFilterCount,
  emptyEventFilters,
  filterEvents,
  norm,
  visibleRows,
  type EventFilterState,
} from './filters';
import { confirmDialog, copyWithToast, safe } from './ui';

interface EditForm {
  id: string;
  title: string;
  location: string;
  event_date: string;
  end_date: string;
  event_type_id: string;
}

interface PersonStat {
  staff_id: string;
  name: string;
  dni: string;
  affiliation: string;
  convocados: number;
  asistio: number;
  falta: number;
  vacaciones: number;
  dia: number;
  noche: number;
  history: { title: string; date: string; shift: Shift; status: AttendanceStatus }[];
}

/**
 * Tablero de eventos reutilizado en /eventos (próximos) y /registro (pasados).
 * Registro agrega métricas y es de solo lectura.
 */
export function eventsBoard(opts: { mode: 'upcoming' | 'past' }) {
  return {
    mode: opts.mode,
    readonly: opts.mode === 'past',
    loading: true,
    events: [] as EventFull[],
    types: [] as EventType[],
    filters: emptyEventFilters() as EventFilterState,
    showFilters: false,
    detail: null as EventFull | null,
    detailDay: '',
    edit: null as EditForm | null,
    saving: false,
    openPerson: '' as string,

    async init() {
      await this.load();
    },

    async load() {
      this.loading = true;
      await safe(async () => {
        const [events, types] = await Promise.all([listEvents(this.mode), getEventTypes()]);
        this.events = events;
        this.types = types;
      });
      this.loading = false;
    },

    /* ---------------------------- Datos derivados ---------------------------- */

    get filtered(): EventFull[] {
      return filterEvents(this.events, this.filters);
    },

    get affiliations(): string[] {
      const set = new Set<string>();
      this.events.forEach((e) =>
        e.event_assignments.forEach((a) => a.staff?.affiliation && set.add(a.staff.affiliation))
      );
      return [...set].sort((a, b) => a.localeCompare(b, 'es'));
    },

    get activeFilters(): number {
      return activeFilterCount(this.filters);
    },

    rows(ev: EventFull) {
      return visibleRows(ev, this.filters);
    },

    shiftRows(ev: EventFull, shift: Shift, day?: string) {
      return this.rows(ev).filter((a) => a.shift === shift && (!day || a.event_day === day));
    },

    fmt: formatDate,

    fmtRange(ev: EventFull) {
      return ev.end_date === ev.event_date
        ? formatDate(ev.event_date)
        : `${formatDate(ev.event_date)} - ${formatDate(ev.end_date)}`;
    },

    fmtLong(day: string) {
      return new Date(`${day}T12:00:00`).toLocaleDateString('es', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
    },

    eventDays(ev: EventFull) {
      return getEventDays(ev);
    },

    statusText(status: AttendanceStatus) {
      return status === 'ASISTIO' ? 'Asistió' : status === 'VACACIONES' ? 'Vacaciones' : 'Falta';
    },

    isToday(ev: EventFull) {
      const today = todayISO();
      return ev.event_date <= today && ev.end_date >= today;
    },

    resetFilters() {
      this.filters = emptyEventFilters();
    },

    /* ------------------------------- Registro ------------------------------- */

    get metrics() {
      let conv = 0;
      let asist = 0;
      let falta = 0;
      let vac = 0;
      const shifts = { DIA: { conv: 0, asist: 0 }, NOCHE: { conv: 0, asist: 0 } };
      this.filtered.forEach((ev) =>
        this.rows(ev).forEach((a) => {
          conv++;
          shifts[a.shift].conv++;
          if (a.status === 'ASISTIO') {
            asist++;
            shifts[a.shift].asist++;
          } else if (a.status === 'VACACIONES') vac++;
          else falta++;
        })
      );
      const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
      return {
        events: this.filtered.length,
        conv,
        asist,
        falta,
        vac,
        pending: conv - asist,
        pct: pct(asist, conv),
        dia: { ...shifts.DIA, pct: pct(shifts.DIA.asist, shifts.DIA.conv) },
        noche: { ...shifts.NOCHE, pct: pct(shifts.NOCHE.asist, shifts.NOCHE.conv) },
      };
    },

    get people(): PersonStat[] {
      const map = new Map<string, PersonStat>();
      this.filtered.forEach((ev) =>
        this.rows(ev).forEach((a) => {
          if (!a.staff) return;
          let p = map.get(a.staff_id);
          if (!p) {
            p = {
              staff_id: a.staff_id,
              name: [a.staff.first_name, a.staff.last_name].filter(Boolean).join(' '),
              dni: a.staff.dni ?? '',
              affiliation: a.staff.affiliation ?? '',
              convocados: 0,
              asistio: 0,
              falta: 0,
              vacaciones: 0,
              dia: 0,
              noche: 0,
              history: [],
            };
            map.set(a.staff_id, p);
          }
          p.convocados++;
          if (a.status === 'ASISTIO') p.asistio++;
          else if (a.status === 'VACACIONES') p.vacaciones++;
          else p.falta++;
          if (a.shift === 'DIA') p.dia++;
          else p.noche++;
          p.history.push({ title: ev.title, date: a.event_day, shift: a.shift, status: a.status });
        })
      );
      return [...map.values()].sort(
        (a, b) => b.convocados - a.convocados || a.name.localeCompare(b.name, 'es')
      );
    },

    togglePerson(id: string) {
      this.openPerson = this.openPerson === id ? '' : id;
    },

    /* -------------------------------- Acciones -------------------------------- */

    view(ev: EventFull) {
      this.detail = ev;
      this.detailDay = getEventDays(ev)[0] ?? ev.event_date;
    },

    startEdit(ev: EventFull) {
      this.edit = {
        id: ev.id,
        title: ev.title,
        location: ev.location,
        event_date: ev.event_date,
        end_date: ev.end_date,
        event_type_id: ev.event_type_id ?? '',
      };
    },

    syncEditEndDate() {
      if (this.edit && this.edit.end_date < this.edit.event_date) {
        this.edit.end_date = this.edit.event_date;
      }
    },

    async submitEdit() {
      if (!this.edit) return;
      this.saving = true;
      const f = this.edit;
      const ok = await safe(
        () =>
          saveEvent(
            {
              title: f.title,
              location: f.location,
              event_date: f.event_date,
              end_date: f.end_date,
              event_type_id: f.event_type_id || null,
            },
            f.id
          ),
        'Evento actualizado'
      );
      this.saving = false;
      if (ok) {
        this.edit = null;
        this.detail = null;
        await this.load();
      }
    },

    async remove(ev: EventFull) {
      const n = ev.event_assignments.length;
      const yes = await confirmDialog({
        title: 'Eliminar evento',
        message: `Se eliminará "${ev.title}" (${formatDate(ev.event_date)})${n ? ` y sus ${n} asignaciones` : ''}. Esta acción no se puede deshacer.`,
        confirmLabel: 'Sí, eliminar',
        danger: true,
      });
      if (!yes) return;
      const ok = await safe(() => deleteEvent(ev.id), 'Evento eliminado');
      if (ok) {
        this.detail = null;
        await this.load();
      }
    },

    /* ------------------------------- Exportación ------------------------------- */

    exportPdf(ev: EventFull) {
      return safe(() => eventsToPdf([toExportEvent(ev)], eventFileName(toExportEvent(ev))), 'PDF generado');
    },
    exportExcel(ev: EventFull) {
      return safe(() => eventsToExcel([toExportEvent(ev)], eventFileName(toExportEvent(ev))), 'Excel generado');
    },
    copyList(ev: EventFull) {
      return copyWithToast(eventsToWhatsApp([toExportEvent(ev)]));
    },

    /** Exporta todos los eventos visibles (con filtros aplicados), p. ej. el reporte de Registro. */
    exportAll(kind: 'pdf' | 'excel' | 'text') {
      const list = this.filtered.map((e) => toExportEvent(e, this.rows(e)));
      if (!list.length) return safe(async () => { throw new Error('No hay eventos para exportar.'); });
      const name = `${this.mode === 'past' ? 'registro' : 'eventos'}_${todayISO()}`;
      if (kind === 'text') return copyWithToast(eventsToWhatsApp(list));
      if (kind === 'pdf') return safe(() => eventsToPdf(list, name), 'PDF generado');
      return safe(() => eventsToExcel(list, name), 'Excel generado');
    },
  };
}

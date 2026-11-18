import type { AssignmentWithStaff, EventFull, Shift } from '../supabase';

export interface EventFilterState {
  q: string;
  from: string;
  to: string;
  typeId: string;
  shift: '' | Shift;
  affiliation: string;
}

export const emptyEventFilters = (): EventFilterState => ({
  q: '',
  from: '',
  to: '',
  typeId: '',
  shift: '',
  affiliation: '',
});

/** Minúsculas y sin tildes para búsquedas tolerantes. */
export const norm = (s: string | null | undefined): string =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Asignaciones que cumplen los filtros de turno y afiliación. */
export function visibleRows(ev: EventFull, f: EventFilterState): AssignmentWithStaff[] {
  return ev.event_assignments.filter((a) => {
    if (f.shift && a.shift !== f.shift) return false;
    if (f.affiliation && norm(a.staff?.affiliation) !== norm(f.affiliation)) return false;
    return true;
  });
}

export function matchesEvent(ev: EventFull, f: EventFilterState): boolean {
  if (f.typeId && ev.event_type_id !== f.typeId) return false;
  if (f.from && ev.end_date < f.from) return false;
  if (f.to && ev.event_date > f.to) return false;

  const rowFilterActive = Boolean(f.shift || f.affiliation);
  const rows = visibleRows(ev, f);
  if (rowFilterActive && rows.length === 0) return false;

  const q = norm(f.q);
  if (q) {
    const inEvent = norm(ev.title).includes(q) || norm(ev.location).includes(q);
    const inStaff = rows.some((a) => {
      const s = a.staff;
      if (!s) return false;
      return (
        norm(`${s.first_name} ${s.last_name ?? ''}`).includes(q) || norm(s.dni).includes(q)
      );
    });
    if (!inEvent && !inStaff) return false;
  }
  return true;
}

export const filterEvents = (events: EventFull[], f: EventFilterState) =>
  events.filter((e) => matchesEvent(e, f));

export function activeFilterCount(f: EventFilterState): number {
  return [f.q, f.from, f.to, f.typeId, f.shift, f.affiliation].filter(Boolean).length;
}

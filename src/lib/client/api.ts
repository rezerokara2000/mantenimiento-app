import {
  supabase,
  type AssignmentWithStaff,
  type AttendanceStatus,
  type EventFull,
  type EventRow,
  type EventType,
  type Shift,
  type Staff,
} from '../supabase';
import type { ExportEvent } from '../exporters';

/* ------------------------------- Utilidades ------------------------------- */

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del dispositivo. */
export function todayISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function fail(error: { message: string; code?: string } | null, fallback = 'Error inesperado'): never {
  if (error?.code === '23505') throw new Error('Ya existe un registro con ese valor (DNI o nombre duplicado).');
  throw new Error(error?.message || fallback);
}

const EVENT_SELECT =
  '*, event_types(name), event_assignments(id, event_id, event_day, staff_id, shift, attended, status, notes, staff(id, first_name, last_name, dni, age, affiliation, is_active))';

export function getEventDays(event: { event_date: string; end_date: string }): string[] {
  const start = new Date(`${event.event_date}T00:00:00Z`);
  const end = new Date(`${event.end_date}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return [];

  const days: string[] = [];
  for (const date = start; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

/* ------------------------------ Tipos de evento ------------------------------ */

export async function getEventTypes(): Promise<EventType[]> {
  const { data, error } = await supabase.from('event_types').select('*').order('name');
  if (error) fail(error);
  return data as EventType[];
}

export async function addEventType(name: string): Promise<EventType> {
  const clean = name.trim();
  if (!clean) throw new Error('Escribe un nombre para el tipo.');
  const { data, error } = await supabase.from('event_types').insert({ name: clean }).select().single();
  if (error) {
    if (error.code === '23505') {
      // ya existía: lo devolvemos para seleccionarlo
      const { data: existing } = await supabase.from('event_types').select('*').ilike('name', clean).single();
      if (existing) return existing as EventType;
    }
    fail(error);
  }
  return data as EventType;
}

/* ---------------------------------- Eventos ---------------------------------- */

export async function listEvents(scope: 'upcoming' | 'past' | 'all'): Promise<EventFull[]> {
  const today = todayISO();
  let q = supabase.from('events').select(EVENT_SELECT);
  if (scope === 'upcoming') q = q.gte('end_date', today).order('event_date', { ascending: true });
  else if (scope === 'past') q = q.lt('end_date', today).order('event_date', { ascending: false });
  else q = q.order('event_date', { ascending: false });
  const { data, error } = await q;
  if (error) fail(error);
  return (data as unknown as EventFull[]).map(sortAssignments);
}

export async function getEvent(id: string): Promise<EventFull | null> {
  const { data, error } = await supabase.from('events').select(EVENT_SELECT).eq('id', id).maybeSingle();
  if (error) fail(error);
  return data ? sortAssignments(data as unknown as EventFull) : null;
}

function sortAssignments(ev: EventFull): EventFull {
  ev.event_assignments = (ev.event_assignments ?? []).sort(
    (a, b) =>
      a.event_day.localeCompare(b.event_day) ||
      (a.staff?.first_name ?? '').localeCompare(b.staff?.first_name ?? '', 'es')
  );
  return ev;
}

export interface EventInput {
  title: string;
  location: string;
  event_date: string;
  end_date: string;
  event_type_id: string | null;
}

export async function saveEvent(input: EventInput, id?: string): Promise<EventRow> {
  const payload = {
    title: input.title.trim(),
    location: input.location.trim(),
    event_date: input.event_date,
    end_date: input.end_date,
    event_type_id: input.event_type_id || null,
  };
  if (!payload.title || !payload.location || !payload.event_date || !payload.end_date) {
    throw new Error('Título, lugar y fechas son obligatorios.');
  }
  if (payload.end_date < payload.event_date) {
    throw new Error('La fecha de fin no puede ser anterior a la fecha de inicio.');
  }
  const q = id
    ? supabase.from('events').update(payload).eq('id', id).select().single()
    : supabase.from('events').insert(payload).select().single();
  const { data, error } = await q;
  if (error) fail(error);
  return data as EventRow;
}

export async function deleteEvent(id: string): Promise<true> {
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) fail(error);
  return true;
}

/* ---------------------------------- Personal ---------------------------------- */

export async function listStaff(): Promise<Staff[]> {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .order('first_name', { ascending: true });
  if (error) fail(error);
  return data as Staff[];
}

export interface StaffInput {
  first_name: string;
  last_name?: string | null;
  dni?: string | null;
  age?: number | string | null;
  affiliation?: string | null;
  is_active?: boolean;
}

export async function saveStaff(input: StaffInput, id?: string): Promise<Staff> {
  const first = input.first_name?.trim();
  if (!first) throw new Error('El nombre es obligatorio.');
  const ageNum = input.age === '' || input.age == null ? null : Number(input.age);
  if (ageNum !== null && (!Number.isFinite(ageNum) || ageNum < 14 || ageNum > 100)) {
    throw new Error('La edad debe estar entre 14 y 100.');
  }
  const payload = {
    first_name: first,
    last_name: input.last_name?.trim() || null,
    dni: input.dni?.trim() || null,
    age: ageNum,
    affiliation: input.affiliation?.trim() || null,
    ...(input.is_active === undefined ? {} : { is_active: input.is_active }),
  };
  const q = id
    ? supabase.from('staff').update(payload).eq('id', id).select().single()
    : supabase.from('staff').insert(payload).select().single();
  const { data, error } = await q;
  if (error) fail(error);
  return data as Staff;
}

export async function deleteStaff(id: string): Promise<true> {
  const { error } = await supabase.from('staff').delete().eq('id', id);
  if (error) fail(error);
  return true;
}

/** Historial de participación de un trabajador. */
export async function staffHistory(staffId: string) {
  const { data, error } = await supabase
    .from('event_assignments')
    .select('id, event_day, shift, attended, status, events(id, title, location, event_date, end_date)')
    .eq('staff_id', staffId);
  if (error) fail(error);
  type Row = {
    id: string;
    event_day: string;
    shift: Shift;
    attended: boolean;
    status: AttendanceStatus;
    events: { id: string; title: string; location: string; event_date: string; end_date: string } | null;
  };
  return (data as unknown as Row[])
    .filter((r) => r.events)
    .sort((a, b) => b.event_day.localeCompare(a.event_day));
}

/* ------------------------------- Asignaciones ------------------------------- */

export interface DesiredAssignment {
  staff_id: string;
  event_day: string;
  shift: Shift;
  status: AttendanceStatus;
}

/**
 * Sincroniza la lista de un evento: elimina lo que ya no está, inserta lo nuevo
 * y actualiza la asistencia de lo existente.
 */
export async function syncAssignments(eventId: string, desired: DesiredAssignment[]): Promise<true> {
  const { data: current, error } = await supabase
    .from('event_assignments')
    .select('id, event_day, staff_id, shift, attended, status')
    .eq('event_id', eventId);
  if (error) fail(error);

  const key = (day: string, s: string, sh: string) => `${day}|${s}|${sh}`;
  const currentMap = new Map((current ?? []).map((c) => [key(c.event_day, c.staff_id, c.shift), c]));
  const desiredMap = new Map(desired.map((d) => [key(d.event_day, d.staff_id, d.shift), d]));

  const toDelete = (current ?? [])
    .filter((c) => !desiredMap.has(key(c.event_day, c.staff_id, c.shift)))
    .map((c) => c.id);
  const toInsert = desired
    .filter((d) => !currentMap.has(key(d.event_day, d.staff_id, d.shift)))
    .map((d) => ({
      event_id: eventId,
      event_day: d.event_day,
      staff_id: d.staff_id,
      shift: d.shift,
      attended: d.status === 'ASISTIO',
      status: d.status,
    }));
  const toUpdate = desired.filter((d) => {
    const c = currentMap.get(key(d.event_day, d.staff_id, d.shift));
    return c && (c.status !== d.status || c.attended !== (d.status === 'ASISTIO'));
  });

  if (toDelete.length) {
    const { error: e } = await supabase.from('event_assignments').delete().in('id', toDelete);
    if (e) fail(e);
  }
  if (toInsert.length) {
    const { error: e } = await supabase.from('event_assignments').insert(toInsert);
    if (e) fail(e);
  }
  for (const u of toUpdate) {
    const { error: e } = await supabase
      .from('event_assignments')
      .update({ attended: u.status === 'ASISTIO', status: u.status })
      .eq('event_id', eventId)
      .eq('event_day', u.event_day)
      .eq('staff_id', u.staff_id)
      .eq('shift', u.shift);
    if (e) fail(e);
  }
  return true;
}

/* --------------------------------- Exportación --------------------------------- */

export function toExportEvent(ev: EventFull, rows?: AssignmentWithStaff[]): ExportEvent {
  return {
    title: ev.title,
    location: ev.location,
    event_date: ev.event_date,
    end_date: ev.end_date,
    type: ev.event_types?.name ?? 'Evento',
    rows: (rows ?? ev.event_assignments)
      .filter((a) => a.staff)
      .map((a) => ({
        staff_id: a.staff_id,
        event_day: a.event_day,
        first_name: a.staff!.first_name,
        last_name: a.staff!.last_name,
        dni: a.staff!.dni,
        shift: a.shift,
        status: a.status ?? (a.attended ? 'ASISTIO' : 'FALTA'),
      })),
  };
}

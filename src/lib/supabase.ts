import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

/** false si faltan las variables de entorno (se muestra un aviso en el layout). */
export const supabaseConfigured = Boolean(url && key);

// Valores de relleno para que la app cargue y muestre el aviso en vez de romperse.
export const supabase = createClient(url || 'http://localhost:54321', key || 'sin-configurar');

/* ------------------------------ Tipados de BD ------------------------------ */

export type Shift = 'DIA' | 'NOCHE';
export type AttendanceStatus = 'ASISTIO' | 'FALTA' | 'VACACIONES';

export interface EventType {
  id: string;
  name: string;
}

export interface Staff {
  id: string;
  first_name: string;
  last_name: string | null;
  dni: string | null;
  age: number | null;
  affiliation: string | null;
  is_active: boolean;
}

export interface EventRow {
  id: string;
  title: string;
  location: string;
  event_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  event_type_id: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  event_id: string;
  event_day: string; // YYYY-MM-DD
  staff_id: string;
  shift: Shift;
  attended: boolean;
  status: AttendanceStatus;
  notes: string | null;
}

export interface AssignmentWithStaff extends Assignment {
  staff: Staff | null;
}

export interface EventFull extends EventRow {
  event_types: { name: string } | null;
  event_assignments: AssignmentWithStaff[];
}

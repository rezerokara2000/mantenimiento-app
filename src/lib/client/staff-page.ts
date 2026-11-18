import type { Staff } from '../supabase';
import { copyToClipboard, staffToExcel, staffToPdf, staffToWhatsApp } from '../exporters';
import { deleteStaff, listStaff, saveStaff, staffHistory, todayISO } from './api';
import { norm } from './filters';
import { confirmDialog, safe, toast } from './ui';

interface StaffForm {
  id: string;
  first_name: string;
  last_name: string;
  dni: string;
  age: string;
  affiliation: string;
  is_active: boolean;
}

const blankForm = (): StaffForm => ({
  id: '',
  first_name: '',
  last_name: '',
  dni: '',
  age: '',
  affiliation: '',
  is_active: true,
});

export function staffPage() {
  return {
    loading: true,
    staff: [] as Staff[],
    q: '',
    affiliation: '',
    status: 'active' as 'all' | 'active' | 'inactive',
    form: null as StaffForm | null,
    saving: false,
    detail: null as Staff | null,
    history: [] as Awaited<ReturnType<typeof staffHistory>>,
    historyLoading: false,
    affiliationSuggestions: ['Planilla', 'Recibo por honorarios', 'Externo'],

    async init() {
      await this.load();
    },

    async load() {
      this.loading = true;
      await safe(async () => {
        this.staff = await listStaff();
      });
      this.loading = false;
    },

    get affiliations(): string[] {
      const set = new Set<string>(this.affiliationSuggestions);
      this.staff.forEach((s) => s.affiliation && set.add(s.affiliation));
      return [...set].sort((a, b) => a.localeCompare(b, 'es'));
    },

    get filtered(): Staff[] {
      const q = norm(this.q);
      return this.staff.filter((s) => {
        if (this.status === 'active' && !s.is_active) return false;
        if (this.status === 'inactive' && s.is_active) return false;
        if (this.affiliation && norm(s.affiliation) !== norm(this.affiliation)) return false;
        if (!q) return true;
        return (
          norm(`${s.first_name} ${s.last_name ?? ''}`).includes(q) ||
          norm(s.dni).includes(q) ||
          norm(s.affiliation).includes(q)
        );
      });
    },

    get activeFilters(): number {
      return [this.q, this.affiliation, this.status !== 'active' ? this.status : ''].filter(Boolean).length;
    },

    resetFilters() {
      this.q = '';
      this.affiliation = '';
      this.status = 'active';
    },

    fullName(s: Staff) {
      return [s.first_name, s.last_name].filter(Boolean).join(' ');
    },

    /* ---------------------------------- CRUD ---------------------------------- */

    startCreate() {
      this.form = blankForm();
    },

    startEdit(s: Staff) {
      this.form = {
        id: s.id,
        first_name: s.first_name,
        last_name: s.last_name ?? '',
        dni: s.dni ?? '',
        age: s.age == null ? '' : String(s.age),
        affiliation: s.affiliation ?? '',
        is_active: s.is_active,
      };
      this.detail = null;
    },

    async submit() {
      if (!this.form) return;
      this.saving = true;
      const f = this.form;
      const ok = await safe(
        () =>
          saveStaff(
            {
              first_name: f.first_name,
              last_name: f.last_name,
              dni: f.dni,
              age: f.age,
              affiliation: f.affiliation,
              is_active: f.is_active,
            },
            f.id || undefined
          ),
        f.id ? 'Trabajador actualizado' : 'Trabajador agregado'
      );
      this.saving = false;
      if (ok) {
        this.form = null;
        await this.load();
      }
    },

    async toggleActive(s: Staff) {
      const ok = await safe(
        () => saveStaff({ first_name: s.first_name, is_active: !s.is_active }, s.id),
        s.is_active ? 'Marcado como inactivo' : 'Marcado como activo'
      );
      if (ok) await this.load();
    },

    async remove(s: Staff) {
      const yes = await confirmDialog({
        title: 'Eliminar trabajador',
        message: `Se eliminará a ${this.fullName(s)} y también sus asignaciones en listas de eventos. Si solo dejó de trabajar, mejor márcalo como inactivo.`,
        confirmLabel: 'Sí, eliminar',
        danger: true,
      });
      if (!yes) return;
      const ok = await safe(() => deleteStaff(s.id), 'Trabajador eliminado');
      if (ok) {
        this.detail = null;
        await this.load();
      }
    },

    async view(s: Staff) {
      this.detail = s;
      this.history = [];
      this.historyLoading = true;
      await safe(async () => {
        this.history = await staffHistory(s.id);
      });
      this.historyLoading = false;
    },

    get historyStats() {
      const total = this.history.length;
      const attended = this.history.filter((h) => h.attended).length;
      return { total, attended };
    },

    /* ------------------------------- Exportación ------------------------------- */

    exportPdf() {
      return safe(() => staffToPdf(this.filtered, `personal_${todayISO()}`), 'PDF generado');
    },
    exportExcel() {
      return safe(() => staffToExcel(this.filtered, `personal_${todayISO()}`), 'Excel generado');
    },
    async copyList() {
      const ok = await copyToClipboard(staffToWhatsApp(this.filtered));
      toast(ok ? 'Lista copiada. Pégala en WhatsApp.' : 'No se pudo copiar.', ok ? 'ok' : 'error');
    },
  };
}

import type { Staff } from '../supabase';
import { staffToExcel, staffToPdf, type StaffExportOptions } from '../exporters';
import { listStaff, todayISO } from './api';
import { norm } from './filters';
import { safe, toast } from './ui';

export function staffListBuilder() {
  return {
    loading: true,
    staff: [] as Staff[],
    query: '',
    selected: {} as Record<string, boolean>,
    fields: {
      dni: true,
      age: true,
      affiliation: true,
      is_active: false,
      combinedName: true,
      rowNumber: false,
    } as StaffExportOptions,

    async init() {
      await safe(async () => {
        this.staff = await listStaff();
      });
      this.loading = false;
    },

    get filtered(): Staff[] {
      const q = norm(this.query);
      return this.staff.filter((person) =>
        !q ||
        norm(`${person.first_name} ${person.last_name ?? ''}`).includes(q) ||
        norm(person.dni).includes(q) ||
        norm(person.affiliation).includes(q)
      );
    },

    get selectedStaff(): Staff[] {
      return this.staff.filter((person) => this.selected[person.id]);
    },

    get selectedCount(): number {
      return this.selectedStaff.length;
    },

    fullName(person: Staff) {
      return [person.first_name, person.last_name].filter(Boolean).join(' ');
    },

    toggle(id: string) {
      this.selected[id] = !this.selected[id];
    },

    selectVisible(value: boolean) {
      this.filtered.forEach((person) => {
        this.selected[person.id] = value;
      });
    },

    exportPdf() {
      if (!this.selectedCount) {
        toast('Selecciona al menos una persona para crear la lista.', 'error');
        return;
      }
      return safe(
        () => staffToPdf(this.selectedStaff, `lista_personal_${todayISO()}`, this.fields),
        'PDF generado'
      );
    },

    exportExcel() {
      if (!this.selectedCount) {
        toast('Selecciona al menos una persona para crear la lista.', 'error');
        return;
      }
      return safe(
        () => staffToExcel(this.selectedStaff, `lista_personal_${todayISO()}`, this.fields),
        'Excel generado'
      );
    },
  };
}

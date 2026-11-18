import type { AttendanceStatus } from './supabase';

/**
 * Exportadores: PDF, Excel y texto plano (WhatsApp).
 * Las funciones de texto son puras; PDF/Excel cargan sus librerías bajo demanda
 * para no inflar el bundle inicial.
 */

export interface ExportRow {
  staff_id: string;
  event_day: string;
  first_name: string;
  last_name: string | null;
  dni: string | null;
  shift: 'DIA' | 'NOCHE';
  status: AttendanceStatus;
}

export interface ExportEvent {
  title: string;
  location: string;
  event_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  type: string;
  rows: ExportRow[];
}

export interface ExportStaff {
  first_name: string;
  last_name: string | null;
  dni: string | null;
  age: number | null;
  affiliation: string | null;
  is_active: boolean;
}

export interface StaffExportOptions {
  dni: boolean;
  age: boolean;
  affiliation: boolean;
  is_active: boolean;
  combinedName: boolean;
  rowNumber: boolean;
}

const defaultStaffExportOptions: StaffExportOptions = {
  dni: true,
  age: true,
  affiliation: true,
  is_active: true,
  combinedName: false,
  rowNumber: true,
};

function staffExportMatrix(staff: ExportStaff[], options: StaffExportOptions) {
  const headers = [
    'Nombre',
    ...(!options.combinedName ? ['Apellidos'] : []),
    ...(options.dni ? ['DNI'] : []),
    ...(options.age ? ['Edad'] : []),
    ...(options.affiliation ? ['Afiliación'] : []),
    ...(options.is_active ? ['Estado'] : []),
  ];
  const rows = staff.map((person) => [
    options.combinedName ? fullName(person) : person.first_name,
    ...(!options.combinedName ? [person.last_name ?? ''] : []),
    ...(options.dni ? [person.dni ?? ''] : []),
    ...(options.age ? [person.age ?? ''] : []),
    ...(options.affiliation ? [person.affiliation ?? ''] : []),
    ...(options.is_active ? [person.is_active ? 'Activo' : 'Inactivo'] : []),
  ]);
  return { headers, rows };
}

/* ------------------------------- Utilidades ------------------------------- */

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const fullName = (r: { first_name: string; last_name: string | null }) =>
  [r.first_name, r.last_name].filter(Boolean).join(' ');

const byShift = (rows: ExportRow[], shift: 'DIA' | 'NOCHE') => rows.filter((r) => r.shift === shift);

const daysInEvent = (ev: ExportEvent) => {
  const start = new Date(`${ev.event_date}T00:00:00Z`);
  const end = new Date(`${ev.end_date}T00:00:00Z`);
  const days: string[] = [];
  for (const date = start; Number.isFinite(date.getTime()) && date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
};

const safeFile = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'lista';

export const eventFileName = (ev: ExportEvent) => safeFile(`${ev.title}_${ev.event_date}`);

/* --------------------------- Texto plano (WhatsApp) --------------------------- */

export function eventToWhatsApp(ev: ExportEvent): string {
  const lines: string[] = [];
  const dateLabel =
    ev.end_date === ev.event_date
      ? formatDate(ev.event_date)
      : `${formatDate(ev.event_date)} al ${formatDate(ev.end_date)}`;
  lines.push(`📋 *${ev.type.toUpperCase()}: ${ev.title} - ${dateLabel}*`);
  lines.push(`📍 ${ev.location}`);
  lines.push('');

  daysInEvent(ev).forEach((day) => {
    lines.push(`📅 *${formatDate(day)}*`);
    (['DIA', 'NOCHE'] as const).forEach((shift) => {
      const rows = byShift(ev.rows.filter((r) => r.event_day === day), shift);
      const label = shift === 'DIA' ? '☀️ TURNO DÍA' : '🌙 TURNO NOCHE';
      lines.push(`${label} (${rows.length})`);
      if (!rows.length) lines.push('- (sin personal asignado)');
      rows.forEach((r) =>
        lines.push(`- ${fullName(r)} · ${attendanceLabel(r.status)}${r.status === 'ASISTIO' ? ' ✅' : ''}`)
      );
      lines.push('');
    });
  });
  return lines.join('\n').trim();
}

export function eventsToWhatsApp(events: ExportEvent[]): string {
  return events.map(eventToWhatsApp).join('\n\n— — — — —\n\n');
}

export function staffToWhatsApp(staff: ExportStaff[]): string {
  const lines = [`👷 *PERSONAL DE MANTENIMIENTO* (${staff.length})`, ''];
  staff.forEach((s) => {
    const extra = [s.dni ? `DNI ${s.dni}` : '', s.affiliation ?? '', s.is_active ? '' : 'INACTIVO']
      .filter(Boolean)
      .join(' · ');
    lines.push(`- ${fullName(s)}${extra ? ` (${extra})` : ''}`);
  });
  return lines.join('\n');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* cae al método alternativo */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/* ----------------------------------- Excel ----------------------------------- */

const attendanceLabel = (status: AttendanceStatus) =>
  status === 'ASISTIO' ? 'Asistió' : status === 'VACACIONES' ? 'Vacaciones' : 'Falta';
const shiftLabel = (s: 'DIA' | 'NOCHE') => (s === 'DIA' ? 'Día' : 'Noche');
const dayHeader = (day: string) => {
  const label = new Date(`${day}T12:00:00`).toLocaleDateString('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

function attendanceMatrix(ev: ExportEvent, shift: 'DIA' | 'NOCHE') {
  const days = daysInEvent(ev);
  const people = new Map<string, { name: string; statuses: Map<string, string> }>();
  ev.rows
    .filter((row) => row.shift === shift)
    .forEach((row) => {
      let person = people.get(row.staff_id);
      if (!person) {
        person = {
          name: fullName(row),
          statuses: new Map(),
        };
        people.set(row.staff_id, person);
      }
      person.statuses.set(row.event_day, attendanceLabel(row.status));
    });

  const body = [...people.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((person) => [person.name, ...days.map((day) => person.statuses.get(day) ?? '')]);
  return { days, body };
}

/**
 * Un evento: columnas Nombre, Apellidos, DNI, Turno y Asistencia.
 * Varios eventos (reportes): se antepone Evento, Fecha, Lugar y Tipo.
 */
export async function eventsToExcel(events: ExportEvent[], filename: string): Promise<void> {
  const XLSX = await import('xlsx-js-style');
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  events.forEach((ev) => {
    (['DIA', 'NOCHE'] as const).forEach((shift) => {
      const { days, body } = attendanceMatrix(ev, shift);
      const header = ['Nombre', ...days.map(dayHeader)];
      const rows = body.length ? body : [['(sin personal asignado)', ...days.map(() => '')]];
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
      const border = {
        top: { style: 'thin', color: { rgb: 'D6E2DC' } },
        bottom: { style: 'thin', color: { rgb: 'D6E2DC' } },
        left: { style: 'thin', color: { rgb: 'D6E2DC' } },
        right: { style: 'thin', color: { rgb: 'D6E2DC' } },
      };

      header.forEach((_, column) => {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c: column })];
        cell.s = {
          font: { name: 'Aptos', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
          fill: { patternType: 'solid', fgColor: { rgb: '1F6B52' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border,
        };
      });

      rows.forEach((row, rowIndex) => {
        row.forEach((value, column) => {
          const cell = ws[XLSX.utils.encode_cell({ r: rowIndex + 1, c: column })];
          const statusStyles: Record<string, { fill: string; color: string }> = {
            Asistió: { fill: 'D9EAD3', color: '274E13' },
            Falta: { fill: 'F4CCCC', color: '990000' },
            Vacaciones: { fill: 'CFE2F3', color: '0B5394' },
          };
          const status = typeof value === 'string' ? statusStyles[value] : undefined;
          cell.s = {
            font: {
              name: 'Aptos',
              sz: 10,
              bold: column === 0 || Boolean(status),
              color: { rgb: column === 0 ? '000000' : status?.color ?? '263238' },
            },
            fill: {
              patternType: 'solid',
              fgColor: { rgb: status?.fill ?? (rowIndex % 2 ? 'F2F6F4' : 'FFFFFF') },
            },
            alignment: {
              horizontal: column === 0 ? 'left' : 'center',
              vertical: 'center',
              wrapText: true,
            },
            border,
          };
        });
      });

      ws['!cols'] = [{ wch: 30 }, ...days.map(() => ({ wch: 22 }))];
      ws['!rows'] = [{ hpt: 34 }, ...rows.map(() => ({ hpt: 25 }))];
      ws['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: rows.length, c: header.length - 1 },
        }),
      };
      ws['!freeze'] = {
        xSplit: 1,
        ySplit: 1,
        topLeftCell: 'B2',
        activePane: 'bottomRight',
        state: 'frozen',
      };

      const base = events.length === 1 ? shiftLabel(shift) : `${ev.title} ${shiftLabel(shift)}`;
      const prefix = base.replace(/[\\/?*[\]:]/g, ' ').slice(0, 27) || 'Lista';
      let sheetName = prefix;
      let suffix = 2;
      while (usedNames.has(sheetName)) {
        const ending = ` ${suffix++}`;
        sheetName = `${prefix.slice(0, 31 - ending.length)}${ending}`;
      }
      usedNames.add(sheetName);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
  });

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export async function staffToExcel(
  staff: ExportStaff[],
  filename: string,
  options: StaffExportOptions = defaultStaffExportOptions
): Promise<void> {
  const XLSX = await import('xlsx-js-style');
  const { headers, rows } = staffExportMatrix(staff, options);
  const data = rows.length ? rows : [['(sin personal)', ...headers.slice(1).map(() => '')]];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = headers.map((_, index) => ({ wch: index === 0 ? 32 : 22 }));
  ws['!rows'] = [{ hpt: 32 }, ...data.map(() => ({ hpt: 25 }))];
  headers.forEach((_, column) => {
    ws[XLSX.utils.encode_cell({ r: 0, c: column })].s = {
      font: { name: 'Aptos', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '1F6B52' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    };
  });
  data.forEach((row, rowIndex) =>
    row.forEach((_, column) => {
      ws[XLSX.utils.encode_cell({ r: rowIndex + 1, c: column })].s = {
        font: {
          name: 'Aptos',
          sz: 10,
          bold: column === 0,
          color: { rgb: column === 0 ? '000000' : '263238' },
        },
        fill: { patternType: 'solid', fgColor: { rgb: rowIndex % 2 ? 'F2F6F4' : 'FFFFFF' } },
        alignment: { horizontal: column === 0 ? 'left' : 'center', vertical: 'center' },
      };
    })
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Personal');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/* ------------------------------------ PDF ------------------------------------ */

export async function eventsToPdf(events: ExportEvent[], filename: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();
  let firstTable = true;

  events.forEach((ev, i) => {
    (['DIA', 'NOCHE'] as const).forEach((shift) => {
      if (!firstTable) doc.addPage();
      firstTable = false;

      const { days, body } = attendanceMatrix(ev, shift);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.text(`${ev.title} · Turno ${shiftLabel(shift)}`, margin, 44, { maxWidth: pageW - margin * 2 });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const dateRange =
        ev.end_date === ev.event_date
          ? formatDate(ev.event_date)
          : `${formatDate(ev.event_date)} - ${formatDate(ev.end_date)}`;
      doc.text(dateRange, margin, 61);

      const header = ['Nombre', ...days.map(dayHeader)];
      const rows = body.length ? body : [[{ content: 'Sin personal asignado', colSpan: header.length }]];
      const dateColumnWidth = (pageW - margin * 2 - 180) / Math.max(days.length, 1);
      autoTable(doc, {
        startY: 72,
        margin: { left: margin, right: margin },
        head: [header],
        body: rows,
        styles: { fontSize: Math.max(6, Math.min(9, Math.floor(72 / Math.max(days.length, 1)))), cellPadding: 6, halign: 'center', valign: 'middle', lineColor: [210, 220, 216], lineWidth: 0.4 },
        headStyles: { fillColor: [31, 107, 82], textColor: [255, 255, 255], fontStyle: 'bold', minCellHeight: 34 },
        alternateRowStyles: { fillColor: [242, 246, 244] },
        columnStyles: {
          0: { halign: 'left', cellWidth: 180, textColor: [0, 0, 0], fontStyle: 'bold' },
          ...Object.fromEntries(days.map((_, index) => [index + 1, { cellWidth: dateColumnWidth }])),
        },
        didParseCell(data) {
          if (data.section !== 'body' || data.column.index === 0) return;
          const colors: Record<string, { fill: [number, number, number]; text: [number, number, number] }> = {
            Asistió: { fill: [217, 234, 211], text: [39, 78, 19] },
            Falta: { fill: [244, 204, 204], text: [153, 0, 0] },
            Vacaciones: { fill: [207, 226, 243], text: [11, 83, 148] },
          };
          const status = colors[String(data.cell.raw)];
          if (status) {
            data.cell.styles.fillColor = status.fill;
            data.cell.styles.textColor = status.text;
            data.cell.styles.fontStyle = 'bold';
          }
        },
        theme: 'grid',
      });
    });
  });

  doc.save(`${filename}.pdf`);
}

export async function staffToPdf(
  staff: ExportStaff[],
  filename: string,
  options: StaffExportOptions = defaultStaffExportOptions
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const { headers, rows } = staffExportMatrix(staff, options);
  const tableHeaders = options.rowNumber ? ['#', ...headers] : headers;
  const tableRows = rows.length ? rows : [['(sin personal)', ...headers.slice(1).map(() => '')]];
  const printableRows = options.rowNumber
    ? tableRows.map((row, index) => [index + 1, ...row])
    : tableRows;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 32;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Lista de personal', margin, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${staff.length} trabajador(es)`, margin, 58);

  autoTable(doc, {
    startY: 68,
    margin: { left: margin, right: margin },
    head: [tableHeaders],
    body: printableRows,
    styles: { fontSize: 10, cellPadding: 6, valign: 'middle', lineColor: [210, 220, 216], lineWidth: 0.4 },
    headStyles: { fillColor: [31, 107, 82], textColor: [255, 255, 255], fontStyle: 'bold', minCellHeight: 32 },
    alternateRowStyles: { fillColor: [242, 246, 244] },
    columnStyles: {
      [options.rowNumber ? 1 : 0]: {
        cellWidth: Math.min(260, pageW * 0.35),
        textColor: [0, 0, 0],
        fontStyle: 'bold',
      },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === (options.rowNumber ? 1 : 0)) {
        data.cell.styles.textColor = [0, 0, 0];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    theme: 'grid',
  });

  doc.save(`${filename}.pdf`);
}

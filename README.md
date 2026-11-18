# Gestión de Mantenimiento

Astro (SSR) + Tailwind CSS 4 + Supabase + Alpine.js. Mobile-first.

## Puesta en marcha

1. En Supabase > SQL Editor, ejecuta `supabase/schema.sql`.
   Si ya tienes la aplicación instalada, vuelve a ejecutar el esquema para agregar las fechas de fin, las asignaciones por día y los estados de asistencia.
2. `cp .env.example .env` y completa `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`.
3. `npm install`
4. `npm run dev` (desarrollo) o `npm run build && node dist/server/entry.mjs` (producción).

## Secciones

| Ruta | Función |
|---|---|
| `/crear-lista` | Constructor en 3 pasos: tipo, evento, días, turnos y asistencia |
| `/crear-lista-personal` | Selección de personal y exportación sin evento ni asistencia |
| `/personal` | CRUD de trabajadores, filtros y exportación |
| `/eventos` | Eventos de hoy en adelante: ver, editar, eliminar, exportar |
| `/registro` | Eventos pasados en solo lectura, con métricas y exportación |

## Seguridad

`schema.sql` deja las tablas abiertas a la `anon key` (política `acceso_total_*`).
Es válido para uso interno, pero cualquiera con la clave puede leer y escribir.
Antes de publicar, agrega Supabase Auth y cambia `anon` por `authenticated` en esas políticas.

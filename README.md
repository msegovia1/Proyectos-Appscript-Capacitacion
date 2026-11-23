# SIGC — Sistema Integrado de Gestión de Capacitaciones y Emprendimiento
**Municipalidad de Santiago • DIDEL**

Sistema Web y Backend integral desarrollado sobre **Google Apps Script** y **Google Sheets** para la gestión completa del ciclo de capacitaciones (Emprendimiento, Empleo y Transversal): padrón único de personas, catálogo de actividades con multi-sesión, integración automática con Google Forms, control de asistencia, traspaso de postulantes con trayectoria acumulada, comunicaciones segmentadas y analítica institucional.

---

## 🏗️ Arquitectura General del Sistema

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    FRONTEND (SPA en HtmlService)                        │
│  Index.html + Styles.html + JsUI.html + JsApp.html + 14 Vistas (View*)  │
│  • Caché local en navegador (IndexedDB: SIGC_STORE)                     │
│  • Carga progresiva por módulos bajo demanda                            │
│  • Gráficos interactivos (Chart.js) y exportación Excel (.xlsx) / .ics  │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ google.script.run
┌───────────────────────────────────▼─────────────────────────────────────┐
│                  BACKEND (Google Apps Script .gs)                       │
│  WebApp.gs + Codigo.gs + Importaciones.gs + Config.gs + Utils.gs        │
│  • Caché rápida en servidor (CacheService + PropertiesService)          │
│  • Bloqueo de concurrencia (LockService) en escrituras críticas         │
│  • Triggers onFormSubmit para ingesta automática desde Google Forms     │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ SpreadsheetApp
┌───────────────────────────────────▼─────────────────────────────────────┐
│                 BASE DE DATOS (Google Sheets Central)                   │
│  PERSONAS │ ACTIVIDADES │ PARTICIPACIONES │ INTERESES_CAPACITACION      │
│  CONFIG_FORMULARIOS │ EVALUACIONES_SATISFACCION │ LOG_CAMBIOS │ ...     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Estructura de Archivos que Componen el Sistema

El proyecto utiliza una estructura plana en la raíz (28 archivos productivos sincronizados con Apps Script mediante `clasp`):

```text
SGC/
├── appsscript.json                  # Manifiesto, zona horaria (America/Santiago) y permisos OAuth
├── .clasp.json                      # ID del proyecto de Google Apps Script
├── .claspignore                     # Lista blanca de archivos sincronizados con Apps Script
├── package.json                     # Dependencias locales de desarrollo (clasp)
├── README.md                        # Documentación de arquitectura y archivos del sistema
│
├── Backend (.gs) — 8 archivos:
│   ├── Config.gs                    # Configuración central, versión y SPREADSHEET_ID dinámico (PropertiesService)
│   ├── Utils.gs                     # Normalización/validación de RUT, documentos extranjeros, correos, teléfonos y fechas
│   ├── WebApp.gs                    # doGet(), endpoints RPC, cálculo de KPIs, perfiles demográficos y reportes
│   ├── Codigo.gs                    # Menú en Sheets, triggers onFormSubmit, formularios vinculados y traspaso múltiple
│   ├── Importaciones.gs             # Importador universal tolerante (.xlsx/.csv) y migración/ingesta de Base Madre
│   ├── ImportadorHistorico.gs       # Compatibilidad y utilidades de lectura/escritura tabular para importaciones
│   ├── MigracionV3.gs               # Utilidades de migración estructural v3
│   └── MigracionConsolidado2026.gs  # Migración idempotente del consolidado anual 2026 hacia ACTIVIDADES
│
└── Frontend (.html) — 20 archivos:
    ├── Index.html                   # Shell SPA, barra lateral, cabecera, carga de Chart.js y ensamblado de vistas
    ├── Styles.html                  # Hoja de estilos institucional, variables CSS, diseño responsivo y tablas
    ├── ModalConfig.html             # Modal para configurar el ID de la Google Sheet central
    ├── JsUI.html                    # Utilidades de interfaz (toasts, modales, drawer móvil, helpers visuales)
    ├── JsApp.html                   # Controlador cliente: estado DB, SIGC_STORE, gráficos, filtros, exportaciones
    │
    └── Vistas Modulares (Partials):
        ├── ViewDashboard.html              # KPIs consolidados, gráficos operativos y perfiles (género, edad, comunas)
        ├── ViewCalendario.html             # Calendario mensual multi-sesión, enlace a Google Calendar y descarga .ics
        ├── ViewPersonas.html               # Padrón único de personas, búsqueda y edición de ficha
        ├── ViewActividades.html            # Listado de capacitaciones con estado de asistencia, filtro y acciones
        ├── ViewParticipaciones.html        # Registro histórico global de inscripciones y resultados
        ├── ViewGestion.html                # Gestión por actividad: selección, cuadritos por sesión, asistencia y traspaso
        ├── ViewRegistroPersonas.html       # Formulario de alta individual de persona
        ├── ViewRegistroActividades.html    # Formulario de alta de actividad con constructor multi-fecha de sesiones
        ├── ViewRegistroParticipaciones.html# Formulario de inscripción manual persona–actividad
        ├── ViewDemanda.html                # Análisis de demanda e intereses de capacitación registrados
        ├── ViewReportes.html               # Reportes filtrables y exportación a Excel multipestaña
        ├── ViewComunicaciones.html         # Segmentación de destinatarios CCO y generador de cartelera HTML
        ├── ViewFormularios.html            # Vinculación de Google Forms, cuota de activadores y sincronización
        └── ViewImportaciones.html          # Carga masiva con plantilla .xlsx (incluye género/nacimiento) y Base Madre
```

---

## 🧩 Módulos y Capacidades Principales

1. **Dashboard Institucional (`ViewDashboard.html` / `WebApp.gs`):**
   - 12 KPIs consolidados y guía de fórmulas.
   - Gráficos operativos (estado, escuela/línea, áreas temáticas, inscripciones y participación efectiva) + **perfiles demográficos** con género unificado (`Femenino`, `Masculino`, `Otro`), tramos de edad y Top 10 comunas.
2. **Actividades y Calendario (`ViewActividades.html`, `ViewCalendario.html`):**
   - Columna e indicador de **Asistencia** por capacitación (*Con asistencia*, *Sin asistencia*, *Sin registros*) y filtro rápido.
   - Cronograma multi-sesión, agendamiento en Google Calendar y exportación `.ics`.
3. **Gestión de Participantes y Traspaso Múltiple (`ViewGestion.html`, `Codigo.gs`):**
   - Cuadritos dinámicos por cada sesión (`S1..Sn`), acciones masivas, lista de firmas Word/Excel y encuesta de satisfacción.
   - **Traspaso de postulantes con trayectoria acumulada:** permite seleccionar múltiples ediciones previas, excluir automáticamente a quienes ya asistieron o aprobaron en cualquiera de ellas (mostrando el detalle de excluidos) y marcarlos como `No seleccionado` en la actividad destino.
4. **Formularios Conectados (`ViewFormularios.html`, `Codigo.gs`):**
   - Vinculación por URL de Google Sheets de respuestas (inscripción, Base Madre y satisfacción), monitoreo de cuota de 20 activadores por proyecto, reprocesamiento tolerante y sincronización masiva.
5. **Importaciones Masivas (`ViewImportaciones.html`, `Importaciones.gs`):**
   - Plantilla `.xlsx` estándar (incluye `GENERO` y `FECHA_NACIMIENTO`), auto-mapeo de columnas y procesamiento tolerante de documentos históricos.

---

## 🛠️ Despliegue y Flujo de Trabajo con `clasp`

```bash
# Subir cambios al entorno de pruebas (/dev - @HEAD)
npx.cmd @google/clasp push --force

# Publicar nueva versión oficial en producción (/exec)
npx.cmd @google/clasp deploy -i AKfycbzUAT1P4ULZl_z75CuqcH3XT9grV6SpOkbeBDY-5C0mzwtH192aj3vSpynSYU60rBCm -d "Descripción de la versión"
```

---

## 📄 Licencia
Ilustre Municipalidad de Santiago • DIDEL • 2026

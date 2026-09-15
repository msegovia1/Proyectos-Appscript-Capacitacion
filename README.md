# SIGC - Sistema Integrado de Gestión de Capacitaciones y Emprendimiento
**Versión 3.8.0** • Municipalidad de Santiago

Sistema Web y Backend integral de alto rendimiento desarrollado sobre **Google Apps Script** y **Google Sheets** para la gestión, seguimiento, evaluación y analítica de capacitaciones, cursos y programas comunitarios.

---

## 🚀 Novedades de la Versión 3.8.0

1. **⚡ Optimización Extrema de Rendimiento y Carga:**
   - **Lectura Ultrarrápida por Lotes:** Reemplazo de `getDisplayValues()` por `getValues()` nativo, reduciendo tiempos de I/O hasta un 70%.
   - **Cálculo de IDs Correlativos en Memoria:** Eliminación de múltiples escaneos repetidos de hojas al registrar fichas de personas, actividades o participaciones.
   - **Inserción Masiva de Intereses:** Guardado de intereses formativos en una sola pasada.
   - **Sincronización en Bloque:** Actualización matricial masiva de participaciones al modificar actividades.
   - **Actualizaciones Optimistas en Frontend:** La UI actualiza la base local (`DB`) de inmediato con los datos retornados por el servidor sin esperas de recarga completa.
   - **Debounce Inteligente:** Búsquedas y filtros en vivo optimizados (200 ms) para evitar congelamientos en tablas extensas.

2. **🎨 Modernización Visual y Estética:**
   - Paleta corporativa refinada con gradientes suaves azul municipal (`#0b1f3a` a `#112d52`).
   - Tarjetas KPI con acentos de color semánticos, hover interactivo y tipografía nítida.
   - Gráficos **Chart.js** modernizados con barras redondeadas, tooltips refinados y colores coordinados.
   - Tablas con cabeceras *sticky* sutiles, scrollbars estilizadas y *badges* de estado tipo píldora.
   - Microinteracciones ágiles y animaciones fluidas de cambio de vista.

3. **🧹 Arquitectura Depurada y Limpia:**
   - Eliminación física y lógica de los módulos de Asistencia QR y Generador de Diplomas para concentrar el sistema en su núcleo de gestión y analítica.
   - Estructura plana de archivos en raíz para sincronización directa 1-a-1 mediante la extensión *Google Apps Script GitHub Assistant*.

---

## 📁 Estructura del Proyecto

```text
SGC/
├── appsscript.json             # Manifiesto y permisos de Apps Script
├── .clasp.json                 # Configuración de Clasp para despliegue
├── .claspignore               # Exclusiones de sincronización
├── package.json               # Atajos de npm para Clasp
├── README.md                  # Documentación del sistema
│
├── Backend (.gs):
│   ├── Config.gs              # Configuración central v3.8.0 y PropertiesService
│   ├── Utils.gs               # Normalización de RUTs, nombres y validaciones
│   ├── WebApp.gs              # Endpoints API, doGet y orquestador optimizado
│   ├── Codigo.gs              # Menús de Google Sheets y disparadores
│   ├── Importaciones.gs       # Importador universal por lotes
│   ├── ImportadorHistorico.gs # Compatibilidad histórica
│   └── MigracionV3.gs         # Utilidades de migración estructural
│
└── Frontend (.html):
    ├── Index.html             # Shell principal, navegación moderna y contenedor
    ├── Styles.html            # CSS moderno, variables de diseño y responsive
    ├── ModalConfig.html       # Modal de configuración de planilla
    │
    ├── Vistas (Partials):
    │   ├── ViewDashboard.html      # KPIs y gráficos interactivos
    │   ├── ViewPersonas.html       # Registro consolidado de participantes
    │   ├── ViewActividades.html    # Talleres, cursos y estados
    │   ├── ViewParticipaciones.html# Inscritos y resultados
    │   ├── ViewGestion.html        # Asistencia rápida y nóminas
    │   ├── ViewDemanda.html        # Análisis de demanda e intereses
    │   ├── ViewReportes.html       # Reportes y estadísticas
    │   ├── ViewComunicaciones.html # Correos masivos y plantillas
    │   ├── ViewFormularios.html    # Conexión con Google Forms
    │   ├── ViewImportaciones.html  # Importador universal
    │   └── ViewRegistros.html      # Formularios de ingreso rápido
    │
    └── Scripts de Cliente:
        ├── JsUI.html               # Toasts flotantes, Modales y Drawer móvil
        └── JsApp.html              # Controlador general reactivo y optimista
```

---

## 🛠️ Instalación y Despliegue

### Opción A: Despliegue con Extensión de GitHub (Recomendada)
1. Abre tu proyecto en el editor de Google Apps Script (`script.google.com`).
2. Abre la extensión **Google Apps Script GitHub Assistant**.
3. Selecciona tu repositorio `Proyectos-Appscript-Capacitacion` y la rama correspondiente.
4. Haz clic en **Pull** para traer todos los archivos `.gs` y `.html`.

### Opción B: Despliegue con Google Clasp
```bash
npm install -g @google/clasp
clasp login
clasp push
```

---

## ⚙️ Configuración Inicial

1. **Vincular Hoja de Cálculo:**
   - Abre la aplicación Web desplegada.
   - Haz clic en el botón superior **⚙️ Configurar**.
   - Pega el ID de tu Google Sheet y haz clic en **Guardar Cambios**.
2. **Estructurar la Planilla:**
   - En la hoja de cálculo de Google, ve al menú **Sistema Capacitación > 1. Preparar sistema**.
   - Acepta los permisos de Google.

---

## 📄 Licencia
Municipalidad de Santiago • 2026

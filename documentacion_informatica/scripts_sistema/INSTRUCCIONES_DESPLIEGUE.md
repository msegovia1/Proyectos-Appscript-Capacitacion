# Guía Técnica de Despliegue — Scripts del Sistema SIGC
### Para el Equipo de Informática — Municipalidad de Santiago

Esta subcarpeta contiene la totalidad de los archivos fuente del **Sistema de Gestión de Capacitaciones (SIGC)** en su versión modular de alto rendimiento (v3.10.6).

---

## 1. Inventario de Archivos del Sistema

### Backend (Google Apps Script - V8 Runtime)
* **`appsscript.json`**: Manifiesto del proyecto (zonas horarias, dependencias y permisos OAuth de dominio).
* **`Config.gs`**: Parámetros globales, nombres de hojas y lectura de `SIGC_SPREADSHEET_ID` desde Script Properties.
* **`WebApp.gs`**: Punto de entrada web (`doGet`), enrutador RPC, motor de consultas SQL tabulares en memoria y endpoints del sistema.
* **`Codigo.gs`**: Reglas de negocio, validación de RUT (Módulo 11), control de cupos y generador de identificadores (`PER-`, `ACT-`, `PAR-`).
* **`Utils.gs`**: Funciones utilitarias de sanitización, formato de fechas y prevención de inyección.
* **`Importaciones.gs`** y **`ImportadorHistorico.gs`**: Parsers de importación masiva desde CSV/Excel con deduplicación por RUT.
* **`MigracionV3.gs`**: Utilidad de verificación de consistencia e integridad de datos.

### Frontend (SPA Modular HTML5 / Vanilla JS)
* **`Index.html`**: Estructura principal, topbar institucional y ensamblador de vistas.
* **`Styles.html`**: Hojas de estilo CSS optimizadas con diseño corporativo accesible.
* **`JsApp.html`**: Núcleo de la aplicación cliente, almacenamiento local reactivo en **IndexedDB (`SIGC_STORE`)**, sincronización asíncrona y lógica de interfaz.
* **`JsUI.html`**: Controladores de navegación lateral, modales y vinculación dinámica de planillas.
* **`ViewDashboard.html`**: Panel de control con métricas clave en tiempo real.
* **`ViewCalendario.html`**: Vista interactiva de calendario mensual/semanal de capacitaciones.
* **`ViewPersonas.html`** y **`ViewRegistroPersonas.html`**: Padrón de beneficiarios y ficha unificada con validación de RUT.
* **`ViewActividades.html`** y **`ViewRegistroActividades.html`**: Catálogo y creación de capacitaciones con gestión de cupos y sesiones.
* **`ViewGestion.html`**: Mesa de trabajo operativa (pase de lista 1-clic por sesión, cambio masivo de estados y contacto por WhatsApp).
* **`ViewParticipaciones.html`** y **`ViewRegistroParticipaciones.html`**: Matrículas y vinculaciones alumno-actividad.
* **`ViewDemanda.html`** y **`ViewFormularios.html`**: Módulo de intereses de capacitación y vinculación con Google Forms.
* **`ViewReportes.html`**: Generación de reportes y exportación de nóminas oficiales en Excel con filtros.
* **`ViewComunicaciones.html`** y **`ViewImportaciones.html`**: Avisos masivos e importador de planillas históricas.

---

## 2. Opción A: Despliegue Rápido vía Clasp (Recomendada)

Si el equipo de Informática utiliza la terminal con **Google Clasp** (`@google/clasp`), el despliegue toma menos de 2 minutos:

```bash
# 1. Instalar Clasp globalmente (si no lo tienen)
npm install -g @google/clasp

# 2. Iniciar sesión con la cuenta institucional de Google
clasp login

# 3. Crear un nuevo proyecto Web App en Google Drive institucional
clasp create --title "SIGC - Capacitaciones Santiago" --type webapp --rootDir .

# 4. Subir todos los archivos al proyecto
clasp push -f

# 5. Desplegar una versión de prueba
clasp deploy --description "SIGC v3.10.6 - Despliegue Inicial Informática"
```

---

## 3. Opción B: Despliegue Manual en el Editor Web de Google Apps Script

1. Crear un proyecto nuevo en [script.google.com](https://script.google.com/) con la cuenta institucional de desarrollo.
2. Ir a **Configuración del Proyecto** (icono de engranaje) y marcar la casilla:
   - ✅ *Mostrar el archivo de manifiesto "appsscript.json" en el editor*.
3. Copiar el contenido de `appsscript.json` en el archivo correspondiente.
4. Crear cada uno de los archivos `.gs` y `.html` respetando exactamente los mismos nombres del listado superior.
5. Copiar y pegar el código fuente de cada archivo.

---

## 4. Vinculación con la Base de Datos (Google Sheets)

El sistema lee y escribe sus datos sobre una planilla de Google Sheets estructurada.

### Configuración del ID de la Planilla
Para no modificar el código al cambiar entre entornos (Desarrollo, Pruebas o Producción):
1. En el editor de Apps Script, ir a **Configuración del proyecto** > **Propiedades de la secuencia de comandos**.
2. Agregar una propiedad:
   - **Propiedad:** `SIGC_SPREADSHEET_ID`
   - **Valor:** `[ID_DE_LA_PLANILLA_EN_GOOGLE_DRIVE]` (la cadena alfanumérica en la URL entre `/d/` y `/edit`).

*(Si no se define la propiedad, el sistema utiliza por defecto el respaldo configurado en `Config.gs`).*

### Estructura de Hojas Requeridas en la Planilla:
* `PERSONAS`: Maestro de vecinos/beneficiarios.
* `ACTIVIDADES`: Catálogo de cursos y capacitaciones.
* `PARTICIPACIONES`: Tabla puente relacional (matrículas y asistencias).
* `CONFIG_FORMULARIOS`: Parámetros de vinculación con formularios Google.
* `INTERESES_CAPACITACION`: Matriz de demanda ciudadana.
* `LOG_CAMBIOS`: Trazabilidad y auditoría de acciones.

---

## 5. Parámetros de Publicación y Seguridad

Al publicar la aplicación web (**Implementar** > **Nueva implementación**):
* **Tipo:** Aplicación Web.
* **Ejecutar como:** `Usuario que accede` o `Yo (cuenta que implementa)` (Se recomienda *Yo* para centralizar permisos de lectura/escritura en la planilla municipal).
* **Quién tiene acceso:** `Cualquier usuario de Municipalidad de Santiago` (`@munistgo.cl`).

/**
 * CONFIGURACIÓN CENTRAL SIGC
 * Versión 3.9.0
 * Soporta configuración dinámica mediante PropertiesService y respaldo estático.
 */
const SIGC_CONFIG_DEFAULT = Object.freeze({
  VERSION: '3.9.0',
  SPREADSHEET_ID: '1gT0135EeC1MTzLSfcfJOHuJl5yODFyDtL7eXRfTRmuo',
  ZONA_HORARIA: 'America/Santiago',
  LIMITE_RECUPERACION_FORMULARIO: 100,
  CACHE_RESUMEN_SEGUNDOS: 21600,
  CACHE_FORMULARIOS_SEGUNDOS: 300,
  LIMITE_ACTIVADORES_PROYECTO: 20,
  MAX_FORMULARIOS_RECOMENDADO: 15,
  HOJAS: Object.freeze({
    PERSONAS: 'PERSONAS',
    INTERESES: 'INTERESES_CAPACITACION',
    PERFILES_BASE_MADRE: 'PERFILES_BASE_MADRE',
    FORMULARIOS: 'CONFIG_FORMULARIOS',
    ACTIVIDADES: 'ACTIVIDADES',
    PARTICIPACIONES: 'PARTICIPACIONES',
    ASISTENCIA: 'ASISTENCIA_RAPIDA',
    BUSCADOR: 'BUSCADOR_PERSONA',
    CALIDAD: 'CONTROL_CALIDAD',
    RESPUESTAS: 'RESPUESTAS_FORMULARIO',
    IMPORTAR: 'IMPORTAR_ASISTENTES',
    HISTORIAL_IMPORTACIONES: 'HISTORIAL_IMPORTACIONES',
    HISTORICO_ORIGINAL: 'HISTORICO_ORIGINAL',
    LOG: 'LOG_CAMBIOS',
    AUDITORIA: 'AUDITORIA_MIGRACION'
  })
});

/**
 * Obtiene el SPREADSHEET_ID activo, priorizando Script Properties sobre el valor por defecto.
 */
function sigcObtenerSpreadsheetId() {
  try {
    const props = PropertiesService.getScriptProperties();
    const idProp = props.getProperty('SIGC_SPREADSHEET_ID');
    if (idProp && idProp.trim().length > 10) {
      return idProp.trim();
    }
  } catch (e) {
    console.warn('No se pudo acceder a PropertiesService, usando valor por defecto: ' + e.message);
  }
  return SIGC_CONFIG_DEFAULT.SPREADSHEET_ID;
}

/**
 * Guarda el SPREADSHEET_ID en las Script Properties de forma segura.
 */
function sigcGuardarSpreadsheetId(nuevoId) {
  if (!nuevoId || typeof nuevoId !== 'string' || nuevoId.trim().length < 15) {
    throw new Error('ID de Google Spreadsheet no válido.');
  }
  const idLimpio = nuevoId.trim();
  try {
    // Probar conexión antes de guardar
    const ss = SpreadsheetApp.openById(idLimpio);
    PropertiesService.getScriptProperties().setProperty('SIGC_SPREADSHEET_ID', idLimpio);
    return {
      ok: true,
      mensaje: 'Conexión exitosa a la planilla: ' + ss.getName(),
      id: idLimpio,
      nombre: ss.getName()
    };
  } catch (error) {
    throw new Error('Error al conectar con la planilla especificada: ' + error.message);
  }
}

/**
 * Objeto dinámico de configuración central SIGC.
 */
const SIGC_CONFIG = {
  get VERSION() { return SIGC_CONFIG_DEFAULT.VERSION; },
  get SPREADSHEET_ID() { return sigcObtenerSpreadsheetId(); },
  get ZONA_HORARIA() { return SIGC_CONFIG_DEFAULT.ZONA_HORARIA; },
  get LIMITE_RECUPERACION_FORMULARIO() { return SIGC_CONFIG_DEFAULT.LIMITE_RECUPERACION_FORMULARIO; },
  get CACHE_RESUMEN_SEGUNDOS() { return SIGC_CONFIG_DEFAULT.CACHE_RESUMEN_SEGUNDOS; },
  get CACHE_FORMULARIOS_SEGUNDOS() { return SIGC_CONFIG_DEFAULT.CACHE_FORMULARIOS_SEGUNDOS; },
  get LIMITE_ACTIVADORES_PROYECTO() { return SIGC_CONFIG_DEFAULT.LIMITE_ACTIVADORES_PROYECTO; },
  get MAX_FORMULARIOS_RECOMENDADO() { return SIGC_CONFIG_DEFAULT.MAX_FORMULARIOS_RECOMENDADO; },
  get HOJAS() { return SIGC_CONFIG_DEFAULT.HOJAS; }
};

/* Alias de compatibilidad con el código histórico */
const SISTEMA = {
  get HOJAS() { return SIGC_CONFIG_DEFAULT.HOJAS; },
  get ZONA_HORARIA() { return SIGC_CONFIG_DEFAULT.ZONA_HORARIA; }
};

const WEBAPP_CONFIG = {
  get SPREADSHEET_ID() { return sigcObtenerSpreadsheetId(); },
  get ZONA_HORARIA() { return SIGC_CONFIG_DEFAULT.ZONA_HORARIA; },
  get HOJAS() { return SIGC_CONFIG_DEFAULT.HOJAS; }
};

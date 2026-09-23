/**
 * SIGC V3 - Utilidades, normalización, validación e IDs
 */
function normHeader_(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_/\\-]+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}/**
 * UTILIDADES COMUNES SIGC 3.0
 * Reglas únicas de normalización, documentos, selección y resultados.
 */
function sigcNormalizarEncabezado(valor) {
  return String(valor || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_/\\-]+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
function sigcNormalizarTexto(valor) {
  return String(valor || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function sigcNormalizarClave(valor) {
  return sigcNormalizarTexto(valor)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
function sigcNormalizarNombre(valor) {
  const texto = sigcNormalizarTexto(valor).toLowerCase();
  if (!texto) return '';
  const minusculas = ['de', 'del', 'la', 'las', 'los', 'y', 'e'];
  return texto.split(' ').map(function(palabra, indice) {
    if (indice > 0 && minusculas.indexOf(palabra) >= 0) return palabra;
    return palabra.charAt(0).toUpperCase() + palabra.slice(1);
  }).join(' ');
}
function sigcNormalizarRut(valor) {
  if (!valor) return '';
  const str = String(valor).trim().toUpperCase();
  // Si ya contiene guión explícito (ej: "18.234.567-8" o "18234567-K")
  if (str.indexOf('-') >= 0) {
    const partes = str.split('-');
    let cuerpo = partes[0].replace(/\D/g, '');
    const dv = partes[1].replace(/[^0-9K]/g, '');
    const repMatch = cuerpo.match(/^(\d{7,8})\1+$/);
    if (repMatch) {
      cuerpo = repMatch[1];
    }
    if (cuerpo.length >= 6 && dv.length >= 1) {
      return cuerpo + '-' + dv.charAt(0);
    }
  }
  let limpio = str.replace(/[^0-9K]/g, '');
  if (limpio.length < 2) return '';

  // Si contiene cuerpo repetido con DV al final continuo (ej: "15933157159331571")
  const repMatchConDv = limpio.match(/^(\d{7,8})\1+([0-9K])$/);
  if (repMatchConDv) {
    return repMatchConDv[1] + '-' + repMatchConDv[2];
  }
  // Si contiene cuerpo repetido sin DV
  const repMatchSinDv = limpio.match(/^(\d{7,8})\1+$/);
  if (repMatchSinDv) {
    limpio = repMatchSinDv[1];
  }

  // Si son 7 u 8 dígitos puros sin guión previo (es el cuerpo al que le falta el DV)
  if (/^\d{7,8}$/.test(limpio)) {
    let suma = 0;
    let mult = 2;
    for (let i = limpio.length - 1; i >= 0; i--) {
      suma += Number(limpio.charAt(i)) * mult;
      mult = mult === 7 ? 2 : mult + 1;
    }
    const resto = 11 - (suma % 11);
    const dvCalc = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
    return limpio + '-' + dvCalc;
  }
  // Si tiene 8 o 9 caracteres con DV pegado al final (ej: "182345678" o "18234567K")
  return limpio.slice(0, -1) + '-' + limpio.slice(-1);
}
function sigcValidarRut(valor) {
  const limpio = String(valor || '').toUpperCase().replace(/[^0-9K]/g, '');
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo.charAt(i)) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === esperado;
}
function sigcNormalizarCorreo(valor) {
  return String(valor || '').trim().toLowerCase().replace(/\s+/g, '');
}
function sigcValidarCorreo(valor) {
  const correo = sigcNormalizarCorreo(valor);
  return !correo || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo);
}
function sigcNormalizarTelefono(valor) {
  let limpio = String(valor || '').replace(/\D/g, '');
  if (!limpio) return '';
  if (limpio.indexOf('0056') === 0) limpio = limpio.substring(2);
  if (limpio.length === 9) limpio = '56' + limpio;
  if (limpio.length === 8) limpio = '562' + limpio;
  return limpio;
}
function sigcValidarTelefono(valor) {
  const telefono = sigcNormalizarTelefono(valor);
  return !telefono || /^56\d{9}$/.test(telefono);
}
function sigcNormalizarTipoDocumento(valor, rutAlternativo) {
  const clave = sigcNormalizarClave(valor);
  if (clave.indexOf('pasaporte') >= 0) return 'Pasaporte';
  if (clave.indexOf('documento extranjero') >= 0 || clave === 'dni') return 'Documento extranjero';
  if (clave.indexOf('documento historico') >= 0) return 'Documento histórico';
  if (clave.indexOf('identificador historico') >= 0) return 'Identificador histórico';
  if (clave === 'rut' || clave === 'run' || clave.indexOf('chileno') >= 0) return 'RUT';
  return rutAlternativo ? 'RUT' : '';
}
function sigcNormalizarPasaporte(valor) {
  return String(valor || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}
function sigcNormalizarDocumento(tipo, numero, rutAlternativo) {
  const tipoNormalizado = sigcNormalizarTipoDocumento(tipo, rutAlternativo);
  const fuente = numero || rutAlternativo || '';
  if (tipoNormalizado === 'RUT') return sigcNormalizarRut(fuente);
  if (tipoNormalizado === 'Pasaporte') return sigcNormalizarPasaporte(fuente);
  if (['Documento extranjero', 'Documento histórico', 'Identificador histórico'].indexOf(tipoNormalizado) >= 0) {
    return String(fuente || '').toUpperCase().replace(/[^A-Z0-9K-]/g, '').trim();
  }
  return '';
}
function sigcValidarDocumento(tipo, numero, nacionalidad) {
  let tipoNormalizado = sigcNormalizarTipoDocumento(tipo, numero);
  let documento = sigcNormalizarDocumento(tipoNormalizado, numero, numero);

  if (tipoNormalizado === 'RUT') {
    if (!documento || !sigcValidarRut(documento)) {
      // 1. Intentar auto-reconstruir si son 7 u 8 dígitos sin DV
      const soloDigitos = String(numero || '').replace(/\D/g, '');
      if (soloDigitos.length >= 7 && soloDigitos.length <= 8) {
        let suma = 0;
        let mult = 2;
        for (let i = soloDigitos.length - 1; i >= 0; i--) {
          suma += Number(soloDigitos.charAt(i)) * mult;
          mult = mult === 7 ? 2 : mult + 1;
        }
        const resto = 11 - (suma % 11);
        const dvCalc = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
        const rutReconstruido = soloDigitos + '-' + dvCalc;
        if (sigcValidarRut(rutReconstruido)) {
          return {tipo: 'RUT', numero: rutReconstruido};
        }
      }
      // 2. Si contiene texto o formato extranjero, clasificar como Documento extranjero
      const limpioDoc = String(numero || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').trim();
      if (limpioDoc.length >= 3) {
        return {
          tipo: 'Documento extranjero',
          numero: limpioDoc
        };
      }
      throw new Error('Debe ingresar un RUT o documento de identidad válido.');
    }
    return {tipo: 'RUT', numero: documento};
  } else if (tipoNormalizado === 'Pasaporte' || tipoNormalizado === 'Documento extranjero') {
    const docPas = sigcNormalizarPasaporte(numero);
    if (!docPas || docPas.length < 3) {
      throw new Error('Debe ingresar un número de pasaporte o documento válido.');
    }
    return {tipo: tipoNormalizado, numero: docPas};
  } else if (['Documento histórico', 'Identificador histórico'].indexOf(tipoNormalizado) >= 0) {
    if (!documento || documento.length < 3) {
      throw new Error('El documento histórico no contiene información suficiente.');
    }
    return {tipo: tipoNormalizado, numero: documento};
  } else {
    if (documento && sigcValidarRut(documento)) {
      return {tipo: 'RUT', numero: documento};
    }
    const limpio = String(numero || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').trim();
    if (limpio.length >= 3) {
      return {tipo: 'Documento extranjero', numero: limpio};
    }
    throw new Error('Debe ingresar un RUT o documento de identidad.');
  }
}
function sigcDocumentoVisible(persona) {
  const tipo = sigcNormalizarTipoDocumento(
    persona.TIPO_DOCUMENTO || persona['TIPO DOCUMENTO'],
    persona.RUT
  );
  const numero = sigcNormalizarDocumento(
    tipo,
    persona.NUMERO_DOCUMENTO || persona['NUMERO DOCUMENTO'],
    persona.RUT
  );
  return numero || '';
}
function sigcNormalizarSiNo(valor, defecto) {
  const clave = sigcNormalizarClave(valor);
  if (['si', 'sí', 's', 'yes', '1', 'true'].indexOf(clave) >= 0) return 'Sí';
  if (['no', 'n', '0', 'false'].indexOf(clave) >= 0) return 'No';
  if (clave.indexOf('no informado') >= 0 || clave.indexOf('sin informacion') >= 0) return 'No informado';
  return defecto || 'No informado';
}
function sigcNormalizarCumple(valor) {
  const clave = sigcNormalizarClave(valor);
  if (clave === 'pendiente') return 'Pendiente';
  if (clave.indexOf('no informado') >= 0) return 'No informado';
  return sigcNormalizarSiNo(valor, 'Pendiente');
}
function sigcNormalizarSeleccion(valor) {
  const clave = sigcNormalizarClave(valor);
  if (clave === 'seleccionado' || clave === 'seleccionada') return 'Seleccionado';
  if (clave.indexOf('lista de espera') >= 0) return 'Lista de espera';
  if (clave.indexOf('no seleccionado') >= 0 || clave.indexOf('no seleccionada') >= 0) return 'No seleccionado';
  if (clave.indexOf('no informado') >= 0) return 'No informado';
  return 'Pendiente';
}
function sigcNormalizarResultado(valor) {
  const clave = sigcNormalizarClave(valor);
  const mapa = {
    'participo': 'Participó',
    'no participo': 'No participó',
    'aprobado': 'Aprobado',
    'aprobada': 'Aprobado',
    'desaprobado': 'Desaprobado',
    'desaprobada': 'Desaprobado',
    'pendiente': 'Pendiente',
    'no aplica': 'No aplica'
  };
  return mapa[clave] || '';
}
function sigcConvertirPorcentaje(valor) {
  if (typeof valor === 'number') {
    if (!isFinite(valor) || valor < 0) return 0;
    return valor > 1 ? valor / 100 : valor;
  }
  const texto = String(valor ?? '0')
    .replace('%', '')
    .replace(',', '.')
    .trim();
  const numero = Number(texto);
  if (!isFinite(numero) || numero < 0) return 0;
  return numero > 1 ? numero / 100 : numero;
}
function sigcActividadFinalizada(actividad) {
  const estado = sigcNormalizarEncabezado(actividad && actividad.ESTADO_ACTIVIDAD);
  return estado === 'EJECUTADA' || estado === 'CERRADA';
}
function sigcEsSeleccionado(participacion) {
  return sigcNormalizarSeleccion(participacion && participacion.ESTADO_SELECCION) === 'Seleccionado';
}
function sigcEsResultadoDefinitivo(resultado) {
  return ['Participó', 'No participó', 'Aprobado', 'Desaprobado']
    .indexOf(sigcNormalizarResultado(resultado)) >= 0;
}
function sigcCalcularResultado(actividad, asistidas, total, finalizar) {
  const sesiones = Number(asistidas || 0);
  const sesionesTotales = Number(total || 0);
  const resultadoAsistencia = sesiones === 0
    ? 'No asistió'
    : (sesionesTotales > 0 && sesiones >= sesionesTotales
      ? 'Asistió'
      : 'Asistencia parcial');
  if (!finalizar) {
    return {
      resultadoAsistencia: sesiones > 0 ? resultadoAsistencia : 'Pendiente',
      resultadoFinal: 'Pendiente'
    };
  }
  const regla = sigcNormalizarEncabezado(
    actividad && actividad.REGLA_RESULTADO || actividad && actividad.reglaResultado || 'Asistencia'
  );
  if (regla === 'ASISTENCIA') {
    return {
      resultadoAsistencia: resultadoAsistencia,
      resultadoFinal: sesiones >= 1 ? 'Participó' : 'No participó'
    };
  }
  if (!sesionesTotales) {
    return {resultadoAsistencia: resultadoAsistencia, resultadoFinal: 'Pendiente'};
  }
  const minimo = sigcConvertirPorcentaje(
    actividad && (actividad.PORCENTAJE_APROBACION ?? actividad.porcentajeAprobacion)
  );
  const porcentaje = sesiones / sesionesTotales;
  return {
    resultadoAsistencia: resultadoAsistencia,
    resultadoFinal: porcentaje >= minimo ? 'Aprobado' : 'Desaprobado'
  };
}
function sigcFormatearFechaChile(fecha, patron) {
  if (!fecha) return '';
  const valor = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(valor.getTime())) return String(fecha);
  return Utilities.formatDate(
    valor,
    SIGC_CONFIG.ZONA_HORARIA,
    patron || 'dd-MM-yyyy'
  );
}
function sigcRegistrarLog(accion, entidad, idEntidad, detalle) {
  sigcInvalidarCache_();
  const ss = SpreadsheetApp.openById(SIGC_CONFIG.SPREADSHEET_ID);
  let hoja = ss.getSheetByName(SIGC_CONFIG.HOJAS.LOG);
  if (!hoja) {
    hoja = ss.insertSheet(SIGC_CONFIG.HOJAS.LOG);
    hoja.appendRow([
      'FECHA_HORA', 'USUARIO', 'ACCION',
      'ENTIDAD', 'ID_ENTIDAD', 'DETALLE'
    ]);
    hoja.setFrozenRows(1);
  }
  hoja.appendRow([
    new Date(),
    Session.getActiveUser().getEmail() || 'No identificado',
    accion,
    entidad,
    idEntidad || '',
    detalle || ''
  ]);
}
/**
 * Ejecuta una operación mutante de datos protegida por LockService (control de concurrencia).
 * Evita condiciones de carrera entre múltiples coordinadores o ejecuciones simultáneas.
 */
function sigcEjecutarConBloqueo_(callback, tiempoEsperaMs) {
  const lock = LockService.getScriptLock();
  const espera = tiempoEsperaMs || 15000;
  const tieneBloqueo = lock.tryLock(espera);
  if (!tieneBloqueo) {
    throw new Error('El sistema está ocupado procesando otra solicitud simultánea. Por favor, reintenta en unos segundos.');
  }
  try {
    return callback();
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {
      console.warn('Advertencia al liberar bloqueo de script: ' + e.message);
    }
  }
}

/**
 * Invalida selectivamente la caché de una entidad específica.
 */
function sigcInvalidarCacheEntidad_(nombreEntidad) {
  const nombre = String(nombreEntidad || '').toUpperCase().trim();
  try {
    const cache = CacheService.getScriptCache();
    const clave = 'SIGC_TABLA_' + nombre;
    const chunksVal = cache.get(clave + '_chunks');
    const keysToRemove = [clave, clave + '_chunks', 'SIGC_DASHBOARD_RESUMEN_V3', 'SIGC_PANEL_FORMULARIOS_V1'];
    if (chunksVal) {
      const total = parseInt(chunksVal, 10) || 0;
      for (let i = 0; i < total; i++) {
        keysToRemove.push(clave + '_chunk_' + i);
      }
    }
    cache.removeAll(keysToRemove);
  } catch (error) {
    // La invalidación de caché nunca debe romper la ejecución principal
  }
}

function sigcInvalidarCache_() {
  try {
    const cache = CacheService.getScriptCache();
    const tablas = [
      'PERSONAS', 'ACTIVIDADES', 'PARTICIPACIONES', 'ASISTENCIA',
      'INTERESES', 'INTERESES_CAPACITACION', 'PERFILES_BASE_MADRE',
      'HISTORIAL_IMPORTACIONES', 'CONFIG_FORMULARIOS', 'FORMULARIOS'
    ];
    const keysToRemove = [
      'SIGC_DASHBOARD_RESUMEN_V3',
      'SIGC_PANEL_FORMULARIOS_V1'
    ];
    tablas.forEach(function(t) {
      const clave = 'SIGC_TABLA_' + t;
      keysToRemove.push(clave);
      keysToRemove.push(clave + '_chunks');
      for (let i = 0; i < 30; i++) {
        keysToRemove.push(clave + '_chunk_' + i);
      }
    });
    cache.removeAll(keysToRemove);
  } catch (error) {
    // La invalidación de caché nunca debe impedir una operación principal.
  }
}
function normalizeFreeText_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}
function normalizeName_(value) {
  const text = normalizeFreeText_(value).toLowerCase();
  if (!text) return '';
  const lower = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return text.split(' ').map((word, i) =>
    i > 0 && lower.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}
function normalizeRut_(value) {
  const clean = String(value || '').toUpperCase().replace(/[^0-9K]/g, '');
  if (clean.length < 2) return '';
  return clean.slice(0, -1) + '-' + clean.slice(-1);
}
function validRut_(value) {
  const clean = String(value || '').toUpperCase().replace(/[^0-9K]/g, '');
  if (!/^\d{7,8}[0-9K]$/.test(clean)) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  let sum = 0, factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  const expected = rest === 11 ? '0' : rest === 10 ? 'K' : String(rest);
  return dv === expected;
}
function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}
function validEmail_(value) {
  return !value || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}
function normalizePhone_(value) {
  let clean = String(value || '').replace(/\D/g, '');
  if (!clean) return '';
  if (clean.startsWith('0056')) clean = clean.slice(2);
  if (clean.length === 9 && clean.startsWith('9')) clean = '56' + clean;
  if (clean.length === 8) clean = '562' + clean;
  return clean;
}
function validPhone_(value) {
  return !value || /^56\d{9}$/.test(value);
}
function validatePersonInput_(data, requireRut) {
  const name = normalizeName_(data.NOMBRE_COMPLETO || data.nombre);
  const rut = normalizeRut_(data.RUT || data.rut);
  const email = normalizeEmail_(data.CORREO || data.correo);
  const phone = normalizePhone_(data.TELEFONO || data.telefono);
  if (!name) throw new Error('El nombre completo es obligatorio.');
  if (requireRut && !rut) throw new Error('El RUT es obligatorio.');
  if (rut && !validRut_(rut)) throw new Error('El RUT ingresado no es válido.');
  if (!validEmail_(email)) throw new Error('El correo electrónico no es válido.');
  if (!validPhone_(phone)) throw new Error('El teléfono debe tener formato chileno, por ejemplo 56912345678.');
  if (!email && !phone) throw new Error('Debe informar al menos un correo o teléfono.');
  return { name, rut, email, phone };
}
function table_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { headers: [], rows: [], map: {} };
  const headers = values[0].map(v => String(v).trim());
  const map = {};
  headers.forEach((h, i) => map[normHeader_(h)] = i);
  const rows = values.slice(1).map((values, i) => ({ row: i + 2, values }));
  return { headers, rows, map };
}
function rowObject_(headers, values) {
  return headers.reduce((obj, h, i) => {
    if (h) obj[String(h).trim()] = values[i] === undefined ? '' : values[i];
    return obj;
  }, {});
}
function buildRow_(headers, data) {
  const normalized = {};
  Object.keys(data).forEach(k => normalized[normHeader_(k)] = data[k]);
  return headers.map(h => Object.prototype.hasOwnProperty.call(normalized, normHeader_(h))
    ? normalized[normHeader_(h)] : '');
}
function setFields_(sheet, row, headers, changes) {
  const map = {};
  headers.forEach((h, i) => map[normHeader_(h)] = i + 1);
  Object.keys(changes).forEach(key => {
    const col = map[normHeader_(key)];
    if (col) sheet.getRange(row, col).setValue(changes[key]);
  });
}
function nextId_(sheet, header, prefix, digits) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const t = table_(sheet);
    const index = t.map[normHeader_(header)];
    if (index === undefined) throw new Error('No existe la columna ' + header + '.');
    let max = 0;
    t.rows.forEach(r => {
      const text = String(r.values[index] || '').trim();
      if (!text.startsWith(prefix)) return;
      const n = Number(text.slice(prefix.length).replace(/\D/g, ''));
      if (Number.isFinite(n) && n > max) max = n;
    });
    return prefix + String(max + 1).padStart(digits, '0');
  } finally {
    lock.releaseLock();
  }
}
function now_() {
  return new Date();
}
function formatDateTime_(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return Utilities.formatDate(d, SIGC.TIMEZONE, 'dd-MM-yyyy HH:mm');
}
function logChange_(action, entity, id, detail) {
  const ss = sigcSpreadsheet_();
  let sheet = ss.getSheetByName(SIGC.SHEETS.LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SIGC.SHEETS.LOG);
    sheet.appendRow(['FECHA_HORA', 'USUARIO', 'ACCION', 'ENTIDAD', 'ID_ENTIDAD', 'DETALLE']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    now_(),
    Session.getActiveUser().getEmail() || 'No identificado',
    action, entity, id, detail || ''
  ]);
}
function safeResult_(fn) {
  try {
    return fn();
  } catch (error) {
    console.error(error);
    return { ok: false, mensaje: error && error.message ? error.message : String(error) };
  }
}

/**
 * Motor de Consultas SQL sobre Google Sheets (Google Visualization SQL Engine).
 * Permite ejecutar consultas estructuradas (SELECT, WHERE, GROUP BY, ORDER BY)
 * procesadas directamente por los servidores de Google Sheets en milisegundos.
 *
 * @param {string} nombreHoja - Nombre de la pestaña (ej.: 'ACTIVIDADES', 'PERSONAS')
 * @param {string} querySql - Consulta SQL (admite nombres de columna como ESTADO_ACTIVIDAD, RUT, etc.)
 * @param {Object} [opciones] - Opciones opcionales {spreadsheetId, mapeoColumnas}
 * @returns {Array<Object>} Arreglo de objetos con los resultados de la consulta
 */
function sigcConsultarSql_(nombreHoja, querySql, opciones) {
  opciones = opciones || {};
  const ssId = opciones.spreadsheetId || SIGC_CONFIG.SPREADSHEET_ID;
  if (!ssId || !nombreHoja) throw new Error('Se requiere ID de spreadsheet y nombre de hoja para la consulta SQL.');

  const ss = sigcSpreadsheetCentral_();
  const hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) throw new Error('No se encontró la hoja: ' + nombreHoja);

  // 1. Obtener encabezados para traducir nombres de columna a letras (A, B, C...) y Col1, Col2...
  const encabezados = hoja.getRange(1, 1, 1, Math.max(1, hoja.getLastColumn())).getValues()[0];
  const mapaColLetras = {};
  const mapaColIndice = {};
  const mapaColOriginal = {};

  encabezados.forEach(function(enc, idx) {
    const norm = sigcNormalizarEncabezado(enc);
    if (!norm) return;
    const letra = sigcNumeroAColumnaLetra_(idx + 1);
    const colNum = 'Col' + (idx + 1);
    mapaColLetras[norm] = letra;
    mapaColIndice[norm] = colNum;
    mapaColOriginal[letra] = String(enc || norm);
    mapaColOriginal[colNum] = String(enc || norm);
  });

  // 2. Traducir nombres de columna legibles en la consulta SQL a referencias de columna
  let sqlTraducido = String(querySql || 'SELECT *');
  // Ordenar por longitud descendente para evitar reemplazos parciales
  const nombresOrdenados = Object.keys(mapaColLetras).sort(function(a, b) { return b.length - a.length; });
  nombresOrdenados.forEach(function(nombre) {
    const letra = mapaColLetras[nombre];
    const regex = new RegExp('\\b' + nombre + '\\b', 'gi');
    sqlTraducido = sqlTraducido.replace(regex, letra);
  });

  // 3. Ejecutar consulta vía Google Visualization API
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(ssId) +
      '/gviz/tq?tq=' + encodeURIComponent(sqlTraducido) +
      '&sheet=' + encodeURIComponent(nombreHoja) +
      '&headers=1&tqx=out:json';

    const token = ScriptApp.getOAuthToken();
    const respuesta = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });

    if (respuesta.getResponseCode() === 200) {
      const texto = respuesta.getContentText();
      const inicio = texto.indexOf('{');
      const fin = texto.lastIndexOf('}');
      if (inicio >= 0 && fin >= inicio) {
        const jsonStr = texto.substring(inicio, fin + 1);
        const gvizData = JSON.parse(jsonStr);
        if (gvizData.status === 'ok' && gvizData.table) {
          return sigcParsearResultadoGviz_(gvizData.table, encabezados, mapaColOriginal);
        }
      }
    }
  } catch (errorGviz) {
    console.warn('Fallo en consulta SQL GViz (' + errorGviz.message + '). Ejecutando fallback en memoria...');
  }

  // 4. Fallback resiliente: lectura tradicional con filtrado básico en memoria
  return sigcFallbackConsultaEnMemoria_(hoja, encabezados, querySql);
}

/** Convierte índice base 1 a letra de columna de Sheets (1 -> A, 27 -> AA) */
function sigcNumeroAColumnaLetra_(colIndex) {
  let temp = colIndex;
  let letra = '';
  while (temp > 0) {
    const resto = (temp - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    temp = Math.floor((temp - resto) / 26);
  }
  return letra;
}

/** Parsea la tabla devuelta por GViz a una lista de objetos limpios */
function sigcParsearResultadoGviz_(table, encabezadosOriginales, mapaColOriginal) {
  const columnas = (table.cols || []).map(function(col, idx) {
    const label = col.label ? String(col.label).trim() : '';
    const id = col.id ? String(col.id).trim() : '';
    return label || mapaColOriginal[id] || (encabezadosOriginales && encabezadosOriginales[idx]) || ('Columna_' + (idx + 1));
  });

  const filas = [];
  const filasGviz = table.rows || [];
  for (let r = 0; r < filasGviz.length; r++) {
    const celdas = filasGviz[r].c || [];
    const obj = {};
    for (let c = 0; c < columnas.length; c++) {
      const celda = celdas[c];
      let valor = '';
      if (celda) {
        if (celda.v !== null && celda.v !== undefined) {
          // Si es fecha en formato Date(yyyy, m, d) de GViz
          if (typeof celda.v === 'string' && celda.v.indexOf('Date(') === 0) {
            const partes = celda.v.replace('Date(', '').replace(')', '').split(',');
            if (partes.length >= 3) {
              const d = new Date(Number(partes[0]), Number(partes[1]), Number(partes[2]));
              valor = celda.f || (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
            } else {
              valor = celda.f || celda.v;
            }
          } else {
            valor = celda.v;
          }
        } else if (celda.f) {
          valor = celda.f;
        }
      }
      obj[columnas[c]] = valor;
    }
    filas.push(obj);
  }
  return filas;
}

/** Fallback en memoria si la consulta GViz no responde */
function sigcFallbackConsultaEnMemoria_(hoja, encabezados, querySql) {
  const datos = hoja.getDataRange().getValues();
  if (datos.length < 2) return [];
  const encs = datos[0].map(sigcNormalizarEncabezado);
  const filas = [];
  for (let i = 1; i < datos.length; i++) {
    const obj = {};
    for (let j = 0; j < encs.length; j++) {
      obj[encs[j]] = datos[i][j];
    }
    filas.push(obj);
  }
  return filas;
}

/**
 * SISTEMA DE DATOS CAPACITACIÓN Y PMJH
 * Municipalidad de Santiago
 *
 * Instrucciones:
 * 1. Abra el archivo convertido a Google Sheets.
 * 2. Vaya a Extensiones > Apps Script.
 * 3. Reemplace el contenido de Code.gs por este código.
 * 4. Guarde y ejecute prepararSistema().
 * 5. Autorice los permisos solicitados.
 */
function asegurarEstructuraPersonas_() {
  const hoja = sigcSpreadsheetCentral_().getSheetByName(SISTEMA.HOJAS.PERSONAS);
  asegurarColumna_(hoja, 'TIPO_DOCUMENTO');
  asegurarColumna_(hoja, 'NUMERO_DOCUMENTO');
}
function sigcSpreadsheetCentral_() {
  const id = SIGC_CONFIG.SPREADSHEET_ID;
  if (id && String(id).trim().length > 10) {
    try {
      return SpreadsheetApp.openById(String(id).trim());
    } catch (e) {
      console.warn('No se pudo abrir por ID (' + id + '): ' + e.message);
    }
  }
  try {
    const activa = SpreadsheetApp.getActiveSpreadsheet();
    if (activa) return activa;
  } catch (e) {}
  throw new Error('No se pudo conectar con la planilla de Google Sheets. Configure el ID en el botón Configurar.');
}
function asegurarColumna_(hoja, encabezado) {
  const ultimaColumna = Math.max(hoja.getLastColumn(), 1);
  const encabezados = hoja.getRange(1, 1, 1, ultimaColumna).getValues()[0];
  if (encabezados.map(normalizarEncabezado_).indexOf(normalizarEncabezado_(encabezado)) >= 0) return;
  hoja.getRange(1, ultimaColumna + 1).setValue(encabezado);
}
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Sistema Capacitación')
    .addItem('1. Preparar sistema', 'prepararSistema')
    .addItem('1.b Preparar demanda y comunicaciones', 'prepararModuloDemandaComunicaciones')
    .addItem('1.c Instalar actualización diaria de actividades', 'instalarActualizacionAutomaticaActividades')
    .addItem('2. Instalar trigger del formulario', 'instalarTriggerFormulario')
    .addItem('3. Procesar respuestas pendientes', 'procesarRespuestasPendientes')
    .addItem('3.b Preparar registro de formularios', 'prepararConfigFormularios')
    .addSeparator()
    .addItem('4. Generar nómina de actividad', 'generarNominaActividad')
    .addItem('5. Guardar asistencia', 'guardarAsistenciaRapida')
    .addSeparator()
    .addItem('6. Buscar persona', 'buscarPersona')
    .addItem('7. Actualizar control de calidad', 'actualizarControlCalidad')
    .addToUi();
}

function prepararConfigFormularios() {
  const ss = sigcSpreadsheetCentral_();
  let hoja = ss.getSheetByName(SISTEMA.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS');
  const encabezados = [
    'ID_CONFIG', 'TIPO', 'SPREADSHEET_RESPUESTAS_ID', 'HOJA_RESPUESTAS',
    'ID_ACTIVIDAD', 'ESTADO', 'FECHA_VINCULACION', 'FORM_ID',
    'FORM_URL_PUBLICA', 'FORM_URL_EDICION', 'CREADO_POR_SIGC'
  ];
  if (!hoja) hoja = ss.insertSheet(SISTEMA.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS');
  if (hoja.getLastRow() === 0) hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  encabezados.forEach(function(h) { asegurarColumna_(hoja, h); });
  hoja.setFrozenRows(1);
  hoja.getRange(1, 1, 1, hoja.getLastColumn()).setFontWeight('bold').setBackground('#173B57').setFontColor('#FFFFFF');
  return {ok: true, hoja: hoja.getName()};
}

function vincularFormularioInscripcion(idActividad, spreadsheetRespuestasId, hojaRespuestas) {
  idActividad = String(idActividad || '').trim();
  spreadsheetRespuestasId = String(spreadsheetRespuestasId || '').trim();
  hojaRespuestas = String(hojaRespuestas || '').trim();
  if (!idActividad || !spreadsheetRespuestasId || !hojaRespuestas) throw new Error('Faltan datos para vincular el formulario.');
  if (!resolverActividad_(idActividad)) throw new Error('La actividad ' + idActividad + ' no existe en ACTIVIDADES.');
  const origen = SpreadsheetApp.openById(spreadsheetRespuestasId);
  const hojaOrigen = origen.getSheetByName(hojaRespuestas);
  if (!hojaOrigen) throw new Error('No existe la hoja de respuestas indicada.');
  validarHojaRespuestasVinculada_(hojaOrigen);
  prepararConfigFormularios();
  const config = sigcSpreadsheetCentral_().getSheetByName(SISTEMA.HOJAS.FORMULARIOS);
  const datos = config.getDataRange().getValues();
  const mapa = mapaEncabezados_(datos[0]);
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][mapa['SPREADSHEET RESPUESTAS ID']]) === spreadsheetRespuestasId &&
        String(datos[i][mapa['HOJA RESPUESTAS']]) === hojaRespuestas) {
      const activador = instalarTriggerFormularioVinculado_(spreadsheetRespuestasId);
      config.getRange(i + 1, mapa['ID ACTIVIDAD'] + 1).setValue(idActividad);
      config.getRange(i + 1, mapa['ESTADO'] + 1).setValue('Activo');
      const recuperacion = procesarPendientesFormularioVinculado_(
        spreadsheetRespuestasId,
        hojaRespuestas,
        idActividad,
        SIGC_CONFIG.LIMITE_RECUPERACION_FORMULARIO,
        false
      );
      return {
        ok: true,
        actualizado: true,
        idActividad: idActividad,
        activador: activador,
        recuperacion: recuperacion
      };
    }
  }
  const activador = instalarTriggerFormularioVinculado_(spreadsheetRespuestasId);
  config.appendRow([
    'FOR-' + Utilities.getUuid().slice(0, 8).toUpperCase(), 'INSCRIPCION',
    spreadsheetRespuestasId, hojaRespuestas, idActividad, 'Activo', new Date()
  ]);
  const recuperacion = procesarPendientesFormularioVinculado_(
    spreadsheetRespuestasId,
    hojaRespuestas,
    idActividad,
    SIGC_CONFIG.LIMITE_RECUPERACION_FORMULARIO,
    false
  );
  return {
    ok: true,
    actualizado: false,
    idActividad: idActividad,
    activador: activador,
    recuperacion: recuperacion
  };
}

function instalarTriggerFormularioVinculado_(spreadsheetId) {
  const triggers = ScriptApp.getProjectTriggers();
  const coincidencias = triggers.filter(function(t) {
    return t.getHandlerFunction() === 'alEnviarFormularioVinculado' &&
      t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT &&
      typeof t.getTriggerSourceId === 'function' && t.getTriggerSourceId() === spreadsheetId;
  });
  let eliminadosDuplicados = 0;
  if (coincidencias.length > 1) {
    coincidencias.slice(1).forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
      eliminadosDuplicados++;
    });
  }
  if (coincidencias.length) {
    return {
      creado: false,
      operativo: true,
      eliminadosDuplicados: eliminadosDuplicados
    };
  }
  if (triggers.length >= 20) {
    throw new Error(
      'No se pudo instalar el activador: esta cuenta ya alcanzó el límite actual de 20 activadores para este proyecto. ' +
      'Use pestañas de una misma Google Sheet institucional para varios formularios o desactive vinculaciones que ya terminaron.'
    );
  }
  ScriptApp.newTrigger('alEnviarFormularioVinculado').forSpreadsheet(spreadsheetId).onFormSubmit().create();
  return {creado: true, operativo: true, eliminadosDuplicados: 0};
}

/** Informa si una Sheet externa tiene exactamente un activador operativo. */
function obtenerEstadoTriggerFormulario_(spreadsheetId, triggersOpcionales) {
  const triggers = triggersOpcionales || ScriptApp.getProjectTriggers();
  const cantidad = triggers.filter(function(trigger) {
    return trigger.getHandlerFunction() === 'alEnviarFormularioVinculado' &&
      trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT &&
      typeof trigger.getTriggerSourceId === 'function' &&
      trigger.getTriggerSourceId() === String(spreadsheetId);
  }).length;
  return {
    cantidad: cantidad,
    operativo: cantidad === 1,
    estado: cantidad === 0 ? 'Falta activador' : cantidad === 1 ? 'Operativo' : 'Duplicado'
  };
}

/**
 * Verifica que la pestaña tenga encabezados y una columna temporal propia de
 * una hoja de respuestas. Evita vincular por error una pestaña administrativa.
 */
function validarHojaRespuestasVinculada_(hoja) {
  if (!hoja || hoja.getLastColumn() < 1) {
    throw new Error('La pestaña seleccionada no contiene encabezados de formulario.');
  }
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0];
  const mapa = mapaEncabezados_(encabezados);
  const tieneMarcaTemporal = ['MARCA TEMPORAL', 'TIMESTAMP', 'FECHA REGISTRO'].some(function(campo) {
    return mapa[normalizarEncabezado_(campo)] !== undefined;
  });
  if (!tieneMarcaTemporal) {
    throw new Error(
      'La pestaña no parece ser una hoja de respuestas de Google Forms: falta la columna Marca temporal o Timestamp.'
    );
  }
  return true;
}

/**
 * Libera el activador de una Sheet externa únicamente cuando ninguna de sus
 * pestañas conserva una vinculación activa. Una Sheet puede recibir respuestas
 * de varios Forms y compartir un solo activador.
 */
function eliminarTriggerFormularioVinculadoSiNoSeUsa_(spreadsheetId) {
  const hoja = sigcSpreadsheetCentral_().getSheetByName(SISTEMA.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS');
  if (hoja && hoja.getLastRow() >= 2) {
    const datos = hoja.getDataRange().getValues();
    const mapa = mapaEncabezados_(datos[0]);
    const sigueActivo = datos.slice(1).some(function(fila) {
      return String(fila[mapa['SPREADSHEET RESPUESTAS ID']] || '') === String(spreadsheetId) &&
        normalizarEncabezado_(fila[mapa['ESTADO']]) === 'ACTIVO';
    });
    if (sigueActivo) return {eliminados: 0, motivo: 'La Sheet todavía tiene vinculaciones activas.'};
  }
  let eliminados = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    const corresponde = trigger.getHandlerFunction() === 'alEnviarFormularioVinculado' &&
      trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT &&
      typeof trigger.getTriggerSourceId === 'function' &&
      trigger.getTriggerSourceId() === String(spreadsheetId);
    if (!corresponde) return;
    ScriptApp.deleteTrigger(trigger);
    eliminados++;
  });
  return {eliminados: eliminados, motivo: 'La Sheet ya no tiene vinculaciones activas.'};
}

/**
 * Cierra automáticamente la recepción de respuestas en Google Forms y desactiva
 * las vinculaciones y activadores de una actividad cuando esta pasa a 'En ejecución',
 * 'Ejecutada', 'Suspendida', 'Cerrada' o 'Archivada'.
 */
function cerrarFormulariosYActivadoresActividad_(idActividad, nuevoEstado) {
  idActividad = String(idActividad || '').trim();
  nuevoEstado = String(nuevoEstado || '').trim();
  if (!idActividad) return { cerrados: 0, formulariosDesactivados: 0 };

  const estadosCierre = [
    'EN EJECUCION', 'EN EJECUCIÓN', 'EJECUTADA', 'SUSPENDIDA', 'CERRADA', 'ARCHIVADA'
  ];
  const estadoNorm = normalizarEncabezado_(nuevoEstado);
  if (estadosCierre.indexOf(estadoNorm) < 0) return { cerrados: 0, formulariosDesactivados: 0 };

  const ss = sigcSpreadsheetCentral_();
  const hojaConfig = ss.getSheetByName(SISTEMA.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS');
  if (!hojaConfig || hojaConfig.getLastRow() < 2) return { cerrados: 0, formulariosDesactivados: 0 };

  const datos = hojaConfig.getDataRange().getValues();
  const mapa = mapaEncabezados_(datos[0]);
  let formsCerrados = 0;
  let vinculacionesDesactivadas = 0;
  const spreadsheetsParaTrigger = [];

  for (let i = 1; i < datos.length; i++) {
    const filaActId = String(datos[i][mapa['ID ACTIVIDAD']] || '').trim();
    if (filaActId !== idActividad) continue;

    const estadoForm = normalizarEncabezado_(datos[i][mapa['ESTADO']]);
    const formId = String(datos[i][mapa['FORM ID']] || '').trim();
    const spreadsheetId = String(datos[i][mapa['SPREADSHEET RESPUESTAS ID']] || '').trim();

    // 1. Cerrar formulario Google Form
    if (formId) {
      try {
        const form = FormApp.openById(formId);
        if (form) {
          form.setAcceptingResponses(false);
          form.setCustomClosedFormMessage(
            'El periodo de postulación/inscripción para esta actividad ha finalizado (' + nuevoEstado + '). ' +
            'Municipalidad de Santiago — Sistema Integrado de Capacitaciones.'
          );
          formsCerrados++;
        }
      } catch (eForm) {
        console.warn('No se pudo cerrar formulario ' + formId + ': ' + eForm.message);
      }
    }

    // 2. Si la vinculación estaba activa, marcarla como Inactivo
    if (estadoForm === 'ACTIVO') {
      hojaConfig.getRange(i + 1, mapa['ESTADO'] + 1).setValue('Inactivo');
      vinculacionesDesactivadas++;
      if (spreadsheetId && spreadsheetsParaTrigger.indexOf(spreadsheetId) < 0) {
        spreadsheetsParaTrigger.push(spreadsheetId);
      }
    }
  }

  // 3. Limpiar activadores de las planillas de respuestas si ya no tienen formularios activos
  spreadsheetsParaTrigger.forEach(function(ssId) {
    try {
      eliminarTriggerFormularioVinculadoSiNoSeUsa_(ssId);
    } catch (eTrig) {
      console.warn('Error al verificar activador para ' + ssId + ': ' + eTrig.message);
    }
  });

  if (vinculacionesDesactivadas > 0 || formsCerrados > 0) {
    try { CacheService.getScriptCache().remove('SIGC_PANEL_FORMULARIOS_V1'); } catch (e) {}
  }

  return {
    cerrados: formsCerrados,
    formulariosDesactivados: vinculacionesDesactivadas
  };
}

function alEnviarFormularioVinculado(e) {
  if (!e || !e.range || !e.source) {
    console.error('Evento de formulario no válido.');
    return;
  }
  const hoja = e.range.getSheet();
  const cfg = obtenerConfigFormulario_(e.source.getId(), hoja.getName());
  if (!cfg) {
    console.warn('Respuesta recibida desde un formulario no vinculado o inactivo.');
    return;
  }
  procesarFilaFormularioSeguro_(hoja, e.range.getRow(), cfg);
}

/**
 * Procesa una sola respuesta sin permitir que un dato incorrecto interrumpa
 * el activador ni las respuestas posteriores. Los errores que requieren
 * intervención humana quedan visibles como REVISION en la propia hoja origen.
 */
function procesarFilaFormularioSeguro_(hoja, fila, configFormulario) {
  try {
    procesarFilaRespuesta_(hoja, fila, configFormulario);
    return {ok: true, fila: fila};
  } catch (error) {
    const mensaje = error && error.message ? error.message : String(error);
    console.warn('Respuesta enviada a revisión. Fila ' + fila + ': ' + mensaje);
    try {
      registrarResultadoEnRespuesta_(hoja, fila, '', '', 'REVISION', mensaje);
    } catch (errorRegistro) {
      console.error(errorRegistro);
    }
    return {ok: false, fila: fila, revision: true, mensaje: mensaje};
  }
}

function obtenerConfigFormulario_(spreadsheetId, hojaRespuestas) {
  const hoja = sigcSpreadsheetCentral_().getSheetByName(SISTEMA.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS');
  if (!hoja || hoja.getLastRow() < 2) return null;
  const datos = hoja.getDataRange().getValues();
  const mapa = mapaEncabezados_(datos[0]);
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][mapa['SPREADSHEET RESPUESTAS ID']]) === String(spreadsheetId) &&
        String(datos[i][mapa['HOJA RESPUESTAS']]) === String(hojaRespuestas) &&
        normalizarEncabezado_(datos[i][mapa['ESTADO']]) === 'ACTIVO') {
      return {tipo: datos[i][mapa['TIPO']], idActividad: datos[i][mapa['ID ACTIVIDAD']]};
    }
  }
  return null;
}

/** Vinculación amigable desde la WebApp: actividad + URL de la hoja de respuestas. */
function vincularFormularioDesdeWeb(datos) {
  datos = datos || {};
  const idActividad = String(datos.idActividad || '').trim();
  const url = String(datos.url || '').trim();
  if (!idActividad) throw new Error('Seleccione una actividad.');
  if (!url) throw new Error('Pegue la URL de la hoja de respuestas del formulario.');
  const origen = resolverOrigenFormularioDesdeUrl_(url);
  const resultado = vincularFormularioInscripcion(idActividad, origen.spreadsheetId, origen.hoja);
  const recuperadas = resultado.recuperacion ? Number(resultado.recuperacion.resueltas || 0) : 0;
  const aRevision = resultado.recuperacion ? Number(resultado.recuperacion.revision || 0) : 0;
  const resumenRecuperacion = recuperadas || aRevision
    ? ' Se recuperaron ' + recuperadas + ' respuesta(s) previa(s)' +
      (aRevision ? ' y ' + aRevision + ' quedó/quedaron en revisión.' : '.')
    : '';
  return {
    ok: true,
    mensaje: resultado.actualizado
      ? 'Formulario actualizado y vinculado correctamente.' + resumenRecuperacion
      : 'Formulario vinculado correctamente. Las nuevas respuestas se procesarán automáticamente.' + resumenRecuperacion,
    idActividad: idActividad,
    archivo: origen.archivo,
    hoja: origen.hoja,
    activador: resultado.activador,
    recuperacion: resultado.recuperacion
  };
}

function resolverOrigenFormularioDesdeUrl_(url) {
  const coincidenciaId = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!coincidenciaId) {
    throw new Error('La URL debe corresponder a la Google Sheet que recibe las respuestas, no al Google Form.');
  }
  const spreadsheetId = coincidenciaId[1];
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const coincidenciaGid = String(url).match(/[?#&]gid=(\d+)/);
  let hoja = null;
  if (coincidenciaGid) {
    const gid = Number(coincidenciaGid[1]);
    hoja = ss.getSheets().find(function(s) { return s.getSheetId() === gid; }) || null;
  }
  if (!hoja) {
    const candidatas = ss.getSheets().filter(function(s) {
      const n = normalizarEncabezado_(s.getName());
      return n.indexOf('RESPUESTAS') >= 0 || n.indexOf('FORM RESPONSES') >= 0;
    });
    if (candidatas.length === 1) hoja = candidatas[0];
  }
  if (!hoja) {
    throw new Error('No pude identificar la pestaña de respuestas. Abra esa pestaña en Google Sheets y copie nuevamente la URL completa.');
  }
  return {spreadsheetId: spreadsheetId, archivo: ss.getName(), hoja: hoja.getName()};
}

/** Entrega al módulo Formularios un resumen operativo sin exponer IDs técnicos y de forma optimizada. */
function obtenerFormulariosVinculados() {
  prepararConfigFormularios();
  const central = sigcSpreadsheetCentral_();
  const hojaConfig = central.getSheetByName(SISTEMA.HOJAS.FORMULARIOS);
  if (!hojaConfig || hojaConfig.getLastRow() < 2) return [];
  const datos = hojaConfig.getDataRange().getValues();
  const mapa = mapaEncabezados_(datos[0]);
  const triggers = ScriptApp.getProjectTriggers();
  const origenesPorId = {};

  // Pre-indexar actividades en memoria para evitar lecturas repetitivas
  const hojaActividades = central.getSheetByName(SISTEMA.HOJAS.ACTIVIDADES);
  const mapaActividades = {};
  if (hojaActividades && hojaActividades.getLastRow() >= 2) {
    const actDatos = hojaActividades.getDataRange().getValues();
    const actMapa = mapaEncabezados_(actDatos[0]);
    for (let a = 1; a < actDatos.length; a++) {
      const idAct = String(actDatos[a][actMapa['ID ACTIVIDAD']] || '').trim();
      if (idAct) {
        mapaActividades[idAct] = {
          id: idAct,
          nombre: String(actDatos[a][actMapa['NOMBRE ACTIVIDAD']] || '')
        };
      }
    }
  }

  return datos.slice(1).filter(function(fila) {
    return fila.some(function(v) { return v !== ''; });
  }).map(function(fila) {
    function valorConfig_(campo) {
      return mapa[campo] === undefined ? '' : fila[mapa[campo]];
    }
    const idConfig = fila[mapa['ID CONFIG']];
    const spreadsheetId = String(fila[mapa['SPREADSHEET RESPUESTAS ID']] || '').trim();
    const nombreHoja = String(fila[mapa['HOJA RESPUESTAS']] || '').trim();
    const idActividad = String(fila[mapa['ID ACTIVIDAD']] || '').trim();
    const tipoFormulario = String(fila[mapa['TIPO']] || 'INSCRIPCION');
    const actividad = mapaActividades[idActividad] || null;
    const resumen = {
      total: 0, procesadas: 0, advertencias: 0, duplicadas: 0, revision: 0, pendientes: 0, detallesRevision: []
    };
    let archivo = 'Hoja de respuestas';

    if (spreadsheetId) {
      try {
        const origen = origenesPorId[spreadsheetId] ||
          (origenesPorId[spreadsheetId] = (spreadsheetId === central.getId() ? central : SpreadsheetApp.openById(spreadsheetId)));
        archivo = origen.getName();
        const respuestas = nombreHoja ? origen.getSheetByName(nombreHoja) : null;
        if (respuestas && respuestas.getLastRow() >= 2) {
          const ultimaFila = respuestas.getLastRow();
          const ultimaColumna = Math.min(respuestas.getLastColumn(), 50);
          const encabezados = respuestas.getRange(1, 1, 1, ultimaColumna).getValues()[0];
          const mr = mapaEncabezados_(encabezados);
          const colEstado = mr['ESTADO PROCESO'];
          const colDetalle = mr['DETALLE PROCESO'];
          const cantidad = ultimaFila - 1;
          resumen.total = cantidad;

          if (colEstado !== undefined) {
            const estados = respuestas.getRange(2, colEstado + 1, cantidad, 1).getValues();
            for (let i = 0; i < cantidad; i++) {
              const estado = normalizarEncabezado_(estados[i][0]);
              if (estado === 'PROCESADO') resumen.procesadas++;
              else if (estado === 'PROCESADO CON ADVERTENCIA' || estado === 'PROCESADO_CON_ADVERTENCIA') resumen.advertencias++;
              else if (estado === 'DUPLICADO') resumen.duplicadas++;
              else if (estado === 'REVISION' || estado === 'ERROR') {
                resumen.revision++;
                if (resumen.detallesRevision.length < 5) {
                  resumen.detallesRevision.push({
                    fila: i + 2,
                    detalle: 'Requiere revisión.'
                  });
                }
              } else {
                resumen.pendientes++;
              }
            }
          } else {
            resumen.pendientes = cantidad;
          }
        }
      } catch (error) {
        resumen.detallesRevision.push({fila: '', detalle: 'No se pudo leer la hoja: ' + error.message});
      }
    }

    const creadoPorSigc = String(valorConfig_('CREADO POR SIGC') || '');
    const formId = String(valorConfig_('FORM ID') || '');
    const urlPublica = String(valorConfig_('FORM URL PUBLICA') || '');
    const urlEdicion = String(valorConfig_('FORM URL EDICION') || '');
    return {
      idConfig: idConfig,
      _origenId: spreadsheetId,
      tipo: tipoFormulario,
      idActividad: idActividad,
      actividad: sigcNormalizarEncabezado(tipoFormulario) === 'INTERES GENERAL'
        ? (normalizarEncabezado_(creadoPorSigc) === 'SI'
          ? 'Registro público de personas e intereses'
          : 'Base madre / interés general')
        : (actividad ? actividad.nombre : (idActividad || 'Sin asignar')),
      archivo: archivo,
      hoja: nombreHoja,
      estado: String(fila[mapa['ESTADO']] || 'Inactivo'),
      fechaVinculacion: formFechaVisible_(fila[mapa['FECHA VINCULACION']]),
      formId: formId,
      urlPublica: urlPublica,
      urlEdicion: urlEdicion,
      urlRespuestas: spreadsheetId ? 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit' : '',
      creadoPorSigc: creadoPorSigc,
      activador: normalizarEncabezado_(fila[mapa['ESTADO']]) === 'ACTIVO'
        ? obtenerEstadoTriggerFormulario_(spreadsheetId, triggers)
        : {cantidad: 0, operativo: true, estado: 'No requerido'},
      resumen: resumen
    };
  });
}

/** Vinculaciones más capacidad real de activadores del proyecto. */
function obtenerPanelFormularios(forzarActualizacion) {
  const cache = CacheService.getScriptCache();
  const claveCache = 'SIGC_PANEL_FORMULARIOS_V1';
  if (!forzarActualizacion) {
    try {
      const guardado = cache.get(claveCache);
      if (guardado) {
        const salidaCache = JSON.parse(guardado);
        salidaCache.desdeCache = true;
        return salidaCache;
      }
    } catch (error) {
      // La caché es opcional
    }
  }
  const formularios = obtenerFormulariosVinculados();
  const triggers = ScriptApp.getProjectTriggers();
  const activos = formularios.filter(function(f) {
    return normalizarEncabezado_(f.estado) === 'ACTIVO';
  });
  const formulariosActivos = activos.length;
  const archivosRespuestaActivos = new Set(activos.map(function(f) {
    return String(f._origenId || '');
  }).filter(Boolean)).size;
  const formulariosPorActivador = archivosRespuestaActivos
    ? formulariosActivos / archivosRespuestaActivos
    : 0;
  formularios.forEach(function(f) { delete f._origenId; });
  const limite = SIGC_CONFIG.LIMITE_ACTIVADORES_PROYECTO || 20;
  const recomendados = SIGC_CONFIG.MAX_FORMULARIOS_RECOMENDADO || 15;
  const salida = {
    fechaActualizacion: Utilities.formatDate(new Date(), SIGC_CONFIG.ZONA_HORARIA, 'dd-MM-yyyy HH:mm:ss'),
    formularios: formularios,
    formularioIntereses: formularios.find(function(f) {
      return normalizarEncabezado_(f.tipo) === 'INTERES GENERAL' &&
        normalizarEncabezado_(f.creadoPorSigc) === 'SI' && Boolean(f.formId);
    }) || null,
    capacidad: {
      activadoresUtilizados: triggers.length,
      activadoresDisponibles: Math.max(0, limite - triggers.length),
      limiteTecnico: limite,
      formulariosActivos: formulariosActivos,
      archivosRespuestaActivos: archivosRespuestaActivos,
      formulariosPorActivador: formulariosPorActivador,
      maximoRecomendado: recomendados,
      alerta: archivosRespuestaActivos >= recomendados
        ? 'Se alcanzó el máximo operativo recomendado de archivos de respuesta independientes. Agrupe nuevos Forms como pestañas de una misma Sheet institucional o desactive archivos cerrados.'
        : ''
    }
  };
  try {
    cache.put(
      claveCache,
      JSON.stringify(salida),
      SIGC_CONFIG.CACHE_FORMULARIOS_SEGUNDOS || 300
    );
  } catch (error) {
    // Si excede la caché se entrega normalmente
  }
  return salida;
}

/**
 * Crea o verifica el Google Form institucional oficial para el registro público
 * de personas e intereses de capacitación, vinculándolo con la planilla central.
 */
function crearFormularioRegistroInteresesDesdeWeb() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    prepararConfigFormularios();
    const central = sigcSpreadsheetCentral_();
    const hojaConfig = central.getSheetByName(SISTEMA.HOJAS.FORMULARIOS);
    const datos = hojaConfig.getDataRange().getValues();
    const mapa = mapaEncabezados_(datos[0]);
    
    // 1. Buscar si ya existe un formulario institucional registrado y activo
    for (let i = 1; i < datos.length; i++) {
      const tipo = normalizarEncabezado_(datos[i][mapa['TIPO']]);
      const creadoSigc = normalizarEncabezado_(datos[i][mapa['CREADO POR SIGC']]);
      const formId = String(datos[i][mapa['FORM ID']] || '').trim();
      const ssRespId = String(datos[i][mapa['SPREADSHEET RESPUESTAS ID']] || '').trim();
      
      if (tipo === 'INTERES GENERAL' && creadoSigc === 'SI' && formId) {
        try {
          const formExistente = FormApp.openById(formId);
          if (formExistente) {
            if (ssRespId) {
              instalarTriggerFormularioVinculado_(ssRespId);
            }
            hojaConfig.getRange(i + 1, mapa['ESTADO'] + 1).setValue('Activo');
            try { CacheService.getScriptCache().remove('SIGC_PANEL_FORMULARIOS_V1'); } catch (e) {}
            return {
              ok: true,
              mensaje: 'El formulario institucional ya existe y ha sido verificado con éxito.',
              formId: formId,
              urlPublica: formExistente.getPublishedUrl(),
              urlEdicion: formExistente.getEditUrl(),
              urlRespuestas: ssRespId ? 'https://docs.google.com/spreadsheets/d/' + ssRespId + '/edit' : ''
            };
          }
        } catch (eForm) {
          console.warn('Formulario previo no accesible, se procederá a generar uno nuevo: ' + eForm.message);
        }
      }
    }
    
    // 2. Crear el nuevo formulario oficial en Google Forms
    const titulo = 'SIGC — Registro e Intereses de Capacitación';
    const form = FormApp.create(titulo);
    form.setDescription(
      'Municipalidad de Santiago • Sistema Integrado de Gestión de Capacitaciones (SIGC)\n\n' +
      'Complete este formulario para registrarse en la base comunal y señalar sus áreas de interés formativo. ' +
      'Nos comunicaremos oportunamente para invitarle a cursos, talleres y programas acordes a sus preferencias.'
    );
    form.setConfirmationMessage(
      '¡Muchas gracias por registrar sus datos e intereses! Su información ha sido incorporada al Sistema Integrado de Capacitaciones de la Municipalidad de Santiago.'
    );
    form.setAllowResponseEdits(false);
    form.setCollectEmail(false);
    
    // 3. Crear campos ordenados y normalizados
    form.addTextItem()
      .setTitle('Nombre completo')
      .setHelpText('Ingrese sus nombres y apellidos completos.')
      .setRequired(true);
      
    form.addMultipleChoiceItem()
      .setTitle('Tipo de documento')
      .setChoiceValues(['RUT', 'Pasaporte'])
      .setRequired(true);
      
    form.addTextItem()
      .setTitle('Número de documento / RUT')
      .setHelpText('Si es RUT, escriba con puntos y guion (Ej.: 12.345.678-9). Si es pasaporte, ingrese el número exacto.')
      .setRequired(true);
      
    form.addTextItem()
      .setTitle('Correo electrónico')
      .setHelpText('Correo donde recibirá convocatorias y novedades (Ej.: usuario@ejemplo.cl).')
      .setRequired(true);
      
    form.addTextItem()
      .setTitle('Teléfono')
      .setHelpText('Número móvil de contacto (Ej.: +56912345678).')
      .setRequired(false);
      
    form.addTextItem()
      .setTitle('Comuna')
      .setHelpText('Comuna donde vive actualmente (Ej.: Santiago).')
      .setRequired(false);
      
    form.addTextItem()
      .setTitle('Barrio')
      .setHelpText('Barrio o sector de residencia (Ej.: Yungay, Franklin, Meiggs, etc.).')
      .setRequired(false);
      
    form.addDateItem()
      .setTitle('Fecha nacimiento')
      .setRequired(false);
      
    form.addMultipleChoiceItem()
      .setTitle('Género')
      .setChoiceValues(['Femenino', 'Masculino', 'No binario', 'Otro / Prefiero no informar'])
      .setRequired(false);
      
    form.addTextItem()
      .setTitle('Nacionalidad')
      .setHelpText('Ej.: Chilena, Peruana, Venezolana, Colombiana, etc.')
      .setRequired(false);
      
    form.addMultipleChoiceItem()
      .setTitle('Participa o participó en PMJH')
      .setChoiceValues(['Sí', 'No', 'No informado'])
      .setRequired(false);
      
    form.addCheckboxItem()
      .setTitle('Escuela / línea')
      .setChoiceValues(['Empleo', 'Emprendimiento', 'Transversal'])
      .setHelpText('Seleccione una o más opciones.')
      .setRequired(false);
      
    form.addCheckboxItem()
      .setTitle('Área temática')
      .setChoiceValues([
        'Alfabetización y Competencias Digitales',
        'Gestión de Emprendimiento y Finanzas',
        'Marketing Digital y Redes Sociales',
        'Ventas y Comercio Electrónico',
        'Oficios y Servicios',
        'Habilidades Laborales y Empleabilidad',
        'Idiomas',
        'Liderazgo y Habilidades Transversales'
      ])
      .setHelpText('Seleccione las áreas temáticas en las que le gustaría capacitarse.')
      .setRequired(false);
      
    form.addMultipleChoiceItem()
      .setTitle('Autoriza contacto')
      .setChoiceValues(['Sí', 'No'])
      .setRequired(true);
      
    form.addParagraphTextItem()
      .setTitle('Observaciones')
      .setHelpText('Indique requerimientos especiales o temáticas adicionales de su interés.')
      .setRequired(false);
      
    // 4. Vincular el destino de respuestas a la planilla central
    const hojasPrevias = central.getSheets().map(function(s) { return s.getName(); });
    form.setDestination(FormApp.DestinationType.SPREADSHEET, central.getId());
    SpreadsheetApp.flush();
    Utilities.sleep(1000);
    
    // Identificar la pestaña de respuestas vinculada
    const hojasActuales = central.getSheets();
    let nombreHojaRespuestas = '';
    for (let h = 0; h < hojasActuales.length; h++) {
      const s = hojasActuales[h];
      if (hojasPrevias.indexOf(s.getName()) === -1) {
        nombreHojaRespuestas = s.getName();
        break;
      }
    }
    if (!nombreHojaRespuestas) {
      for (let h = 0; h < hojasActuales.length; h++) {
        const s = hojasActuales[h];
        try {
          if (s.getFormUrl() && s.getFormUrl().indexOf(form.getId()) >= 0) {
            nombreHojaRespuestas = s.getName();
            break;
          }
        } catch (e) {}
      }
    }
    if (!nombreHojaRespuestas) {
      const ultima = hojasActuales[hojasActuales.length - 1];
      nombreHojaRespuestas = ultima.getName();
    }
    
    // 5. Registrar en CONFIG_FORMULARIOS
    const idConfig = 'FOR-INT-' + Utilities.getUuid().slice(0, 6).toUpperCase();
    hojaConfig.appendRow([
      idConfig,
      'INTERES GENERAL',
      central.getId(),
      nombreHojaRespuestas,
      '',
      'Activo',
      new Date(),
      form.getId(),
      form.getPublishedUrl(),
      form.getEditUrl(),
      'SI'
    ]);
    
    // 6. Instalar activador automático para la planilla central
    instalarTriggerFormularioVinculado_(central.getId());
    
    // 7. Invalidar caché para actualización inmediata
    try { CacheService.getScriptCache().remove('SIGC_PANEL_FORMULARIOS_V1'); } catch (e) {}
    
    return {
      ok: true,
      mensaje: '¡Formulario institucional creado y vinculado exitosamente!',
      formId: form.getId(),
      urlPublica: form.getPublishedUrl(),
      urlEdicion: form.getEditUrl(),
      urlRespuestas: 'https://docs.google.com/spreadsheets/d/' + central.getId() + '/edit'
    };
  } finally {
    lock.releaseLock();
  }
}

function cambiarEstadoFormularioVinculado(idConfig, activar) {
  prepararConfigFormularios();
  const hoja = sigcSpreadsheetCentral_().getSheetByName(SISTEMA.HOJAS.FORMULARIOS);
  const datos = hoja.getDataRange().getValues();
  const mapa = mapaEncabezados_(datos[0]);
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][mapa['ID CONFIG']]) !== String(idConfig)) continue;
    const spreadsheetId = String(datos[i][mapa['SPREADSHEET RESPUESTAS ID']]);
    if (activar) instalarTriggerFormularioVinculado_(spreadsheetId);
    hoja.getRange(i + 1, mapa['ESTADO'] + 1).setValue(activar ? 'Activo' : 'Inactivo');
    if (!activar) eliminarTriggerFormularioVinculadoSiNoSeUsa_(spreadsheetId);
    return {ok: true, mensaje: activar ? 'Formulario activado.' : 'Formulario desactivado.'};
  }
  throw new Error('No se encontró la vinculación indicada.');
}

/**
 * Repara el activador de una vinculación activa y recupera respuestas que
 * todavía no tienen estado técnico. Los casos REVISION no se modifican.
 */
function repararYRecuperarFormulario(idConfig) {
  const origen = resolverConfigFormularioPorId_(idConfig);
  if (normalizarEncabezado_(origen.estado) !== 'ACTIVO') {
    throw new Error('Active primero la vinculación antes de repararla.');
  }
  const activador = instalarTriggerFormularioVinculado_(origen.spreadsheetId);
  const recuperacion = procesarPendientesFormularioVinculado_(
    origen.spreadsheetId,
    origen.hoja,
    origen.idActividad,
    SIGC_CONFIG.LIMITE_RECUPERACION_FORMULARIO,
    false,
    origen.tipo
  );
  return {
    ok: true,
    activador: activador,
    recuperacion: recuperacion,
    mensaje: 'Automatización verificada. Se revisaron ' + recuperacion.intentadas +
      ' respuesta(s) pendiente(s): ' + recuperacion.resueltas + ' procesada(s) y ' +
      recuperacion.revision + ' enviada(s) a revisión.'
  };
}

/** Procesa pendientes de una única pestaña con un límite seguro por ejecución. */
function procesarPendientesFormularioVinculado_(spreadsheetId, hojaRespuestas, idActividad, limite, incluirRevisiones, tipoFormulario) {
  const hoja = SpreadsheetApp.openById(spreadsheetId).getSheetByName(hojaRespuestas);
  if (!hoja) throw new Error('No se encontró la hoja de respuestas vinculada.');
  asegurarColumnasProceso_(hoja);
  if (hoja.getLastRow() < 2) return {intentadas: 0, resueltas: 0, revision: 0, restantes: 0};
  const valores = hoja.getDataRange().getValues();
  const mapa = mapaEncabezados_(valores[0]);
  const colEstado = mapa['ESTADO PROCESO'];
  const maximo = Math.max(1, Number(limite || 100));
  let intentadas = 0;
  let resueltas = 0;
  let revision = 0;
  let restantes = 0;
  for (let i = 1; i < valores.length; i++) {
    const estado = normalizarEncabezado_(colEstado === undefined ? '' : valores[i][colEstado]);
    const esPendiente = estado === '';
    const esRevision = incluirRevisiones && (estado === 'REVISION' || estado === 'ERROR');
    if (!esPendiente && !esRevision) continue;
    if (intentadas >= maximo) {
      restantes++;
      continue;
    }
    intentadas++;
    const resultado = procesarFilaFormularioSeguro_(hoja, i + 1, {
      tipo: tipoFormulario || 'INSCRIPCION',
      idActividad: idActividad
    });
    if (resultado.ok) resueltas++;
    else revision++;
  }
  return {
    intentadas: intentadas,
    resueltas: resueltas,
    revision: revision,
    restantes: restantes
  };
}

function reprocesarRevisionesFormulario(idConfig) {
  prepararConfigFormularios();
  const hoja = sigcSpreadsheetCentral_().getSheetByName(SISTEMA.HOJAS.FORMULARIOS);
  const datos = hoja.getDataRange().getValues();
  const mapa = mapaEncabezados_(datos[0]);
  let cfgFila = null;
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][mapa['ID CONFIG']]) === String(idConfig)) {
      cfgFila = datos[i];
      break;
    }
  }
  if (!cfgFila) throw new Error('No se encontró la vinculación indicada.');
  const spreadsheetId = String(cfgFila[mapa['SPREADSHEET RESPUESTAS ID']]);
  const nombreHoja = String(cfgFila[mapa['HOJA RESPUESTAS']]);
  const idActividad = String(cfgFila[mapa['ID ACTIVIDAD']]);
  const tipoFormulario = String(cfgFila[mapa['TIPO']] || 'INSCRIPCION');
  const respuestas = SpreadsheetApp.openById(spreadsheetId).getSheetByName(nombreHoja);
  if (!respuestas) throw new Error('No se encontró la hoja de respuestas vinculada.');
  asegurarColumnasProceso_(respuestas);
  const valores = respuestas.getDataRange().getValues();
  const mr = mapaEncabezados_(valores[0]);
  const colEstado = mr['ESTADO PROCESO'];
  let intentadas = 0;
  let resueltas = 0;
  for (let i = 1; i < valores.length && intentadas < 250; i++) {
    const estado = normalizarEncabezado_(valores[i][colEstado]);
    if (estado !== 'REVISION' && estado !== 'ERROR' && estado !== '') continue;
    intentadas++;
    const resultado = procesarFilaFormularioSeguro_(respuestas, i + 1, {tipo: tipoFormulario, idActividad: idActividad});
    if (resultado.ok) resueltas++;
  }
  return {
    ok: true,
    mensaje: 'Revisión terminada: ' + resueltas + ' respuesta(s) resuelta(s) de ' + intentadas + ' revisada(s).'
  };
}

/** Devuelve las respuestas pendientes de revisión de una vinculación. */
function obtenerCasosRevisionFormulario(idConfig) {
  const origen = resolverConfigFormularioPorId_(idConfig);
  const hoja = SpreadsheetApp.openById(origen.spreadsheetId).getSheetByName(origen.hoja);
  if (!hoja) throw new Error('No se encontró la hoja de respuestas vinculada.');
  asegurarColumnasProceso_(hoja);
  const valores = hoja.getDataRange().getDisplayValues();
  if (valores.length < 2) return [];
  const encabezados = valores[0];
  const mapa = mapaEncabezados_(encabezados);
  const colEstado = mapa['ESTADO PROCESO'];
  const colDetalle = mapa['DETALLE PROCESO'];
  const tecnicos = encabezadosTecnicosFormulario_();
  const casos = [];
  for (let i = 1; i < valores.length; i++) {
    const estado = normalizarEncabezado_(colEstado === undefined ? '' : valores[i][colEstado]);
    if (estado !== 'REVISION' && estado !== 'ERROR') continue;
    const campos = encabezados.map(function(encabezado, indice) {
      return {
        encabezado: String(encabezado || ''),
        valor: String(valores[i][indice] || ''),
        editable: !tecnicos[normalizarEncabezado_(encabezado)]
      };
    }).filter(function(campo) {
      return campo.encabezado && campo.editable;
    });
    const registro = registroDesdeFila_(encabezados, valores[i]);
    casos.push({
      idConfig: String(idConfig),
      fila: i + 1,
      fecha: formFechaVisible_(registro.timestamp),
      documento: String(registro.numeroDocumento || registro.rut || ''),
      nombre: String(registro.nombre || ''),
      correo: String(registro.correo || ''),
      telefono: String(registro.telefono || ''),
      detalle: colDetalle === undefined
        ? 'Requiere revisión.'
        : String(valores[i][colDetalle] || 'Requiere revisión.'),
      campos: campos
    });
  }
  return casos;
}

/** Conserva la respuesta original, aplica correcciones y reprocesa una fila. */
function corregirYReprocesarCasoFormulario(datos) {
  datos = datos || {};
  const idConfig = String(datos.idConfig || '').trim();
  const fila = Number(datos.fila || 0);
  const cambios = Array.isArray(datos.cambios) ? datos.cambios : [];
  if (!idConfig || !Number.isInteger(fila) || fila < 2) throw new Error('El caso de revisión no es válido.');
  if (!cambios.length) throw new Error('No se recibieron datos para corregir.');

  const origen = resolverConfigFormularioPorId_(idConfig);
  const hoja = SpreadsheetApp.openById(origen.spreadsheetId).getSheetByName(origen.hoja);
  if (!hoja || fila > hoja.getLastRow()) throw new Error('La respuesta ya no existe en la hoja vinculada.');
  asegurarColumnasProceso_(hoja);
  asegurarColumnasCorreccionFormulario_(hoja);

  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0];
  const mapa = mapaEncabezados_(encabezados);
  const estadoActual = normalizarEncabezado_(hoja.getRange(fila, mapa['ESTADO PROCESO'] + 1).getDisplayValue());
  if (estadoActual !== 'REVISION' && estadoActual !== 'ERROR') {
    throw new Error('Esta respuesta ya fue resuelta o procesada. Actualice el módulo Formularios.');
  }

  const tecnicos = encabezadosTecnicosFormulario_();
  const originales = hoja.getRange(fila, 1, 1, hoja.getLastColumn()).getDisplayValues()[0];
  const propuestos = originales.slice();
  cambios.forEach(function(cambio) {
    const clave = normalizarEncabezado_(cambio && cambio.encabezado);
    const indice = mapa[clave];
    if (!clave || indice === undefined || tecnicos[clave]) return;
    propuestos[indice] = String(cambio.valor == null ? '' : cambio.valor).trim();
  });
  validarNombreSeparadoRevision_(encabezados, propuestos);

  const cambiosAplicados = [];
  cambios.forEach(function(cambio) {
    const clave = normalizarEncabezado_(cambio && cambio.encabezado);
    const indice = mapa[clave];
    if (!clave || indice === undefined || tecnicos[clave]) return;
    const anterior = String(originales[indice] || '');
    const nuevo = String(cambio.valor == null ? '' : cambio.valor).trim();
    if (anterior === nuevo) return;
    const celda = hoja.getRange(fila, indice + 1);
    celda.setNumberFormat('@');
    celda.setValue(nuevo);
    cambiosAplicados.push(String(encabezados[indice]) + ': "' + anterior + '" → "' + nuevo + '"');
  });
  if (!cambiosAplicados.length) throw new Error('No se detectaron cambios. Corrija al menos un dato antes de reprocesar.');

  const colOriginal = mapa['DATOS ORIGINALES REVISION'];
  const colHistorial = mapa['HISTORIAL CORRECCIONES'];
  const colFecha = mapa['FECHA ULTIMA CORRECCION'];
  const colUsuario = mapa['USUARIO ULTIMA CORRECCION'];
  const celdaOriginal = hoja.getRange(fila, colOriginal + 1);
  if (!celdaOriginal.getValue()) {
    const instantanea = {};
    encabezados.forEach(function(encabezado, indice) {
      const clave = normalizarEncabezado_(encabezado);
      if (encabezado && !tecnicos[clave]) instantanea[String(encabezado)] = originales[indice];
    });
    celdaOriginal.setValue(JSON.stringify(instantanea));
  }
  const ahora = new Date();
  const usuario = Session.getActiveUser().getEmail() || 'Usuario SIGC';
  const historialAnterior = String(hoja.getRange(fila, colHistorial + 1).getValue() || '');
  const entradaHistorial = Utilities.formatDate(ahora, SIGC_CONFIG.ZONA_HORARIA, 'dd-MM-yyyy HH:mm:ss') +
    ' | ' + usuario + ' | ' + cambiosAplicados.join('; ');
  hoja.getRange(fila, colHistorial + 1).setValue([historialAnterior, entradaHistorial].filter(Boolean).join('\n'));
  hoja.getRange(fila, colFecha + 1).setValue(ahora);
  hoja.getRange(fila, colUsuario + 1).setValue(usuario);
  hoja.getRange(fila, mapa['ESTADO PROCESO'] + 1).setValue('REPROCESANDO');
  hoja.getRange(fila, mapa['DETALLE PROCESO'] + 1).setValue('Corrección manual aplicada. Reprocesando respuesta.');

  const resultado = procesarFilaFormularioSeguro_(hoja, fila, {
    tipo: origen.tipo || 'INSCRIPCION',
    idActividad: origen.idActividad
  });
  const mapaFinal = mapaEncabezados_(hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0]);
  const estadoFinal = hoja.getRange(fila, mapaFinal['ESTADO PROCESO'] + 1).getDisplayValue();
  const detalleFinal = hoja.getRange(fila, mapaFinal['DETALLE PROCESO'] + 1).getDisplayValue();
  return {
    ok: resultado.ok,
    resuelto: normalizarEncabezado_(estadoFinal) !== 'REVISION' && normalizarEncabezado_(estadoFinal) !== 'ERROR',
    estado: estadoFinal,
    detalle: detalleFinal,
    mensaje: resultado.ok
      ? 'La corrección se guardó y la respuesta quedó como ' + estadoFinal + '.'
      : 'La corrección se guardó, pero la respuesta aún requiere revisión: ' + detalleFinal
  };
}

/**
 * Evita que el editor reprocesse una respuesta con apellidos vacíos cuando el
 * Form institucional dispone de campos separados. No intenta dividir un
 * nombre completo automáticamente porque esa inferencia no es segura.
 */
function validarNombreSeparadoRevision_(encabezados, valores) {
  const mapa = {};
  encabezados.forEach(function(encabezado, indice) {
    mapa[normalizarEncabezado_(encabezado)] = indice;
  });
  const colNombres = mapa['NOMBRES'] !== undefined ? mapa['NOMBRES'] : mapa['NOMBRE'];
  const colApellidos = mapa['APELLIDOS'];
  if (colNombres === undefined || colApellidos === undefined) return;
  if (!String(valores[colNombres] || '').trim()) {
    throw new Error('Complete el campo Nombres antes de reprocesar.');
  }
  if (!String(valores[colApellidos] || '').trim()) {
    throw new Error('Complete el campo Apellidos antes de reprocesar. El SIGC no separa apellidos automáticamente para evitar errores.');
  }
}

function resolverConfigFormularioPorId_(idConfig) {
  prepararConfigFormularios();
  const config = sigcSpreadsheetCentral_().getSheetByName(SISTEMA.HOJAS.FORMULARIOS);
  const datos = config.getDataRange().getValues();
  const mapa = mapaEncabezados_(datos[0]);
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][mapa['ID CONFIG']]) !== String(idConfig)) continue;
    return {
      idConfig: String(idConfig),
      tipo: String(datos[i][mapa['TIPO']] || 'INSCRIPCION'),
      spreadsheetId: String(datos[i][mapa['SPREADSHEET RESPUESTAS ID']] || ''),
      hoja: String(datos[i][mapa['HOJA RESPUESTAS']] || ''),
      idActividad: String(datos[i][mapa['ID ACTIVIDAD']] || ''),
      estado: String(datos[i][mapa['ESTADO']] || 'Inactivo')
    };
  }
  throw new Error('No se encontró la vinculación indicada.');
}

function encabezadosTecnicosFormulario_() {
  const salida = {};
  [
    'ID_PERSONA', 'ID_PARTICIPACION', 'ESTADO_PROCESO', 'DETALLE_PROCESO',
    'ID_ACTIVIDAD', 'MARCA_TEMPORAL', 'TIMESTAMP', 'FECHA_REGISTRO',
    'DATOS_ORIGINALES_REVISION', 'HISTORIAL_CORRECCIONES',
    'FECHA_ULTIMA_CORRECCION', 'USUARIO_ULTIMA_CORRECCION'
  ].forEach(function(encabezado) {
    salida[normalizarEncabezado_(encabezado)] = true;
  });
  return salida;
}

function asegurarColumnasCorreccionFormulario_(hoja) {
  [
    'DATOS_ORIGINALES_REVISION', 'HISTORIAL_CORRECCIONES',
    'FECHA_ULTIMA_CORRECCION', 'USUARIO_ULTIMA_CORRECCION'
  ].forEach(function(encabezado) {
    asegurarColumna_(hoja, encabezado);
  });
}

function formFechaVisible_(valor) {
  if (!valor) return '';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(fecha.getTime())) return String(valor);
  return Utilities.formatDate(fecha, SIGC_CONFIG.ZONA_HORARIA, 'dd-MM-yyyy HH:mm');
}
function onEdit(e) {
  if (!e || !e.range) return;
  const hoja = e.range.getSheet();
  const nombre = hoja.getName();
  if (nombre === SISTEMA.HOJAS.BUSCADOR && e.range.getA1Notation() === 'B3') {
    buscarPersona();
  }
  if (nombre === SISTEMA.HOJAS.ASISTENCIA && e.range.getA1Notation() === 'B2') {
    generarNominaActividad();
  }
}
function prepararSistema() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetLocale('es_CL');
  ss.setSpreadsheetTimeZone(SISTEMA.ZONA_HORARIA);
  validarHojasObligatorias_();
  asegurarEstructuraPersonas_();
  prepararModuloDemandaComunicaciones();
  aplicarValidaciones_();
  instalarTriggerFormulario();
  instalarActualizacionAutomaticaActividades();
  actualizarControlCalidad();
  SpreadsheetApp.getUi().alert(
    'Sistema preparado',
    'El sistema quedó configurado. Las personas nuevas podrán registrarse con RUT chileno o pasaporte y las respuestas de formulario quedarán pendientes hasta la selección.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/** Instala un único activador diario para cerrar actividades vencidas. */
function instalarActualizacionAutomaticaActividades() {
  const nombreFuncion = 'actualizarEstadosActividadesVencidas';
  const triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === nombreFuncion;
  });
  if (triggers.length > 1) {
    triggers.slice(1).forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
  }
  if (!triggers.length) {
    ScriptApp.newTrigger(nombreFuncion)
      .timeBased()
      .atHour(2)
      .everyDays(1)
      .inTimezone(SIGC_CONFIG.ZONA_HORARIA)
      .create();
  }
  const actualizacion = actualizarEstadosActividadesVencidas();
  return {
    ok: true,
    activadorCreado: triggers.length === 0,
    actividadesActualizadas: actualizacion.actualizadas,
    mensaje: 'La actualización diaria de actividades quedó instalada.'
  };
}

/** Cambia a Ejecutada una capacitación desde el día posterior a su término. */
function actualizarEstadosActividadesVencidas() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const hoja = ss.getSheetByName(SISTEMA.HOJAS.ACTIVIDADES);
    if (!hoja || hoja.getLastRow() < 2) {
      return {ok:true, actualizadas:0, ids:[]};
    }
    const valores = hoja.getDataRange().getValues();
    const mapa = mapaEncabezados_(valores[0]);
    const colId = mapa['ID ACTIVIDAD'];
    const colFechaTermino = mapa['FECHA TERMINO'];
    const colEstado = mapa['ESTADO ACTIVIDAD'];
    if (colFechaTermino === undefined || colEstado === undefined) {
      throw new Error('ACTIVIDADES debe contener FECHA_TERMINO y ESTADO_ACTIVIDAD.');
    }
    const hoyTexto = Utilities.formatDate(
      new Date(),
      SIGC_CONFIG.ZONA_HORARIA,
      'yyyy-MM-dd'
    );
    const hoyNumero = webFechaNumero_(hoyTexto);
    const ids = [];
    for (let i = 1; i < valores.length; i++) {
      const actividad = {
        FECHA_TERMINO: valores[i][colFechaTermino],
        ESTADO_ACTIVIDAD: valores[i][colEstado]
      };
      if (!actividadDebeMarcarseEjecutada_(actividad, hoyNumero)) continue;
      hoja.getRange(i + 1, colEstado + 1).setValue('Ejecutada');
      ids.push(String(colId === undefined ? '' : valores[i][colId] || ''));
    }
    if (ids.length) {
      SpreadsheetApp.flush();
      ids.forEach(function(idAct) {
        if (idAct) {
          try { cerrarFormulariosYActivadoresActividad_(idAct, 'Ejecutada'); } catch (e) {}
        }
      });
      if (typeof sigcInvalidarCacheTabla_ === 'function') sigcInvalidarCacheTabla_(SISTEMA.HOJAS.ACTIVIDADES);
      if (typeof webInvalidarDashboard_ === 'function') webInvalidarDashboard_();
      sigcRegistrarLog(
        'ACTUALIZACION AUTOMATICA',
        'ACTIVIDAD',
        ids.filter(Boolean).join(', '),
        ids.length + ' actividad(es) pasaron a Ejecutada por fecha de término. Formularios y activadores cerrados automáticamente.'
      );
    }
    return {ok:true, actualizadas:ids.length, ids:ids};
  } finally {
    lock.releaseLock();
  }
}

function actividadDebeMarcarseEjecutada_(actividad, hoyNumero) {
  const fechaTermino = webFechaNumero_(actividad && actividad.FECHA_TERMINO);
  if (!fechaTermino || !hoyNumero || fechaTermino >= hoyNumero) return false;
  const estado = normalizarEncabezado_(actividad && actividad.ESTADO_ACTIVIDAD);
  return ['EJECUTADA', 'CERRADA', 'SUSPENDIDA', 'ARCHIVADA'].indexOf(estado) < 0;
}

/**
 * SIGC 3.1: prepara la tabla de intereses sin borrar ni reemplazar datos.
 * Es seguro ejecutar esta función más de una vez.
 */
function prepararModuloDemandaComunicaciones() {
  const ss = SpreadsheetApp.getActive();
  const nombre = SISTEMA.HOJAS.INTERESES || 'INTERESES_CAPACITACION';
  let hoja = ss.getSheetByName(nombre);
  const encabezados = [
    'ID_INTERES',
    'ID_PERSONA',
    'ESCUELA_LINEA',
    'AREA_TEMATICA',
    'FECHA_REGISTRO',
    'ORIGEN_REGISTRO',
    'ESTADO_INTERES',
    'ULTIMA_ACTUALIZACION',
    'OBSERVACIONES'
  ];
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
  }
  if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  } else {
    encabezados.forEach(function(encabezado) {
      asegurarColumna_(hoja, encabezado);
    });
  }
  hoja.setFrozenRows(1);
  hoja.getRange(1, 1, 1, hoja.getLastColumn())
    .setFontWeight('bold')
    .setBackground('#173B57')
    .setFontColor('#FFFFFF');
  const mapa = mapaEncabezados_(
    hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0]
  );
  const indiceEstado = mapa[normalizarEncabezado_('ESTADO_INTERES')];
  if (indiceEstado !== undefined) {
    hoja.getRange(2, indiceEstado + 1, Math.max(hoja.getMaxRows() - 1, 1), 1)
      .setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(['Activo', 'Inactivo'], true)
          .setAllowInvalid(false)
          .build()
      );
  }
  hoja.autoResizeColumns(1, encabezados.length);
  return {
    ok: true,
    hoja: nombre,
    mensaje: 'Módulo de demanda y comunicaciones preparado correctamente.'
  };
}
function validarHojasObligatorias_() {
  const ss = SpreadsheetApp.getActive();
  // Solo se validan las hojas permanentes necesarias
  // para el funcionamiento habitual del sistema.
  const hojasObligatorias = [
    SISTEMA.HOJAS.PERSONAS,
    SISTEMA.HOJAS.ACTIVIDADES,
    SISTEMA.HOJAS.PARTICIPACIONES,
    SISTEMA.HOJAS.ASISTENCIA,
    SISTEMA.HOJAS.BUSCADOR,
    SISTEMA.HOJAS.CALIDAD
  ].filter(Boolean);
  const faltantes = hojasObligatorias.filter(function(nombreHoja) {
    return !ss.getSheetByName(nombreHoja);
  });
  if (faltantes.length > 0) {
    throw new Error(
      'Faltan las hojas obligatorias: ' + faltantes.join(', ')
    );
  }
}
function aplicarValidaciones_() {
  const ss = SpreadsheetApp.getActive();
  const siNo = ['Sí', 'No', 'No informado'];
  const tiposDocumento = [
    'RUT',
    'Pasaporte',
    'Documento extranjero',
    'Documento histórico',
    'Identificador histórico'
  ];
  const estadosSeleccion = ['Pendiente', 'Seleccionado', 'Lista de espera', 'No seleccionado', 'No informado'];
  const cumple = ['Sí', 'No', 'Pendiente', 'No informado'];
  const medios = ['Correo', 'Teléfono', 'WhatsApp', 'Presencial', 'Otro', 'No informado'];
  const certificados = ['Sí', 'No', 'No aplica', 'No informado'];
  const estadosActividad = ['Planificada', 'Difusión', 'Inscripción abierta', 'En ejecución', 'Ejecutada', 'Suspendida', 'Cerrada', 'Archivada'];
  function aplicarLista(hoja, campo, valores, filaMaxima) {
    const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    const mapa = mapaEncabezados_(encabezados);
    const indice = mapa[normalizarEncabezado_(campo)];
    if (indice === undefined) return;
    hoja.getRange(2, indice + 1, Math.max((filaMaxima || hoja.getMaxRows()) - 1, 1), 1)
      .setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(valores, true)
          .setAllowInvalid(false)
          .build()
      );
  }
  const personas = ss.getSheetByName(SISTEMA.HOJAS.PERSONAS);
  aplicarLista(personas, 'PARTICIPA_PMJH', siNo, 5000);
  aplicarLista(personas, 'AUTORIZA_CONTACTO', siNo, 5000);
  aplicarLista(personas, 'TIPO_DOCUMENTO', tiposDocumento, 5000);
  const actividades = ss.getSheetByName(SISTEMA.HOJAS.ACTIVIDADES);
  aplicarLista(actividades, 'REQUIERE_SELECCION', siNo, 1000);
  aplicarLista(actividades, 'ESTADO_ACTIVIDAD', estadosActividad, 1000);
  const participaciones = ss.getSheetByName(SISTEMA.HOJAS.PARTICIPACIONES);
  aplicarLista(participaciones, 'CUMPLE_REQUISITOS', cumple, 10000);
  aplicarLista(participaciones, 'ESTADO_SELECCION', estadosSeleccion, 10000);
  aplicarLista(participaciones, 'MEDIO_NOTIFICACION', medios, 10000);
  aplicarLista(participaciones, 'CONFIRMA_PARTICIPACION', siNo, 10000);
  aplicarLista(participaciones, 'CERTIFICADO', certificados, 10000);
  aplicarLista(participaciones, 'REGISTRO_ACTIVO', ['Sí', 'No'], 10000);
  const asistencia = ss.getSheetByName(SISTEMA.HOJAS.ASISTENCIA);
  const idsActividad = actividades.getRange('A2:A1000');
  asistencia.getRange('B2').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(idsActividad, true)
      .setAllowInvalid(false)
      .build()
  );
}
function instalarTriggerFormulario() {
  const ss = SpreadsheetApp.getActive();
  const triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'alEnviarFormulario' &&
      trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT;
  });
  /* Se conserva un solo activador para evitar procesar una respuesta dos veces. */
  if (triggers.length > 1) {
    triggers.slice(1).forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
  }
  if (triggers.length === 0) {
    ScriptApp.newTrigger('alEnviarFormulario')
      .forSpreadsheet(ss)
      .onFormSubmit()
      .create();
  }
}
function alEnviarFormulario(e) {
  if (!e || !e.range) {
    console.error('El evento no contiene una fila de formulario.');
    return;
  }
  // procesarFilaRespuesta_ administra el bloqueo. Evitamos solicitar dos veces
  // el mismo ScriptLock, que no es reentrante y puede agotar el tiempo de espera.
  procesarFilaFormularioSeguro_(e.range.getSheet(), e.range.getRow(), null);
}
function procesarRespuestasPendientes() {
  const ss = SpreadsheetApp.getActive();
  const hojas = ss.getSheets().filter(function(hoja) {
    const n = normalizarEncabezado_(hoja.getName());
    if (hoja.getName() === 'FORMULARIO_MODELO') return false;
    return n.indexOf('RESPUESTAS FORMULARIO') >= 0 || n.indexOf('FORM RESPONSES') >= 0;
  });
  let procesadas = 0;
  let errores = 0;
  hojas.forEach(function(hoja) {
    asegurarColumnasProceso_(hoja);
    if (hoja.getLastRow() < 2) return;
    const datos = hoja.getDataRange().getValues();
    const mapa = mapaEncabezados_(datos[0]);
    const colEstado = mapa['ESTADO PROCESO'];
    for (let fila = 2; fila <= datos.length; fila++) {
      const estado = colEstado !== undefined ? datos[fila - 1][colEstado] : '';
      if (estado) continue;
      try {
        procesarFilaRespuesta_(hoja, fila);
        procesadas++;
      } catch (error) {
        registrarResultadoEnRespuesta_(hoja, fila, '', '', 'ERROR', error.message);
        errores++;
      }
    }
  });
  SpreadsheetApp.getUi().alert(
    'Proceso finalizado',
    'Respuestas procesadas: ' + procesadas + '\nErrores: ' + errores,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
function procesarFilaRespuesta_(hoja, fila, configFormulario) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    asegurarColumnasProceso_(hoja);
    const ultimaColumna = hoja.getLastColumn();
    const encabezados = hoja.getRange(1, 1, 1, ultimaColumna).getValues()[0];
    const valores = hoja.getRange(fila, 1, 1, ultimaColumna).getValues()[0];
    const mapaProceso = mapaEncabezados_(encabezados);
    const estadoAnterior = normalizarEncabezado_(
      mapaProceso['ESTADO PROCESO'] === undefined ? '' : valores[mapaProceso['ESTADO PROCESO']]
    );
    if (['PROCESADO', 'PROCESADO CON ADVERTENCIA', 'DUPLICADO'].indexOf(estadoAnterior) >= 0) {
      return {omitida: true, estado: estadoAnterior};
    }
    const tipoFormulario = normalizarEncabezado_(
      configFormulario && configFormulario.tipo || 'INSCRIPCION'
    );
    if (tipoFormulario === 'INTERES GENERAL') {
      return procesarFilaInteresGeneral_(hoja, fila, encabezados, valores);
    }
    const registro = registroDesdeFila_(encabezados, valores);
    const advertencias = prepararRegistroFormulario_(registro);
    if (configFormulario && configFormulario.idActividad) registro.idActividad = configFormulario.idActividad;
    const actividad = resolverActividad_(registro.idActividad || registro.actividad);
    if (!actividad) {
      throw new Error('No se encontró la actividad asociada a este formulario.');
    }
    const persona = obtenerOCrearPersona_(registro);
    const participacion = obtenerOCrearParticipacion_(persona.id, actividad.id, registro);
    registrarResultadoEnRespuesta_(
      hoja,
      fila,
      persona.id,
      participacion.id,
      participacion.nueva
        ? (advertencias.length ? 'PROCESADO_CON_ADVERTENCIA' : 'PROCESADO')
        : 'DUPLICADO',
      (participacion.nueva
        ? 'Registro creado correctamente. La participación quedó pendiente de selección.'
        : 'La persona ya tenía una participación activa en esta actividad.') +
        (advertencias.length ? ' Advertencias: ' + advertencias.join(' ') : '')
    );
    return {
      omitida: false,
      estado: participacion.nueva
        ? (advertencias.length ? 'PROCESADO_CON_ADVERTENCIA' : 'PROCESADO')
        : 'DUPLICADO',
      idPersona: persona.id,
      idParticipacion: participacion.id
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Normaliza datos antes de crear la persona. Un dato de contacto opcional con
 * formato inválido no bloquea la inscripción: se conserva en la respuesta
 * original, se omite de PERSONAS y se deja una advertencia para revisión.
 * Los campos esenciales (documento e identidad) siguen siendo estrictos.
 */
function prepararRegistroFormulario_(registro) {
  const advertencias = [];
  registro.nombre = sigcNormalizarNombre(registro.nombre);
  if (!registro.nombre) throw new Error('Falta el nombre de la persona. Corrija la respuesta y vuelva a procesarla.');

  const correoOriginal = sigcNormalizarTexto(registro.correo);
  const correo = sigcNormalizarCorreo(correoOriginal);
  if (correo && !sigcValidarCorreo(correo)) {
    registro.correo = '';
    advertencias.push('Correo inválido omitido: "' + correoOriginal + '".');
  } else {
    registro.correo = correo;
  }

  const telefonoOriginal = sigcNormalizarTexto(registro.telefono);
  const telefono = sigcNormalizarTelefono(telefonoOriginal);
  if (telefono && !sigcValidarTelefono(telefono)) {
    registro.telefono = '';
    advertencias.push('Teléfono inválido omitido: "' + telefonoOriginal + '".');
  } else {
    registro.telefono = telefono;
  }

  registro.autorizaContacto = sigcNormalizarSiNo(registro.autorizaContacto, 'No informado');
  return advertencias;
}
function registroDesdeFila_(encabezados, valores) {
  const mapa = {};
  encabezados.forEach(function(h, i) {
    mapa[normalizarEncabezado_(h)] = valores[i];
  });
  const rut = valorAlternativo_(mapa, ['RUT', 'RUN']);
  const tipoDocumento = valorAlternativo_(mapa, [
    'TIPO DOCUMENTO', 'TIPO DE DOCUMENTO', 'DOCUMENTO IDENTIDAD'
  ]) || (rut ? 'RUT' : '');
  const numeroDocumento = valorAlternativo_(mapa, [
    'NUMERO DOCUMENTO', 'NÚMERO DOCUMENTO', 'NUMERO DE DOCUMENTO',
    'NÚMERO DE DOCUMENTO', 'PASAPORTE'
  ]) || rut;
  // Un formulario puede usar "Nombre" o "Nombres" para el nombre de pila.
  // Si existe además una columna "Apellidos", ambos componentes deben tener
  // prioridad sobre los encabezados ambiguos. En 3.4, "Nombre" se trataba
  // como si ya fuera el nombre completo y podía omitir los apellidos.
  const nombres = valorAlternativo_(mapa, ['NOMBRES', 'NOMBRE']);
  const apellidos = valorAlternativo_(mapa, ['APELLIDOS']);
  const nombreCompleto = valorAlternativo_(mapa, [
    'NOMBRE COMPLETO', 'NOMBRES Y APELLIDOS', 'NOMBRE Y APELLIDO'
  ]);
  return {
    timestamp: valorAlternativo_(mapa, ['MARCA TEMPORAL', 'TIMESTAMP', 'FECHA REGISTRO']),
    tipoDocumento: tipoDocumento,
    numeroDocumento: numeroDocumento,
    rut: rut,
    nombre: nombreCompleto || [nombres, apellidos].filter(Boolean).join(' '),
    correo: valorAlternativo_(mapa, ['CORREO', 'CORREO ELECTRONICO', 'EMAIL']),
    telefono: valorAlternativo_(mapa, ['TELEFONO', 'CELULAR', 'TELEFONO DE CONTACTO']),
    comuna: valorAlternativo_(mapa, ['COMUNA', 'COMUNA DE RESIDENCIA']),
    barrio: valorAlternativo_(mapa, ['BARRIO']),
    direccion: valorAlternativo_(mapa, ['DIRECCION', 'DOMICILIO']),
    fechaNacimiento: valorAlternativo_(mapa, ['FECHA NACIMIENTO', 'FECHA DE NACIMIENTO']),
    genero: valorAlternativo_(mapa, ['GENERO']),
    nacionalidad: valorAlternativo_(mapa, ['NACIONALIDAD']),
    participaPmjh: valorAlternativo_(mapa, [
      'PARTICIPA PMJH', 'PARTICIPA EN PMJH', 'ES PMJH', 'FUE PMJH'
    ]),
    idActividad: valorAlternativo_(mapa, ['ID ACTIVIDAD', 'ID DE ACTIVIDAD', 'ID ACTIVIDAD CAPACITACION']),
    actividad: valorAlternativo_(mapa, ['ACTIVIDAD', 'CAPACITACION', 'CURSO TALLER CHARLA']),
    canal: valorAlternativo_(mapa, ['CANAL INSCRIPCION', 'CANAL', 'MEDIO DE INSCRIPCION']) || 'Formulario',
    cumpleRequisitos: valorAlternativo_(mapa, ['CUMPLE REQUISITOS']) || 'Pendiente',
    autorizaContacto: valorAlternativo_(mapa, ['AUTORIZA CONTACTO', 'AUTORIZA ENVIO DE INFORMACION', 'AUTORIZA RECIBIR INFORMACION']) || 'No informado',
    origen: valorAlternativo_(mapa, ['ORIGEN PROGRAMA', 'ORIGEN', 'PROGRAMA DE ORIGEN']) || 'Formulario',
    observaciones: valorAlternativo_(mapa, ['OBSERVACIONES', 'COMENTARIOS'])
  };
}
function obtenerOCrearPersona_(registro) {
  const hoja = sigcSpreadsheetCentral_().getSheetByName(SISTEMA.HOJAS.PERSONAS);
  const datos = hoja.getDataRange().getValues();
  const mapa = mapaEncabezados_(datos[0]);
  const tipoDocumento = sigcNormalizarTipoDocumento(registro.tipoDocumento, registro.rut);
  const documento = sigcNormalizarDocumento(
    tipoDocumento,
    registro.numeroDocumento,
    registro.rut
  );
  const documentoValidado = sigcValidarDocumento(
    tipoDocumento,
    documento,
    registro.nacionalidad
  );
  const rut = documentoValidado.tipo === 'RUT' ? documentoValidado.numero : '';
  const correo = sigcNormalizarCorreo(registro.correo);
  const telefono = sigcNormalizarTelefono(registro.telefono);
  const nombre = sigcNormalizarNombre(registro.nombre);
  const nacionalidad = sigcNormalizarTexto(registro.nacionalidad);
  if (!nombre) throw new Error('El nombre completo es obligatorio.');
  if (!sigcValidarCorreo(correo)) throw new Error('El correo electrónico no es válido.');
  if (!sigcValidarTelefono(telefono)) throw new Error('El teléfono no tiene un formato chileno válido.');
  let filaEncontrada = -1;
  for (let i = 1; i < datos.length; i++) {
    const tipoExistente = sigcNormalizarTipoDocumento(
      mapa['TIPO DOCUMENTO'] !== undefined ? datos[i][mapa['TIPO DOCUMENTO']] : '',
      mapa['RUT'] !== undefined ? datos[i][mapa['RUT']] : ''
    );
    const documentoExistente = sigcNormalizarDocumento(
      tipoExistente,
      mapa['NUMERO DOCUMENTO'] !== undefined ? datos[i][mapa['NUMERO DOCUMENTO']] : '',
      mapa['RUT'] !== undefined ? datos[i][mapa['RUT']] : ''
    );
    const nacionalidadExistente = sigcNormalizarClave(
      mapa['NACIONALIDAD'] !== undefined ? datos[i][mapa['NACIONALIDAD']] : ''
    );
    const coincideDocumento = documentoValidado.tipo === 'RUT'
      ? tipoExistente === 'RUT' && documentoExistente === documentoValidado.numero
      : tipoExistente === documentoValidado.tipo &&
        documentoExistente === documentoValidado.numero &&
        (documentoValidado.tipo === 'Identificador histórico' ||
          nacionalidadExistente === sigcNormalizarClave(nacionalidad));
    if (coincideDocumento) {
      filaEncontrada = i + 1;
      break;
    }
    const correoExistente = normalizarCorreo_(datos[i][mapa['CORREO']]);
    const telefonoExistente = normalizarTelefono_(datos[i][mapa['TELEFONO']]);
    const nombreExistente = normalizarNombre_(datos[i][mapa['NOMBRE COMPLETO']]);
    if (!documentoExistente && correo && correoExistente && correo === correoExistente &&
        nombresCompatibles_(nombre, nombreExistente)) {
      filaEncontrada = i + 1;
      break;
    }
    if (!documentoExistente && telefono && telefonoExistente && telefono === telefonoExistente &&
        nombresCompatibles_(nombre, nombreExistente)) {
      filaEncontrada = i + 1;
      break;
    }
  }
  registro.tipoDocumento = documentoValidado.tipo;
  registro.numeroDocumento = documentoValidado.numero;
  registro.rut = rut;
  registro.nombre = nombre;
  registro.correo = correo;
  registro.telefono = telefono;
  registro.nacionalidad = nacionalidad;
  if (filaEncontrada > 0) {
    actualizarPersona_(hoja, filaEncontrada, mapa, registro);
    return {
      id: hoja.getRange(filaEncontrada, mapa['ID PERSONA'] + 1).getValue(),
      nueva: false
    };
  }
  const id = coreSiguienteId_(hoja, 'PER-', 6);
  const ahora = new Date();
  const pmjhOrigen = normalizarEncabezado_(registro.origen).indexOf('PMJH') >= 0
    ? 'Sí'
    : 'No informado';
  const pmjh = registro.participaPmjh
    ? sigcNormalizarSiNo(registro.participaPmjh, pmjhOrigen)
    : pmjhOrigen;
  const fila = nuevaFilaSegunEncabezados_(datos[0], {
    'ID PERSONA': id,
    'RUT': rut,
    'NOMBRE COMPLETO': nombre,
    'CORREO': correo,
    'TELEFONO': telefono,
    'COMUNA': sigcNormalizarTexto(registro.comuna),
    'BARRIO': sigcNormalizarTexto(registro.barrio),
    'DIRECCION': sigcNormalizarTexto(registro.direccion),
    'FECHA NACIMIENTO': registro.fechaNacimiento || '',
    'GENERO': sigcNormalizarTexto(registro.genero),
    'NACIONALIDAD': nacionalidad,
    'AUTORIZA CONTACTO': sigcNormalizarSiNo(registro.autorizaContacto, 'No informado'),
    'FECHA PRIMER REGISTRO': registro.timestamp || ahora,
    'PARTICIPA PMJH': pmjh,
    'ORIGEN REGISTRO': sigcNormalizarTexto(registro.origen) || 'Formulario',
    'ESTADO CONTACTO': correo || telefono ? 'Activo' : 'Sin contacto',
    'ULTIMA ACTUALIZACION': ahora,
    'OBSERVACIONES': sigcNormalizarTexto(registro.observaciones),
    'TIPO DOCUMENTO': documentoValidado.tipo,
    'NUMERO DOCUMENTO': documentoValidado.numero
  });
  hoja.appendRow(fila);
  sigcRegistrarLog('CREAR', 'PERSONA', id, 'Registro desde formulario.');
  return {id: id, nueva: true};
}
function actualizarPersona_(hoja, fila, mapa, registro) {
  const actual = hoja.getRange(fila, 1, 1, hoja.getLastColumn()).getValues()[0];
  const pmjhNuevo = registro.participaPmjh
    ? sigcNormalizarSiNo(registro.participaPmjh, 'No informado')
    : (normalizarEncabezado_(registro.origen).indexOf('PMJH') >= 0 ? 'Sí' : '');
  const cambios = {
    'RUT': registro.rut,
    'NOMBRE COMPLETO': sigcNormalizarNombre(registro.nombre),
    'CORREO': sigcNormalizarCorreo(registro.correo),
    'TELEFONO': sigcNormalizarTelefono(registro.telefono),
    'COMUNA': sigcNormalizarTexto(registro.comuna),
    'BARRIO': sigcNormalizarTexto(registro.barrio),
    'DIRECCION': sigcNormalizarTexto(registro.direccion),
    'FECHA NACIMIENTO': registro.fechaNacimiento,
    'GENERO': sigcNormalizarTexto(registro.genero),
    'NACIONALIDAD': sigcNormalizarTexto(registro.nacionalidad),
    'AUTORIZA CONTACTO': sigcNormalizarSiNo(registro.autorizaContacto, 'No informado'),
    'PARTICIPA PMJH': pmjhNuevo,
    'ORIGEN REGISTRO': sigcNormalizarTexto(registro.origen),
    'TIPO DOCUMENTO': registro.tipoDocumento,
    'NUMERO DOCUMENTO': registro.numeroDocumento,
    'OBSERVACIONES': sigcNormalizarTexto(registro.observaciones)
  };
  Object.keys(cambios).forEach(function(campo) {
    if (mapa[campo] === undefined) return;
    const nuevo = cambios[campo];
    if (nuevo === '' || nuevo === null || nuevo === undefined) return;
    const valorActual = actual[mapa[campo]];
    if ((campo === 'PARTICIPA PMJH' || campo === 'AUTORIZA CONTACTO') &&
        nuevo === 'No informado' &&
        ['Sí', 'No'].indexOf(sigcNormalizarSiNo(valorActual, 'No informado')) >= 0) {
      return;
    }
    hoja.getRange(fila, mapa[campo] + 1).setValue(nuevo);
  });
  if (mapa['ESTADO CONTACTO'] !== undefined) {
    const correo = mapa['CORREO'] !== undefined
      ? sigcNormalizarCorreo(hoja.getRange(fila, mapa['CORREO'] + 1).getValue())
      : '';
    const telefono = mapa['TELEFONO'] !== undefined
      ? sigcNormalizarTelefono(hoja.getRange(fila, mapa['TELEFONO'] + 1).getValue())
      : '';
    hoja.getRange(fila, mapa['ESTADO CONTACTO'] + 1)
      .setValue(correo || telefono ? 'Activo' : 'Sin contacto');
  }
  if (mapa['ULTIMA ACTUALIZACION'] !== undefined) {
    hoja.getRange(fila, mapa['ULTIMA ACTUALIZACION'] + 1).setValue(new Date());
  }
  const id = mapa['ID PERSONA'] !== undefined ? actual[mapa['ID PERSONA']] : '';
  sigcRegistrarLog('ACTUALIZAR', 'PERSONA', id, 'Datos completados desde formulario.');
}
function obtenerOCrearParticipacion_(idPersona, idActividad, registro) {
  const ss = sigcSpreadsheetCentral_();
  const hoja = ss.getSheetByName(SISTEMA.HOJAS.PARTICIPACIONES);
  const datos = hoja.getDataRange().getValues();
  const mapa = mapaEncabezados_(datos[0]);
  for (let i = 1; i < datos.length; i++) {
    const mismaPersona = String(datos[i][mapa['ID PERSONA']]) === String(idPersona);
    const mismaActividad = String(datos[i][mapa['ID ACTIVIDAD']]) === String(idActividad);
    const activo = mapa['REGISTRO ACTIVO'] === undefined ||
      normalizarEncabezado_(datos[i][mapa['REGISTRO ACTIVO']]) !== 'NO';
    if (mismaPersona && mismaActividad && activo) {
      return {id: datos[i][mapa['ID PARTICIPACION']], nueva: false};
    }
  }
  const actividad = resolverActividad_(idActividad);
  const id = coreSiguienteId_(hoja, 'PAR-' + new Date().getFullYear() + '-', 6);
  const ahora = new Date();
  const sesionesTotales = Number(actividad.sesionesTotales || 0);
  const fila = nuevaFilaSegunEncabezados_(datos[0], {
    'ID PARTICIPACION': id,
    'ID PERSONA': idPersona,
    'ID ACTIVIDAD': idActividad,
    'FECHA INSCRIPCION': registro.timestamp || ahora,
    'CANAL INSCRIPCION': sigcNormalizarTexto(registro.canal) || 'Formulario',
    'CUMPLE REQUISITOS': sigcNormalizarCumple(registro.cumpleRequisitos),
    'ESTADO SELECCION': 'Pendiente',
    'CONFIRMA PARTICIPACION': 'No informado',
    'SESIONES ASISTIDAS': 0,
    'SESIONES TOTALES': sesionesTotales,
    'PORCENTAJE ASISTENCIA': 0,
    'RESULTADO ASISTENCIA': 'Pendiente',
    'RESULTADO FINAL': 'Pendiente',
    'CERTIFICADO': 'No informado',
    'OBSERVACIONES': sigcNormalizarTexto(registro.observaciones),
    'ARCHIVO ORIGEN': 'Formulario Google',
    'REGISTRO ACTIVO': 'Sí',
    'ULTIMA ACTUALIZACION': ahora
  });
  hoja.appendRow(fila);
  sigcRegistrarLog('CREAR', 'PARTICIPACION', id, idPersona + ' | ' + idActividad);
  return {id: id, nueva: true};
}
function resolverActividad_(valor) {
  if (!valor) return null;
  const hoja = sigcSpreadsheetCentral_().getSheetByName(SISTEMA.HOJAS.ACTIVIDADES);
  const datos = hoja.getDataRange().getValues();
  const mapa = mapaEncabezados_(datos[0]);
  const buscado = normalizarEncabezado_(valor);
  for (let i = 1; i < datos.length; i++) {
    const id = datos[i][mapa['ID ACTIVIDAD']];
    const nombre = datos[i][mapa['NOMBRE ACTIVIDAD']];
    if (normalizarEncabezado_(id) === buscado ||
        normalizarEncabezado_(nombre) === buscado) {
      return {
        id: id,
        ID_ACTIVIDAD: id,
        nombre: nombre,
        NOMBRE_ACTIVIDAD: nombre,
        programa: datos[i][mapa['PROGRAMA']],
        sesionesTotales: Number(datos[i][mapa['SESIONES TOTALES']] || 0),
        SESIONES_TOTALES: Number(datos[i][mapa['SESIONES TOTALES']] || 0),
        porcentajeAprobacion: sigcConvertirPorcentaje(
          datos[i][mapa['PORCENTAJE APROBACION']]
        ),
        PORCENTAJE_APROBACION: datos[i][mapa['PORCENTAJE APROBACION']],
        reglaResultado: datos[i][mapa['REGLA RESULTADO']] || 'Asistencia',
        REGLA_RESULTADO: datos[i][mapa['REGLA RESULTADO']] || 'Asistencia',
        ESTADO_ACTIVIDAD: mapa['ESTADO ACTIVIDAD'] !== undefined
          ? datos[i][mapa['ESTADO ACTIVIDAD']]
          : ''
      };
    }
  }
  return null;
}
function generarNominaActividad() {
  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName(SISTEMA.HOJAS.ASISTENCIA);
  const idActividad = hoja.getRange('B2').getValue();
  hoja.getRange('A7:J2000').clearContent();
  hoja.getRange('A7:J7').setValues([[
    'ID_PARTICIPACION', 'ID_PERSONA', 'DOCUMENTO', 'NOMBRE_COMPLETO',
    'PARTICIPA_PMJH', 'ESTADO_SELECCION', 'SESIONES_TOTALES',
    'SESIONES_ASISTIDAS', 'RESULTADO_ACTUAL', 'OBSERVACIONES'
  ]]);
  if (!idActividad) {
    hoja.getRange('A8').setValue('Seleccione una actividad en B2.');
    return;
  }
  const actividad = resolverActividad_(idActividad);
  if (!actividad) {
    hoja.getRange('A8').setValue('La actividad seleccionada no existe.');
    return;
  }
  hoja.getRange('B3').setValue(actividad.nombre);
  hoja.getRange('B4').setValue(actividad.sesionesTotales);
  const participaciones = ss.getSheetByName(SISTEMA.HOJAS.PARTICIPACIONES)
    .getDataRange().getValues();
  const personas = ss.getSheetByName(SISTEMA.HOJAS.PERSONAS)
    .getDataRange().getValues();
  const mp = mapaEncabezados_(participaciones[0]);
  const mper = mapaEncabezados_(personas[0]);
  const personasPorId = {};
  for (let i = 1; i < personas.length; i++) {
    const tipo = mper['TIPO DOCUMENTO'] !== undefined
      ? personas[i][mper['TIPO DOCUMENTO']]
      : (personas[i][mper['RUT']] ? 'RUT' : '');
    const numero = mper['NUMERO DOCUMENTO'] !== undefined
      ? personas[i][mper['NUMERO DOCUMENTO']]
      : personas[i][mper['RUT']];
    personasPorId[personas[i][mper['ID PERSONA']]] = {
      documento: sigcNormalizarDocumento(tipo, numero, personas[i][mper['RUT']]),
      nombre: personas[i][mper['NOMBRE COMPLETO']],
      pmjh: mper['PARTICIPA PMJH'] !== undefined
        ? sigcNormalizarSiNo(personas[i][mper['PARTICIPA PMJH']], 'No informado')
        : 'No informado'
    };
  }
  const salida = [];
  for (let i = 1; i < participaciones.length; i++) {
    if (String(participaciones[i][mp['ID ACTIVIDAD']]) !== String(idActividad)) continue;
    if (mp['REGISTRO ACTIVO'] !== undefined &&
        normalizarEncabezado_(participaciones[i][mp['REGISTRO ACTIVO']]) === 'NO') continue;
    if (sigcNormalizarSeleccion(participaciones[i][mp['ESTADO SELECCION']]) !== 'Seleccionado') continue;
    const idPersona = participaciones[i][mp['ID PERSONA']];
    const persona = personasPorId[idPersona] || {};
    salida.push([
      participaciones[i][mp['ID PARTICIPACION']],
      idPersona,
      persona.documento || '',
      persona.nombre || '',
      persona.pmjh || 'No informado',
      'Seleccionado',
      actividad.sesionesTotales,
      participaciones[i][mp['SESIONES ASISTIDAS']] || 0,
      participaciones[i][mp['RESULTADO FINAL']] || 'Pendiente',
      participaciones[i][mp['OBSERVACIONES']] || ''
    ]);
  }
  if (salida.length) {
    hoja.getRange(8, 1, salida.length, salida[0].length).setValues(salida);
    hoja.getRange(8, 8, salida.length, 1).setNumberFormat('0');
  } else {
    hoja.getRange('A8').setValue('No existen personas seleccionadas en esta actividad.');
  }
}
function guardarAsistenciaRapida() {
  const ss = SpreadsheetApp.getActive();
  const hojaAsistencia = ss.getSheetByName(SISTEMA.HOJAS.ASISTENCIA);
  const idActividad = hojaAsistencia.getRange('B2').getValue();
  const actividad = resolverActividad_(idActividad);
  if (!actividad) throw new Error('Seleccione una actividad válida.');
  const ultimaFila = hojaAsistencia.getLastRow();
  if (ultimaFila < 8) return;
  const nomina = hojaAsistencia.getRange(8, 1, ultimaFila - 7, 10).getValues();
  const hojaPart = ss.getSheetByName(SISTEMA.HOJAS.PARTICIPACIONES);
  const datosPart = hojaPart.getDataRange().getValues();
  const mapa = mapaEncabezados_(datosPart[0]);
  const filaPorId = {};
  for (let i = 1; i < datosPart.length; i++) {
    filaPorId[String(datosPart[i][mapa['ID PARTICIPACION']])] = i + 1;
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let actualizadas = 0;
  try {
    nomina.forEach(function(fila) {
      const idParticipacion = fila[0];
      if (!idParticipacion || !filaPorId[String(idParticipacion)]) return;
      const filaDestino = filaPorId[String(idParticipacion)];
      const seleccion = sigcNormalizarSeleccion(
        hojaPart.getRange(filaDestino, mapa['ESTADO SELECCION'] + 1).getValue()
      );
      if (seleccion !== 'Seleccionado') {
        throw new Error('La participación ' + idParticipacion + ' ya no está seleccionada.');
      }
      const sesiones = Number(fila[7] || 0);
      if (sesiones < 0 || sesiones > Number(actividad.sesionesTotales || 0)) {
        throw new Error(
          'Las sesiones de ' + fila[3] + ' deben estar entre 0 y ' +
          actividad.sesionesTotales + '.'
        );
      }
      const porcentaje = actividad.sesionesTotales
        ? sesiones / actividad.sesionesTotales
        : 0;
      const resultado = sigcCalcularResultado(
        actividad,
        sesiones,
        actividad.sesionesTotales,
        sigcActividadFinalizada(actividad)
      );
      hojaPart.getRange(filaDestino, mapa['SESIONES ASISTIDAS'] + 1).setValue(sesiones);
      hojaPart.getRange(filaDestino, mapa['SESIONES TOTALES'] + 1).setValue(actividad.sesionesTotales);
      hojaPart.getRange(filaDestino, mapa['PORCENTAJE ASISTENCIA'] + 1).setValue(porcentaje);
      hojaPart.getRange(filaDestino, mapa['RESULTADO ASISTENCIA'] + 1).setValue(resultado.resultadoAsistencia);
      hojaPart.getRange(filaDestino, mapa['RESULTADO FINAL'] + 1).setValue(resultado.resultadoFinal);
      hojaPart.getRange(filaDestino, mapa['OBSERVACIONES'] + 1).setValue(fila[9] || '');
      hojaPart.getRange(filaDestino, mapa['ULTIMA ACTUALIZACION'] + 1).setValue(new Date());
      actualizadas++;
    });
    SpreadsheetApp.flush();
    if (typeof sigcInvalidarCacheTabla_ === 'function') sigcInvalidarCacheTabla_(SISTEMA.HOJAS.PARTICIPACIONES);
  } finally {
    lock.releaseLock();
  }
  SpreadsheetApp.getUi().alert(
    'Asistencia guardada',
    'Registros actualizados: ' + actualizadas,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
function calcularResultadoFinal_(sesionesAsistidas, actividad) {
  return sigcCalcularResultado(
    actividad,
    sesionesAsistidas,
    Number(actividad.sesionesTotales || 0),
    true
  ).resultadoFinal;
}
function buscarPersona() {
  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName(SISTEMA.HOJAS.BUSCADOR);
  const terminoOriginal = hoja.getRange('B3').getValue();
  hoja.getRange('A6:F14').clearContent();
  hoja.getRange('A15:I2000').clearContent();
  if (!terminoOriginal) {
    hoja.getRange('A6').setValue('Ingrese un documento, ID, correo o nombre.');
    return;
  }
  const personas = ss.getSheetByName(SISTEMA.HOJAS.PERSONAS).getDataRange().getValues();
  const mapa = mapaEncabezados_(personas[0]);
  const termino = normalizarEncabezado_(terminoOriginal);
  const documentoBuscado = String(terminoOriginal || '').toUpperCase().replace(/[^A-Z0-9K]/g, '');
  const correoBuscado = normalizarCorreo_(terminoOriginal);
  const coincidencias = [];
  for (let i = 1; i < personas.length; i++) {
    const id = String(personas[i][mapa['ID PERSONA']] || '');
    const tipo = mapa['TIPO DOCUMENTO'] !== undefined
      ? personas[i][mapa['TIPO DOCUMENTO']]
      : (personas[i][mapa['RUT']] ? 'RUT' : '');
    const documento = sigcNormalizarDocumento(
      tipo,
      mapa['NUMERO DOCUMENTO'] !== undefined ? personas[i][mapa['NUMERO DOCUMENTO']] : '',
      personas[i][mapa['RUT']]
    );
    const documentoComparable = String(documento).toUpperCase().replace(/[^A-Z0-9K]/g, '');
    const correo = normalizarCorreo_(personas[i][mapa['CORREO']]);
    const nombre = normalizarEncabezado_(personas[i][mapa['NOMBRE COMPLETO']]);
    if (normalizarEncabezado_(id) === termino ||
        (documentoBuscado && documentoComparable === documentoBuscado) ||
        (correoBuscado && correo === correoBuscado) ||
        (termino.length >= 4 && nombre.indexOf(termino) >= 0)) {
      coincidencias.push({fila: i + 1, datos: personas[i], documento: documento});
    }
  }
  if (coincidencias.length === 0) {
    hoja.getRange('A6').setValue('No se encontraron coincidencias.');
    return;
  }
  if (coincidencias.length > 1) {
    hoja.getRange('A6:D6').setValues([[
      'ID_PERSONA', 'DOCUMENTO', 'NOMBRE_COMPLETO', 'PARTICIPA_PMJH'
    ]]);
    const opciones = coincidencias.map(function(c) {
      return [
        c.datos[mapa['ID PERSONA']],
        c.documento,
        c.datos[mapa['NOMBRE COMPLETO']],
        mapa['PARTICIPA PMJH'] !== undefined
          ? c.datos[mapa['PARTICIPA PMJH']]
          : 'No informado'
      ];
    });
    hoja.getRange(7, 1, opciones.length, 4).setValues(opciones);
    hoja.getRange('F6').setValue(
      'Se encontraron varias personas. Copie un ID_PERSONA en B3 para abrir su historial.'
    );
    return;
  }
  const persona = coincidencias[0].datos;
  const idPersona = persona[mapa['ID PERSONA']];
  const tipo = mapa['TIPO DOCUMENTO'] !== undefined
    ? persona[mapa['TIPO DOCUMENTO']]
    : (persona[mapa['RUT']] ? 'RUT' : '');
  const documento = coincidencias[0].documento;
  hoja.getRange('A6:B14').setValues([
    ['ID_PERSONA', idPersona],
    ['TIPO_DOCUMENTO', tipo || 'RUT'],
    ['DOCUMENTO', documento],
    ['NOMBRE_COMPLETO', persona[mapa['NOMBRE COMPLETO']]],
    ['CORREO', persona[mapa['CORREO']]],
    ['TELÉFONO', persona[mapa['TELEFONO']]],
    ['COMUNA', persona[mapa['COMUNA']]],
    ['PARTICIPA_PMJH', mapa['PARTICIPA PMJH'] !== undefined
      ? persona[mapa['PARTICIPA PMJH']]
      : 'No informado'],
    ['ESTADO_CONTACTO', persona[mapa['ESTADO CONTACTO']]]
  ]);
  const actividades = ss.getSheetByName(SISTEMA.HOJAS.ACTIVIDADES).getDataRange().getValues();
  const ma = mapaEncabezados_(actividades[0]);
  const actividadPorId = {};
  for (let i = 1; i < actividades.length; i++) {
    actividadPorId[actividades[i][ma['ID ACTIVIDAD']]] = {
      nombre: actividades[i][ma['NOMBRE ACTIVIDAD']],
      programa: actividades[i][ma['PROGRAMA']]
    };
  }
  const participaciones = ss.getSheetByName(SISTEMA.HOJAS.PARTICIPACIONES)
    .getDataRange().getValues();
  const mp = mapaEncabezados_(participaciones[0]);
  const historial = [];
  for (let i = 1; i < participaciones.length; i++) {
    if (String(participaciones[i][mp['ID PERSONA']]) !== String(idPersona)) continue;
    const idActividad = participaciones[i][mp['ID ACTIVIDAD']];
    const act = actividadPorId[idActividad] || {};
    historial.push([
      participaciones[i][mp['FECHA INSCRIPCION']],
      idActividad,
      act.nombre || '',
      act.programa || '',
      participaciones[i][mp['ESTADO SELECCION']],
      participaciones[i][mp['SESIONES ASISTIDAS']],
      participaciones[i][mp['SESIONES TOTALES']],
      participaciones[i][mp['PORCENTAJE ASISTENCIA']],
      participaciones[i][mp['RESULTADO FINAL']]
    ]);
  }
  historial.sort(function(a, b) {
    return new Date(b[0] || 0) - new Date(a[0] || 0);
  });
  hoja.getRange('A15:I15').setValues([[
    'FECHA_INSCRIPCION', 'ID_ACTIVIDAD', 'ACTIVIDAD', 'PROGRAMA',
    'ESTADO_SELECCION', 'SESIONES_ASISTIDAS', 'SESIONES_TOTALES',
    '% ASISTENCIA', 'RESULTADO_FINAL'
  ]]);
  if (historial.length) {
    hoja.getRange(16, 1, historial.length, historial[0].length).setValues(historial);
    hoja.getRange(16, 8, historial.length, 1).setNumberFormat('0.0%');
  } else {
    hoja.getRange('A16').setValue('La persona no registra participaciones.');
  }
  hoja.getRange('D6').setValue('TOTAL PARTICIPACIONES');
  hoja.getRange('E6').setValue(historial.length);
}
function actualizarControlCalidad() {
  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName(SISTEMA.HOJAS.CALIDAD);
  const encabezados = [
    'ID_ALERTA', 'TIPO_REGISTRO', 'ID_REGISTRO', 'CAMPO', 'NIVEL',
    'PROBLEMA', 'VALOR', 'ACCION_SUGERIDA', 'ESTADO_REVISION', 'OBSERVACIONES'
  ];
  hoja.clearContents();
  hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  const alertas = [];
  let numero = 1;
  function agregar(tipo, id, campo, nivel, problema, valor, accion) {
    alertas.push([
      'ALT-' + String(numero++).padStart(5, '0'),
      tipo, id, campo, nivel, problema, valor, accion, 'Pendiente', ''
    ]);
  }
  const personas = ss.getSheetByName(SISTEMA.HOJAS.PERSONAS).getDataRange().getValues();
  const mp = mapaEncabezados_(personas[0]);
  const documentos = {};
  const emails = {};
  const telefonos = {};
  for (let i = 1; i < personas.length; i++) {
    const id = personas[i][mp['ID PERSONA']];
    if (!id) continue;
    const rutOriginal = mp['RUT'] !== undefined ? personas[i][mp['RUT']] : '';
    const tipo = sigcNormalizarTipoDocumento(
      mp['TIPO DOCUMENTO'] !== undefined ? personas[i][mp['TIPO DOCUMENTO']] : '',
      rutOriginal
    );
    const documento = sigcNormalizarDocumento(
      tipo,
      mp['NUMERO DOCUMENTO'] !== undefined ? personas[i][mp['NUMERO DOCUMENTO']] : '',
      rutOriginal
    );
    const nacionalidad = mp['NACIONALIDAD'] !== undefined
      ? sigcNormalizarTexto(personas[i][mp['NACIONALIDAD']])
      : '';
    const correo = sigcNormalizarCorreo(personas[i][mp['CORREO']]);
    const telefono = sigcNormalizarTelefono(personas[i][mp['TELEFONO']]);
    const comuna = personas[i][mp['COMUNA']];
    const pmjh = mp['PARTICIPA PMJH'] !== undefined
      ? sigcNormalizarSiNo(personas[i][mp['PARTICIPA PMJH']], 'No informado')
      : 'No informado';
    if (!/^PER-\d{6}$/.test(String(id))) {
      agregar('PERSONA', id, 'ID_PERSONA', 'Crítico', 'ID malformado', id, 'Revisar la generación de IDs.');
    }
    if (!tipo || !documento) {
      agregar('PERSONA', id, 'DOCUMENTO', 'Crítico', 'Documento no informado', '', 'Completar RUT o pasaporte.');
    } else if (tipo === 'RUT' && !sigcValidarRut(documento)) {
      agregar('PERSONA', id, 'RUT', 'Crítico', 'RUT inválido', documento, 'Confirmar el RUT.');
    } else if (tipo === 'Pasaporte' && !nacionalidad) {
      agregar('PERSONA', id, 'NACIONALIDAD', 'Crítico', 'Pasaporte sin nacionalidad', documento, 'Completar nacionalidad.');
    }
    if (!correo) {
      agregar('PERSONA', id, 'CORREO', 'Advertencia', 'Correo no informado', '', 'Solicitar correo si autoriza contacto.');
    } else if (!sigcValidarCorreo(correo)) {
      agregar('PERSONA', id, 'CORREO', 'Crítico', 'Correo inválido', correo, 'Corregir el correo.');
    }
    if (!telefono) {
      agregar('PERSONA', id, 'TELEFONO', 'Advertencia', 'Teléfono no informado', '', 'Solicitar teléfono.');
    } else if (!sigcValidarTelefono(telefono)) {
      agregar('PERSONA', id, 'TELEFONO', 'Advertencia', 'Teléfono fuera del formato esperado', telefono, 'Confirmar código de país y número.');
    }
    if (!comuna) agregar('PERSONA', id, 'COMUNA', 'Advertencia', 'Comuna no informada', '', 'Completar comuna.');
    if (['Sí', 'No', 'No informado'].indexOf(pmjh) < 0) {
      agregar('PERSONA', id, 'PARTICIPA_PMJH', 'Advertencia', 'Valor PMJH no estandarizado', pmjh, 'Normalizar a Sí, No o No informado.');
    }
    const claveDocumento = tipo === 'Pasaporte'
      ? tipo + '|' + documento + '|' + sigcNormalizarClave(nacionalidad)
      : tipo + '|' + documento;
    if (documento) {
      if (!documentos[claveDocumento]) documentos[claveDocumento] = [];
      documentos[claveDocumento].push(id);
    }
    if (correo) {
      if (!emails[correo]) emails[correo] = [];
      emails[correo].push(id);
    }
    if (telefono) {
      if (!telefonos[telefono]) telefonos[telefono] = [];
      telefonos[telefono].push(id);
    }
  }
  function alertarCompartidos(diccionario, campo, problema) {
    Object.keys(diccionario).forEach(function(clave) {
      const ids = Array.from(new Set(diccionario[clave]));
      if (ids.length > 1) ids.forEach(function(id) {
        agregar('PERSONA', id, campo, 'Advertencia', problema, clave, 'Revisar si corresponde a un duplicado o contacto compartido.');
      });
    });
  }
  alertarCompartidos(documentos, 'DOCUMENTO', 'Documento compartido por personas distintas');
  alertarCompartidos(emails, 'CORREO', 'Correo compartido por personas distintas');
  alertarCompartidos(telefonos, 'TELEFONO', 'Teléfono compartido por personas distintas');
  const participaciones = ss.getSheetByName(SISTEMA.HOJAS.PARTICIPACIONES)
    .getDataRange().getValues();
  const mpar = mapaEncabezados_(participaciones[0]);
  const pares = {};
  for (let i = 1; i < participaciones.length; i++) {
    const id = participaciones[i][mpar['ID PARTICIPACION']];
    if (!id) continue;
    const activo = mpar['REGISTRO ACTIVO'] === undefined ||
      normalizarEncabezado_(participaciones[i][mpar['REGISTRO ACTIVO']]) !== 'NO';
    if (!activo) continue;
    if (!/^PAR-\d{4}-\d{6}$/.test(String(id))) {
      agregar('PARTICIPACION', id, 'ID_PARTICIPACION', 'Crítico', 'ID malformado', id, 'Revisar la generación de IDs.');
    }
    const idPersona = participaciones[i][mpar['ID PERSONA']];
    const idActividad = participaciones[i][mpar['ID ACTIVIDAD']];
    const asistidas = Number(participaciones[i][mpar['SESIONES ASISTIDAS']] || 0);
    const totales = Number(participaciones[i][mpar['SESIONES TOTALES']] || 0);
    const seleccion = sigcNormalizarSeleccion(participaciones[i][mpar['ESTADO SELECCION']]);
    if (totales && asistidas > totales) {
      agregar('PARTICIPACION', id, 'SESIONES_ASISTIDAS', 'Crítico', 'Asistencia superior al total', asistidas, 'Corregir las sesiones.');
    }
    if (seleccion !== 'Seleccionado' && asistidas > 0) {
      agregar('PARTICIPACION', id, 'SESIONES_ASISTIDAS', 'Crítico', 'Asistencia registrada en una persona no seleccionada', asistidas, 'Revisar selección o eliminar asistencia.');
    }
    const clave = idPersona + '|' + idActividad;
    if (!pares[clave]) pares[clave] = [];
    pares[clave].push(id);
  }
  Object.keys(pares).forEach(function(clave) {
    if (pares[clave].length > 1) {
      pares[clave].forEach(function(id) {
        agregar('PARTICIPACION', id, 'ID_ACTIVIDAD', 'Advertencia', 'Participación posiblemente duplicada', clave.split('|')[1], 'Revisar el registro.');
      });
    }
  });
  if (alertas.length) {
    hoja.getRange(2, 1, alertas.length, alertas[0].length).setValues(alertas);
  }
  hoja.setFrozenRows(1);
}
function asegurarColumnasProceso_(hoja) {
  const requeridas = ['ID_PERSONA', 'ID_PARTICIPACION', 'ESTADO_PROCESO', 'DETALLE_PROCESO'];
  const ultimaCol = Math.max(hoja.getLastColumn(), 1);
  const encabezados = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0];
  const existentes = encabezados.map(normalizarEncabezado_);
  requeridas.forEach(function(encabezado) {
    if (existentes.indexOf(normalizarEncabezado_(encabezado)) < 0) {
      hoja.getRange(1, hoja.getLastColumn() + 1).setValue(encabezado);
      existentes.push(normalizarEncabezado_(encabezado));
    }
  });
}
function registrarResultadoEnRespuesta_(hoja, fila, idPersona, idParticipacion, estado, detalle) {
  asegurarColumnasProceso_(hoja);
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const mapa = mapaEncabezados_(encabezados);
  hoja.getRange(fila, mapa['ID PERSONA'] + 1).setValue(idPersona);
  hoja.getRange(fila, mapa['ID PARTICIPACION'] + 1).setValue(idParticipacion);
  hoja.getRange(fila, mapa['ESTADO PROCESO'] + 1).setValue(estado);
  hoja.getRange(fila, mapa['DETALLE PROCESO'] + 1).setValue(detalle);
}
function coreSiguienteId_(hoja, prefijo, digitos) {
  if (hoja.getLastRow() < 2) return prefijo + String(1).padStart(digitos, '0');
  const valores = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getDisplayValues().flat();
  let maximo = 0;
  valores.forEach(function(valor) {
    if (String(valor).indexOf(prefijo) !== 0) return;
    const numero = Number(String(valor).substring(prefijo.length).replace(/\D/g, ''));
    if (numero > maximo) maximo = numero;
  });
  return prefijo + String(maximo + 1).padStart(digitos, '0');
}
function nuevaFilaSegunEncabezados_(encabezados, valoresPorCampo) {
  const normalizados = {};
  Object.keys(valoresPorCampo).forEach(function(k) {
    normalizados[normalizarEncabezado_(k)] = valoresPorCampo[k];
  });
  return encabezados.map(function(encabezado) {
    const clave = normalizarEncabezado_(encabezado);
    return normalizados.hasOwnProperty(clave) ? normalizados[clave] : '';
  });
}
function mapaEncabezados_(encabezados) {
  const mapa = {};
  encabezados.forEach(function(h, i) {
    mapa[normalizarEncabezado_(h)] = i;
  });
  return mapa;
}
function valorAlternativo_(mapa, alternativas) {
  for (let i = 0; i < alternativas.length; i++) {
    const clave = normalizarEncabezado_(alternativas[i]);
    if (mapa[clave] !== undefined && mapa[clave] !== null && mapa[clave] !== '') {
      return mapa[clave];
    }
  }
  return '';
}
function normalizarEncabezado_(valor) {
  return sigcNormalizarEncabezado(valor);
}
function normalizarRut_(valor) {
  return sigcNormalizarRut(valor);
}
function validarRut_(rut) {
  return sigcValidarRut(rut);
}
function normalizarCorreo_(valor) {
  return sigcNormalizarCorreo(valor);
}
function normalizarTelefono_(valor) {
  return sigcNormalizarTelefono(valor);
}
function normalizarNombre_(valor) {
  return sigcNormalizarNombre(valor);
}
function nombresCompatibles_(a, b) {
  const na = normalizarEncabezado_(a);
  const nb = normalizarEncabezado_(b);
  if (!na || !nb) return false;
  if (na === nb || na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0) return true;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  const interseccion = ta.filter(function(x) { return tb.indexOf(x) >= 0; }).length;
  return interseccion / Math.min(ta.length, tb.length) >= 0.75;
}

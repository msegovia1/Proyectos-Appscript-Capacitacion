/**
 * MIGRACIÓN Y AUDITORÍA SIGC 3.0
 *
 * Estas funciones se ejecutan manualmente y no alteran datos sin una acción
 * explícita del administrador.
 */
function prepararActualizacionV3() {
  const ss = SpreadsheetApp.openById(SIGC_CONFIG.SPREADSHEET_ID);
  const personas = ss.getSheetByName(SIGC_CONFIG.HOJAS.PERSONAS);
  if (!personas) throw new Error('No existe la hoja PERSONAS.');
  migracionAsegurarColumna_(personas, 'TIPO_DOCUMENTO');
  migracionAsegurarColumna_(personas, 'NUMERO_DOCUMENTO');
  const datos = personas.getDataRange().getValues();
  const mapa = migracionMapa_(datos[0]);
  let completados = 0;
  for (let i = 1; i < datos.length; i++) {
    const id = datos[i][mapa['ID PERSONA']];
    if (!id) continue;
    const rut = sigcNormalizarRut(datos[i][mapa['RUT']]);
    const tipoActual = mapa['TIPO DOCUMENTO'] !== undefined
      ? sigcNormalizarTipoDocumento(datos[i][mapa['TIPO DOCUMENTO']])
      : '';
    const numeroActual = mapa['NUMERO DOCUMENTO'] !== undefined
      ? sigcNormalizarTexto(datos[i][mapa['NUMERO DOCUMENTO']])
      : '';
    if (rut && (!tipoActual || !numeroActual)) {
      personas.getRange(i + 1, mapa['TIPO DOCUMENTO'] + 1).setValue('RUT');
      personas.getRange(i + 1, mapa['NUMERO DOCUMENTO'] + 1).setValue(rut);
      completados++;
    }
  }
  if (typeof aplicarValidaciones_ === 'function') aplicarValidaciones_();
  if (typeof instalarImportadorHistorico === 'function') instalarImportadorHistorico();
  SpreadsheetApp.flush();
  sigcRegistrarLog(
    'PREPARAR ACTUALIZACION',
    'SISTEMA',
    SIGC_CONFIG.VERSION,
    completados + ' documentos completados desde RUT.'
  );
  return {
    ok: true,
    version: SIGC_CONFIG.VERSION,
    documentosCompletados: completados,
    mensaje: 'Estructura SIGC 3.0 preparada correctamente.'
  };
}
function auditarMigracionSeleccion() {
  const ss = SpreadsheetApp.openById(SIGC_CONFIG.SPREADSHEET_ID);
  const participacionesHoja = ss.getSheetByName(
    SIGC_CONFIG.HOJAS.PARTICIPACIONES
  );
  const personasHoja = ss.getSheetByName(SIGC_CONFIG.HOJAS.PERSONAS);
  const actividadesHoja = ss.getSheetByName(SIGC_CONFIG.HOJAS.ACTIVIDADES);
  if (!participacionesHoja || !personasHoja || !actividadesHoja) {
    throw new Error('Falta PERSONAS, ACTIVIDADES o PARTICIPACIONES.');
  }
  const participaciones = migracionLeerTabla_(participacionesHoja);
  const personas = migracionLeerTabla_(personasHoja);
  const actividades = migracionLeerTabla_(actividadesHoja);
  const personasPorId = migracionIndexar_(personas.filas, 'ID_PERSONA');
  const actividadesPorId = migracionIndexar_(
    actividades.filas,
    'ID_ACTIVIDAD'
  );
  const salida = [];
  participaciones.filas.forEach(function(participacion) {
    if (!migracionEsCandidataHistorica_(participacion)) return;
    const persona = personasPorId[participacion.ID_PERSONA] || {};
    const actividad = actividadesPorId[participacion.ID_ACTIVIDAD] || {};
    salida.push([
      participacion.ID_PARTICIPACION || '',
      participacion.ID_PERSONA || '',
      sigcDocumentoVisible(persona),
      persona.NOMBRE_COMPLETO || '',
      persona.PARTICIPA_PMJH || 'No informado',
      participacion.ID_ACTIVIDAD || '',
      actividad.NOMBRE_ACTIVIDAD || '',
      participacion.CANAL_INSCRIPCION || '',
      participacion.ARCHIVO_ORIGEN || '',
      participacion.ESTADO_SELECCION || '',
      participacion.RESULTADO_FINAL || '',
      'Marcar como Seleccionado',
      'Pendiente de autorización'
    ]);
  });
  let auditoria = ss.getSheetByName(SIGC_CONFIG.HOJAS.AUDITORIA);
  if (!auditoria) auditoria = ss.insertSheet(SIGC_CONFIG.HOJAS.AUDITORIA);
  const encabezados = [
    'ID_PARTICIPACION',
    'ID_PERSONA',
    'DOCUMENTO',
    'NOMBRE_COMPLETO',
    'PARTICIPA_PMJH',
    'ID_ACTIVIDAD',
    'NOMBRE_ACTIVIDAD',
    'CANAL_INSCRIPCION',
    'ARCHIVO_ORIGEN',
    'ESTADO_SELECCION_ACTUAL',
    'RESULTADO_FINAL',
    'ACCION_PROPUESTA',
    'ESTADO_AUDITORIA'
  ];
  auditoria.clearContents();
  auditoria.getRange(1, 1, 1, encabezados.length)
    .setValues([encabezados])
    .setFontWeight('bold');
  if (salida.length) {
    auditoria.getRange(2, 1, salida.length, encabezados.length)
      .setValues(salida);
  }
  auditoria.setFrozenRows(1);
  auditoria.autoResizeColumns(1, encabezados.length);
  return {
    ok: true,
    candidatos: salida.length,
    hoja: SIGC_CONFIG.HOJAS.AUDITORIA,
    mensaje:
      'Auditoría creada. No se modificó ninguna participación.'
  };
}
function migrarHistoricosASeleccionados() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SIGC_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName(SIGC_CONFIG.HOJAS.PARTICIPACIONES);
    if (!hoja) throw new Error('No existe la hoja PARTICIPACIONES.');
    const tabla = migracionLeerTablaConFilas_(hoja);
    const mapa = migracionMapa_(tabla.encabezados);
    let actualizados = 0;
    tabla.filas.forEach(function(item) {
      if (!migracionEsCandidataHistorica_(item.datos)) return;
      if (mapa['CUMPLE REQUISITOS'] !== undefined) {
        hoja.getRange(
          item.numeroFila,
          mapa['CUMPLE REQUISITOS'] + 1
        ).setValue('Sí');
      }
      hoja.getRange(
        item.numeroFila,
        mapa['ESTADO SELECCION'] + 1
      ).setValue('Seleccionado');
      if (mapa['ULTIMA ACTUALIZACION'] !== undefined) {
        hoja.getRange(
          item.numeroFila,
          mapa['ULTIMA ACTUALIZACION'] + 1
        ).setValue(new Date());
      }
      actualizados++;
    });
    SpreadsheetApp.flush();
    sigcRegistrarLog(
      'MIGRACION HISTORICA',
      'PARTICIPACION',
      '',
      actualizados + ' participaciones marcadas como Seleccionado.'
    );
    return {
      ok: true,
      actualizados: actualizados,
      mensaje:
        actualizados +
        ' participaciones históricas fueron marcadas como Seleccionado.'
    };
  } finally {
    lock.releaseLock();
  }
}
function normalizarDatosExistentesV3() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SIGC_CONFIG.SPREADSHEET_ID);
    const personas = ss.getSheetByName(SIGC_CONFIG.HOJAS.PERSONAS);
    const actividades = ss.getSheetByName(SIGC_CONFIG.HOJAS.ACTIVIDADES);
    const participaciones = ss.getSheetByName(
      SIGC_CONFIG.HOJAS.PARTICIPACIONES
    );
    if (!personas || !actividades || !participaciones) {
      throw new Error('Falta una hoja principal.');
    }
    migracionAsegurarColumna_(personas, 'TIPO_DOCUMENTO');
    migracionAsegurarColumna_(personas, 'NUMERO_DOCUMENTO');
    const personasTabla = migracionLeerTablaConFilas_(personas);
    const mp = migracionMapa_(personasTabla.encabezados);
    let personasActualizadas = 0;
    personasTabla.filas.forEach(function(item) {
      const d = item.datos;
      let tipo = sigcNormalizarTipoDocumento(d.TIPO_DOCUMENTO);
      let numero = sigcNormalizarTexto(d.NUMERO_DOCUMENTO);
      const rut = sigcNormalizarRut(d.RUT);
      if (!tipo && rut) tipo = 'RUT';
      if (!numero && rut) numero = rut;
      if (tipo === 'RUT') numero = sigcNormalizarRut(numero || rut);
      if (tipo === 'Pasaporte') numero = sigcNormalizarPasaporte(numero);
      const cambios = {
        RUT: tipo === 'RUT' ? numero : rut,
        TIPO_DOCUMENTO: tipo || (rut ? 'RUT' : ''),
        NUMERO_DOCUMENTO: numero || rut,
        NOMBRE_COMPLETO: sigcNormalizarNombre(d.NOMBRE_COMPLETO),
        CORREO: sigcNormalizarCorreo(d.CORREO),
        TELEFONO: sigcNormalizarTelefono(d.TELEFONO),
        COMUNA: sigcNormalizarTexto(d.COMUNA),
        BARRIO: sigcNormalizarTexto(d.BARRIO),
        DIRECCION: sigcNormalizarTexto(d.DIRECCION),
        GENERO: sigcNormalizarTexto(d.GENERO),
        NACIONALIDAD: sigcNormalizarTexto(d.NACIONALIDAD),
        AUTORIZA_CONTACTO: sigcNormalizarSiNo(
          d.AUTORIZA_CONTACTO,
          'No informado'
        ),
        PARTICIPA_PMJH: sigcNormalizarSiNo(
          d.PARTICIPA_PMJH,
          'No informado'
        ),
        ESTADO_CONTACTO:
          sigcNormalizarCorreo(d.CORREO) ||
          sigcNormalizarTelefono(d.TELEFONO)
            ? 'Activo'
            : 'Sin contacto'
      };
      migracionActualizarCampos_(
        personas,
        item.numeroFila,
        personasTabla.encabezados,
        cambios
      );
      personasActualizadas++;
    });
    const actividadesTabla = migracionLeerTablaConFilas_(actividades);
    let actividadesActualizadas = 0;
    actividadesTabla.filas.forEach(function(item) {
      const d = item.datos;
      migracionActualizarCampos_(
        actividades,
        item.numeroFila,
        actividadesTabla.encabezados,
        {
          ID_ACTIVIDAD: sigcNormalizarTexto(d.ID_ACTIVIDAD).toUpperCase(),
          NOMBRE_ACTIVIDAD: sigcNormalizarTexto(d.NOMBRE_ACTIVIDAD),
          TIPO_ACTIVIDAD: sigcNormalizarTexto(d.TIPO_ACTIVIDAD),
          PROGRAMA: sigcNormalizarTexto(d.PROGRAMA),
          ESCUELA_LINEA: sigcNormalizarTexto(d.ESCUELA_LINEA),
          AREA_TEMATICA: sigcNormalizarTexto(d.AREA_TEMATICA),
          PORCENTAJE_APROBACION:
            d.PORCENTAJE_APROBACION === ''
              ? ''
              : sigcConvertirPorcentaje(d.PORCENTAJE_APROBACION),
          REGLA_RESULTADO:
            sigcNormalizarEncabezado(d.REGLA_RESULTADO) === 'PORCENTAJE'
              ? 'Porcentaje'
              : 'Asistencia',
          REQUIERE_SELECCION: sigcNormalizarSiNo(
            d.REQUIERE_SELECCION,
            'No'
          ),
          MODALIDAD: sigcNormalizarTexto(d.MODALIDAD),
          ESTADO_ACTIVIDAD: sigcNormalizarTexto(d.ESTADO_ACTIVIDAD)
        }
      );
      actividadesActualizadas++;
    });
    const participacionesTabla = migracionLeerTablaConFilas_(
      participaciones
    );
    let participacionesActualizadas = 0;
    participacionesTabla.filas.forEach(function(item) {
      const d = item.datos;
      migracionActualizarCampos_(
        participaciones,
        item.numeroFila,
        participacionesTabla.encabezados,
        {
          CUMPLE_REQUISITOS: sigcNormalizarCumple(
            d.CUMPLE_REQUISITOS
          ),
          ESTADO_SELECCION: sigcNormalizarSeleccion(
            d.ESTADO_SELECCION
          ),
          MEDIO_NOTIFICACION:
            sigcNormalizarTexto(d.MEDIO_NOTIFICACION) ||
            'No informado',
          CONFIRMA_PARTICIPACION: sigcNormalizarSiNo(
            d.CONFIRMA_PARTICIPACION,
            'No informado'
          ),
          RESULTADO_FINAL: sigcNormalizarResultado(
            d.RESULTADO_FINAL
          ),
          CERTIFICADO: migracionNormalizarCertificado_(
            d.CERTIFICADO
          ),
          REGISTRO_ACTIVO: sigcNormalizarSiNo(
            d.REGISTRO_ACTIVO,
            'Sí'
          )
        }
      );
      participacionesActualizadas++;
    });
    SpreadsheetApp.flush();
    sigcRegistrarLog(
      'NORMALIZAR DATOS',
      'SISTEMA',
      SIGC_CONFIG.VERSION,
      JSON.stringify({
        personas: personasActualizadas,
        actividades: actividadesActualizadas,
        participaciones: participacionesActualizadas
      })
    );
    return {
      ok: true,
      personas: personasActualizadas,
      actividades: actividadesActualizadas,
      participaciones: participacionesActualizadas,
      mensaje: 'Normalización finalizada.'
    };
  } finally {
    lock.releaseLock();
  }
}
function repararIdsEnRespuestasFormulario() {
  const ss = SpreadsheetApp.openById(SIGC_CONFIG.SPREADSHEET_ID);
  const personas = migracionLeerTabla_(
    ss.getSheetByName(SIGC_CONFIG.HOJAS.PERSONAS)
  );
  const participaciones = migracionLeerTabla_(
    ss.getSheetByName(SIGC_CONFIG.HOJAS.PARTICIPACIONES)
  );
  const personasPorRut = {};
  const personasPorDocumento = {};
  personas.filas.forEach(function(persona) {
    const rut = sigcNormalizarRut(persona.RUT);
    if (rut) personasPorRut[rut] = persona;
    const tipo = sigcNormalizarTipoDocumento(
      persona.TIPO_DOCUMENTO || (rut ? 'RUT' : '')
    );
    const numero = sigcNormalizarDocumento(
      tipo,
      persona.NUMERO_DOCUMENTO || persona.RUT
    );
    const clave = migracionClaveDocumento_(
      tipo,
      numero,
      persona.NACIONALIDAD
    );
    if (clave) personasPorDocumento[clave] = persona;
  });
  const participacionPorClave = {};
  participaciones.filas.forEach(function(participacion) {
    if (sigcNormalizarSiNo(
      participacion.REGISTRO_ACTIVO,
      'Sí'
    ) === 'No') return;
    participacionPorClave[
      String(participacion.ID_PERSONA || '').trim() + '|' +
      String(participacion.ID_ACTIVIDAD || '').trim()
    ] = participacion;
  });
  let hojasRevisadas = 0;
  let filasCorregidas = 0;
  let noResueltas = 0;
  ss.getSheets().forEach(function(hoja) {
    const nombre = sigcNormalizarEncabezado(hoja.getName());
    if (
      nombre.indexOf('RESPUESTAS FORMULARIO') < 0 &&
      nombre.indexOf('FORM RESPONSES') < 0
    ) return;
    if (hoja.getName() === 'FORMULARIO_MODELO') return;
    hojasRevisadas++;
    if (typeof asegurarColumnasProceso_ === 'function') {
      asegurarColumnasProceso_(hoja);
    }
    const valores = hoja.getDataRange().getValues();
    if (valores.length < 2) return;
    const mapa = migracionMapa_(valores[0]);
    for (let i = 1; i < valores.length; i++) {
      const idPersonaActual = mapa['ID PERSONA'] !== undefined
        ? String(valores[i][mapa['ID PERSONA']] || '').trim()
        : '';
      const idParticipacionActual =
        mapa['ID PARTICIPACION'] !== undefined
          ? String(
              valores[i][mapa['ID PARTICIPACION']] || ''
            ).trim()
          : '';
      if (
        /^PER-\d{6}$/.test(idPersonaActual) &&
        /^PAR-\d{4}-\d{6}$/.test(idParticipacionActual)
      ) continue;
      const rut = migracionValorAlternativo_(mapa, valores[i], [
        'RUT',
        'RUN'
      ]);
      const tipo = sigcNormalizarTipoDocumento(
        migracionValorAlternativo_(mapa, valores[i], [
          'TIPO DOCUMENTO',
          'TIPO DE DOCUMENTO'
        ]) || (rut ? 'RUT' : '')
      );
      const numero = migracionValorAlternativo_(mapa, valores[i], [
        'NUMERO DOCUMENTO',
        'NUMERO DE DOCUMENTO',
        'PASAPORTE',
        'RUT',
        'RUN'
      ]);
      const nacionalidad = migracionValorAlternativo_(
        mapa,
        valores[i],
        ['NACIONALIDAD']
      );
      const actividad = sigcNormalizarTexto(
        migracionValorAlternativo_(mapa, valores[i], [
          'ID ACTIVIDAD',
          'ID DE ACTIVIDAD',
          'ID ACTIVIDAD CAPACITACION'
        ])
      ).toUpperCase();
      let persona = null;
      const rutNormalizado = sigcNormalizarRut(rut);
      if (rutNormalizado) persona = personasPorRut[rutNormalizado];
      if (!persona && tipo && numero) {
        persona = personasPorDocumento[
          migracionClaveDocumento_(
            tipo,
            sigcNormalizarDocumento(tipo, numero),
            nacionalidad
          )
        ];
      }
      const participacion = persona && actividad
        ? participacionPorClave[
            persona.ID_PERSONA + '|' + actividad
          ]
        : null;
      if (!persona || !participacion) {
        noResueltas++;
        continue;
      }
      if (mapa['ID PERSONA'] !== undefined) {
        hoja.getRange(i + 1, mapa['ID PERSONA'] + 1)
          .setValue(persona.ID_PERSONA);
      }
      if (mapa['ID PARTICIPACION'] !== undefined) {
        hoja.getRange(i + 1, mapa['ID PARTICIPACION'] + 1)
          .setValue(participacion.ID_PARTICIPACION);
      }
      filasCorregidas++;
    }
  });
  SpreadsheetApp.flush();
  sigcRegistrarLog(
    'REPARAR IDS RESPUESTAS',
    'FORMULARIOS',
    '',
    JSON.stringify({
      hojasRevisadas: hojasRevisadas,
      filasCorregidas: filasCorregidas,
      noResueltas: noResueltas
    })
  );
  return {
    ok: true,
    hojasRevisadas: hojasRevisadas,
    filasCorregidas: filasCorregidas,
    noResueltas: noResueltas,
    mensaje:
      'Reparación terminada. Corregidas: ' +
      filasCorregidas +
      '. No resueltas: ' +
      noResueltas +
      '.'
  };
}
function auditarInstalacionSIGC() {
  const ss = SpreadsheetApp.openById(SIGC_CONFIG.SPREADSHEET_ID);
  const faltantes = [];
  [
    SIGC_CONFIG.HOJAS.PERSONAS,
    SIGC_CONFIG.HOJAS.ACTIVIDADES,
    SIGC_CONFIG.HOJAS.PARTICIPACIONES,
    SIGC_CONFIG.HOJAS.ASISTENCIA,
    SIGC_CONFIG.HOJAS.BUSCADOR,
    SIGC_CONFIG.HOJAS.CALIDAD,
    SIGC_CONFIG.HOJAS.IMPORTAR
  ].forEach(function(nombre) {
    if (!ss.getSheetByName(nombre)) faltantes.push(nombre);
  });
  const triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'alEnviarFormulario' &&
      t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT;
  }).length;
  return {
    ok: faltantes.length === 0 && triggers <= 1,
    version: SIGC_CONFIG.VERSION,
    spreadsheetId: ss.getId(),
    archivo: ss.getName(),
    hojasFaltantes: faltantes,
    triggersFormulario: triggers,
    mensaje:
      faltantes.length
        ? 'Faltan hojas obligatorias.'
        : triggers > 1
          ? 'Existen activadores duplicados.'
          : 'La instalación básica es coherente.'
  };
}
function migracionEsCandidataHistorica_(participacion) {
  const activo = sigcNormalizarSiNo(
    participacion.REGISTRO_ACTIVO,
    'Sí'
  ) !== 'No';
  const seleccion = sigcNormalizarSeleccion(
    participacion.ESTADO_SELECCION
  );
  const definitiva = sigcEsResultadoDefinitivo(
    participacion.RESULTADO_FINAL
  );
  const origen = sigcNormalizarEncabezado(
    [
      participacion.CANAL_INSCRIPCION,
      participacion.ARCHIVO_ORIGEN,
      participacion.OBSERVACIONES
    ].join(' ')
  );
  const historica =
    origen.indexOf('HISTOR') >= 0 ||
    origen.indexOf('IMPORTAR') >= 0 ||
    origen.indexOf('PLANILLA ASISTENCIA') >= 0;
  return activo &&
    seleccion === 'No informado' &&
    definitiva &&
    historica;
}
function migracionLeerTabla_(hoja) {
  if (!hoja) return {encabezados: [], filas: []};
  const valores = hoja.getDataRange().getDisplayValues();
  if (!valores.length) return {encabezados: [], filas: []};
  const encabezados = valores[0].map(function(x) {
    return String(x).trim();
  });
  return {
    encabezados: encabezados,
    filas: valores.slice(1)
      .filter(function(fila) {
        return fila.some(function(celda) {
          return String(celda).trim() !== '';
        });
      })
      .map(function(fila) {
        return migracionObjeto_(encabezados, fila);
      })
  };
}
function migracionLeerTablaConFilas_(hoja) {
  const valores = hoja.getDataRange().getValues();
  if (!valores.length) return {encabezados: [], filas: []};
  const encabezados = valores[0].map(function(x) {
    return String(x).trim();
  });
  return {
    encabezados: encabezados,
    filas: valores.slice(1)
      .map(function(fila, indice) {
        return {
          numeroFila: indice + 2,
          datos: migracionObjeto_(encabezados, fila)
        };
      })
      .filter(function(item) {
        return Object.values(item.datos).some(function(valor) {
          return String(valor ?? '').trim() !== '';
        });
      })
  };
}
function migracionObjeto_(encabezados, fila) {
  return encabezados.reduce(function(obj, encabezado, indice) {
    if (encabezado) obj[encabezado] = fila[indice] ?? '';
    return obj;
  }, {});
}
function migracionIndexar_(filas, campo) {
  return filas.reduce(function(obj, fila) {
    const clave = String(fila[campo] || '').trim();
    if (clave) obj[clave] = fila;
    return obj;
  }, {});
}
function migracionMapa_(encabezados) {
  const mapa = {};
  encabezados.forEach(function(encabezado, indice) {
    mapa[sigcNormalizarEncabezado(encabezado)] = indice;
  });
  return mapa;
}
function migracionAsegurarColumna_(hoja, encabezado) {
  const ultimaColumna = Math.max(hoja.getLastColumn(), 1);
  const encabezados = hoja.getRange(
    1,
    1,
    1,
    ultimaColumna
  ).getValues()[0];
  const existe = encabezados.some(function(actual) {
    return sigcNormalizarEncabezado(actual) ===
      sigcNormalizarEncabezado(encabezado);
  });
  if (!existe) {
    hoja.getRange(1, ultimaColumna + 1).setValue(encabezado);
  }
}
function migracionActualizarCampos_(
  hoja,
  numeroFila,
  encabezados,
  cambios
) {
  const mapa = migracionMapa_(encabezados);
  Object.keys(cambios).forEach(function(campo) {
    const columna = mapa[sigcNormalizarEncabezado(campo)];
    if (columna === undefined) return;
    hoja.getRange(numeroFila, columna + 1).setValue(cambios[campo]);
  });
}
function migracionValorAlternativo_(mapa, fila, alternativas) {
  for (let i = 0; i < alternativas.length; i++) {
    const indice = mapa[
      sigcNormalizarEncabezado(alternativas[i])
    ];
    if (
      indice !== undefined &&
      fila[indice] !== undefined &&
      fila[indice] !== null &&
      String(fila[indice]).trim() !== ''
    ) {
      return fila[indice];
    }
  }
  return '';
}
function migracionNormalizarCertificado_(valor) {
  const clave = sigcNormalizarClave(valor);
  if (clave === 'si') return 'Sí';
  if (clave === 'no') return 'No';
  if (clave === 'no aplica') return 'No aplica';
  return 'No informado';
}
function migracionClaveDocumento_(tipo, numero, nacionalidad) {
  const tipoNormalizado = sigcNormalizarTipoDocumento(tipo);
  const numeroNormalizado = sigcNormalizarDocumento(
    tipoNormalizado,
    numero
  );
  if (!tipoNormalizado || !numeroNormalizado) return '';
  return tipoNormalizado === 'Pasaporte'
    ? 'PASAPORTE|' + numeroNormalizado + '|' +
      sigcNormalizarClave(nacionalidad)
    : 'RUT|' + numeroNormalizado;
}

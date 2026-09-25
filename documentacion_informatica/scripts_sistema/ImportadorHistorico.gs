/**
 * IMPORTADOR HISTÓRICO SIGC 3.0
 * Compatible con RUT, pasaporte, PMJH y reglas de resultado.
 */
const IMPORTADOR_HISTORICO_CONFIG = Object.freeze({
  HOJA_IMPORTACION: SIGC_CONFIG.HOJAS.IMPORTAR,
  ENCABEZADOS: [
    'PROCESAR',
    'TIPO_DOCUMENTO',
    'NUMERO_DOCUMENTO',
    'RUT',
    'NOMBRE_COMPLETO',
    'CORREO',
    'TELEFONO',
    'COMUNA',
    'NACIONALIDAD',
    'PARTICIPA_PMJH',
    'ID_ACTIVIDAD',
    'FECHA_INSCRIPCION',
    'SESIONES_ASISTIDAS',
    'SESIONES_TOTALES',
    'OBSERVACIONES',
    'ESTADO_PROCESO',
    'ID_PERSONA_RESULTADO',
    'ID_PARTICIPACION_RESULTADO',
    'DETALLE_PROCESO'
  ]
});
function instalarImportadorHistorico() {
  const ss = SpreadsheetApp.openById(WEBAPP_CONFIG.SPREADSHEET_ID);
  let hoja = ss.getSheetByName(
    IMPORTADOR_HISTORICO_CONFIG.HOJA_IMPORTACION
  );
  if (!hoja) {
    hoja = ss.insertSheet(
      IMPORTADOR_HISTORICO_CONFIG.HOJA_IMPORTACION
    );
  }
  importadorAsegurarEncabezados_(
    hoja,
    IMPORTADOR_HISTORICO_CONFIG.ENCABEZADOS
  );
  hoja.getRange(
    1,
    1,
    1,
    hoja.getLastColumn()
  )
    .setFontWeight('bold')
    .setWrap(true);
  hoja.setFrozenRows(1);
  const encabezados = hoja.getRange(
    1,
    1,
    1,
    hoja.getLastColumn()
  ).getValues()[0];
  const mapa = importadorMapaEncabezados_(encabezados);
  importadorAplicarLista_(
    hoja,
    mapa,
    'PROCESAR',
    ['Sí', 'No']
  );
  importadorAplicarLista_(
    hoja,
    mapa,
    'TIPO_DOCUMENTO',
    ['RUT', 'Pasaporte']
  );
  importadorAplicarLista_(
    hoja,
    mapa,
    'PARTICIPA_PMJH',
    ['Sí', 'No', 'No informado']
  );
  hoja.autoResizeColumns(1, hoja.getLastColumn());
  ss.toast(
    'Se creó o actualizó la hoja IMPORTAR_ASISTENTES.',
    'Importador instalado',
    5
  );
  return {
    ok: true,
    hoja: IMPORTADOR_HISTORICO_CONFIG.HOJA_IMPORTACION
  };
}
function procesarAsistentesHistoricos() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(
      WEBAPP_CONFIG.SPREADSHEET_ID
    );
    const importacion = ss.getSheetByName(
      IMPORTADOR_HISTORICO_CONFIG.HOJA_IMPORTACION
    );
    const personasHoja = ss.getSheetByName(
      WEBAPP_CONFIG.HOJAS.PERSONAS
    );
    const actividadesHoja = ss.getSheetByName(
      WEBAPP_CONFIG.HOJAS.ACTIVIDADES
    );
    const participacionesHoja = ss.getSheetByName(
      WEBAPP_CONFIG.HOJAS.PARTICIPACIONES
    );
    if (!importacion) {
      throw new Error(
        'No existe IMPORTAR_ASISTENTES. Ejecute instalarImportadorHistorico().'
      );
    }
    if (!personasHoja || !actividadesHoja ||
        !participacionesHoja) {
      throw new Error(
        'Falta una hoja principal: PERSONAS, ACTIVIDADES o PARTICIPACIONES.'
      );
    }
    importadorAsegurarColumna_(personasHoja, 'TIPO_DOCUMENTO');
    importadorAsegurarColumna_(personasHoja, 'NUMERO_DOCUMENTO');
    const valores = importacion.getDataRange().getDisplayValues();
    if (valores.length < 2) {
      throw new Error('No hay filas para procesar.');
    }
    const encabezados = valores[0].map(function(valor) {
      return String(valor).trim();
    });
    validarEncabezadosImportador_(encabezados);
    const col = importadorMapaEncabezados_(encabezados);
    const personas = leerTablaImportador_(personasHoja);
    const actividades = leerTablaImportador_(actividadesHoja);
    const participaciones = leerTablaImportador_(
      participacionesHoja
    );
    const personasPorDocumento = new Map();
    personas.filas.forEach(function(fila) {
      const clave = importadorClavePersona_(fila.datos);
      if (clave && !personasPorDocumento.has(clave)) {
        personasPorDocumento.set(clave, fila);
      }
    });
    const actividadesPorId = new Map(
      actividades.filas.map(function(fila) {
        return [
          String(fila.datos.ID_ACTIVIDAD || '').trim(),
          fila.datos
        ];
      })
    );
    const participacionesActivas = new Set();
    participaciones.filas.forEach(function(fila) {
      if (sigcNormalizarSiNo(
            fila.datos.REGISTRO_ACTIVO,
            'Sí'
          ) !== 'No') {
        participacionesActivas.add(
          String(fila.datos.ID_PERSONA || '').trim() +
          '|' +
          String(fila.datos.ID_ACTIVIDAD || '').trim()
        );
      }
    });
    let personasCreadas = 0;
    let personasActualizadas = 0;
    let participacionesCreadas = 0;
    let duplicadosOmitidos = 0;
    let errores = 0;
    for (let indice = 1; indice < valores.length; indice++) {
      const numeroFila = indice + 1;
      const fila = valores[indice];
      if (sigcNormalizarSiNo(
            importadorValor_(fila, col, 'PROCESAR'),
            'No'
          ) !== 'Sí') {
        continue;
      }
      try {
        const rutOriginal = importadorValor_(
          fila,
          col,
          'RUT'
        );
        const tipoDocumento = sigcNormalizarTipoDocumento(
          importadorValor_(fila, col, 'TIPO_DOCUMENTO'),
          rutOriginal
        );
        const numeroDocumento = sigcNormalizarDocumento(
          tipoDocumento,
          importadorValor_(fila, col, 'NUMERO_DOCUMENTO'),
          rutOriginal
        );
        const nacionalidad = sigcNormalizarTexto(
          importadorValor_(fila, col, 'NACIONALIDAD')
        );
        const documento = sigcValidarDocumento(
          tipoDocumento,
          numeroDocumento,
          nacionalidad
        );
        const nombre = sigcNormalizarNombre(
          importadorValor_(fila, col, 'NOMBRE_COMPLETO')
        );
        const correo = sigcNormalizarCorreo(
          importadorValor_(fila, col, 'CORREO')
        );
        const telefono = sigcNormalizarTelefono(
          importadorValor_(fila, col, 'TELEFONO')
        );
        const idActividad = String(
          importadorValor_(fila, col, 'ID_ACTIVIDAD') || ''
        ).trim();
        if (!nombre) {
          throw new Error('Debe indicar el nombre completo.');
        }
        if (!idActividad) {
          throw new Error('Debe indicar el ID_ACTIVIDAD.');
        }
        if (!sigcValidarCorreo(correo)) {
          throw new Error('El correo electrónico no es válido.');
        }
        if (!sigcValidarTelefono(telefono)) {
          throw new Error('El teléfono no tiene un formato chileno válido.');
        }
        const actividad = actividadesPorId.get(idActividad);
        if (!actividad) {
          throw new Error(
            'El ID_ACTIVIDAD no existe: ' + idActividad
          );
        }
        const claveDocumento = importadorClaveDocumento_(
          documento.tipo,
          documento.numero,
          nacionalidad
        );
        let personaFila = personasPorDocumento.get(
          claveDocumento
        );
        let idPersona;
        const datosPersona = {
          RUT: documento.tipo === 'RUT'
            ? documento.numero
            : '',
          TIPO_DOCUMENTO: documento.tipo,
          NUMERO_DOCUMENTO: documento.numero,
          NOMBRE_COMPLETO: nombre,
          CORREO: correo,
          TELEFONO: telefono,
          COMUNA: sigcNormalizarTexto(
            importadorValor_(fila, col, 'COMUNA')
          ),
          NACIONALIDAD: nacionalidad,
          PARTICIPA_PMJH: sigcNormalizarSiNo(
            importadorValor_(fila, col, 'PARTICIPA_PMJH'),
            'No informado'
          )
        };
        if (!personaFila) {
          idPersona = siguienteIdImportador_(
            personasHoja,
            'ID_PERSONA',
            'PER-',
            6
          );
          const ahora = new Date();
          agregarFilaImportador_(
            personasHoja,
            personas.encabezados,
            Object.assign({
              ID_PERSONA: idPersona,
              AUTORIZA_CONTACTO: 'No informado',
              FECHA_PRIMER_REGISTRO: ahora,
              ORIGEN_REGISTRO: 'Importación histórica',
              ESTADO_CONTACTO: correo || telefono
                ? 'Activo'
                : 'Sin contacto',
              ULTIMA_ACTUALIZACION: ahora,
              OBSERVACIONES:
                'Creado mediante importación de asistentes históricos.'
            }, datosPersona)
          );
          personaFila = {
            numeroFila: personasHoja.getLastRow(),
            datos: Object.assign({
              ID_PERSONA: idPersona
            }, datosPersona)
          };
          personasPorDocumento.set(
            claveDocumento,
            personaFila
          );
          personasCreadas++;
        } else {
          idPersona = String(
            personaFila.datos.ID_PERSONA || ''
          ).trim();
          if (!idPersona) {
            throw new Error(
              'La persona existe, pero no tiene ID_PERSONA.'
            );
          }
          importadorActualizarPersonaSinBorrar_(
            personasHoja,
            personas.encabezados,
            personaFila.numeroFila,
            datosPersona
          );
          personasActualizadas++;
        }
        const claveParticipacion =
          idPersona + '|' + idActividad;
        if (participacionesActivas.has(
              claveParticipacion
            )) {
          escribirResultadoImportador_(
            importacion,
            numeroFila,
            col,
            'OMITIDO',
            idPersona,
            '',
            'La persona ya posee una participación activa en esta actividad.'
          );
          duplicadosOmitidos++;
          continue;
        }
        const sesionesTotales = numeroSeguroImportador_(
          importadorValor_(
            fila,
            col,
            'SESIONES_TOTALES'
          ),
          actividad.SESIONES_TOTALES || 1
        );
        const sesionesAsistidas = numeroSeguroImportador_(
          importadorValor_(
            fila,
            col,
            'SESIONES_ASISTIDAS'
          ),
          sesionesTotales
        );
        if (sesionesTotales < 1) {
          throw new Error(
            'SESIONES_TOTALES debe ser al menos 1.'
          );
        }
        if (sesionesAsistidas > sesionesTotales) {
          throw new Error(
            'SESIONES_ASISTIDAS no puede ser mayor que SESIONES_TOTALES.'
          );
        }
        const porcentaje =
          sesionesAsistidas / sesionesTotales;
        const resultado = sigcCalcularResultado(
          actividad,
          sesionesAsistidas,
          sesionesTotales,
          true
        );
        const idParticipacion = siguienteIdImportador_(
          participacionesHoja,
          'ID_PARTICIPACION',
          'PAR-' + new Date().getFullYear() + '-',
          6
        );
        const ahora = new Date();
        agregarFilaImportador_(
          participacionesHoja,
          participaciones.encabezados,
          {
            ID_PARTICIPACION: idParticipacion,
            ID_PERSONA: idPersona,
            ID_ACTIVIDAD: idActividad,
            FECHA_INSCRIPCION:
              importadorValor_(
                fila,
                col,
                'FECHA_INSCRIPCION'
              ) || ahora,
            CANAL_INSCRIPCION: 'Registro histórico',
            CUMPLE_REQUISITOS: 'Sí',
            ESTADO_SELECCION: 'Seleccionado',
            FECHA_NOTIFICACION: '',
            MEDIO_NOTIFICACION: 'No informado',
            CONFIRMA_PARTICIPACION: 'Sí',
            SESIONES_ASISTIDAS: sesionesAsistidas,
            SESIONES_TOTALES: sesionesTotales,
            PORCENTAJE_ASISTENCIA: porcentaje,
            RESULTADO_ASISTENCIA:
              resultado.resultadoAsistencia,
            RESULTADO_FINAL:
              resultado.resultadoFinal,
            CERTIFICADO: 'No informado',
            FECHA_CERTIFICACION: '',
            OBSERVACIONES:
              importadorValor_(
                fila,
                col,
                'OBSERVACIONES'
              ) || 'Participación histórica importada.',
            ARCHIVO_ORIGEN: 'IMPORTAR_ASISTENTES',
            FILA_ORIGEN: numeroFila,
            REGISTRO_ACTIVO: 'Sí',
            ULTIMA_ACTUALIZACION: ahora
          }
        );
        participacionesActivas.add(
          claveParticipacion
        );
        participacionesCreadas++;
        escribirResultadoImportador_(
          importacion,
          numeroFila,
          col,
          'PROCESADO',
          idPersona,
          idParticipacion,
          'Registro procesado correctamente.'
        );
        sigcRegistrarLog(
          'IMPORTAR',
          'PARTICIPACION',
          idParticipacion,
          idPersona + ' | ' + idActividad
        );
      } catch (error) {
        errores++;
        escribirResultadoImportador_(
          importacion,
          numeroFila,
          col,
          'ERROR',
          '',
          '',
          error.message
        );
      }
    }
    SpreadsheetApp.flush();
    ss.toast(
      'Personas nuevas: ' + personasCreadas +
      ' | Personas actualizadas: ' + personasActualizadas +
      ' | Participaciones creadas: ' +
        participacionesCreadas +
      ' | Duplicados omitidos: ' +
        duplicadosOmitidos +
      ' | Errores: ' + errores,
      'Proceso finalizado',
      10
    );
    return {
      ok: true,
      personasCreadas: personasCreadas,
      personasActualizadas: personasActualizadas,
      participacionesCreadas:
        participacionesCreadas,
      duplicadosOmitidos:
        duplicadosOmitidos,
      errores: errores
    };
  } finally {
    lock.releaseLock();
  }
}
function limpiarResultadosImportadorHistorico() {
  const ss = SpreadsheetApp.openById(
    WEBAPP_CONFIG.SPREADSHEET_ID
  );
  const hoja = ss.getSheetByName(
    IMPORTADOR_HISTORICO_CONFIG.HOJA_IMPORTACION
  );
  if (!hoja) {
    throw new Error(
      'No existe la hoja IMPORTAR_ASISTENTES.'
    );
  }
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila <= 1) {
    ss.toast(
      'No hay registros para limpiar.',
      'Importador histórico',
      5
    );
    return;
  }
  hoja.getRange(
    2,
    1,
    ultimaFila - 1,
    hoja.getLastColumn()
  ).clearContent();
  ss.toast(
    'Se limpió completamente la hoja de importación.',
    'Importador histórico',
    5
  );
}
/* =========================
 * FUNCIONES PRIVADAS IMPORTADOR
 * ========================= */
function validarEncabezadosImportador_(encabezados) {
  const requeridos = [
    'PROCESAR',
    'NOMBRE_COMPLETO',
    'ID_ACTIVIDAD',
    'SESIONES_ASISTIDAS',
    'SESIONES_TOTALES',
    'ESTADO_PROCESO',
    'ID_PERSONA_RESULTADO',
    'ID_PARTICIPACION_RESULTADO',
    'DETALLE_PROCESO'
  ];
  const normalizados = encabezados.map(
    sigcNormalizarEncabezado
  );
  const faltantes = requeridos.filter(function(campo) {
    return normalizados.indexOf(
      sigcNormalizarEncabezado(campo)
    ) < 0;
  });
  if (faltantes.length) {
    throw new Error(
      'Faltan columnas: ' + faltantes.join(', ')
    );
  }
}
function leerTablaImportador_(hoja) {
  const valores = hoja.getDataRange().getDisplayValues();
  if (!valores.length) {
    return {encabezados: [], filas: []};
  }
  const encabezados = valores[0].map(function(valor) {
    return String(valor).trim();
  });
  const filas = valores.slice(1)
    .map(function(fila, indice) {
      return {
        numeroFila: indice + 2,
        datos: encabezados.reduce(
          function(objeto, encabezado, columna) {
            if (encabezado) {
              objeto[encabezado] =
                fila[columna] ?? '';
            }
            return objeto;
          },
          {}
        )
      };
    })
    .filter(function(fila) {
      return Object.values(fila.datos)
        .some(function(valor) {
          return String(valor).trim() !== '';
        });
    });
  return {
    encabezados: encabezados,
    filas: filas
  };
}
function agregarFilaImportador_(
  hoja,
  encabezados,
  datos
) {
  const normalizados = {};
  Object.keys(datos).forEach(function(campo) {
    normalizados[
      sigcNormalizarEncabezado(campo)
    ] = datos[campo];
  });
  hoja.appendRow(
    encabezados.map(function(encabezado) {
      const clave =
        sigcNormalizarEncabezado(encabezado);
      return Object.prototype.hasOwnProperty.call(
        normalizados,
        clave
      )
        ? normalizados[clave]
        : '';
    })
  );
}
function siguienteIdImportador_(
  hoja,
  campo,
  prefijo,
  largo
) {
  const tabla = leerTablaImportador_(hoja);
  const numeros = tabla.filas.map(function(fila) {
    const texto = String(
      fila.datos[campo] || ''
    );
    if (!texto.startsWith(prefijo)) return 0;
    const numero = parseInt(
      texto.substring(prefijo.length),
      10
    );
    return isNaN(numero) ? 0 : numero;
  });
  const siguiente =
    (numeros.length
      ? Math.max.apply(null, numeros)
      : 0) + 1;
  return prefijo +
    String(siguiente).padStart(largo, '0');
}
function escribirResultadoImportador_(
  hoja,
  fila,
  col,
  estado,
  idPersona,
  idParticipacion,
  detalle
) {
  importadorEscribir_(
    hoja,
    fila,
    col,
    'ESTADO_PROCESO',
    estado
  );
  importadorEscribir_(
    hoja,
    fila,
    col,
    'ID_PERSONA_RESULTADO',
    idPersona || ''
  );
  importadorEscribir_(
    hoja,
    fila,
    col,
    'ID_PARTICIPACION_RESULTADO',
    idParticipacion || ''
  );
  importadorEscribir_(
    hoja,
    fila,
    col,
    'DETALLE_PROCESO',
    detalle || ''
  );
}
function numeroSeguroImportador_(
  valor,
  defecto
) {
  const limpio = String(
    valor ?? ''
  ).replace(',', '.').trim();
  if (limpio === '') {
    return Number(defecto || 0);
  }
  const numero = Number(limpio);
  if (!isFinite(numero) || numero < 0) {
    throw new Error(
      'Se detectó un valor numérico inválido.'
    );
  }
  return numero;
}
function importadorMapaEncabezados_(
  encabezados
) {
  const mapa = {};
  encabezados.forEach(function(encabezado, indice) {
    mapa[
      sigcNormalizarEncabezado(encabezado)
    ] = indice;
  });
  return mapa;
}
function importadorValor_(
  fila,
  mapa,
  campo
) {
  const indice = mapa[
    sigcNormalizarEncabezado(campo)
  ];
  return indice === undefined
    ? ''
    : fila[indice];
}
function importadorEscribir_(
  hoja,
  fila,
  mapa,
  campo,
  valor
) {
  const indice = mapa[
    sigcNormalizarEncabezado(campo)
  ];
  if (indice === undefined) return;
  hoja.getRange(
    fila,
    indice + 1
  ).setValue(valor);
}
function importadorClaveDocumento_(
  tipo,
  numero,
  nacionalidad
) {
  if (!tipo || !numero) return '';
  return tipo === 'Pasaporte'
    ? tipo + '|' + numero + '|' +
      sigcNormalizarClave(nacionalidad)
    : tipo + '|' + numero;
}
function importadorClavePersona_(persona) {
  const tipo = sigcNormalizarTipoDocumento(
    persona.TIPO_DOCUMENTO,
    persona.RUT
  );
  const numero = sigcNormalizarDocumento(
    tipo,
    persona.NUMERO_DOCUMENTO,
    persona.RUT
  );
  return importadorClaveDocumento_(
    tipo,
    numero,
    persona.NACIONALIDAD
  );
}
function importadorAsegurarEncabezados_(
  hoja,
  encabezadosRequeridos
) {
  if (hoja.getLastColumn() === 0) {
    hoja.getRange(
      1,
      1,
      1,
      encabezadosRequeridos.length
    ).setValues([encabezadosRequeridos]);
    return;
  }
  const existentes = hoja.getRange(
    1,
    1,
    1,
    Math.max(hoja.getLastColumn(), 1)
  ).getValues()[0];
  const normalizados =
    existentes.map(sigcNormalizarEncabezado);
  encabezadosRequeridos.forEach(function(encabezado) {
    if (normalizados.indexOf(
          sigcNormalizarEncabezado(encabezado)
        ) >= 0) {
      return;
    }
    hoja.getRange(
      1,
      hoja.getLastColumn() + 1
    ).setValue(encabezado);
    normalizados.push(
      sigcNormalizarEncabezado(encabezado)
    );
  });
}
function importadorAsegurarColumna_(
  hoja,
  encabezado
) {
  const existentes = hoja.getRange(
    1,
    1,
    1,
    Math.max(hoja.getLastColumn(), 1)
  ).getValues()[0];
  if (existentes.map(sigcNormalizarEncabezado)
      .indexOf(
        sigcNormalizarEncabezado(encabezado)
      ) >= 0) {
    return;
  }
  hoja.getRange(
    1,
    hoja.getLastColumn() + 1
  ).setValue(encabezado);
}
function importadorAplicarLista_(
  hoja,
  mapa,
  campo,
  valores
) {
  const indice = mapa[
    sigcNormalizarEncabezado(campo)
  ];
  if (indice === undefined) return;
  hoja.getRange(
    2,
    indice + 1,
    Math.max(hoja.getMaxRows() - 1, 1),
    1
  ).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(valores, true)
      .setAllowInvalid(false)
      .build()
  );
}
function importadorActualizarPersonaSinBorrar_(
  hoja,
  encabezados,
  numeroFila,
  cambios
) {
  const rango = hoja.getRange(
    numeroFila,
    1,
    1,
    encabezados.length
  );
  const actual = rango.getValues()[0];
  const mapa = {};
  encabezados.forEach(function(encabezado, indice) {
    mapa[
      sigcNormalizarEncabezado(encabezado)
    ] = indice;
  });
  Object.keys(cambios).forEach(function(campo) {
    const indice = mapa[
      sigcNormalizarEncabezado(campo)
    ];
    if (indice === undefined) return;
    const nuevo = cambios[campo];
    if (nuevo === '' ||
        nuevo === null ||
        nuevo === undefined) {
      return;
    }
    if (sigcNormalizarEncabezado(campo) ===
          'PARTICIPA PMJH' &&
        nuevo === 'No informado' &&
        ['Sí', 'No'].indexOf(
          sigcNormalizarSiNo(
            actual[indice],
            'No informado'
          )
        ) >= 0) {
      return;
    }
    actual[indice] = nuevo;
  });
  const indiceActualizacion = mapa[
    'ULTIMA ACTUALIZACION'
  ];
  if (indiceActualizacion !== undefined) {
    actual[indiceActualizacion] = new Date();
  }
  rango.setValues([actual]);
}

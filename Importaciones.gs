/**
 * SIGC 3.6.10 — Importaciones universales y migración histórica de base madre.
 *
 * Mantiene dos flujos separados:
 * 1) listados históricos -> PERSONAS + PARTICIPACIONES;
 * 2) base madre/formulario general -> PERSONAS + INTERESES_CAPACITACION.
 */
const SIGC_IMPORTACIONES = Object.freeze({
  MAX_FILAS_LOTE: 250,
  MAX_FILAS_BASE_MADRE: 500,
  HOJA_HISTORIAL: 'HISTORIAL_IMPORTACIONES',
  HOJA_ORIGINALES: 'HISTORICO_ORIGINAL',
  HOJA_PERFILES_BASE_MADRE: 'PERFILES_BASE_MADRE',
  TIPO_INTERES_GENERAL: 'INTERES_GENERAL',
  CAMPOS_UNIVERSALES: [
    'TIPO_DOCUMENTO', 'NUMERO_DOCUMENTO', 'RUT', 'NOMBRE_COMPLETO', 'NOMBRES', 'APELLIDOS',
    'CORREO', 'TELEFONO', 'COMUNA', 'NACIONALIDAD', 'PARTICIPA_PMJH',
    'FECHA_INSCRIPCION', 'CONFIRMA_PARTICIPACION', 'SESIONES_ASISTIDAS',
    'SESIONES_TOTALES', 'CERTIFICADO', 'OBSERVACIONES'
  ]
});

/** Devuelve un resumen liviano para abrir la sección Importaciones. */
function obtenerPanelImportaciones() {
  const ss = sigcSpreadsheetCentral_();
  const historial = ss.getSheetByName(SIGC_IMPORTACIONES.HOJA_HISTORIAL);
  let filas = [];
  if (historial && historial.getLastRow() >= 2) {
    const tabla = leerTablaImportador_(historial);
    filas = tabla.filas.slice(-20).reverse().map(function(fila) {
      return fila.datos;
    });
  }
  return {
    maxFilasLote: SIGC_IMPORTACIONES.MAX_FILAS_LOTE,
    maxFilasBaseMadre: SIGC_IMPORTACIONES.MAX_FILAS_BASE_MADRE,
    historial: filas,
    baseMadre: importacionesObtenerVinculacionBaseMadre_()
  };
}

/** Analiza un bloque pegado sin escribir en las hojas principales. */
function analizarImportacionUniversal(datos) {
  datos = datos || {};
  const encabezados = Array.isArray(datos.encabezados) ? datos.encabezados : [];
  const filas = Array.isArray(datos.filas) ? datos.filas : [];
  const mapeo = datos.mapeo || {};
  const idActividad = String(datos.idActividad || '').trim();
  if (!idActividad || !resolverActividad_(idActividad)) {
    throw new Error('Seleccione una capacitación válida antes de analizar.');
  }
  if (!encabezados.length || !filas.length) {
    throw new Error('Pegue una tabla que incluya encabezados y al menos una fila.');
  }
  if (filas.length > SIGC_IMPORTACIONES.MAX_FILAS_LOTE) {
    throw new Error(
      'La prueba admite hasta ' + SIGC_IMPORTACIONES.MAX_FILAS_LOTE +
      ' filas por lote. Divida el listado y continúe con el siguiente bloque.'
    );
  }
  const ss = sigcSpreadsheetCentral_();
  const personas = leerTablaImportador_(ss.getSheetByName(SISTEMA.HOJAS.PERSONAS));
  const participaciones = leerTablaImportador_(ss.getSheetByName(SISTEMA.HOJAS.PARTICIPACIONES));
  const personasPorDocumento = {};
  const personasPorCorreo = {};
  const personasPorTelefono = {};
  const personasPorNombreUnico = {};
  personas.filas.forEach(function(fila) {
    const clave = importadorClavePersona_(fila.datos);
    if (clave && !personasPorDocumento[clave]) personasPorDocumento[clave] = fila.datos;
    const cor = sigcNormalizarCorreo(fila.datos.CORREO || '');
    if (cor && sigcValidarCorreo(cor)) {
      if (!personasPorCorreo[cor]) personasPorCorreo[cor] = [];
      personasPorCorreo[cor].push(fila.datos);
    }
    const tel = sigcNormalizarTelefono(fila.datos.TELEFONO || '');
    if (tel && sigcValidarTelefono(tel)) {
      if (!personasPorTelefono[tel]) personasPorTelefono[tel] = [];
      personasPorTelefono[tel].push(fila.datos);
    }
    const nomCl = sigcNormalizarClave(fila.datos.NOMBRE_COMPLETO || '');
    if (nomCl && nomCl.split(' ').length >= 2) {
      if (!Object.prototype.hasOwnProperty.call(personasPorNombreUnico, nomCl)) {
        personasPorNombreUnico[nomCl] = fila.datos;
      } else if (personasPorNombreUnico[nomCl] !== fila.datos) {
        personasPorNombreUnico[nomCl] = null;
      }
    }
  });
  const participacionesActivas = {};
  participaciones.filas.forEach(function(fila) {
    if (sigcNormalizarSiNo(fila.datos.REGISTRO_ACTIVO, 'Sí') === 'No') return;
    participacionesActivas[
      String(fila.datos.ID_PERSONA || '') + '|' + String(fila.datos.ID_ACTIVIDAD || '')
    ] = true;
  });
  const documentosLote = {};
  const personasLotePorId = {};
  const lotePorCorreo = {};
  const lotePorTelefono = {};
  const lotePorNombre = {};
  const resumen = {filas: filas.length, nuevas: 0, existentes: 0, duplicadas: 0, revision: 0};
  const vistaPrevia = [];
  filas.forEach(function(fila, indice) {
    try {
      const registro = importacionesRegistroUniversal_(fila, mapeo, datos.valoresGenerales || {});
      const nombre = sigcNormalizarNombre(registro.nombre);
      if (!nombre) throw new Error('Falta el nombre completo.');
      const documento = importacionesResolverDocumentoTolerante_(registro, nombre);
      const clave = importadorClaveDocumento_(documento.tipo, documento.numero, registro.nacionalidad);
      const corReg = sigcNormalizarCorreo(registro.correo);
      const telReg = sigcNormalizarTelefono(registro.telefono);
      const nomCl = sigcNormalizarClave(nombre);

      let persona = personasPorDocumento[clave];
      let criterioCruce = '';
      if (!persona && corReg && personasPorCorreo[corReg]) {
        persona = personasPorCorreo[corReg].find(function(cand) {
          return sigcSonNombresCompatibles(nombre, cand.NOMBRE_COMPLETO);
        }) || null;
        if (persona) criterioCruce = 'correo y nombre';
      }
      if (!persona && telReg && personasPorTelefono[telReg]) {
        persona = personasPorTelefono[telReg].find(function(cand) {
          return sigcSonNombresCompatibles(nombre, cand.NOMBRE_COMPLETO);
        }) || null;
        if (persona) criterioCruce = 'teléfono y nombre';
      }
      if (!persona && documento.historica && nomCl && personasPorNombreUnico[nomCl]) {
        persona = personasPorNombreUnico[nomCl];
        criterioCruce = 'nombre completo único';
      }

      const idPerExistente = persona ? String(persona.ID_PERSONA || '').trim() : '';
      let duplicadoEnLote = Boolean(documentosLote[clave]) || (idPerExistente && Boolean(personasLotePorId[idPerExistente]));
      let motivoDuplicadoLote = '';
      if (!duplicadoEnLote && corReg && lotePorCorreo[corReg] && sigcSonNombresCompatibles(nombre, lotePorCorreo[corReg])) {
        duplicadoEnLote = true;
        motivoDuplicadoLote = 'Correo y nombre repetidos en el listado.';
      }
      if (!duplicadoEnLote && telReg && lotePorTelefono[telReg] && sigcSonNombresCompatibles(nombre, lotePorTelefono[telReg])) {
        duplicadoEnLote = true;
        motivoDuplicadoLote = 'Teléfono y nombre repetidos en el listado.';
      }
      if (!duplicadoEnLote && documento.historica && nomCl && nomCl.split(' ').length >= 2 && lotePorNombre[nomCl]) {
        duplicadoEnLote = true;
        motivoDuplicadoLote = 'Nombre completo repetido en el listado.';
      }

      let estado = persona ? 'PERSONA_EXISTENTE' : 'PERSONA_NUEVA';
      if (duplicadoEnLote) {
        estado = 'DUPLICADO_EN_LISTADO';
        resumen.duplicadas++;
      } else if (idPerExistente && participacionesActivas[idPerExistente + '|' + idActividad]) {
        estado = 'PARTICIPACION_EXISTENTE';
        resumen.duplicadas++;
      } else if (persona) {
        resumen.existentes++;
      } else {
        resumen.nuevas++;
      }
      documentosLote[clave] = true;
      if (idPerExistente) personasLotePorId[idPerExistente] = true;
      if (corReg && sigcValidarCorreo(corReg) && !lotePorCorreo[corReg]) lotePorCorreo[corReg] = nombre;
      if (telReg && sigcValidarTelefono(telReg) && !lotePorTelefono[telReg]) lotePorTelefono[telReg] = nombre;
      if (nomCl && nomCl.split(' ').length >= 2 && !lotePorNombre[nomCl]) lotePorNombre[nomCl] = true;

      if (vistaPrevia.length < 250) {
        const docMostrar = persona && (persona.RUT || persona.NUMERO_DOCUMENTO)
          ? (persona.RUT || persona.NUMERO_DOCUMENTO)
          : documento.numero;
        const notaCruce = criterioCruce ? 'Asociado por ' + criterioCruce + ' · ' : (documento.advertencia ? documento.advertencia + ' · ' : '');
        vistaPrevia.push({
          fila: indice + 2,
          nombre: nombre,
          documento: docMostrar,
          estado: estado,
          detalle: notaCruce + (estado === 'PERSONA_NUEVA'
            ? 'Se creará la persona y su participación.'
            : estado === 'PERSONA_EXISTENTE'
              ? 'Se reutilizará la persona y se creará la participación.'
              : (motivoDuplicadoLote || 'No se creará una participación duplicada.'))
        });
      }
    } catch (error) {
      resumen.revision++;
      if (vistaPrevia.length < 250) {
        vistaPrevia.push({
          fila: indice + 2,
          nombre: importacionesValorMapeado_(fila, mapeo, 'NOMBRE_COMPLETO') ||
            [
              importacionesValorMapeado_(fila, mapeo, 'NOMBRES'),
              importacionesValorMapeado_(fila, mapeo, 'APELLIDOS')
            ].filter(Boolean).join(' '),
          documento: importacionesValorMapeado_(fila, mapeo, 'RUT') ||
            importacionesValorMapeado_(fila, mapeo, 'NUMERO_DOCUMENTO'),
          estado: 'REVISION',
          detalle: error.message
        });
      }
    }
  });
  return {ok: true, resumen: resumen, vistaPrevia: vistaPrevia};
}

/** Confirma un lote ya mapeado y crea personas/participaciones con trazabilidad. */
function importarCapacitacionHistoricaUniversal(datos) {
  datos = datos || {};
  const analisis = analizarImportacionUniversal(datos);
  const filas = datos.filas || [];
  const mapeo = datos.mapeo || {};
  const generales = datos.valoresGenerales || {};
  const idActividad = String(datos.idActividad || '').trim();
  const actividad = resolverActividad_(idActividad);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const personasHoja = ss.getSheetByName(SISTEMA.HOJAS.PERSONAS);
    const participacionesHoja = ss.getSheetByName(SISTEMA.HOJAS.PARTICIPACIONES);
    importadorAsegurarColumna_(personasHoja, 'TIPO_DOCUMENTO');
    importadorAsegurarColumna_(personasHoja, 'NUMERO_DOCUMENTO');
    const personas = leerTablaImportador_(personasHoja);
    const participaciones = leerTablaImportador_(participacionesHoja);
    const personasPorDocumento = {};
    const personasPorCorreo = {};
    const personasPorTelefono = {};
    const personasPorNombreUnico = {};
    function indexarPersonaImportador_(fila) {
      const clave = importadorClavePersona_(fila.datos);
      if (clave && !personasPorDocumento[clave]) personasPorDocumento[clave] = fila;
      const cor = sigcNormalizarCorreo(fila.datos.CORREO || '');
      if (cor && sigcValidarCorreo(cor)) {
        if (!personasPorCorreo[cor]) personasPorCorreo[cor] = [];
        personasPorCorreo[cor].push(fila);
      }
      const tel = sigcNormalizarTelefono(fila.datos.TELEFONO || '');
      if (tel && sigcValidarTelefono(tel)) {
        if (!personasPorTelefono[tel]) personasPorTelefono[tel] = [];
        personasPorTelefono[tel].push(fila);
      }
      const nomCl = sigcNormalizarClave(fila.datos.NOMBRE_COMPLETO || '');
      if (nomCl && nomCl.split(' ').length >= 2) {
        if (!Object.prototype.hasOwnProperty.call(personasPorNombreUnico, nomCl)) {
          personasPorNombreUnico[nomCl] = fila;
        } else if (personasPorNombreUnico[nomCl] !== fila) {
          personasPorNombreUnico[nomCl] = null; // homónimo: no asociar automáticamente por solo nombre
        }
      }
    }
    personas.filas.forEach(indexarPersonaImportador_);
    const participacionesActivas = {};
    participaciones.filas.forEach(function(fila) {
      if (sigcNormalizarSiNo(fila.datos.REGISTRO_ACTIVO, 'Sí') === 'No') return;
      participacionesActivas[
        String(fila.datos.ID_PERSONA || '') + '|' + String(fila.datos.ID_ACTIVIDAD || '')
      ] = true;
    });
    const importacionId = 'IMP-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    const historial = importacionesAsegurarHistorial_(ss);
    const originales = importacionesAsegurarOriginales_(ss);
    const documentosLote = {};
    let siguientePersona = importacionesSiguienteNumero_(personas.filas, 'ID_PERSONA', 'PER-');
    let siguienteParticipacion = importacionesSiguienteNumero_(
      participaciones.filas,
      'ID_PARTICIPACION',
      'PAR-' + new Date().getFullYear() + '-'
    );
    const resumen = {
      personasCreadas: 0, personasActualizadas: 0,
      participacionesCreadas: 0, duplicadosOmitidos: 0, revision: 0
    };
    const auditoria = [];
    const nuevasPersonasRows = [];
    const nuevasParticipacionesRows = [];
    let huboPersonasModificadas = false;
    const correoUsuarioLote = Session.getActiveUser().getEmail() || 'Usuario no disponible';
    let siguienteFilaNuevaPersona = personasHoja.getLastRow() + 1;
    let maxSesionesLote = Number(actividad.sesionesTotales || 1);
    filas.forEach(function(fila, indice) {
      let estado = 'ERROR';
      let detalle = '';
      let idPersona = '';
      let idParticipacion = '';
      try {
        const registro = importacionesRegistroUniversal_(fila, mapeo, generales);
        const nombre = sigcNormalizarNombre(registro.nombre);
        if (!nombre) throw new Error('Falta el nombre completo.');
        const documento = importacionesResolverDocumentoTolerante_(registro, nombre);
        const claveDocumento = importadorClaveDocumento_(documento.tipo, documento.numero, registro.nacionalidad);
        if (documentosLote[claveDocumento]) {
          estado = 'DUPLICADO';
          detalle = 'El documento está repetido dentro del mismo listado.';
          resumen.duplicadosOmitidos++;
          return;
        }
        documentosLote[claveDocumento] = true;
        const correoRaw = sigcNormalizarCorreo(registro.correo);
        const telefonoRaw = sigcNormalizarTelefono(registro.telefono);
        const correo = sigcValidarCorreo(correoRaw) ? correoRaw : '';
        const telefono = sigcValidarTelefono(telefonoRaw) ? telefonoRaw : '';
        const notasExtra = [];
        if (documento.advertencia) notasExtra.push(documento.advertencia);
        if (correoRaw && !correo) notasExtra.push('Correo no estándar: ' + correoRaw);
        if (telefonoRaw && !telefono) notasExtra.push('Teléfono no estándar: ' + telefonoRaw);
        const datosPersona = {
          RUT: documento.tipo === 'RUT' ? documento.numero : '',
          TIPO_DOCUMENTO: documento.tipo,
          NUMERO_DOCUMENTO: documento.numero,
          NOMBRE_COMPLETO: nombre,
          CORREO: correo,
          TELEFONO: telefono,
          COMUNA: sigcNormalizarTexto(registro.comuna),
          GENERO: baseMadreNormalizarGenero_(registro.genero),
          FECHA_NACIMIENTO: importacionesNormalizarFechaNacimiento_(registro.fechaNacimiento),
          NACIONALIDAD: sigcNormalizarTexto(registro.nacionalidad),
          PARTICIPA_PMJH: sigcNormalizarSiNo(registro.participaPmjh, 'No informado')
        };
        let personaFila = personasPorDocumento[claveDocumento];
        let criterioCruce = 'documento';
        if (!personaFila && correo && personasPorCorreo[correo]) {
          personaFila = personasPorCorreo[correo].find(function(cand) {
            return sigcSonNombresCompatibles(nombre, cand.datos.NOMBRE_COMPLETO);
          }) || null;
          if (personaFila) criterioCruce = 'correo y nombre';
        }
        if (!personaFila && telefono && personasPorTelefono[telefono]) {
          personaFila = personasPorTelefono[telefono].find(function(cand) {
            return sigcSonNombresCompatibles(nombre, cand.datos.NOMBRE_COMPLETO);
          }) || null;
          if (personaFila) criterioCruce = 'teléfono y nombre';
        }
        if (!personaFila && documento.historica) {
          const nomCl = sigcNormalizarClave(nombre);
          if (nomCl && personasPorNombreUnico[nomCl]) {
            personaFila = personasPorNombreUnico[nomCl];
            criterioCruce = 'nombre completo único';
          } else if (nomCl && nomCl.split(' ').length >= 2 && personasPorNombreUnico[nomCl] === null) {
            // Si hubo homónimo creado dentro de este mismo lote sin documento, buscarlo en las creadas del lote
            const prevLote = personas.filas.find(function(cand) {
              return sigcNormalizarClave(cand.datos.NOMBRE_COMPLETO || '') === nomCl;
            });
            if (prevLote) {
              personaFila = prevLote;
              criterioCruce = 'nombre repetido en lote';
            }
          }
        }
        if (!personaFila) {
          idPersona = 'PER-' + String(siguientePersona++).padStart(6, '0');
          const ahora = new Date();
          const objNuevaPersona = Object.assign({
            ID_PERSONA: idPersona,
            AUTORIZA_CONTACTO: 'No informado',
            FECHA_PRIMER_REGISTRO: registro.fechaInscripcion || ahora,
            ORIGEN_REGISTRO: 'Importación histórica universal',
            ESTADO_CONTACTO: correo || telefono ? 'Activo' : 'Sin contacto',
            ULTIMA_ACTUALIZACION: ahora,
            OBSERVACIONES: 'Creado desde la sección Importaciones. Lote ' + importacionId
          }, datosPersona);
          const arrNuevaPersona = nuevaFilaSegunEncabezados_(personas.encabezados, objNuevaPersona);
          nuevasPersonasRows.push(arrNuevaPersona);
          personaFila = {
            numeroFila: siguienteFilaNuevaPersona++,
            esNuevaLote: true,
            arrNueva: arrNuevaPersona,
            datos: objNuevaPersona
          };
          personas.filas.push(personaFila);
          indexarPersonaImportador_(personaFila);
          resumen.personasCreadas++;
        } else {
          idPersona = String(personaFila.datos.ID_PERSONA || '').trim();
          if (!idPersona) throw new Error('La persona existente no tiene ID_PERSONA.');
          const datosActualizar = Object.assign({}, datosPersona);
          // Si se asoció por correo/teléfono/nombre sin RUT en el Excel, no sobrescribir el documento previo
          if (criterioCruce !== 'documento' && personaFila.datos.NUMERO_DOCUMENTO) {
            delete datosActualizar.RUT;
            delete datosActualizar.TIPO_DOCUMENTO;
            delete datosActualizar.NUMERO_DOCUMENTO;
          }
          if (criterioCruce !== 'documento') {
            notasExtra.push('Asociado a ficha existente por ' + criterioCruce + '.');
          }
          let cambioEnFicha = false;
          Object.keys(datosActualizar).forEach(function(campo) {
            const valNuevo = datosActualizar[campo];
            if (valNuevo === '' || valNuevo === null || valNuevo === undefined) return;
            const valAct = personaFila.datos[campo];
            const actNorm = normalizarEncabezado_(valAct);
            if (valAct !== '' && valAct !== null && valAct !== undefined &&
                ['NO INFORMADO', 'SIN INFORMACION', 'N A'].indexOf(actNorm) < 0) {
              return;
            }
            personaFila.datos[campo] = valNuevo;
            cambioEnFicha = true;
          });
          if (cambioEnFicha) {
            personaFila.datos.ULTIMA_ACTUALIZACION = new Date();
            if (personaFila.esNuevaLote && personaFila.arrNueva) {
              const filaAct = nuevaFilaSegunEncabezados_(personas.encabezados, personaFila.datos);
              for (let c = 0; c < filaAct.length; c++) personaFila.arrNueva[c] = filaAct[c];
            } else {
              personaFila._modificada = true;
              huboPersonasModificadas = true;
            }
            resumen.personasActualizadas++;
          }
        }
        const claveParticipacion = idPersona + '|' + idActividad;
        if (participacionesActivas[claveParticipacion]) {
          estado = 'DUPLICADO';
          detalle = 'La persona ya tiene una participación activa en esta capacitación.';
          resumen.duplicadosOmitidos++;
          return;
        }
        const sesionesAsistidas = Math.max(0, numeroSeguroImportador_(registro.sesionesAsistidas, 0));
        const sesionesTotales = Math.max(1, sesionesAsistidas, numeroSeguroImportador_(registro.sesionesTotales, actividad.sesionesTotales || 1));
        if (sesionesTotales > maxSesionesLote) maxSesionesLote = sesionesTotales;
        const confirma = importacionesNormalizarConfirmacion_(registro.confirmaParticipacion);
        const finalizar = generales.finalizarResultado === true || generales.finalizarResultado === 'true';
        const resultado = sigcCalcularResultado(actividad, sesionesAsistidas, sesionesTotales, finalizar);
        idParticipacion = 'PAR-' + new Date().getFullYear() + '-' +
          String(siguienteParticipacion++).padStart(6, '0');
        nuevasParticipacionesRows.push(nuevaFilaSegunEncabezados_(participaciones.encabezados, {
          ID_PARTICIPACION: idParticipacion,
          ID_PERSONA: idPersona,
          ID_ACTIVIDAD: idActividad,
          FECHA_INSCRIPCION: registro.fechaInscripcion || new Date(),
          CANAL_INSCRIPCION: 'Registro histórico',
          CUMPLE_REQUISITOS: 'Sí',
          ESTADO_SELECCION: 'Seleccionado',
          CONFIRMA_PARTICIPACION: confirma,
          SESIONES_ASISTIDAS: sesionesAsistidas,
          SESIONES_TOTALES: sesionesTotales,
          PORCENTAJE_ASISTENCIA: sesionesTotales ? sesionesAsistidas / sesionesTotales : 0,
          RESULTADO_ASISTENCIA: resultado.resultadoAsistencia,
          RESULTADO_FINAL: resultado.resultadoFinal,
          CERTIFICADO: sigcNormalizarSiNo(registro.certificado, 'No informado'),
          OBSERVACIONES: [sigcNormalizarTexto(registro.observaciones), notasExtra.join('; ')].filter(Boolean).join(' | '),
          ARCHIVO_ORIGEN: 'Importación universal ' + importacionId,
          FILA_ORIGEN: indice + 2,
          REGISTRO_ACTIVO: 'Sí',
          ULTIMA_ACTUALIZACION: new Date()
        }));
        participacionesActivas[claveParticipacion] = true;
        resumen.participacionesCreadas++;
        estado = 'PROCESADO';
        detalle = 'Persona y participación procesadas correctamente.';
      } catch (error) {
        resumen.revision++;
        estado = 'REVISION';
        detalle = error.message;
      } finally {
        auditoria.push([
          importacionId, indice + 2, new Date(),
          correoUsuarioLote,
          JSON.stringify(importacionesFilaOriginal_(datos.encabezados || [], fila)),
          estado, idPersona, idParticipacion, detalle
        ]);
      }
    });
    if (huboPersonasModificadas) {
      personas.filas.forEach(function(pf) {
        if (!pf._modificada || pf.esNuevaLote) return;
        const rowArr = nuevaFilaSegunEncabezados_(personas.encabezados, pf.datos);
        try {
          personasHoja.getRange(pf.numeroFila, 1, 1, rowArr.length).setValues([rowArr]);
        } catch (errUpdPer) {
          if (/validaci[oó]n|validation/i.test(String(errUpdPer && errUpdPer.message || ''))) {
            personasHoja.getRange(pf.numeroFila, 1, 1, rowArr.length).clearDataValidations();
            personasHoja.getRange(pf.numeroFila, 1, 1, rowArr.length).setValues([rowArr]);
          } else {
            throw errUpdPer;
          }
        }
      });
    }
    if (nuevasPersonasRows.length) {
      try {
        personasHoja.getRange(personasHoja.getLastRow() + 1, 1, nuevasPersonasRows.length, personas.encabezados.length)
          .setValues(nuevasPersonasRows);
      } catch (errInsPer) {
        if (/validaci[oó]n|validation/i.test(String(errInsPer && errInsPer.message || ''))) {
          const rIniP = personasHoja.getLastRow() + 1;
          personasHoja.getRange(rIniP, 1, nuevasPersonasRows.length, personas.encabezados.length).clearDataValidations();
          personasHoja.getRange(rIniP, 1, nuevasPersonasRows.length, personas.encabezados.length).setValues(nuevasPersonasRows);
        } else {
          throw errInsPer;
        }
      }
    }
    if (nuevasParticipacionesRows.length) {
      try {
        participacionesHoja.getRange(participacionesHoja.getLastRow() + 1, 1, nuevasParticipacionesRows.length, participaciones.encabezados.length)
          .setValues(nuevasParticipacionesRows);
      } catch (errInsPart) {
        if (/validaci[oó]n|validation/i.test(String(errInsPart && errInsPart.message || ''))) {
          const rIniPt = participacionesHoja.getLastRow() + 1;
          participacionesHoja.getRange(rIniPt, 1, nuevasParticipacionesRows.length, participaciones.encabezados.length).clearDataValidations();
          participacionesHoja.getRange(rIniPt, 1, nuevasParticipacionesRows.length, participaciones.encabezados.length).setValues(nuevasParticipacionesRows);
        } else {
          throw errInsPart;
        }
      }
    }
    if (auditoria.length) {
      originales.getRange(originales.getLastRow() + 1, 1, auditoria.length, auditoria[0].length)
        .setValues(auditoria);
    }
    historial.appendRow([
      importacionId, new Date(), correoUsuarioLote,
      'CAPACITACION_HISTORICA', idActividad, actividad.nombre, filas.length,
      resumen.personasCreadas, resumen.personasActualizadas,
      resumen.participacionesCreadas, resumen.duplicadosOmitidos,
      resumen.revision, 'Finalizada'
    ]);
    sigcRegistrarLog(
      'IMPORTAR',
      'LOTE_IMPORTACION',
      importacionId,
      idActividad + ' | Creadas: ' + resumen.participacionesCreadas + ' | Personas nuevas: ' + resumen.personasCreadas
    );
    if (maxSesionesLote > Number(actividad.sesionesTotales || 1) && actividad.fila) {
      try {
        const actHoja = ss.getSheetByName(SISTEMA.HOJAS.ACTIVIDADES);
        const actHeaders = actHoja.getRange(1, 1, 1, actHoja.getLastColumn()).getValues()[0];
        const colSes = actHeaders.findIndex(function(h) { return normalizarEncabezado_(h) === 'SESIONES TOTALES'; });
        if (colSes >= 0) actHoja.getRange(actividad.fila, colSes + 1).setValue(maxSesionesLote);
      } catch (eAct) {}
    }
    SpreadsheetApp.flush();
    sigcInvalidarCache_();
    return {
      ok: true,
      importacionId: importacionId,
      resumen: resumen,
      analisisPrevio: analisis.resumen,
      mensaje: 'Importación finalizada: ' + resumen.participacionesCreadas +
        ' participación(es) creada(s), ' + resumen.duplicadosOmitidos +
        ' duplicado(s) omitido(s) y ' + resumen.revision + ' caso(s) para revisar.'
    };
  } finally {
    lock.releaseLock();
  }
}

/** Analiza la pestaña de la base madre usando únicamente conteos. */
function analizarBaseMadreDesdeWeb(datos) {
  const origen = resolverOrigenFormularioDesdeUrl_(String(datos && datos.url || '').trim());
  const hoja = SpreadsheetApp.openById(origen.spreadsheetId).getSheetByName(origen.hoja);
  validarHojaRespuestasVinculada_(hoja);
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0];
  const campos = importacionesCamposBaseMadreDetectados_(encabezados);
  return {
    ok: true,
    archivo: origen.archivo,
    hoja: origen.hoja,
    totalRespuestas: Math.max(0, hoja.getLastRow() - 1),
    columnas: hoja.getLastColumn(),
    camposDetectados: campos,
    listaPreparada: !!(campos.nombre && (campos.rut || campos.rutCuerpo || campos.documento))
  };
}

/** Vincula el formulario general. No crea participaciones. */
function vincularBaseMadreDesdeWeb(datos) {
  const url = String(datos && datos.url || '').trim();
  if (!url) throw new Error('Pegue la URL de la hoja de respuestas de la base madre.');
  const origen = resolverOrigenFormularioDesdeUrl_(url);
  const hojaOrigen = SpreadsheetApp.openById(origen.spreadsheetId).getSheetByName(origen.hoja);
  validarHojaRespuestasVinculada_(hojaOrigen);
  const encabezados = hojaOrigen.getRange(1, 1, 1, hojaOrigen.getLastColumn()).getDisplayValues()[0];
  const campos = importacionesCamposBaseMadreDetectados_(encabezados);
  if (!campos.nombre || !(campos.rut || campos.rutCuerpo || campos.documento)) {
    throw new Error('No se reconocieron las columnas mínimas de nombre y documento.');
  }
  prepararConfigFormularios();
  const config = sigcSpreadsheetCentral_().getSheetByName(SISTEMA.HOJAS.FORMULARIOS);
  const tabla = config.getDataRange().getValues();
  const mapa = mapaEncabezados_(tabla[0]);
  let idConfig = '';
  for (let i = 1; i < tabla.length; i++) {
    if (String(tabla[i][mapa['SPREADSHEET RESPUESTAS ID']]) !== origen.spreadsheetId ||
        String(tabla[i][mapa['HOJA RESPUESTAS']]) !== origen.hoja) continue;
    idConfig = String(tabla[i][mapa['ID CONFIG']] || '');
    config.getRange(i + 1, mapa['TIPO'] + 1).setValue(SIGC_IMPORTACIONES.TIPO_INTERES_GENERAL);
    config.getRange(i + 1, mapa['ID ACTIVIDAD'] + 1).clearContent();
    config.getRange(i + 1, mapa['ESTADO'] + 1).setValue('Activo');
    break;
  }
  if (!idConfig) {
    idConfig = 'FOR-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    config.appendRow([
      idConfig, SIGC_IMPORTACIONES.TIPO_INTERES_GENERAL,
      origen.spreadsheetId, origen.hoja, '', 'Activo', new Date()
    ]);
  }
  const activador = instalarTriggerFormularioVinculado_(origen.spreadsheetId);
  asegurarColumnasProceso_(hojaOrigen);
  importacionesInvalidarPanelFormularios_();
  return {
    ok: true,
    idConfig: idConfig,
    archivo: origen.archivo,
    hoja: origen.hoja,
    activador: activador,
    mensaje: 'Base madre vinculada. La migración consolidará PERSONAS, PERFILES_BASE_MADRE e INTERESES, nunca PARTICIPACIONES.'
  };
}

/** Procesa un lote histórico de la base madre. Se repite hasta llegar a cero pendientes. */
function procesarLoteBaseMadreDesdeWeb(datos) {
  const idConfig = String(datos && datos.idConfig || '').trim();
  const limite = Math.min(
    SIGC_IMPORTACIONES.MAX_FILAS_BASE_MADRE,
    Math.max(1, Number(datos && datos.limite || 100))
  );
  const origen = resolverConfigFormularioPorId_(idConfig);
  if (sigcNormalizarEncabezado(origen.tipo) !== sigcNormalizarEncabezado(SIGC_IMPORTACIONES.TIPO_INTERES_GENERAL)) {
    throw new Error('La vinculación seleccionada no corresponde a una base madre.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const central = sigcSpreadsheetCentral_();
    const fuente = SpreadsheetApp.openById(origen.spreadsheetId).getSheetByName(origen.hoja);
    if (!fuente) throw new Error('No se encontró la pestaña de la base madre.');
    asegurarColumnasProceso_(fuente);
    const fuenteValores = fuente.getDataRange().getValues();
    if (fuenteValores.length < 2) {
      return {ok:true, resultado:{intentadas:0,resueltas:0,revision:0,restantes:0}, mensaje:'La base madre no contiene respuestas.'};
    }
    const fuenteEncabezados = fuenteValores[0];
    const mf = mapaEncabezados_(fuenteEncabezados);
    const colEstado = mf['ESTADO PROCESO'];
    const colDetalle = mf['DETALLE PROCESO'];
    const pendientes = [];
    for (let i = 1; i < fuenteValores.length; i++) {
      const estado = normalizarEncabezado_(fuenteValores[i][colEstado]);
      const detalle = normalizarEncabezado_(fuenteValores[i][colDetalle]);
      const procesadaSinPerfil =
        (estado === 'PROCESADO' || estado === 'PROCESADO CON ADVERTENCIA') &&
        detalle.indexOf('PERFIL HISTORICO ACTUALIZADO') < 0;
      if (estado === '' || estado === 'REVISION' || estado === 'ERROR' || procesadaSinPerfil) pendientes.push(i);
    }
    const seleccionadas = pendientes.slice(0, limite);
    if (!seleccionadas.length) {
      return {ok:true, resultado:{intentadas:0,resueltas:0,revision:0,restantes:0}, mensaje:'No quedan respuestas pendientes en la base madre.'};
    }

    const personasHoja = central.getSheetByName(SISTEMA.HOJAS.PERSONAS);
    importadorAsegurarColumna_(personasHoja, 'TIPO_DOCUMENTO');
    importadorAsegurarColumna_(personasHoja, 'NUMERO_DOCUMENTO');
    baseMadreAsegurarValidacionTipoDocumento_(personasHoja);
    const personasValores = personasHoja.getDataRange().getValues();
    const personasEncabezados = personasValores[0];
    const mp = mapaEncabezados_(personasEncabezados);
    const indicesPersonas = baseMadreCrearIndicesPersonas_();
    let maxPersona = 0;
    for (let i = 1; i < personasValores.length; i++) {
      baseMadreIndexarPersona_(indicesPersonas, {
        indice: i,
        fila: personasValores[i],
        nueva: false
      }, mp);
      const id = String(mp['ID PERSONA'] === undefined ? '' : personasValores[i][mp['ID PERSONA']] || '');
      const numero = parseInt(id.replace(/^PER-/, ''), 10);
      if (!isNaN(numero)) maxPersona = Math.max(maxPersona, numero);
    }

    const interesesHoja = baseMadreAsegurarIntereses_(central);
    const interesesValores = interesesHoja.getDataRange().getValues();
    const interesesEncabezados = interesesValores[0];
    const mi = mapaEncabezados_(interesesEncabezados);
    const interesesExistentes = {};
    let maxInteres = 0;
    for (let i = 1; i < interesesValores.length; i++) {
      const clave = String(interesesValores[i][mi['ID PERSONA']] || '') + '|' +
        sigcNormalizarClave(interesesValores[i][mi['ESCUELA LINEA']]) + '|' +
        sigcNormalizarClave(interesesValores[i][mi['AREA TEMATICA']]);
      interesesExistentes[clave] = true;
      const id = String(interesesValores[i][mi['ID INTERES']] || '');
      const numero = parseInt(id.replace(/^INT-/, ''), 10);
      if (!isNaN(numero)) maxInteres = Math.max(maxInteres, numero);
    }

    const perfilesHoja = baseMadreAsegurarPerfiles_(central);
    const perfilesValores = perfilesHoja.getDataRange().getValues();
    const perfilesEncabezados = perfilesValores[0];
    const mperfil = mapaEncabezados_(perfilesEncabezados);
    const perfilesPorPersona = {};
    for (let i = 1; i < perfilesValores.length; i++) {
      const id = String(perfilesValores[i][mperfil['ID PERSONA']] || '');
      if (id && !perfilesPorPersona[id]) {
        perfilesPorPersona[id] = {indice:i, fila:perfilesValores[i], nueva:false};
      }
    }

    const personasNuevas = [];
    const personasModificadas = {};
    const interesesNuevos = [];
    const perfilesNuevos = [];
    const perfilesModificados = {};
    const personasCreadasIds = {};
    const personasActualizadasIds = {};
    let resueltas = 0;
    let revision = 0;
    let interesesGuardados = 0;
    let documentosHistoricos = 0;

    seleccionadas.forEach(function(indiceFuente) {
      const valores = fuenteValores[indiceFuente];
      try {
        const registro = registroBaseMadreDesdeFila_(fuenteEncabezados, valores);
        const advertencias = baseMadreLimpiarRegistro_(registro);
        const identidad = baseMadreResolverIdentidad_(registro, indiceFuente + 1);
        Array.prototype.push.apply(advertencias, identidad.advertencias);
        if (identidad.historica) documentosHistoricos++;
        let persona = baseMadreEncontrarPersona_(indicesPersonas, identidad, registro);
        const ahora = new Date();
        const cambios = {
          'RUT': identidad.tipo === 'RUT' ? identidad.numero : '',
          'TIPO DOCUMENTO': identidad.tipo,
          'NUMERO DOCUMENTO': identidad.numero,
          'NOMBRE COMPLETO': registro.nombre,
          'CORREO': registro.correo,
          'TELEFONO': registro.telefono,
          'COMUNA': registro.comuna,
          'BARRIO': registro.barrio,
          'DIRECCION': registro.direccion,
          'FECHA NACIMIENTO': registro.fechaNacimiento || '',
          'GENERO': baseMadreNormalizarGenero_(registro.genero),
          'NACIONALIDAD': registro.nacionalidad,
          'AUTORIZA CONTACTO': registro.autorizaContacto,
          'PARTICIPA PMJH': sigcNormalizarSiNo(registro.participaPmjh, 'No informado')
        };
        let idPersona;
        let creadaEnEstaFila = false;
        if (!persona) {
          idPersona = 'PER-' + String(++maxPersona).padStart(6, '0');
          const filaNueva = nuevaFilaSegunEncabezados_(personasEncabezados, Object.assign({
            'ID PERSONA': idPersona,
            'FECHA PRIMER REGISTRO': registro.timestamp || ahora,
            'ORIGEN REGISTRO': 'Migración base madre',
            'ESTADO CONTACTO': cambios.CORREO || cambios.TELEFONO ? 'Activo' : 'Sin contacto',
            'ULTIMA ACTUALIZACION': ahora,
            'OBSERVACIONES': identidad.historica
              ? 'Migración base madre. Documento histórico conservado sin validar como RUT chileno.'
              : 'Creado mediante migración única de la base madre.'
          }, cambios));
          persona = {indice:-1, fila:filaNueva, nueva:true};
          personasNuevas.push(filaNueva);
          personasCreadasIds[idPersona] = true;
          creadaEnEstaFila = true;
          baseMadreIndexarPersona_(indicesPersonas, persona, mp);
        } else {
          idPersona = String(persona.fila[mp['ID PERSONA']] || '');
          let cambioReal = false;
          Object.keys(cambios).forEach(function(campo) {
            const columna = mp[campo];
            const nuevo = cambios[campo];
            if (columna === undefined || nuevo === '' || nuevo === null || nuevo === undefined) return;
            const actual = persona.fila[columna];
            const actualNorm = normalizarEncabezado_(actual);
            if (actual !== '' && actual !== null && actual !== undefined &&
                ['NO INFORMADO', 'SIN INFORMACION', 'N A'].indexOf(actualNorm) < 0) return;
            persona.fila[columna] = nuevo;
            cambioReal = true;
          });
          if (cambioReal && mp['ULTIMA ACTUALIZACION'] !== undefined) {
            persona.fila[mp['ULTIMA ACTUALIZACION']] = ahora;
          }
          if (cambioReal && mp['ESTADO CONTACTO'] !== undefined &&
              (cambios.CORREO || cambios.TELEFONO) &&
              sigcNormalizarClave(persona.fila[mp['ESTADO CONTACTO']]) !== 'activo') {
            persona.fila[mp['ESTADO CONTACTO']] = 'Activo';
          }
          if (cambioReal && !persona.nueva) {
            personasModificadas[persona.indice] = persona.fila;
            personasActualizadasIds[idPersona] = true;
          }
          baseMadreIndexarPersona_(indicesPersonas, persona, mp);
        }

        const intereses = extraerInteresesBaseMadre_(fuenteEncabezados, valores);
        let interesesFila = 0;
        intereses.forEach(function(interes) {
          const clave = idPersona + '|' + sigcNormalizarClave(interes.ESCUELA_LINEA) + '|' +
            sigcNormalizarClave(interes.AREA_TEMATICA);
          if (interesesExistentes[clave]) return;
          interesesExistentes[clave] = true;
          interesesNuevos.push(nuevaFilaSegunEncabezados_(interesesEncabezados, {
            'ID INTERES': 'INT-' + String(++maxInteres).padStart(6, '0'),
            'ID PERSONA': idPersona,
            'ESCUELA LINEA': interes.ESCUELA_LINEA,
            'AREA TEMATICA': interes.AREA_TEMATICA,
            'FECHA REGISTRO': registro.timestamp || ahora,
            'ORIGEN REGISTRO': 'Migración base madre',
            'ESTADO INTERES': 'Activo',
            'ULTIMA ACTUALIZACION': ahora,
            'OBSERVACIONES': 'Respuesta original: ' + interes.ORIGINAL
          }));
          interesesGuardados++;
          interesesFila++;
        });

        const perfilDatos = baseMadreConstruirPerfil_(
          idPersona,
          fuenteEncabezados,
          valores,
          registro,
          identidad,
          indiceFuente + 1
        );
        let perfil = perfilesPorPersona[idPersona];
        if (!perfil) {
          const filaPerfil = nuevaFilaSegunEncabezados_(perfilesEncabezados, perfilDatos);
          perfil = {indice:-1, fila:filaPerfil, nueva:true};
          perfilesPorPersona[idPersona] = perfil;
          perfilesNuevos.push(filaPerfil);
        } else if (baseMadreActualizarPerfil_(perfil.fila, mperfil, perfilDatos)) {
          if (!perfil.nueva) perfilesModificados[perfil.indice] = perfil.fila;
        }

        valores[mf['ID PERSONA']] = idPersona;
        valores[mf['ID PARTICIPACION']] = '';
        valores[mf['ESTADO PROCESO']] = advertencias.length || !intereses.length
          ? 'PROCESADO_CON_ADVERTENCIA' : 'PROCESADO';
        valores[mf['DETALLE PROCESO']] = 'Persona ' + (creadaEnEstaFila ? 'creada' : 'consolidada') +
          '. Intereses nuevos: ' + interesesFila + '. Perfil histórico actualizado.' +
          (!intereses.length ? ' No se reconoció un interés temático.' : '') +
          (advertencias.length ? ' Advertencias: ' + advertencias.join(' ') : '');
        resueltas++;
      } catch (error) {
        valores[mf['ID PERSONA']] = '';
        valores[mf['ID PARTICIPACION']] = '';
        valores[mf['ESTADO PROCESO']] = 'REVISION';
        valores[mf['DETALLE PROCESO']] = error.message;
        revision++;
      }
    });

    if (Object.keys(personasModificadas).length && personasValores.length > 1) {
      personasHoja.getRange(2, 1, personasValores.length - 1, personasEncabezados.length)
        .setValues(personasValores.slice(1));
    }
    if (personasNuevas.length) {
      personasHoja.getRange(personasHoja.getLastRow() + 1, 1, personasNuevas.length, personasEncabezados.length)
        .setValues(personasNuevas);
    }
    if (interesesNuevos.length) {
      interesesHoja.getRange(interesesHoja.getLastRow() + 1, 1, interesesNuevos.length, interesesEncabezados.length)
        .setValues(interesesNuevos);
    }
    if (Object.keys(perfilesModificados).length && perfilesValores.length > 1) {
      perfilesHoja.getRange(2, 1, perfilesValores.length - 1, perfilesEncabezados.length)
        .setValues(perfilesValores.slice(1));
    }
    if (perfilesNuevos.length) {
      perfilesHoja.getRange(perfilesHoja.getLastRow() + 1, 1, perfilesNuevos.length, perfilesEncabezados.length)
        .setValues(perfilesNuevos);
    }
    ['ID PERSONA', 'ID PARTICIPACION', 'ESTADO PROCESO', 'DETALLE PROCESO'].forEach(function(campo) {
      const columna = mf[campo];
      fuente.getRange(2, columna + 1, fuenteValores.length - 1, 1)
        .setValues(fuenteValores.slice(1).map(function(fila) { return [fila[columna]]; }));
    });
    importacionesAsegurarHistorial_(central).appendRow([
      'BASE-' + Utilities.getUuid().slice(0, 8).toUpperCase(), new Date(),
      Session.getActiveUser().getEmail() || 'Usuario no disponible',
      'BASE_MADRE', '', 'Base madre', seleccionadas.length,
      Object.keys(personasCreadasIds).length, Object.keys(personasActualizadasIds).length,
      0, 0, revision,
      pendientes.length - seleccionadas.length + revision > 0 ? 'En proceso' : 'Finalizada'
    ]);
    SpreadsheetApp.flush();
    sigcInvalidarCache_();
    const resultado = {
      intentadas: seleccionadas.length,
      resueltas: resueltas,
      revision: revision,
      restantes: Math.max(0, pendientes.length - seleccionadas.length + revision),
      personasCreadas: Object.keys(personasCreadasIds).length,
      personasActualizadas: Object.keys(personasActualizadasIds).length,
      interesesGuardados: interesesGuardados,
      perfilesActualizados: perfilesNuevos.length + Object.keys(perfilesModificados).length,
      documentosHistoricos: documentosHistoricos
    };
    return {
      ok: true,
      resultado: resultado,
      mensaje: 'Lote terminado: ' + resueltas + ' procesada(s), ' + revision +
        ' en revisión, ' + interesesGuardados + ' interés(es), ' +
        resultado.perfilesActualizados + ' perfil(es) actualizado(s) y ' +
        resultado.restantes + ' pendiente(s).'
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Amplía la validación histórica de PERSONAS antes de escribir el lote.
 * Las versiones anteriores solo aceptaban RUT y Pasaporte, por lo que Sheets
 * rechazaba documentos conservados por la migración en toda la escritura.
 */
function baseMadreAsegurarValidacionTipoDocumento_(hoja) {
  if (!hoja) throw new Error('No se encontró la hoja PERSONAS.');
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const mapa = mapaEncabezados_(encabezados);
  const indice = mapa['TIPO DOCUMENTO'];
  if (indice === undefined) return;
  const valores = [
    'RUT',
    'Pasaporte',
    'Documento extranjero',
    'Documento histórico',
    'Identificador histórico'
  ];
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

function baseMadreAsegurarIntereses_(ss) {
  const encabezados = [
    'ID_INTERES', 'ID_PERSONA', 'ESCUELA_LINEA', 'AREA_TEMATICA',
    'FECHA_REGISTRO', 'ORIGEN_REGISTRO', 'ESTADO_INTERES',
    'ULTIMA_ACTUALIZACION', 'OBSERVACIONES'
  ];
  const nombre = SISTEMA.HOJAS.INTERESES || 'INTERESES_CAPACITACION';
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) hoja = ss.insertSheet(nombre);
  importadorAsegurarEncabezados_(hoja, encabezados);
  hoja.setFrozenRows(1);
  return hoja;
}

function baseMadreAsegurarPerfiles_(ss) {
  const encabezados = [
    'ID_PERSONA', 'FECHA_PRIMERA_RESPUESTA', 'FECHA_ULTIMA_RESPUESTA', 'ANO_REGISTRO',
    'DOCUMENTO_ORIGINAL', 'CALIDAD_DOCUMENTO', 'NOMBRE_SOCIAL', 'EDAD_DECLARADA',
    'NIVEL_EDUCACIONAL', 'DISCAPACIDAD', 'MEDIDAS_ACCESIBILIDAD', 'SITUACION_OCUPACIONAL',
    'TIENE_EMPRENDIMIENTO', 'AREA_EMPRENDIMIENTO', 'RUBRO', 'FORMALIZADO_SII',
    'DESCRIPCION_EMPRENDIMIENTO', 'REDES_EMPRENDIMIENTO', 'LINEA_INTERES_DECLARADA',
    'MODALIDAD_PREFERIDA', 'HORARIO_PREFERIDO', 'OTROS_APOYOS',
    'PARTICIPA_ORGANIZACION', 'CONEXION_INTERNET', 'EQUIPOS_CONEXION',
    'COMO_SE_ENTERO', 'CANAL_DIFUSION', 'BUSCA_TRABAJO', 'SECTOR_EXPERIENCIA',
    'ES_CUIDADOR', 'CREDENCIAL_DISCAPACIDAD', 'JEFE_HOGAR', 'TRAMO_RSH',
    'AUTORIZA_DATOS', 'AUTORIZA_IMAGEN', 'FILAS_ORIGEN',
    'ULTIMA_ACTUALIZACION', 'DATOS_ULTIMA_RESPUESTA_JSON'
  ];
  const nombre = SISTEMA.HOJAS.PERFILES_BASE_MADRE || SIGC_IMPORTACIONES.HOJA_PERFILES_BASE_MADRE;
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) hoja = ss.insertSheet(nombre);
  importadorAsegurarEncabezados_(hoja, encabezados);
  hoja.setFrozenRows(1);
  return hoja;
}

function baseMadreCrearIndicesPersonas_() {
  return {documento:{}, correoNombre:{}, telefonoNombre:{}, nombreNacimiento:{}};
}

function baseMadreAgregarIndiceUnico_(indice, clave, persona) {
  if (!clave) return;
  if (!Object.prototype.hasOwnProperty.call(indice, clave)) {
    indice[clave] = persona;
  } else if (indice[clave] !== persona) {
    indice[clave] = null;
  }
}

function baseMadreClaveDocumento_(tipo, numero, nacionalidad) {
  const tipoNormalizado = sigcNormalizarTipoDocumento(tipo, tipo === 'RUT' ? numero : '');
  const documento = sigcNormalizarDocumento(tipoNormalizado, numero, tipoNormalizado === 'RUT' ? numero : '');
  if (!tipoNormalizado || !documento) return '';
  if (tipoNormalizado === 'RUT') return 'RUT|' + documento;
  if (tipoNormalizado === 'Identificador histórico') return tipoNormalizado + '|' + documento;
  return tipoNormalizado + '|' + documento + '|' + sigcNormalizarClave(nacionalidad);
}

function baseMadreFechaClave_(valor) {
  if (!valor) return '';
  if (valor instanceof Date && !isNaN(valor.getTime())) return String(valor.getTime());
  return sigcNormalizarClave(valor);
}

function baseMadreIndexarPersona_(indices, persona, mapa) {
  const fila = persona.fila;
  const valor = function(campo) {
    return mapa[campo] === undefined ? '' : fila[mapa[campo]];
  };
  const rut = valor('RUT');
  const tipo = sigcNormalizarTipoDocumento(valor('TIPO DOCUMENTO'), rut);
  const numero = sigcNormalizarDocumento(tipo, valor('NUMERO DOCUMENTO') || rut, rut);
  const nombre = sigcNormalizarClave(valor('NOMBRE COMPLETO'));
  const correo = sigcNormalizarCorreo(valor('CORREO'));
  const telefono = sigcNormalizarTelefono(valor('TELEFONO'));
  const nacimiento = baseMadreFechaClave_(valor('FECHA NACIMIENTO'));
  const claveDocumento = baseMadreClaveDocumento_(tipo, numero, valor('NACIONALIDAD'));
  if (claveDocumento && !indices.documento[claveDocumento]) indices.documento[claveDocumento] = persona;
  if (nombre && correo && sigcValidarCorreo(correo)) {
    baseMadreAgregarIndiceUnico_(indices.correoNombre, correo + '|' + nombre, persona);
  }
  if (nombre && telefono && sigcValidarTelefono(telefono)) {
    baseMadreAgregarIndiceUnico_(indices.telefonoNombre, telefono + '|' + nombre, persona);
  }
  if (nombre && nacimiento) {
    baseMadreAgregarIndiceUnico_(indices.nombreNacimiento, nombre + '|' + nacimiento, persona);
  }
}

function baseMadreEncontrarPersona_(indices, identidad, registro) {
  if (identidad.clave && indices.documento[identidad.clave]) return indices.documento[identidad.clave];
  if (!identidad.historica) return null;
  const nombre = sigcNormalizarClave(registro.nombre);
  const correo = sigcNormalizarCorreo(registro.correo);
  const telefono = sigcNormalizarTelefono(registro.telefono);
  const nacimiento = baseMadreFechaClave_(registro.fechaNacimiento);
  return (correo && indices.correoNombre[correo + '|' + nombre]) ||
    (telefono && indices.telefonoNombre[telefono + '|' + nombre]) ||
    (nacimiento && indices.nombreNacimiento[nombre + '|' + nacimiento]) || null;
}

function baseMadreLimpiarRegistro_(registro) {
  const advertencias = [];
  registro.nombre = sigcNormalizarNombre(registro.nombre);
  if (!registro.nombre) throw new Error('Falta el nombre de la persona.');
  const correoOriginal = sigcNormalizarTexto(registro.correo);
  registro.correo = sigcNormalizarCorreo(correoOriginal);
  if (registro.correo && !sigcValidarCorreo(registro.correo)) {
    registro.correo = '';
    advertencias.push('Correo no interpretable omitido.');
  }
  const telefonoOriginal = sigcNormalizarTexto(registro.telefono);
  registro.telefono = sigcNormalizarTelefono(telefonoOriginal);
  if (registro.telefono && !sigcValidarTelefono(registro.telefono)) {
    registro.telefono = '';
    advertencias.push('Teléfono no interpretable omitido.');
  }
  registro.comuna = sigcNormalizarNombre(registro.comuna);
  registro.barrio = sigcNormalizarTexto(registro.barrio);
  registro.direccion = sigcNormalizarTexto(registro.direccion);
  registro.genero = baseMadreNormalizarGenero_(registro.genero);
  registro.nacionalidad = sigcNormalizarNombre(registro.nacionalidad);
  registro.autorizaContacto = baseMadreNormalizarAutorizacion_(registro.autorizaContacto);
  return advertencias;
}

function baseMadreNormalizarGenero_(valor) {
  const clave = sigcNormalizarClave(valor);
  if (!clave) return '';
  if (clave.indexOf('mujer') >= 0 || clave.indexOf('femen') >= 0) return 'Mujer';
  if (clave.indexOf('hombre') >= 0 || clave.indexOf('mascul') >= 0) return 'Hombre';
  if (clave.indexOf('no binar') >= 0) return 'No binario';
  if (clave.indexOf('prefiero no') >= 0) return 'Prefiere no informar';
  return sigcNormalizarTexto(valor);
}

function baseMadreHash_(valor) {
  const texto = String(valor || '');
  let hash = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function baseMadreResolverIdentidad_(registro, filaOrigen) {
  const advertencias = [];
  const rutCandidato = sigcNormalizarRut(registro.rut);
  if (rutCandidato && sigcValidarRut(rutCandidato)) {
    return {
      tipo:'RUT', numero:rutCandidato, clave:'RUT|' + rutCandidato,
      historica:false, calidad:'RUT válido', original:rutCandidato, advertencias:advertencias
    };
  }
  const alternativo = sigcNormalizarTexto(registro.documentoAlternativo);
  if (alternativo) {
    const tipo = sigcNormalizarClave(registro.tipoDeclarado).indexOf('dni') >= 0
      ? 'Documento extranjero' : 'Documento histórico';
    const numero = sigcNormalizarDocumento(tipo, alternativo);
    if (numero.length >= 4) {
      advertencias.push('Documento extranjero/histórico conservado sin validación de RUT.');
      return {
        tipo:tipo, numero:numero,
        clave:baseMadreClaveDocumento_(tipo, numero, registro.nacionalidad),
        historica:true, calidad:'Documento extranjero declarado', original:alternativo,
        advertencias:advertencias
      };
    }
  }
  if (rutCandidato) {
    const tipo = 'Documento histórico';
    const numero = sigcNormalizarDocumento(tipo, rutCandidato);
    advertencias.push('RUT histórico reconstruido desde cuerpo y dígito verificador; no validado como RUT chileno.');
    return {
      tipo:tipo, numero:numero,
      clave:baseMadreClaveDocumento_(tipo, numero, registro.nacionalidad),
      historica:true, calidad:'RUT histórico no validado', original:rutCandidato,
      advertencias:advertencias
    };
  }
  const base = registro.correo || registro.telefono ||
    [sigcNormalizarClave(registro.nombre), baseMadreFechaClave_(registro.fechaNacimiento)].join('|') ||
    'fila|' + filaOrigen;
  const numero = 'HIST-' + baseMadreHash_(base);
  advertencias.push('Sin documento utilizable; se creó un identificador histórico trazable.');
  return {
    tipo:'Identificador histórico', numero:numero,
    clave:baseMadreClaveDocumento_('Identificador histórico', numero, ''),
    historica:true, calidad:'Identificador histórico generado', original:'',
    advertencias:advertencias
  };
}

function baseMadreMapaFila_(encabezados, valores) {
  const mapa = {};
  encabezados.forEach(function(encabezado, indice) {
    const k = sigcNormalizarEncabezado(encabezado);
    if (!k) return;
    const val = valores[indice];
    const tieneValor = val !== '' && val !== null && val !== undefined && String(val).trim() !== '';
    if (tieneValor || mapa[k] === undefined) {
      mapa[k] = val;
    }
  });
  return mapa;
}

function baseMadreBuscarMapa_(mapa, fragmentos) {
  const claves = Object.keys(mapa);
  for (let i = 0; i < claves.length; i++) {
    const clave = claves[i];
    if (!fragmentos.some(function(fragmento) { return clave.indexOf(fragmento) >= 0; })) continue;
    const valor = mapa[clave];
    if (valor !== '' && valor !== null && valor !== undefined) return valor;
  }
  return '';
}

function baseMadreOriginalSinTecnicos_(encabezados, valores) {
  const tecnicos = encabezadosTecnicosFormulario_();
  const salida = {};
  encabezados.forEach(function(encabezado, indice) {
    const clave = normalizarEncabezado_(encabezado);
    if (!encabezado || tecnicos[clave]) return;
    salida[String(encabezado)] = valores[indice] == null ? '' : valores[indice];
  });
  return salida;
}

function baseMadreConstruirPerfil_(idPersona, encabezados, valores, registro, identidad, filaOrigen) {
  const mapa = baseMadreMapaFila_(encabezados, valores);
  const buscar = function(fragmentos) { return baseMadreBuscarMapa_(mapa, fragmentos); };
  const fecha = registro.timestamp || new Date();
  const redes = buscar(['NOMBRE DE LA S RED ES SOCIAL', 'REDES SOCIALES DE TU EMPRENDIMIENTO']);
  const original = JSON.stringify(baseMadreOriginalSinTecnicos_(encabezados, valores)).slice(0, 45000);
  return {
    'ID PERSONA': idPersona,
    'FECHA PRIMERA RESPUESTA': fecha,
    'FECHA ULTIMA RESPUESTA': fecha,
    'ANO REGISTRO': buscar(['ANO']),
    'DOCUMENTO ORIGINAL': identidad.original,
    'CALIDAD DOCUMENTO': identidad.calidad,
    'NOMBRE SOCIAL': buscar(['NOMBRE SOCIAL']),
    'EDAD DECLARADA': buscar(['EDAD']),
    'NIVEL EDUCACIONAL': buscar(['NIVEL EDUCACIONAL', 'ESCOLARIDAD', 'ESTUDIOS']),
    'DISCAPACIDAD': buscar(['PRESENTA ALGUNA SITUACION DE DISCAPACIDAD', 'SITUACION DE DISCAPACIDAD', 'DISCAPACIDAD']),
    'MEDIDAS ACCESIBILIDAD': buscar(['MEDIDAS DE ACCESIBILIDAD', 'ACCESIBILIDAD']),
    'SITUACION OCUPACIONAL': buscar(['SITUACION OCUPACIONAL', 'OCUPACION ACTUAL', 'SITUACION LABORAL']),
    'TIENE EMPRENDIMIENTO': buscar(['TIENES UN EMPRENDIMIENTO', 'TIENE UN EMPRENDIMIENTO', 'CUENTA CON EMPRENDIMIENTO']),
    'AREA EMPRENDIMIENTO': buscar(['AREA EN QUE SE DESARROLLA', 'AREA DE EMPRENDIMIENTO']),
    'RUBRO': buscar(['RUBROS ES MAS CERCANO', 'ACTIVIDAD ECONOMICA', 'RUBRO']),
    'FORMALIZADO SII': buscar(['FORMALIZADO ANTE SII', 'FORMALIZACION', 'INICIO DE ACTIVIDADES']),
    'DESCRIPCION EMPRENDIMIENTO': buscar(['DESCRIBE BREVEMENTE TU EMPRENDIMIENTO']),
    'REDES EMPRENDIMIENTO': redes,
    'LINEA INTERES DECLARADA': buscar(['LINEA DE CAPACITACION']),
    'MODALIDAD PREFERIDA': buscar(['MODALIDAD DE CAPACITACION']),
    'HORARIO PREFERIDO': buscar(['HORARIO PREFIERES', 'HORARIO CONSOLIDADO']),
    'OTROS APOYOS': buscar(['OTROS APOYOS NECESITAS']),
    'PARTICIPA ORGANIZACION': buscar(['PARTICIPAS DE ALGUN TIPO DE ORGANIZACION']),
    'CONEXION INTERNET': buscar(['TIPO DE CONEXION A INTERNET']),
    'EQUIPOS CONEXION': buscar(['TIPO DE EQUIPO CUENTAS']),
    'COMO SE ENTERO': buscar(['COMO TE ENTERASTE']),
    'CANAL DIFUSION': buscar(['MEDIO O CANAL VISTE LA PUBLICACION']),
    'BUSCA TRABAJO': buscar(['BUSQUEDA DE TRABAJO']),
    'SECTOR EXPERIENCIA': buscar(['SECTOR ECONOMICO']),
    'ES CUIDADOR': buscar(['ERES CUIDADOR']),
    'CREDENCIAL DISCAPACIDAD': buscar(['CREDENCIAL DE DISCAPACIDAD']),
    'JEFE HOGAR': buscar(['JEFE A DE HOGAR']),
    'TRAMO RSH': buscar(['TRAMO SE UBICA DEL REGISTRO SOCIAL']),
    'AUTORIZA DATOS': registro.autorizaContacto,
    'AUTORIZA IMAGEN': baseMadreNormalizarAutorizacion_(buscar(['USO DE IMAGEN'])),
    'FILAS ORIGEN': String(filaOrigen),
    'ULTIMA ACTUALIZACION': new Date(),
    'DATOS ULTIMA RESPUESTA JSON': original
  };
}

function baseMadreActualizarPerfil_(fila, mapa, datos) {
  let cambio = false;
  Object.keys(datos).forEach(function(campo) {
    const columna = mapa[sigcNormalizarEncabezado(campo)];
    if (columna === undefined || campo === 'ID PERSONA') return;
    const nuevo = datos[campo];
    if (nuevo === '' || nuevo === null || nuevo === undefined) return;
    if (campo === 'FILAS ORIGEN') {
      const filas = String(fila[columna] || '').split(',').map(function(v) { return v.trim(); }).filter(Boolean);
      if (filas.indexOf(String(nuevo)) < 0) filas.push(String(nuevo));
      const unido = filas.join(', ');
      if (unido !== fila[columna]) { fila[columna] = unido; cambio = true; }
      return;
    }
    if (campo === 'FECHA PRIMERA RESPUESTA') {
      if (!fila[columna] || new Date(nuevo).getTime() < new Date(fila[columna]).getTime()) {
        fila[columna] = nuevo; cambio = true;
      }
      return;
    }
    if (campo === 'FECHA ULTIMA RESPUESTA') {
      if (!fila[columna] || new Date(nuevo).getTime() >= new Date(fila[columna]).getTime()) {
        fila[columna] = nuevo; cambio = true;
      }
      return;
    }
    if (String(fila[columna] == null ? '' : fila[columna]) !== String(nuevo)) {
      fila[columna] = nuevo;
      cambio = true;
    }
  });
  return cambio;
}

/** Procesa una respuesta general dentro del lock administrado por Codigo.gs. */
function procesarFilaInteresGeneral_(hoja, fila, encabezados, valores) {
  const registro = registroBaseMadreDesdeFila_(encabezados, valores);
  const advertencias = baseMadreLimpiarRegistro_(registro);
  const identidad = baseMadreResolverIdentidad_(registro, fila);
  Array.prototype.push.apply(advertencias, identidad.advertencias);
  registro.tipoDocumento = identidad.tipo;
  registro.numeroDocumento = identidad.numero;
  registro.rut = identidad.tipo === 'RUT' ? identidad.numero : '';
  const persona = obtenerOCrearPersona_(registro);
  const intereses = extraerInteresesBaseMadre_(encabezados, valores);
  const guardados = guardarInteresesBaseMadre_(persona.id, intereses, registro.timestamp);
  guardarPerfilBaseMadreIndividual_(persona.id, encabezados, valores, registro, identidad, fila);
  const estado = advertencias.length || !guardados ? 'PROCESADO_CON_ADVERTENCIA' : 'PROCESADO';
  const detalle = 'Persona ' + (persona.nueva ? 'creada' : 'actualizada') +
    '. Intereses registrados o actualizados: ' + guardados + '.' +
    (!guardados ? ' No se reconoció un interés temático; revise la respuesta.' : '') +
    (advertencias.length ? ' Advertencias: ' + advertencias.join(' ') : '');
  registrarResultadoEnRespuesta_(hoja, fila, persona.id, '', estado, detalle);
  return {omitida: false, estado: estado, idPersona: persona.id, idParticipacion: '', intereses: guardados};
}

function guardarPerfilBaseMadreIndividual_(idPersona, encabezados, valores, registro, identidad, filaOrigen) {
  const ss = sigcSpreadsheetCentral_();
  const hoja = baseMadreAsegurarPerfiles_(ss);
  const tabla = hoja.getDataRange().getValues();
  const mapa = mapaEncabezados_(tabla[0]);
  const datos = baseMadreConstruirPerfil_(
    idPersona, encabezados, valores, registro, identidad, filaOrigen
  );
  for (let i = 1; i < tabla.length; i++) {
    if (String(tabla[i][mapa['ID PERSONA']] || '') !== String(idPersona)) continue;
    if (baseMadreActualizarPerfil_(tabla[i], mapa, datos)) {
      hoja.getRange(i + 1, 1, 1, tabla[0].length).setValues([tabla[i]]);
    }
    return;
  }
  hoja.getRange(hoja.getLastRow() + 1, 1, 1, tabla[0].length)
    .setValues([nuevaFilaSegunEncabezados_(tabla[0], datos)]);
}

function registroBaseMadreDesdeFila_(encabezados, valores) {
  const mapa = {};
  encabezados.forEach(function(encabezado, indice) {
    const k = sigcNormalizarEncabezado(encabezado);
    if (!k) return;
    const val = valores[indice];
    const tieneValor = val !== '' && val !== null && val !== undefined && String(val).trim() !== '';
    if (tieneValor || mapa[k] === undefined) {
      mapa[k] = val;
    }
  });
  function buscar(fragmentos) {
    const claves = Object.keys(mapa);
    for (let i = 0; i < claves.length; i++) {
      const clave = claves[i];
      if (fragmentos.some(function(fragmento) { return clave.indexOf(fragmento) >= 0; })) {
        const valor = mapa[clave];
        if (valor !== '' && valor !== null && valor !== undefined) return valor;
      }
    }
    return '';
  }
  function buscarFiltrado(fragmentos, exclusiones) {
    const claves = Object.keys(mapa);
    for (let i = 0; i < claves.length; i++) {
      const clave = claves[i];
      if (exclusiones.some(function(fragmento) { return clave.indexOf(fragmento) >= 0; })) continue;
      if (!fragmentos.some(function(fragmento) { return clave.indexOf(fragmento) >= 0; })) continue;
      const valor = mapa[clave];
      if (valor !== '' && valor !== null && valor !== undefined) return valor;
    }
    return '';
  }
  const rutExacto = mapa.RUT || mapa.RUN || '';
  const rutDirecto = rutExacto || buscarFiltrado(
    ['RUT EJ', 'RUT COMPLETO', 'INGRESE SU RUT', 'ESCRIBA SU RUT', 'RUT', 'RUN'],
    ['SIN PUNTOS', 'SIN PUNTO', 'HASTA ANTES', 'DIGITO VERIFICADOR', 'USTED CUENTA', 'CUENTA CON', 'TIPO', 'EMPRESA', 'EMPRENDIMIENTO']
  );
  const cuerpo = buscar(['RUT SIN PUNTOS', 'RUT SIN PUNTO', 'HASTA ANTES DEL GUION']);
  const dv = buscarFiltrado(
    ['ESCRIBA EL DIGITO VERIFICADOR', 'NUMERO DESPUES DEL GUION', 'DIGITO VERIFICADOR DE SU RUT', 'DIGITO VERIFICADOR'],
    ['SIN EL DIGITO VERIFICADOR', 'SIN DIGITO VERIFICADOR']
  );
  const pasaporte = buscar(['DNI PASAPORTE', 'PASAPORTE U OTRO', 'NUMERO DOCUMENTO']);
  const tipoDeclarado = buscar(['USTED CUENTA CON', 'TIPO DE DOCUMENTO', 'TIPO DOCUMENTO']);
  const tieneCuerpo = cuerpo !== '' && cuerpo !== null && cuerpo !== undefined && String(cuerpo).trim() !== '';
  const tieneDv = dv !== '' && dv !== null && dv !== undefined && String(dv).trim() !== '';
  const tieneRutDir = rutDirecto && /\d{6,}/.test(String(rutDirecto));
  const rut = (tieneRutDir ? String(rutDirecto).trim() : '') ||
    (tieneCuerpo && tieneDv ? String(cuerpo).trim() + '-' + String(dv).trim() : (tieneCuerpo ? String(cuerpo).trim() : ''));
  const tipo = sigcNormalizarClave(tipoDeclarado).indexOf('pasaporte') >= 0 || (!rut && pasaporte)
    ? 'Pasaporte' : 'RUT';
  const nombreComp = buscarFiltrado(
    ['NOMBRE COMPLETO', 'NOMBRES Y APELLIDOS', 'NOMBRE Y APELLIDO', 'NOMBRE Y DOS APELLIDOS'],
    ['EMPRENDIMIENTO', 'EMPRESA', 'SOCIAL']
  );
  const soloNombres = nombreComp ? '' : buscarFiltrado(
    ['NOMBRES', 'NOMBRE'],
    ['APELLIDO', 'COMPLETO', 'EMPRENDIMIENTO', 'EMPRESA', 'SOCIAL']
  );
  const soloApellidos = nombreComp ? '' : buscarFiltrado(
    ['APELLIDOS', 'APELLIDO'],
    ['NOMBRE', 'COMPLETO', 'EMPRENDIMIENTO', 'EMPRESA', 'SOCIAL']
  );
  const domicilio = buscarFiltrado(['DOMLICIO', 'DOMICILIO', 'DIRECCION'], ['CORREO', 'EMAIL']);
  const aclaratoria = buscar(['ACLARATORIA']);
  return {
    timestamp: buscar(['MARCA TEMPORAL', 'TIMESTAMP', 'FECHA REGISTRO']),
    tipoDocumento: tipo,
    numeroDocumento: tipo === 'RUT' ? rut : pasaporte,
    rut: tipo === 'RUT' ? rut : '',
    rutCuerpo: cuerpo,
    rutDv: dv,
    tipoDeclarado: tipoDeclarado,
    documentoAlternativo: pasaporte,
    nombre: sigcNormalizarTexto(nombreComp || [soloNombres, soloApellidos].filter(Boolean).join(' ')),
    correo: buscar(['CORREO ELECTRONICO', 'EMAIL', 'CORREO']),
    telefono: buscar(['TELEFONO', 'CELULAR']),
    comuna: buscar(['COMUNA']),
    barrio: buscarFiltrado(
      ['BARRIO', 'UNIDAD VECINAL', 'POBLACION', 'VILLA', 'SECTOR'],
      ['ECONOMICO', 'PRODUCTIVO', 'LABORAL', 'EXPERIENCIA', 'RUBRO', 'COMERCIAL']
    ),
    direccion: sigcNormalizarTexto([domicilio, aclaratoria].filter(Boolean).join(', ')),
    fechaNacimiento: buscar(['FECHA DE NACIMIENTO', 'FECHA NACIMIENTO', 'CUAL ES TU FECHA DE NACIMIENTO']),
    genero: buscarFiltrado(
      ['GENERO TE IDENTIFICAS', 'IDENTIDAD DE GENERO', 'CUAL ES SU GENERO', 'CUAL ES TU GENERO', 'GENERO', 'SEXO'],
      ['ENFOQUE', 'EQUIDAD', 'VIOLENCIA', 'TEMATICA', 'PREFERENCIA', 'AREA']
    ),
    nacionalidad: buscar(['NACIONALIDAD', 'PAIS DE ORIGEN', 'PAIS DE NACIMIENTO']),
    participaPmjh: buscar(['PARTICIPA PMJH', 'MUJERES JEFAS DE HOGAR']),
    autorizaContacto: buscar(['AUTORIZA RECIBIR INFORMACION', 'AUTORIZA CONTACTO', 'USO DE DATOS']),
    origen: 'Formulario base madre',
    observaciones: ''
  };
}

function baseMadreNormalizarAutorizacion_(valor) {
  const clave = sigcNormalizarClave(valor);
  if (!clave) return 'No informado';
  if (clave.indexOf('no acepto') >= 0 || clave.indexOf('no autorizo') >= 0) return 'No';
  if (clave.indexOf('acepto') >= 0 || clave.indexOf('autorizo') >= 0) return 'Sí';
  return sigcNormalizarSiNo(valor, 'No informado');
}

function extraerInteresesBaseMadre_(encabezados, valores) {
  const intereses = [];
  let lineaDeclarada = '';
  encabezados.forEach(function(encabezado, indice) {
    const clave = sigcNormalizarEncabezado(encabezado);
    const valor = sigcNormalizarTexto(valores[indice]);
    if (!valor) return;
    if (clave.indexOf('LINEA DE CAPACITACION') >= 0) lineaDeclarada = valor;
    if (clave.indexOf('PREFERENCIA') < 0 && clave.indexOf('AREA DE CAPACITACION') < 0) return;
    let linea = '';
    if (clave.indexOf('EMPLEO') >= 0) linea = 'Empleo';
    if (clave.indexOf('EMPRENDIMIENTO') >= 0) linea = 'Emprendimiento';
    if (!linea) return;
    // Las alternativas históricas contienen comas dentro de su propia
    // descripción (por ejemplo: "Office, redes sociales, página web").
    // Se interpreta la respuesta completa para no inventar intereses separados.
    const area = baseMadreMapearArea_(linea, valor);
    if (area) intereses.push({ESCUELA_LINEA: linea, AREA_TEMATICA: area, ORIGINAL: valor});
  });
  if (!intereses.length && lineaDeclarada) {
    const linea = sigcNormalizarClave(lineaDeclarada);
    if (linea.indexOf('empleo') >= 0 || linea.indexOf('ambos') >= 0) {
      intereses.push({ESCUELA_LINEA:'Empleo', AREA_TEMATICA:'Otra área de empleo', ORIGINAL:lineaDeclarada});
    }
    if (linea.indexOf('emprend') >= 0 || linea.indexOf('ambos') >= 0) {
      intereses.push({ESCUELA_LINEA:'Emprendimiento', AREA_TEMATICA:'Otra área de emprendimiento', ORIGINAL:lineaDeclarada});
    }
  }
  const unicos = {};
  return intereses.filter(function(interes) {
    const clave = sigcNormalizarClave(interes.ESCUELA_LINEA + '|' + interes.AREA_TEMATICA);
    if (unicos[clave]) return false;
    unicos[clave] = true;
    return true;
  });
}

function baseMadreMapearArea_(linea, respuesta) {
  const valor = sigcNormalizarClave(respuesta);
  if (!valor || ['ninguna', 'no', 'no aplica'].indexOf(valor) >= 0) return '';
  if (linea === 'Empleo') {
    if (/curriculum|curriculo|\bcv\b|entrevista/.test(valor)) return 'Currículum y entrevista laboral';
    if (/office|ofimat|excel|word/.test(valor)) return 'Ofimática';
    if (/digital|comput|tecnolog|redes sociales/.test(valor)) return 'Herramientas digitales para el trabajo';
    if (/busqueda de empleo|portales|empleabilidad/.test(valor)) return 'Empleabilidad y búsqueda de trabajo';
    if (/codigo del trabajo|normativa|legislacion|derechos/.test(valor)) return 'Derechos laborales';
    if (/liderazgo|trabajo en equipo/.test(valor)) return 'Liderazgo y trabajo en equipo';
    if (/comunicacion/.test(valor)) return 'Comunicación efectiva';
    if (/habilidades personales|habilidades blandas|habilidades laborales/.test(valor)) return 'Habilidades laborales';
    if (/oficio|os10|guardia|cajero|gasfiter|gastronom/.test(valor)) return 'Oficios';
    return 'Otra área de empleo';
  }
  if (/contab|finanz|costos/.test(valor)) return 'Finanzas, costos y contabilidad';
  if (/formaliza|tributar|sii/.test(valor)) return 'Formalización y aspectos tributarios';
  if (/marketing|clientes|ventas|comercial/.test(valor)) return 'Marketing, ventas y comercialización';
  if (/digital|redes sociales|pagina web|office/.test(valor)) return 'Transformación digital';
  if (/innov/.test(valor)) return 'Innovación y desarrollo de productos';
  if (/sustent|circular/.test(valor)) return 'Sustentabilidad y economía circular';
  if (/cooper|asociativ|gremio/.test(valor)) return 'Cooperativismo y asociatividad';
  if (/competitiv|diferencia|modelo de negocio|planifica|valor/.test(valor)) return 'Modelo de negocio y planificación';
  if (/financiamiento|credito|fondos/.test(valor)) return 'Acceso a financiamiento';
  if (/habilidades emprendedoras|liderazgo|storytelling|pitch/.test(valor)) return 'Gestión del emprendimiento';
  return 'Otra área de emprendimiento';
}

function guardarInteresesBaseMadre_(idPersona, intereses, fecha) {
  if (!intereses.length) return 0;
  const ss = sigcSpreadsheetCentral_();
  const hoja = baseMadreAsegurarIntereses_(ss);
  const tabla = leerTablaImportador_(hoja);
  const existentes = {};
  tabla.filas.forEach(function(fila) {
    existentes[
      String(fila.datos.ID_PERSONA || '') + '|' +
      sigcNormalizarClave(fila.datos.ESCUELA_LINEA) + '|' +
      sigcNormalizarClave(fila.datos.AREA_TEMATICA)
    ] = fila;
  });
  let siguiente = importacionesSiguienteNumero_(tabla.filas, 'ID_INTERES', 'INT-');
  let guardados = 0;
  intereses.forEach(function(interes) {
    const clave = String(idPersona) + '|' + sigcNormalizarClave(interes.ESCUELA_LINEA) + '|' +
      sigcNormalizarClave(interes.AREA_TEMATICA);
    if (existentes[clave]) {
      const fila = existentes[clave];
      const mapa = importadorMapaEncabezados_(tabla.encabezados);
      if (mapa['ESTADO INTERES'] !== undefined) hoja.getRange(fila.numeroFila, mapa['ESTADO INTERES'] + 1).setValue('Activo');
      if (mapa['ULTIMA ACTUALIZACION'] !== undefined) hoja.getRange(fila.numeroFila, mapa['ULTIMA ACTUALIZACION'] + 1).setValue(new Date());
      guardados++;
      return;
    }
    agregarFilaImportador_(hoja, tabla.encabezados, {
      ID_INTERES: 'INT-' + String(siguiente++).padStart(6, '0'),
      ID_PERSONA: idPersona,
      ESCUELA_LINEA: interes.ESCUELA_LINEA,
      AREA_TEMATICA: interes.AREA_TEMATICA,
      FECHA_REGISTRO: fecha || new Date(),
      ORIGEN_REGISTRO: 'Formulario base madre',
      ESTADO_INTERES: 'Activo',
      ULTIMA_ACTUALIZACION: new Date(),
      OBSERVACIONES: interes.ORIGINAL && sigcNormalizarClave(interes.ORIGINAL) !== sigcNormalizarClave(interes.AREA_TEMATICA)
        ? 'Respuesta original: ' + interes.ORIGINAL : ''
    });
    existentes[clave] = true;
    guardados++;
  });
  return guardados;
}

function importacionesRegistroUniversal_(fila, mapeo, generales) {
  function valor(campo) {
    const propio = importacionesValorMapeado_(fila, mapeo, campo);
    return propio === '' || propio === null || propio === undefined ? generales[campo] || '' : propio;
  }
  const rut = valor('RUT');
  const tipo = sigcNormalizarTipoDocumento(valor('TIPO_DOCUMENTO') || generales.TIPO_DOCUMENTO, rut);
  const nombreCompleto = valor('NOMBRE_COMPLETO') ||
    [valor('NOMBRES'), valor('APELLIDOS')].filter(Boolean).join(' ');
  return {
    tipoDocumento: tipo || 'RUT',
    numeroDocumento: valor('NUMERO_DOCUMENTO') || rut,
    rut: rut,
    nombre: nombreCompleto,
    correo: valor('CORREO'),
    telefono: valor('TELEFONO'),
    comuna: valor('COMUNA'),
    genero: valor('GENERO'),
    fechaNacimiento: valor('FECHA_NACIMIENTO'),
    nacionalidad: valor('NACIONALIDAD'),
    participaPmjh: valor('PARTICIPA_PMJH'),
    fechaInscripcion: valor('FECHA_INSCRIPCION'),
    confirmaParticipacion: valor('CONFIRMA_PARTICIPACION'),
    sesionesAsistidas: valor('SESIONES_ASISTIDAS'),
    sesionesTotales: valor('SESIONES_TOTALES'),
    certificado: valor('CERTIFICADO'),
    observaciones: valor('OBSERVACIONES')
  };
}

function importacionesValorMapeado_(fila, mapeo, campo) {
  const indice = Number(mapeo && mapeo[campo]);
  if (!Number.isInteger(indice) || indice < 0 || indice >= fila.length) return '';
  return fila[indice] == null ? '' : fila[indice];
}

function importacionesNormalizarConfirmacion_(valor) {
  const clave = sigcNormalizarClave(valor);
  if (/confirmad|confirmo|asistira|asistirá/.test(clave)) return 'Sí';
  if (/no asiste|no podra asistir|no podrá asistir|rechaza/.test(clave)) return 'No';
  return sigcNormalizarSiNo(valor, 'No informado');
}

function importacionesSiguienteNumero_(filas, campo, prefijo) {
  let maximo = 0;
  filas.forEach(function(fila) {
    const valor = String(fila.datos && fila.datos[campo] || '');
    if (valor.indexOf(prefijo) !== 0) return;
    const numero = parseInt(valor.substring(prefijo.length), 10);
    if (!isNaN(numero)) maximo = Math.max(maximo, numero);
  });
  return maximo + 1;
}

function importacionesFilaOriginal_(encabezados, fila) {
  const salida = {};
  encabezados.forEach(function(encabezado, indice) {
    salida[String(encabezado || 'Columna ' + (indice + 1))] = fila[indice] == null ? '' : fila[indice];
  });
  return salida;
}

function importacionesAsegurarHistorial_(ss) {
  const encabezados = [
    'ID_IMPORTACION', 'FECHA', 'USUARIO', 'TIPO', 'ID_ACTIVIDAD', 'ACTIVIDAD',
    'FILAS_RECIBIDAS', 'PERSONAS_CREADAS', 'PERSONAS_ACTUALIZADAS',
    'PARTICIPACIONES_CREADAS', 'DUPLICADOS', 'REVISION', 'ESTADO'
  ];
  let hoja = ss.getSheetByName(SIGC_IMPORTACIONES.HOJA_HISTORIAL);
  if (!hoja) hoja = ss.insertSheet(SIGC_IMPORTACIONES.HOJA_HISTORIAL);
  importadorAsegurarEncabezados_(hoja, encabezados);
  hoja.setFrozenRows(1);
  return hoja;
}

function importacionesAsegurarOriginales_(ss) {
  const encabezados = [
    'ID_IMPORTACION', 'FILA_ORIGEN', 'FECHA', 'USUARIO', 'DATOS_ORIGINALES_JSON',
    'ESTADO_PROCESO', 'ID_PERSONA', 'ID_PARTICIPACION', 'DETALLE_PROCESO'
  ];
  let hoja = ss.getSheetByName(SIGC_IMPORTACIONES.HOJA_ORIGINALES);
  if (!hoja) hoja = ss.insertSheet(SIGC_IMPORTACIONES.HOJA_ORIGINALES);
  importadorAsegurarEncabezados_(hoja, encabezados);
  hoja.setFrozenRows(1);
  return hoja;
}

function importacionesCamposBaseMadreDetectados_(encabezados) {
  const salida = {};
  encabezados.forEach(function(encabezado) {
    const clave = sigcNormalizarEncabezado(encabezado);
    if (clave.indexOf('NOMBRE COMPLETO') >= 0) salida.nombre = encabezado;
    if (clave === 'RUT' || clave.indexOf('RUT EJ') >= 0 || clave.indexOf('RUT COMPLETO') >= 0) salida.rut = encabezado;
    if (clave.indexOf('RUT SIN PUNTOS') >= 0 || clave.indexOf('HASTA ANTES DEL GUION') >= 0) salida.rutCuerpo = encabezado;
    if (clave.indexOf('DIGITO VERIFICADOR') >= 0 || clave.indexOf('NUMERO DESPUES DEL GUION') >= 0) salida.rutDv = encabezado;
    if (clave.indexOf('DNI PASAPORTE') >= 0 || clave.indexOf('PASAPORTE U OTRO') >= 0) salida.documento = encabezado;
    if (clave.indexOf('CORREO') >= 0 || clave.indexOf('EMAIL') >= 0) salida.correo = encabezado;
    if (clave.indexOf('TELEFONO') >= 0 || clave.indexOf('CELULAR') >= 0) salida.telefono = encabezado;
    if (clave.indexOf('LINEA DE CAPACITACION') >= 0) salida.linea = encabezado;
    if (clave.indexOf('PREFERENCIA') >= 0) salida.preferencias = true;
  });
  return salida;
}

function importacionesObtenerVinculacionBaseMadre_() {
  const ss = sigcSpreadsheetCentral_();
  const hoja = ss.getSheetByName(SISTEMA.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS');
  if (!hoja || hoja.getLastRow() < 2) return null;
  const tabla = leerTablaImportador_(hoja);
  const fila = tabla.filas.find(function(item) {
    return sigcNormalizarEncabezado(item.datos.TIPO) === sigcNormalizarEncabezado(SIGC_IMPORTACIONES.TIPO_INTERES_GENERAL);
  });
  if (!fila) return null;
  return {
    idConfig: fila.datos.ID_CONFIG,
    hoja: fila.datos.HOJA_RESPUESTAS,
    estado: fila.datos.ESTADO,
    fechaVinculacion: formFechaVisible_(fila.datos.FECHA_VINCULACION)
  };
}

function importacionesInvalidarPanelFormularios_() {
  try { CacheService.getScriptCache().remove('SIGC_PANEL_FORMULARIOS_V1'); } catch (error) {}
}

function importacionesNormalizarFechaNacimiento_(valor) {
  if (!valor) return '';
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return sigcFormatearFechaChile(valor, 'yyyy-MM-dd');
  }
  const txt = String(valor).trim();
  if (!txt) return '';
  const mIso = txt.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (mIso) return mIso[1] + '-' + mIso[2].padStart(2, '0') + '-' + mIso[3].padStart(2, '0');
  const mCl = txt.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (mCl) return mCl[3] + '-' + mCl[2].padStart(2, '0') + '-' + mCl[1].padStart(2, '0');
  return txt;
}

function importacionesResolverDocumentoTolerante_(registro, nombre) {
  const rawDoc = String(registro.numeroDocumento || registro.rut || '').trim();
  try {
    return sigcValidarDocumento(registro.tipoDocumento, rawDoc, registro.nacionalidad);
  } catch (e) {
    const limpio = rawDoc.toUpperCase().replace(/[^A-Z0-9.-]/g, '').trim();
    if (limpio.length >= 3) {
      return {
        tipo: 'Documento histórico',
        numero: limpio,
        advertencia: 'Documento conservado sin validación estricta'
      };
    }
    const base = [normalizarEncabezado_(nombre), sigcNormalizarCorreo(registro.correo), sigcNormalizarTelefono(registro.telefono)].filter(Boolean).join('|');
    const hash = baseMadreHash_(base || nombre || String(new Date().getTime()));
    return {
      tipo: 'Identificador histórico',
      numero: 'HIST-' + hash,
      advertencia: 'Sin documento informado (identificador temporal)'
    };
  }
}

/**
 * Enriquecimiento retroactivo en lote: lee PERFILES_BASE_MADRE y la hoja vinculada de Base Madre
 * (INTERES GENERAL) para completar GENERO, BARRIO, NACIONALIDAD, FECHA_NACIMIENTO, COMUNA y DIRECCION
 * en PERSONAS cuando estén vacíos, "No informado" o con edad en texto (ej: "60 años").
 */
function enriquecerPersonasDesdeBaseMadreDesdeWeb() {
  const ss = sigcSpreadsheetCentral_();
  const hojaPerCheck = ss.getSheetByName(SISTEMA.HOJAS.PERSONAS);
  if (!hojaPerCheck || hojaPerCheck.getLastRow() < 2) throw new Error('No hay personas registradas.');

  const extraPorId = {};
  const extraPorRut = {};
  const extraPorCorreo = {};
  const extraPorNombre = {};

  function combinarCampo_(prev, nuevo) {
    return (nuevo !== '' && nuevo !== null && nuevo !== undefined && String(nuevo).trim() !== '') ? nuevo : (prev || '');
  }

  function normalizarRutCuerpoODv_(rutDir, cuerpo, dv) {
    if (rutDir !== '' && rutDir !== null && rutDir !== undefined && String(rutDir).trim() !== '') {
      const r1 = sigcNormalizarRut(rutDir);
      if (r1 && sigcValidarRut(r1)) return r1;
    }
    const tieneC = cuerpo !== '' && cuerpo !== null && cuerpo !== undefined && String(cuerpo).trim() !== '';
    const tieneD = dv !== '' && dv !== null && dv !== undefined && String(dv).trim() !== '';
    if (tieneC && tieneD) {
      return sigcNormalizarRut(String(cuerpo).trim() + '-' + String(dv).trim());
    }
    const soloDig = String(tieneC ? cuerpo : (rutDir || '')).replace(/\D/g, '');
    if (soloDig.length >= 7 && soloDig.length <= 8) {
      let suma = 0, mult = 2;
      for (let i = soloDig.length - 1; i >= 0; i--) {
        suma += Number(soloDig.charAt(i)) * mult;
        mult = mult === 7 ? 2 : mult + 1;
      }
      const resto = 11 - (suma % 11);
      const dvCalc = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
      return soloDig + '-' + dvCalc;
    }
    return sigcNormalizarRut(rutDir);
  }

  function guardarExtraIndexado_(idP, rutNorm, correoRaw, nombreRaw, datosNuevos) {
    const telNorm = sigcNormalizarTelefono(datosNuevos.TELEFONO);
    const corNorm = sigcNormalizarCorreo(datosNuevos.CORREO || correoRaw);
    const pmjhNorm = datosNuevos.PARTICIPA_PMJH ? sigcNormalizarSiNo(datosNuevos.PARTICIPA_PMJH, '') : '';
    const limpio = {
      GENERO: baseMadreNormalizarGenero_(datosNuevos.GENERO),
      BARRIO: sigcNormalizarTexto(datosNuevos.BARRIO),
      NACIONALIDAD: sigcNormalizarTexto(datosNuevos.NACIONALIDAD),
      FECHA_NACIMIENTO: datosNuevos.FECHA_NACIMIENTO || '',
      COMUNA: sigcNormalizarTexto(datosNuevos.COMUNA),
      DIRECCION: sigcNormalizarTexto(datosNuevos.DIRECCION),
      TELEFONO: sigcValidarTelefono(telNorm) ? telNorm : '',
      CORREO: sigcValidarCorreo(corNorm) ? corNorm : '',
      PARTICIPA_PMJH: pmjhNorm === 'Sí' || pmjhNorm === 'No' ? pmjhNorm : ''
    };
    function mergeInto_(map, key) {
      if (!key) return;
      const ant = map[key] || {};
      map[key] = {
        GENERO: combinarCampo_(ant.GENERO, limpio.GENERO),
        BARRIO: combinarCampo_(ant.BARRIO, limpio.BARRIO),
        NACIONALIDAD: combinarCampo_(ant.NACIONALIDAD, limpio.NACIONALIDAD),
        FECHA_NACIMIENTO: combinarCampo_(ant.FECHA_NACIMIENTO, limpio.FECHA_NACIMIENTO),
        COMUNA: combinarCampo_(ant.COMUNA, limpio.COMUNA),
        DIRECCION: combinarCampo_(ant.DIRECCION, limpio.DIRECCION),
        TELEFONO: combinarCampo_(ant.TELEFONO, limpio.TELEFONO),
        CORREO: combinarCampo_(ant.CORREO, limpio.CORREO),
        PARTICIPA_PMJH: combinarCampo_(ant.PARTICIPA_PMJH, limpio.PARTICIPA_PMJH)
      };
    }
    mergeInto_(extraPorId, idP);
    mergeInto_(extraPorRut, rutNorm);
    mergeInto_(extraPorCorreo, sigcNormalizarCorreo(correoRaw));
    const nomClave = sigcNormalizarClave(nombreRaw);
    if (nomClave && nomClave.length >= 6) mergeInto_(extraPorNombre, nomClave);
  }

  function indicesColumnasPorFragmentos_(encNorm, fragmentos, exclusiones) {
    const idxs = [];
    for (let i = 0; i < encNorm.length; i++) {
      const h = encNorm[i];
      if (!h) continue;
      if (exclusiones && exclusiones.some(function(ex) { return h.indexOf(ex) >= 0; })) continue;
      if (fragmentos.some(function(fr) { return h.indexOf(fr) >= 0; })) idxs.push(i);
    }
    return idxs;
  }

  function primerValorNoVacio_(fila, idxs) {
    for (let i = 0; i < idxs.length; i++) {
      const v = fila[idxs[i]];
      if (v !== '' && v !== null && v !== undefined && String(v).trim() !== '') return v;
    }
    return '';
  }

  function primerValorConPatron_(fila, idxs, regex) {
    for (let i = 0; i < idxs.length; i++) {
      const v = fila[idxs[i]];
      if (v !== '' && v !== null && v !== undefined && regex.test(String(v).trim())) return v;
    }
    return '';
  }

    const socioPorId = {};
    const socioPorRut = {};
    const socioPorCorreo = {};
    const socioPorNombre = {};

    function combinarSocioObj_(prev, nuevo) {
      const res = Object.assign({}, prev || {});
      Object.keys(nuevo || {}).forEach(function(k) {
        const v = nuevo[k];
        if (v !== '' && v !== null && v !== undefined && String(v).trim() !== '') {
          res[k] = v;
        }
      });
      return res;
    }

    // 1. Lectura ultrarrápida (FUERA del candado) de todas las hojas vinculadas de Base Madre (INTERES GENERAL)
    let leidasHojaDirecta = 0;
    let pestanasLeidas = 0;
    const ssVisitados = {};
    const hojaCfg = ss.getSheetByName(SISTEMA.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS');
    if (hojaCfg && hojaCfg.getLastRow() >= 2) {
      const cfgDatos = hojaCfg.getDataRange().getValues();
      const mCfg = mapaEncabezados_(cfgDatos[0]);
      for (let c = 1; c < cfgDatos.length; c++) {
        const tipoCfg = normalizarEncabezado_(cfgDatos[c][mCfg['TIPO']]);
        if (tipoCfg !== 'INTERES GENERAL') continue;
        const ssIdBm = String(cfgDatos[c][mCfg['SPREADSHEET RESPUESTAS ID']] || '').trim();
        if (!ssIdBm || ssVisitados[ssIdBm]) continue;
        ssVisitados[ssIdBm] = true;
        try {
          const ssBm = ssIdBm === ss.getId() ? ss : SpreadsheetApp.openById(ssIdBm);
          const hojasCandidatas = ssIdBm === ss.getId()
            ? [ssBm.getSheetByName(String(cfgDatos[c][mCfg['HOJA RESPUESTAS']] || '').trim())].filter(Boolean)
            : ssBm.getSheets();
          for (let s = 0; s < hojasCandidatas.length; s++) {
            const hojaBm = hojasCandidatas[s];
            if (!hojaBm || hojaBm.getLastRow() < 2) continue;
            const valsBm = hojaBm.getDataRange().getValues();
            const encRaw = valsBm[0];
            const encNorm = encRaw.map(sigcNormalizarEncabezado);
            const colsGenero = indicesColumnasPorFragmentos_(
              encNorm,
              ['GENERO TE IDENTIFICAS', 'IDENTIDAD DE GENERO', 'CUAL ES SU GENERO', 'CUAL ES TU GENERO', 'GENERO', 'SEXO'],
              ['ENFOQUE', 'EQUIDAD', 'VIOLENCIA', 'TEMATICA', 'PREFERENCIA', 'AREA']
            );
            const colsBarrio = indicesColumnasPorFragmentos_(
              encNorm,
              ['BARRIO', 'UNIDAD VECINAL', 'POBLACION', 'VILLA', 'SECTOR'],
              ['ECONOMICO', 'PRODUCTIVO', 'LABORAL', 'EXPERIENCIA', 'RUBRO', 'COMERCIAL']
            );
            if (!colsGenero.length && !colsBarrio.length) continue;

            const colsIdPer = indicesColumnasPorFragmentos_(encNorm, ['ID PERSONA']);
            const colsCuerpo = indicesColumnasPorFragmentos_(encNorm, ['RUT SIN PUNTOS', 'RUT SIN PUNTO', 'HASTA ANTES DEL GUION']);
            const colsDv = indicesColumnasPorFragmentos_(
              encNorm,
              ['ESCRIBA EL DIGITO VERIFICADOR', 'NUMERO DESPUES DEL GUION', 'DIGITO VERIFICADOR DE SU RUT', 'DIGITO VERIFICADOR'],
              ['SIN EL DIGITO VERIFICADOR', 'SIN DIGITO VERIFICADOR']
            );
            const colsRutDir = indicesColumnasPorFragmentos_(
              encNorm,
              ['RUT', 'RUN', 'CEDULA', 'DOCUMENTO'],
              ['SIN PUNTOS', 'SIN PUNTO', 'HASTA ANTES', 'DIGITO VERIFICADOR', 'USTED CUENTA', 'CUENTA CON', 'TIPO', 'EMPRESA', 'EMPRENDIMIENTO']
            );
            const colsCorreo = indicesColumnasPorFragmentos_(encNorm, ['CORREO', 'EMAIL', 'E MAIL', 'MAIL']);
            const colsNomComp = indicesColumnasPorFragmentos_(
              encNorm,
              ['NOMBRE COMPLETO', 'NOMBRES Y APELLIDOS', 'NOMBRE Y APELLIDO', 'NOMBRE Y DOS APELLIDOS'],
              ['EMPRENDIMIENTO', 'EMPRESA', 'SOCIAL']
            );
            const colsSoloNom = indicesColumnasPorFragmentos_(
              encNorm,
              ['NOMBRES', 'NOMBRE'],
              ['APELLIDO', 'COMPLETO', 'EMPRENDIMIENTO', 'EMPRESA', 'SOCIAL']
            );
            const colsSoloApe = indicesColumnasPorFragmentos_(
              encNorm,
              ['APELLIDOS', 'APELLIDO'],
              ['NOMBRE', 'COMPLETO', 'EMPRENDIMIENTO', 'EMPRESA', 'SOCIAL']
            );
            const colsNac = indicesColumnasPorFragmentos_(encNorm, ['NACIONALIDAD', 'PAIS DE ORIGEN', 'PAIS DE NACIMIENTO']);
            const colsFechaNac = indicesColumnasPorFragmentos_(encNorm, ['FECHA DE NACIMIENTO', 'FECHA NACIMIENTO', 'CUAL ES TU FECHA DE NACIMIENTO']);
            const colsComuna = indicesColumnasPorFragmentos_(encNorm, ['COMUNA']);
            const colsDom = indicesColumnasPorFragmentos_(encNorm, ['DOMLICIO', 'DOMICILIO', 'DIRECCION'], ['CORREO', 'EMAIL']);
            const colsAcl = indicesColumnasPorFragmentos_(encNorm, ['ACLARATORIA']);
            const colsTel = indicesColumnasPorFragmentos_(encNorm, ['TELEFONO', 'CELULAR', 'WHATSAPP', 'FONO'], ['EMERGENCIA']);
            const colsPmjh = indicesColumnasPorFragmentos_(encNorm, ['PARTICIPA PMJH', 'MUJERES JEFAS DE HOGAR', 'PMJH']);

            // Columnas socioeconómicas y productivas para PERFILES_BASE_MADRE
            const colsTs = indicesColumnasPorFragmentos_(encNorm, ['MARCA TEMPORAL', 'TIMESTAMP', 'FECHA REGISTRO']);
            const colsEdu = indicesColumnasPorFragmentos_(encNorm, ['NIVEL EDUCACIONAL', 'ESCOLARIDAD', 'ESTUDIOS']);
            const colsOcup = indicesColumnasPorFragmentos_(encNorm, ['SITUACION OCUPACIONAL', 'OCUPACION ACTUAL', 'SITUACION LABORAL']);
            const colsRsh = indicesColumnasPorFragmentos_(encNorm, ['TRAMO SE UBICA DEL REGISTRO SOCIAL', 'TRAMO RSH', 'REGISTRO SOCIAL DE HOGARES']);
            const colsJefe = indicesColumnasPorFragmentos_(encNorm, ['JEFE A DE HOGAR', 'JEFE DE HOGAR', 'JEFATURA DE HOGAR']);
            const colsCuid = indicesColumnasPorFragmentos_(encNorm, ['ERES CUIDADOR', 'PERSONA CUIDADORA', 'CUIDADOR']);
            const colsDisc = indicesColumnasPorFragmentos_(encNorm, ['PRESENTA ALGUNA SITUACION DE DISCAPACIDAD', 'SITUACION DE DISCAPACIDAD', 'DISCAPACIDAD']);
            const colsCred = indicesColumnasPorFragmentos_(encNorm, ['CREDENCIAL DE DISCAPACIDAD']);
            const colsEmp = indicesColumnasPorFragmentos_(encNorm, ['TIENES UN EMPRENDIMIENTO', 'TIENE UN EMPRENDIMIENTO', 'CUENTA CON EMPRENDIMIENTO']);
            const colsAreaEmp = indicesColumnasPorFragmentos_(encNorm, ['AREA EN QUE SE DESARROLLA', 'AREA DE EMPRENDIMIENTO']);
            const colsRubro = indicesColumnasPorFragmentos_(encNorm, ['RUBROS ES MAS CERCANO', 'ACTIVIDAD ECONOMICA', 'RUBRO']);
            const colsSii = indicesColumnasPorFragmentos_(encNorm, ['FORMALIZADO ANTE SII', 'FORMALIZACION', 'INICIO DE ACTIVIDADES']);
            const colsModPref = indicesColumnasPorFragmentos_(encNorm, ['MODALIDAD DE CAPACITACION', 'MODALIDAD PREFERIDA']);
            const colsHorPref = indicesColumnasPorFragmentos_(encNorm, ['HORARIO PREFIERES', 'HORARIO CONSOLIDADO', 'HORARIO PREFERIDO']);
            const colsLineaInt = indicesColumnasPorFragmentos_(encNorm, ['LINEA DE CAPACITACION']);
            const colsCanalDif = indicesColumnasPorFragmentos_(encNorm, ['MEDIO O CANAL VISTE', 'COMO TE ENTERASTE']);

            pestanasLeidas++;
            for (let b = 1; b < valsBm.length; b++) {
              const f = valsBm[b];
              const idP = String(primerValorNoVacio_(f, colsIdPer) || '').trim();
              const rutDir = primerValorConPatron_(f, colsRutDir, /\d{6,}/);
              const cuerpo = primerValorNoVacio_(f, colsCuerpo);
              const dv = primerValorNoVacio_(f, colsDv);
              const rutNorm = normalizarRutCuerpoODv_(rutDir, cuerpo, dv);
              const correo = primerValorConPatron_(f, colsCorreo, /@/);
              const nomComp = primerValorNoVacio_(f, colsNomComp);
              const nom = nomComp || [primerValorNoVacio_(f, colsSoloNom), primerValorNoVacio_(f, colsSoloApe)].filter(Boolean).join(' ');
              if (!idP && !rutNorm && !correo && !nom) continue;
              const dom = primerValorNoVacio_(f, colsDom);
              const acl = primerValorNoVacio_(f, colsAcl);
              guardarExtraIndexado_(idP, rutNorm, correo, nom, {
                GENERO: primerValorNoVacio_(f, colsGenero),
                BARRIO: primerValorNoVacio_(f, colsBarrio),
                NACIONALIDAD: primerValorNoVacio_(f, colsNac),
                FECHA_NACIMIENTO: primerValorNoVacio_(f, colsFechaNac),
                COMUNA: primerValorNoVacio_(f, colsComuna),
                DIRECCION: [dom, acl].filter(Boolean).join(', '),
                TELEFONO: primerValorNoVacio_(f, colsTel),
                CORREO: correo,
                PARTICIPA_PMJH: primerValorNoVacio_(f, colsPmjh)
              });

              const socioObj = {
                'FECHA PRIMERA RESPUESTA': primerValorNoVacio_(f, colsTs),
                'FECHA ULTIMA RESPUESTA': primerValorNoVacio_(f, colsTs),
                'NIVEL EDUCACIONAL': primerValorNoVacio_(f, colsEdu),
                'SITUACION OCUPACIONAL': primerValorNoVacio_(f, colsOcup),
                'TRAMO RSH': primerValorNoVacio_(f, colsRsh),
                'JEFE HOGAR': primerValorNoVacio_(f, colsJefe),
                'ES CUIDADOR': primerValorNoVacio_(f, colsCuid),
                'DISCAPACIDAD': primerValorNoVacio_(f, colsDisc),
                'CREDENCIAL DISCAPACIDAD': primerValorNoVacio_(f, colsCred),
                'TIENE EMPRENDIMIENTO': primerValorNoVacio_(f, colsEmp),
                'AREA EMPRENDIMIENTO': primerValorNoVacio_(f, colsAreaEmp),
                'RUBRO': primerValorNoVacio_(f, colsRubro),
                'FORMALIZADO SII': primerValorNoVacio_(f, colsSii),
                'MODALIDAD PREFERIDA': primerValorNoVacio_(f, colsModPref),
                'HORARIO PREFERIDO': primerValorNoVacio_(f, colsHorPref),
                'LINEA INTERES DECLARADA': primerValorNoVacio_(f, colsLineaInt),
                'CANAL DIFUSION': primerValorNoVacio_(f, colsCanalDif),
                'FILAS ORIGEN': String(b + 1)
              };
              if (idP) socioPorId[idP] = combinarSocioObj_(socioPorId[idP], socioObj);
              if (rutNorm) socioPorRut[rutNorm] = combinarSocioObj_(socioPorRut[rutNorm], socioObj);
              const cNorm = sigcNormalizarCorreo(correo);
              if (cNorm) socioPorCorreo[cNorm] = combinarSocioObj_(socioPorCorreo[cNorm], socioObj);
              const nNorm = sigcNormalizarClave(nom);
              if (nNorm && nNorm.length >= 6) socioPorNombre[nNorm] = combinarSocioObj_(socioPorNombre[nNorm], socioObj);

              leidasHojaDirecta++;
            }
          }
        } catch (eBm) {
          console.warn('No se pudo leer hoja directa de Base Madre: ' + eBm.message);
        }
      }
    }

  // 2. Complementar también desde PERFILES_BASE_MADRE
  const hojaPerf = ss.getSheetByName(SISTEMA.HOJAS.PERFILES_BASE_MADRE || SIGC_IMPORTACIONES.HOJA_PERFILES_BASE_MADRE);
  if (hojaPerf && hojaPerf.getLastRow() >= 2) {
    const datosPerf = hojaPerf.getDataRange().getValues();
    const mPerf = mapaEncabezados_(datosPerf[0]);
    const colIdPerf = mPerf['ID PERSONA'];
    const colJsonPerf = mPerf['DATOS ULTIMA RESPUESTA JSON'];
    if (colIdPerf !== undefined && colJsonPerf !== undefined) {
      for (let i = 1; i < datosPerf.length; i++) {
        const idP = String(datosPerf[i][colIdPerf] || '').trim();
        if (!idP || (extraPorId[idP] && extraPorId[idP].GENERO)) continue;
        const rawJson = String(datosPerf[i][colJsonPerf] || '').trim();
        if (!rawJson) continue;
        try {
          const obj = JSON.parse(rawJson);
          const encs = Object.keys(obj);
          const vals = encs.map(function(k) { return obj[k]; });
          const reg = registroBaseMadreDesdeFila_(encs, vals);
          guardarExtraIndexado_(idP, sigcNormalizarRut(reg.rut || reg.numeroDocumento), reg.correo, reg.nombre, {
            GENERO: reg.genero,
            BARRIO: reg.barrio,
            NACIONALIDAD: reg.nacionalidad,
            FECHA_NACIMIENTO: reg.fechaNacimiento,
            COMUNA: reg.comuna,
            DIRECCION: reg.direccion
          });
        } catch (eJson) {}
      }
    }
  }

  // 3. Adquirir candado SOLO para actualizar PERSONAS y PERFILES_BASE_MADRE en memoria y escribir en bloque
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hojaPer = ss.getSheetByName(SISTEMA.HOJAS.PERSONAS);
    const rangoPer = hojaPer.getDataRange();
    const datosPer = rangoPer.getValues();
    const mPer = mapaEncabezados_(datosPer[0]);
    const colIdP = mPer['ID PERSONA'];
    const colRutP = mPer['RUT'];
    const colNumDocP = mPer['NUMERO DOCUMENTO'];
    const colCorreoP = mPer['CORREO'];
    const colNomP = mPer['NOMBRE COMPLETO'];
    const colUlt = mPer['ULTIMA ACTUALIZACION'];
    const campos = ['GENERO', 'BARRIO', 'NACIONALIDAD', 'FECHA NACIMIENTO', 'COMUNA', 'DIRECCION', 'TELEFONO', 'CORREO', 'PARTICIPA PMJH'];
    const ahora = new Date();
    let personasActualizadas = 0;
    let camposRellenados = 0;

    // Índice de filas de PERFILES_BASE_MADRE por ID_PERSONA
    const hojaPerfEdit = baseMadreAsegurarPerfiles_(ss);
    const rangoPerf = hojaPerfEdit.getDataRange();
    const datosPerfEdit = rangoPerf.getValues();
    const encPerf = datosPerfEdit[0];
    const mPerfEdit = mapaEncabezados_(encPerf);
    const colIdPerfEdit = mPerfEdit['ID PERSONA'];
    const filaPerfPorId = {};
    for (let p = 1; p < datosPerfEdit.length; p++) {
      const idPx = String(datosPerfEdit[p][colIdPerfEdit] || '').trim();
      if (idPx && filaPerfPorId[idPx] === undefined) filaPerfPorId[idPx] = p;
    }
    let perfilesActualizados = 0;
    let perfilesCreados = 0;
    const nuevosPerfiles = [];

    for (let r = 1; r < datosPer.length; r++) {
      const idP = String(datosPer[r][colIdP] || '').trim();
      const rutP = sigcNormalizarRut(
        (colRutP !== undefined ? datosPer[r][colRutP] : '') ||
        (colNumDocP !== undefined ? datosPer[r][colNumDocP] : '')
      );
      const correoP = colCorreoP !== undefined ? sigcNormalizarCorreo(datosPer[r][colCorreoP]) : '';
      const nomP = colNomP !== undefined ? sigcNormalizarClave(datosPer[r][colNomP]) : '';

      const extra = extraPorId[idP] || (rutP && extraPorRut[rutP]) || (correoP && extraPorCorreo[correoP]) || (nomP && extraPorNombre[nomP]);
      if (extra) {
        let cambio = false;
        campos.forEach(function(campo) {
          const colIdx = mPer[campo];
          if (colIdx === undefined) return;
          const claveExtra = campo === 'FECHA NACIMIENTO' ? 'FECHA_NACIMIENTO' : (campo === 'PARTICIPA PMJH' ? 'PARTICIPA_PMJH' : campo);
          const nuevo = extra[claveExtra];
          if (nuevo === '' || nuevo === null || nuevo === undefined) return;
          const actual = datosPer[r][colIdx];
          const normAct = normalizarEncabezado_(actual);
          const esTextoEdad = campo === 'FECHA NACIMIENTO' && /ANOS|AÑOS|^\d{1,3}$/.test(normAct);
          if (!esTextoEdad && actual !== '' && actual !== null && actual !== undefined &&
              ['NO INFORMADO', 'SIN INFORMACION', 'N A'].indexOf(normAct) < 0) {
            return;
          }
          datosPer[r][colIdx] = nuevo;
          camposRellenados++;
          cambio = true;
        });
        if (cambio) {
          if (colUlt !== undefined) datosPer[r][colUlt] = ahora;
          personasActualizadas++;
        }
      }

      const socio = socioPorId[idP] || (rutP && socioPorRut[rutP]) || (correoP && socioPorCorreo[correoP]) || (nomP && socioPorNombre[nomP]);
      if (idP && socio) {
        const idxPerf = filaPerfPorId[idP];
        if (idxPerf !== undefined) {
          let cambioPerf = false;
          Object.keys(socio).forEach(function(campoP) {
            const cIdx = mPerfEdit[campoP];
            if (cIdx === undefined) return;
            const valNuevo = socio[campoP];
            if (valNuevo === '' || valNuevo === null || valNuevo === undefined) return;
            const valAct = datosPerfEdit[idxPerf][cIdx];
            if (valAct !== '' && valAct !== null && valAct !== undefined &&
                ['NO INFORMADO', 'SIN INFORMACION', 'N A'].indexOf(normalizarEncabezado_(valAct)) < 0) {
              return;
            }
            datosPerfEdit[idxPerf][cIdx] = valNuevo;
            cambioPerf = true;
          });
          if (cambioPerf) {
            if (mPerfEdit['ULTIMA ACTUALIZACION'] !== undefined) datosPerfEdit[idxPerf][mPerfEdit['ULTIMA ACTUALIZACION']] = ahora;
            perfilesActualizados++;
          }
        } else {
          const filaNuevaP = nuevaFilaSegunEncabezados_(encPerf, Object.assign({
            'ID PERSONA': idP,
            'ULTIMA ACTUALIZACION': ahora
          }, socio));
          nuevosPerfiles.push(filaNuevaP);
          filaPerfPorId[idP] = -1; // evitar duplicado dentro del mismo ciclo
          perfilesCreados++;
        }
      }
    }

    if (personasActualizadas > 0) {
      rangoPer.setValues(datosPer);
    }
    if (perfilesActualizados > 0 && datosPerfEdit.length > 1) {
      rangoPerf.setValues(datosPerfEdit);
    }
    if (nuevosPerfiles.length > 0) {
      hojaPerfEdit.getRange(hojaPerfEdit.getLastRow() + 1, 1, nuevosPerfiles.length, encPerf.length)
        .setValues(nuevosPerfiles);
    }

    if (personasActualizadas > 0 || perfilesActualizados > 0 || perfilesCreados > 0) {
      SpreadsheetApp.flush();
      sigcInvalidarCache_();
      if (typeof sigcInvalidarCacheTabla_ === 'function') {
        sigcInvalidarCacheTabla_(SISTEMA.HOJAS.PERSONAS);
        sigcInvalidarCacheTabla_(SISTEMA.HOJAS.PERFILES_BASE_MADRE || 'PERFILES_BASE_MADRE');
      }
      try { CacheService.getScriptCache().remove('SIGC_PERFILES_SOCIOEC_V1'); } catch (eC) {}
    }

    const huboCambios = personasActualizadas > 0 || perfilesActualizados > 0 || perfilesCreados > 0;
    return {
      ok: true,
      personasActualizadas: personasActualizadas,
      camposRellenados: camposRellenados,
      perfilesActualizados: perfilesActualizados,
      perfilesCreados: perfilesCreados,
      mensaje: (huboCambios
        ? 'Cruce integral completado: ' + personasActualizadas + ' persona(s) en PERSONAS (' + camposRellenados + ' campos) y ' +
          (perfilesActualizados + perfilesCreados) + ' perfil(es) socioeconómicos en PERFILES_BASE_MADRE actualizados/creados'
        : 'Sin cambios pendientes en PERSONAS ni PERFILES_BASE_MADRE') +
        ' (' + leidasHojaDirecta + ' respuestas revisadas en ' + pestanasLeidas + ' pestaña(s) de Base Madre).'
    };
  } finally {
    lock.releaseLock();
  }
}

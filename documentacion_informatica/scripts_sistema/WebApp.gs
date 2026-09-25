/**
 * WEB APP SIGC 3.9.0
 * Backend modular de alto rendimiento para gestión de capacitaciones.
 */
function doGet(e) {
  try {
    verificarActividadesVencidasConThrottle_();
  } catch (error) {
    console.error('No se pudieron verificar actividades vencidas: ' + error.message);
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Sistema de Gestión de Capacitaciones — SIGC')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Ejecuta la verificación de actividades vencidas con control de frecuencia
 * para que no ralentice la carga inicial de la interfaz web.
 */
function verificarActividadesVencidasConThrottle_() {
  const cache = CacheService.getScriptCache();
  const claveThrottle = 'SIGC_THROTTLE_VENCIDAS';
  if (cache.get(claveThrottle)) {
    return;
  }
  try {
    actualizarEstadosActividadesVencidas();
    cache.put(claveThrottle, '1', 21600); // 6 horas
  } catch (e) {
    console.warn('Verificación de actividades vencidas omitida: ' + e.message);
  }
}
/* Compatibilidad con implementaciones antiguas. */
function doGetV1(e) {
  return doGet(e);
}
function incluir(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}
function probarConexionSIGC() {
  const ss = sigcSpreadsheetCentral_();
  return {
    ok: true,
    version: SIGC_CONFIG.VERSION,
    id: ss.getId(),
    archivo: ss.getName(),
    url: ss.getUrl(),
    zonaHoraria: ss.getSpreadsheetTimeZone()
  };
}
/**
 * Ejecuta una consulta SQL estructurada sobre cualquier hoja del SIGC.
 */
function ejecutarConsultaSqlSIGC(datos) {
  datos = datos || {};
  const nombreHoja = String(datos.hoja || WEBAPP_CONFIG.HOJAS.ACTIVIDADES).trim();
  const hojasPermitidas = Object.values(WEBAPP_CONFIG.HOJAS);
  if (!hojasPermitidas.includes(nombreHoja)) {
    throw new Error('Hoja no autorizada para consulta: ' + nombreHoja);
  }
  const sql = String(datos.sql || 'SELECT *').trim();
  const inicio = new Date().getTime();
  const resultado = sigcConsultarSql_(nombreHoja, sql);
  const duracionMs = new Date().getTime() - inicio;
  return {
    ok: true,
    hoja: nombreHoja,
    sql: sql,
    total: resultado.length,
    duracionMs: duracionMs,
    datos: resultado
  };
}

/**
 * Obtiene registros paginados y filtrados directamente desde el motor SQL en servidor.
 * Reduce drásticamente la transferencia de datos y acelera la carga en el cliente.
 */
function obtenerTablaPaginadaSql(opciones) {
  opciones = opciones || {};
  const nombreHoja = String(opciones.hoja || WEBAPP_CONFIG.HOJAS.ACTIVIDADES).trim();
  const hojasPermitidas = Object.values(WEBAPP_CONFIG.HOJAS);
  if (!hojasPermitidas.includes(nombreHoja)) {
    throw new Error('Hoja no autorizada para consulta: ' + nombreHoja);
  }
  const pagina = Math.max(1, parseInt(opciones.pagina, 10) || 1);
  const tamano = Math.max(1, Math.min(200, parseInt(opciones.tamano, 10) || 50));
  const offset = (pagina - 1) * tamano;
  const columnas = String(opciones.columnas || '*').trim();
  const filtroClausula = opciones.where ? (' WHERE ' + opciones.where) : '';
  const ordenClausula = opciones.orderBy ? (' ORDER BY ' + opciones.orderBy) : '';

  const sqlConPaginacion = 'SELECT ' + columnas + filtroClausula + ordenClausula + ' LIMIT ' + tamano + ' OFFSET ' + offset;
  const sqlConteo = 'SELECT COUNT(' + (opciones.columnaId || 'Col1') + ')' + filtroClausula;

  const inicio = new Date().getTime();
  const registros = sigcConsultarSql_(nombreHoja, sqlConPaginacion);
  let totalRegistros = registros.length;

  try {
    const resConteo = sigcConsultarSql_(nombreHoja, sqlConteo);
    if (resConteo && resConteo.length > 0) {
      const primerObj = resConteo[0];
      const primeraProp = Object.keys(primerObj)[0];
      if (primeraProp && primerObj[primeraProp] !== undefined) {
        totalRegistros = parseInt(primerObj[primeraProp], 10) || totalRegistros;
      }
    }
  } catch (eConteo) {
    totalRegistros = offset + registros.length + (registros.length === tamano ? 1 : 0);
  }

  const duracionMs = new Date().getTime() - inicio;
  return {
    ok: true,
    hoja: nombreHoja,
    pagina: pagina,
    tamano: tamano,
    total: totalRegistros,
    totalPaginas: Math.ceil(totalRegistros / tamano) || 1,
    duracionMs: duracionMs,
    datos: registros
  };
}

/**
 * Función de prueba rápida del motor SQL.
 * Ejecuta 3 consultas analíticas reales y muestra tiempos y resultados.
 */
function probarMotorSqlSIGC() {
  console.log('--- INICIANDO PRUEBA DEL MOTOR SQL SIGC ---');

  // Prueba 1: Actividades agrupadas por Escuela/Línea con suma de cupos
  const p1 = ejecutarConsultaSqlSIGC({
    hoja: 'ACTIVIDADES',
    sql: 'SELECT ESCUELA_LINEA, COUNT(ID_ACTIVIDAD), SUM(CUPOS) GROUP BY ESCUELA_LINEA'
  });
  console.log('✅ Prueba 1 (ACTIVIDADES por Escuela en ' + p1.duracionMs + ' ms):', JSON.stringify(p1.datos));

  // Prueba 2: Top 5 Comunas con más personas registradas
  const p2 = ejecutarConsultaSqlSIGC({
    hoja: 'PERSONAS',
    sql: 'SELECT COMUNA, COUNT(ID_PERSONA) GROUP BY COMUNA ORDER BY COUNT(ID_PERSONA) DESC LIMIT 5'
  });
  console.log('✅ Prueba 2 (Top 5 Comunas PERSONAS en ' + p2.duracionMs + ' ms):', JSON.stringify(p2.datos));

  // Prueba 3: Conteo de participaciones por resultado
  const p3 = ejecutarConsultaSqlSIGC({
    hoja: 'PARTICIPACIONES',
    sql: 'SELECT RESULTADO_FINAL, COUNT(ID_PARTICIPACION) GROUP BY RESULTADO_FINAL'
  });
  console.log('✅ Prueba 3 (PARTICIPACIONES por Resultado en ' + p3.duracionMs + ' ms):', JSON.stringify(p3.datos));

  return {
    mensaje: 'Pruebas completadas exitosamente.',
    prueba1: p1,
    prueba2: p2,
    prueba3: p3
  };
}
/**
 * Entrega dashboard, tablas y selectores a la interfaz principal.
 */
function obtenerDatosDashboard() {
  const ss = sigcSpreadsheetCentral_();
  const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS);
  const actividades = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  const participaciones = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
  const hojaIntereses = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
  const intereses = hojaIntereses
    ? webLeerTablaConCache_(ss, hojaIntereses.getName())
    : [];
  const personasPorId = webIndexar_(personas, 'ID_PERSONA');
  const actividadesPorId = webIndexar_(actividades, 'ID_ACTIVIDAD');
  const personasNormalizadas = personas.map(function(persona) {
    const tipo = sigcNormalizarTipoDocumento(persona.TIPO_DOCUMENTO, persona.RUT);
    const numero = sigcNormalizarDocumento(
      tipo,
      persona.NUMERO_DOCUMENTO,
      persona.RUT
    );
    return Object.assign({}, persona, {
      TIPO_DOCUMENTO: tipo || (persona.RUT ? 'RUT' : ''),
      NUMERO_DOCUMENTO: numero,
      DOCUMENTO: numero,
      EDAD: webCalcularEdad_(persona.FECHA_NACIMIENTO),
      PARTICIPA_PMJH: sigcNormalizarSiNo(persona.PARTICIPA_PMJH, 'No informado')
    });
  });
  const personasNormalizadasPorId = webIndexar_(personasNormalizadas, 'ID_PERSONA');
  const participacionesEnriquecidas = participaciones.map(function(participacion) {
    const persona = personasNormalizadasPorId[participacion.ID_PERSONA] || {};
    const actividad = actividadesPorId[participacion.ID_ACTIVIDAD] || {};
    return Object.assign({}, participacion, {
      NOMBRE_COMPLETO: persona.NOMBRE_COMPLETO || '',
      RUT: persona.RUT || '',
      TIPO_DOCUMENTO: persona.TIPO_DOCUMENTO || '',
      NUMERO_DOCUMENTO: persona.NUMERO_DOCUMENTO || '',
      DOCUMENTO: persona.DOCUMENTO || persona.RUT || '',
      PARTICIPA_PMJH: persona.PARTICIPA_PMJH || 'No informado',
      FECHA_NACIMIENTO: persona.FECHA_NACIMIENTO || '',
      EDAD: persona.EDAD === '' ? '' : persona.EDAD,
      CORREO: persona.CORREO || '',
      TELEFONO: persona.TELEFONO || '',
      NOMBRE_ACTIVIDAD: actividad.NOMBRE_ACTIVIDAD || '',
      PROGRAMA: actividad.PROGRAMA || '',
      AREA_TEMATICA: actividad.AREA_TEMATICA || '',
      REGLA_RESULTADO: actividad.REGLA_RESULTADO || '',
      ESTADO_ACTIVIDAD: actividad.ESTADO_ACTIVIDAD || ''
    });
  });
  return {
    fechaActualizacion: Utilities.formatDate(
      new Date(),
      WEBAPP_CONFIG.ZONA_HORARIA,
      'dd-MM-yyyy HH:mm:ss'
    ),
    resumen: webConstruirResumen_(
      personasNormalizadas,
      actividades,
      participacionesEnriquecidas,
      intereses
    ),
    personas: personasNormalizadas,
    actividades: actividades,
    participaciones: participacionesEnriquecidas,
    intereses: intereses,
    demanda: webConstruirAnalisisDemanda_(
      personasNormalizadas,
      intereses,
      actividades,
      participacionesEnriquecidas
    ),
    graficos: webConstruirGraficos_(
      actividades,
      participacionesEnriquecidas
    )
  };
}

/** Inicio liviano: calcula y conserva solo KPIs y gráficos agregados. */
function obtenerDashboardLiviano(forzarActualizacion, clientTimestamp) {
  const cache = CacheService.getScriptCache();
  const propiedades = PropertiesService.getScriptProperties();
  // Las claves estables permiten reutilizar el último resumen entre versiones
  // compatibles, evitando un recálculo completo después de cada despliegue.
  const clave = 'SIGC_DASHBOARD_RESUMEN_V3';
  const clavePersistente = 'SIGC_DASHBOARD_ULTIMO_VALIDO_V3';
  const clavePersistenteAnterior = 'SIGC_DASHBOARD_ULTIMO_VALIDO_3_6_3';
  if (!forzarActualizacion) {
    let salidaGuardada = null;
    try {
      const guardado = cache.get(clave);
      if (guardado) salidaGuardada = JSON.parse(guardado);
    } catch (error) {
      // Si la caché no está disponible, el Dashboard se calcula normalmente.
    }
    if (!salidaGuardada) {
      try {
        const ultimoValido = propiedades.getProperty(clavePersistente) ||
          propiedades.getProperty(clavePersistenteAnterior);
        if (ultimoValido) {
          salidaGuardada = JSON.parse(ultimoValido);
          salidaGuardada.desdeResumenPersistente = true;
          if (!propiedades.getProperty(clavePersistente)) {
            propiedades.setProperty(clavePersistente, ultimoValido);
          }
        }
      } catch (error) {
        // Una instantánea dañada o no disponible se reemplaza al recalcular.
      }
    }
    if (salidaGuardada) {
      if (clientTimestamp && String(salidaGuardada.fechaActualizacion || '').trim() === String(clientTimestamp).trim()) {
        return { sinCambios: true, fechaActualizacion: salidaGuardada.fechaActualizacion };
      }
      return salidaGuardada;
    }
  }
  const ss = sigcSpreadsheetCentral_();
  const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS);
  const actividades = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  const participaciones = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
  const interesesHoja = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
  const intereses = interesesHoja ? webLeerTablaConCache_(ss, interesesHoja.getName()) : [];
  const personasNormalizadas = personas.map(webNormalizarPersonaSalida_);
  const personasPorId = webIndexar_(personasNormalizadas, 'ID_PERSONA');
  const actividadesPorId = webIndexar_(actividades, 'ID_ACTIVIDAD');
  const enriquecidas = participaciones.map(function(p) {
    const a = actividadesPorId[p.ID_ACTIVIDAD] || {};
    const persona = personasPorId[p.ID_PERSONA] || {};
    return Object.assign({}, p, {
      NOMBRE_ACTIVIDAD: a.NOMBRE_ACTIVIDAD || '',
      AREA_TEMATICA: a.AREA_TEMATICA || '',
      REGLA_RESULTADO: a.REGLA_RESULTADO || '',
      GENERO: persona.GENERO || 'No informado',
      EDAD: persona.EDAD === '' ? '' : persona.EDAD
    });
  });
  const salida = {
    fechaActualizacion: Utilities.formatDate(new Date(), WEBAPP_CONFIG.ZONA_HORARIA, 'dd-MM-yyyy HH:mm:ss'),
    resumen: webConstruirResumen_(personasNormalizadas, actividades, enriquecidas, intereses),
    graficos: webConstruirGraficos_(actividades, enriquecidas)
  };
  try {
    const serializado = JSON.stringify(salida);
    cache.put(clave, serializado, SIGC_CONFIG.CACHE_RESUMEN_SEGUNDOS || 21600);
    propiedades.setProperty(clavePersistente, serializado);
  } catch (error) {
    // El tamaño o disponibilidad del almacenamiento nunca debe impedir la apertura.
  }
  return salida;
}

/** Datos detallados bajo demanda. Evita descargarlos durante la apertura. */
function obtenerDatosModulo(nombreModulo) {
  const modulo = String(nombreModulo || '').toLowerCase();
  const ss = sigcSpreadsheetCentral_();
  if (modulo === 'actividades') return {actividades: webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES)};
  if (modulo === 'personas') {
    const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS).map(webNormalizarPersonaSalida_);
    return {personas: personas};
  }
  if (modulo === 'catalogos') {
    return {
      personas: webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS).map(webNormalizarPersonaSalida_),
      actividades: webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES)
    };
  }
  if (modulo === 'participaciones') {
    const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS).map(webNormalizarPersonaSalida_);
    const actividades = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
    return {personas: personas, actividades: actividades, participaciones: webEnriquecerParticipaciones_(
      webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES), personas, actividades
    )};
  }
  if (modulo === 'demanda') {
    const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS).map(webNormalizarPersonaSalida_);
    const actividades = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
    const participaciones = webEnriquecerParticipaciones_(
      webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES), personas, actividades
    );
    const hoja = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
    const intereses = hoja ? webLeerTablaConCache_(ss, hoja.getName()) : [];
    return {demanda: webConstruirAnalisisDemanda_(personas, intereses, actividades, participaciones)};
  }
  throw new Error('Módulo no reconocido: ' + nombreModulo);
}

function webNormalizarPersonaSalida_(persona) {
  const tipo = sigcNormalizarTipoDocumento(persona.TIPO_DOCUMENTO, persona.RUT);
  const numero = sigcNormalizarDocumento(tipo, persona.NUMERO_DOCUMENTO, persona.RUT);
  return Object.assign({}, persona, {
    TIPO_DOCUMENTO: tipo || (persona.RUT ? 'RUT' : ''),
    NUMERO_DOCUMENTO: numero,
    DOCUMENTO: numero,
    EDAD: webCalcularEdad_(persona.FECHA_NACIMIENTO),
    PARTICIPA_PMJH: sigcNormalizarSiNo(persona.PARTICIPA_PMJH, 'No informado')
  });
}

function webEnriquecerParticipaciones_(participaciones, personas, actividades) {
  const pp = webIndexar_(personas, 'ID_PERSONA');
  const aa = webIndexar_(actividades, 'ID_ACTIVIDAD');
  return participaciones.map(function(p) {
    const persona = pp[p.ID_PERSONA] || {};
    const actividad = aa[p.ID_ACTIVIDAD] || {};
    return Object.assign({}, p, {
      NOMBRE_COMPLETO: persona.NOMBRE_COMPLETO || '', RUT: persona.RUT || '',
      DOCUMENTO: persona.DOCUMENTO || persona.RUT || '', CORREO: persona.CORREO || '',
      TELEFONO: persona.TELEFONO || '', COMUNA: persona.COMUNA || '',
      GENERO: persona.GENERO || 'No informado', FECHA_NACIMIENTO: persona.FECHA_NACIMIENTO || '',
      EDAD: persona.EDAD === '' ? '' : persona.EDAD,
      PARTICIPA_PMJH: persona.PARTICIPA_PMJH || 'No informado',
      NOMBRE_ACTIVIDAD: actividad.NOMBRE_ACTIVIDAD || '', PROGRAMA: actividad.PROGRAMA || '',
      ESCUELA_LINEA: actividad.ESCUELA_LINEA || actividad.PROGRAMA || '',
      AREA_TEMATICA: actividad.AREA_TEMATICA || '', INSTITUCION_ASOCIADA: actividad.INSTITUCION_ASOCIADA || '',
      MODALIDAD: actividad.MODALIDAD || '', REGLA_RESULTADO: actividad.REGLA_RESULTADO || '',
      ESTADO_ACTIVIDAD: actividad.ESTADO_ACTIVIDAD || ''
    });
  });
}

/** Reporte filtrado calculado en servidor. */
function obtenerReporteEstadistico(filtros) {
  filtros = filtros || {};
  const ss = sigcSpreadsheetCentral_();
  const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS).map(webNormalizarPersonaSalida_);
  let actividades = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  const coincide = function(valor, filtro) {
    return !filtro || sigcNormalizarClave(valor) === sigcNormalizarClave(filtro);
  };
  actividades = actividades.filter(function(a) {
    if (!filtros.estado && webEsActividadArchivada_(a)) return false;
    return coincide(a.ANO, filtros.ano) &&
      coincide(a.ESCUELA_LINEA || a.PROGRAMA, filtros.escuelaLinea) &&
      coincide(a.AREA_TEMATICA, filtros.areaTematica) &&
      coincide(a.INSTITUCION_ASOCIADA, filtros.institucion) &&
      coincide(a.MODALIDAD, filtros.modalidad) &&
      coincide(a.ESTADO_ACTIVIDAD, filtros.estado);
  });
  const idsActividad = new Set(actividades.map(function(a) { return String(a.ID_ACTIVIDAD || ''); }));
  const participaciones = webEnriquecerParticipaciones_(
    webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES), personas, actividades
  ).filter(function(p) { return idsActividad.has(String(p.ID_ACTIVIDAD || '')) && webEsRegistroActivo_(p); });
  const seleccionadas = participaciones.filter(sigcEsSeleccionado);
  const asistentes = seleccionadas.filter(function(p) {
    return Number(p.SESIONES_ASISTIDAS || 0) > 0 || ['Participó','Aprobado','Desaprobado'].indexOf(sigcNormalizarResultado(p.RESULTADO_FINAL)) >= 0;
  });
  const aprobadas = seleccionadas.filter(function(p) { return sigcNormalizarResultado(p.RESULTADO_FINAL) === 'Aprobado'; });
  const certificados = seleccionadas.filter(function(p) { return sigcNormalizarSiNo(p.CERTIFICADO, 'No') === 'Sí'; });
  const cupos = actividades.reduce(function(s, a) { return s + (Number(a.CUPOS) || 0); }, 0);
  const unicas = new Set(participaciones.map(function(p) { return String(p.ID_PERSONA || ''); }).filter(Boolean));
  const hojaIntereses = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
  const intereses = hojaIntereses ? webLeerTablaConCache_(ss, hojaIntereses.getName()) : [];
  const interesesFiltrados = intereses.filter(function(i) {
    return sigcNormalizarClave(i.ESTADO_INTERES || 'Activo') !== 'inactivo' &&
      coincide(i.ESCUELA_LINEA, filtros.escuelaLinea) &&
      coincide(i.AREA_TEMATICA, filtros.areaTematica);
  });
  const demanda = new Set(interesesFiltrados.map(function(i) { return String(i.ID_PERSONA || ''); }).filter(Boolean));
  const personasCapacitadas = new Set(asistentes.map(function(p) { return String(p.ID_PERSONA || ''); }).filter(Boolean));
  const tasaAsistencia = seleccionadas.length ? asistentes.length / seleccionadas.length : 0;
  const demografia = webConstruirDemografia_(participaciones);
  return {
    fechaActualizacion: Utilities.formatDate(new Date(), WEBAPP_CONFIG.ZONA_HORARIA, 'dd-MM-yyyy HH:mm:ss'),
    indicadores: {
      actividades: actividades.length, personasUnicas: unicas.size, inscripciones: participaciones.length,
      seleccionadas: seleccionadas.length, asistentes: asistentes.length, aprobadas: aprobadas.length,
      certificadas: certificados.length, cupos: cupos,
      ocupacion: cupos ? seleccionadas.length / cupos : 0,
      seleccion: participaciones.length ? seleccionadas.length / participaciones.length : 0,
      asistencia: tasaAsistencia,
      inasistencia: seleccionadas.length ? 1 - tasaAsistencia : 0,
      aprobacion: asistentes.length ? aprobadas.length / asistentes.length : 0,
      certificacion: asistentes.length ? certificados.length / asistentes.length : 0,
      demandaRegistrada: demanda.size,
      personasCapacitadas: personasCapacitadas.size,
      brechaDemanda: Math.max(0, demanda.size - personasCapacitadas.size),
      coberturaDemanda: demanda.size ? personasCapacitadas.size / demanda.size : 0
    },
    porTematica: webAgruparConteo_(actividades, 'AREA_TEMATICA'),
    porInstitucion: webAgruparConteo_(actividades, 'INSTITUCION_ASOCIADA'),
    porModalidad: webAgruparConteo_(actividades, 'MODALIDAD'),
    porGenero: demografia.porGenero,
    porTramoEdad: demografia.porTramoEdad,
    porComuna: demografia.porComuna,
    porPMJH: demografia.porPMJH,
    demografia: demografia,
    actividades: actividades.map(function(a) {
      const grupo = participaciones.filter(function(p) { return String(p.ID_ACTIVIDAD) === String(a.ID_ACTIVIDAD); });
      return {ID_ACTIVIDAD:a.ID_ACTIVIDAD, NOMBRE_ACTIVIDAD:a.NOMBRE_ACTIVIDAD, ANO:a.ANO,
        ESCUELA_LINEA:a.ESCUELA_LINEA || a.PROGRAMA, AREA_TEMATICA:a.AREA_TEMATICA,
        INSTITUCION_ASOCIADA:a.INSTITUCION_ASOCIADA, MODALIDAD:a.MODALIDAD,
        ESTADO_ACTIVIDAD:a.ESTADO_ACTIVIDAD, CUPOS:Number(a.CUPOS)||0, INSCRIPCIONES:grupo.length,
        SELECCIONADAS:grupo.filter(sigcEsSeleccionado).length,
        ASISTENTES:grupo.filter(function(p){return Number(p.SESIONES_ASISTIDAS||0)>0;}).length};
    })
  };
}

/** Listado operativo de asistencia con datos de persona y capacitación. */
function obtenerReporteAsistencias(filtros) {
  filtros = filtros || {};
  if (!String(filtros.idActividad || '').trim()) {
    throw new Error('Seleccione una capacitación para generar el listado de asistencias.');
  }
  const ss = sigcSpreadsheetCentral_();
  const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS)
    .map(webNormalizarPersonaSalida_);
  const actividades = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  const participaciones = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
  return webConstruirReporteAsistencias_(personas, actividades, participaciones, filtros);
}

function webConstruirReporteAsistencias_(personas, actividades, participaciones, filtros) {
  filtros = filtros || {};
  const actividadesPorId = webIndexar_(actividades, 'ID_ACTIVIDAD');
  const enriquecidas = webEnriquecerParticipaciones_(participaciones, personas, actividades)
    .filter(webEsRegistroActivo_)
    .filter(function(p) {
      const actividad = actividadesPorId[p.ID_ACTIVIDAD] || {};
      if (filtros.idActividad && String(p.ID_ACTIVIDAD) !== String(filtros.idActividad)) return false;
      if (filtros.ano && String(actividad.ANO || '') !== String(filtros.ano)) return false;
      if (filtros.resultado && sigcNormalizarClave(p.RESULTADO_FINAL) !== sigcNormalizarClave(filtros.resultado)) return false;
      if (filtros.confirmacion && sigcNormalizarClave(p.CONFIRMA_PARTICIPACION || 'No informado') !== sigcNormalizarClave(filtros.confirmacion)) return false;
      const asistidas = Number(p.SESIONES_ASISTIDAS || 0);
      if (filtros.tipoAsistencia === 'sin_asistencia' && asistidas > 0) return false;
      if (filtros.tipoAsistencia === 'con_asistencia' && asistidas <= 0) return false;
      if (filtros.tipoAsistencia === 'solo_confirmados' && sigcNormalizarSiNo(p.CONFIRMA_PARTICIPACION, 'No') !== 'Sí') return false;
      return true;
    })
    .map(function(p) {
      const actividad = actividadesPorId[p.ID_ACTIVIDAD] || {};
      const asistidas = Math.max(0, Number(p.SESIONES_ASISTIDAS || 0));
      const totales = Math.max(0, Number(p.SESIONES_TOTALES || actividad.SESIONES_TOTALES || 1));
      let porcentaje = totales ? asistidas / totales : Number(p.PORCENTAJE_ASISTENCIA);
      if (!isFinite(porcentaje)) porcentaje = 0;
      if (porcentaje > 1) porcentaje = porcentaje / 100;

      let sesionesArray = [];
      if (p.ASISTENCIA_SESIONES) {
        try {
          const parsed = typeof p.ASISTENCIA_SESIONES === 'string' ? JSON.parse(p.ASISTENCIA_SESIONES) : p.ASISTENCIA_SESIONES;
          if (Array.isArray(parsed)) sesionesArray = parsed.map(Number).filter(function(n) { return !isNaN(n) && n > 0; });
        } catch (e) {}
      }
      if (!sesionesArray.length && asistidas > 0) {
        for (let i = 1; i <= Math.min(asistidas, totales); i++) sesionesArray.push(i);
      }
      sesionesArray.sort(function(a, b) { return a - b; });

      const detalleTexto = sesionesArray.length
        ? 'Sesión ' + sesionesArray.join(', Sesión ')
        : (asistidas === 0 ? 'Sin asistencia' : asistidas + ' sesión(es)');

      return {
        ID_PARTICIPACION: p.ID_PARTICIPACION || '',
        ID_PERSONA: p.ID_PERSONA || '',
        NOMBRE_COMPLETO: p.NOMBRE_COMPLETO || '',
        DOCUMENTO: p.DOCUMENTO || p.RUT || '',
        CORREO: p.CORREO || '',
        TELEFONO: p.TELEFONO || '',
        COMUNA: p.COMUNA || '',
        PARTICIPA_PMJH: p.PARTICIPA_PMJH || 'No informado',
        ID_ACTIVIDAD: p.ID_ACTIVIDAD || '',
        NOMBRE_ACTIVIDAD: p.NOMBRE_ACTIVIDAD || '',
        ANO: actividad.ANO || '',
        ESCUELA_LINEA: p.ESCUELA_LINEA || '',
        AREA_TEMATICA: p.AREA_TEMATICA || '',
        INSTITUCION_ASOCIADA: p.INSTITUCION_ASOCIADA || '',
        MODALIDAD: p.MODALIDAD || '',
        ESTADO_SELECCION: p.ESTADO_SELECCION || '',
        CONFIRMA_PARTICIPACION: sigcNormalizarSiNo(p.CONFIRMA_PARTICIPACION, 'No informado'),
        SESIONES_ASISTIDAS: asistidas,
        SESIONES_TOTALES: totales,
        ASISTENCIA_SESIONES: p.ASISTENCIA_SESIONES || JSON.stringify(sesionesArray),
        SESIONES_ASISTIDAS_ARRAY: sesionesArray,
        SESIONES_DETALLE_TEXTO: detalleTexto,
        PORCENTAJE_ASISTENCIA: Math.max(0, porcentaje),
        RESULTADO_ASISTENCIA: p.RESULTADO_ASISTENCIA || '',
        RESULTADO_FINAL: p.RESULTADO_FINAL || '',
        CERTIFICADO: p.CERTIFICADO || 'No informado',
        ULTIMA_ACTUALIZACION: p.ULTIMA_ACTUALIZACION || ''
      };
    })
    .sort(function(a, b) {
      return String(a.NOMBRE_ACTIVIDAD).localeCompare(String(b.NOMBRE_ACTIVIDAD), 'es') ||
        String(a.NOMBRE_COMPLETO).localeCompare(String(b.NOMBRE_COMPLETO), 'es');
    });

  let maxSesiones = 1;
  enriquecidas.forEach(function(f) {
    if (f.SESIONES_TOTALES > maxSesiones) maxSesiones = f.SESIONES_TOTALES;
  });

  const porcentajes = enriquecidas.map(function(f) { return Number(f.PORCENTAJE_ASISTENCIA || 0); });
  return {
    fechaActualizacion: Utilities.formatDate(new Date(), WEBAPP_CONFIG.ZONA_HORARIA, 'dd-MM-yyyy HH:mm:ss'),
    maxSesionesTotales: maxSesiones,
    resumen: {
      registros: enriquecidas.length,
      personasUnicas: new Set(enriquecidas.map(function(f) { return String(f.ID_PERSONA || ''); }).filter(Boolean)).size,
      confirmados: enriquecidas.filter(function(f) {
        return sigcNormalizarSiNo(f.CONFIRMA_PARTICIPACION, 'No') === 'Sí';
      }).length,
      actividades: new Set(enriquecidas.map(function(f) { return String(f.ID_ACTIVIDAD || ''); }).filter(Boolean)).size,
      asistenciaPromedio: porcentajes.length
        ? porcentajes.reduce(function(s, n) { return s + n; }, 0) / porcentajes.length
        : 0,
      certificados: enriquecidas.filter(function(f) {
        return sigcNormalizarSiNo(f.CERTIFICADO, 'No') === 'Sí';
      }).length
    },
    filas: enriquecidas
  };
}

/**
 * Registra un interés de capacitación. Un mismo interés activo no se duplica.
 */
function guardarInteresCapacitacion(datos) {
  datos = datos || {};
  webValidarObjeto_(datos, ['ID_PERSONA', 'ESCUELA_LINEA', 'AREA_TEMATICA']);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const persona = webBuscarRegistro_(
      ss,
      WEBAPP_CONFIG.HOJAS.PERSONAS,
      'ID_PERSONA',
      datos.ID_PERSONA
    );
    if (!persona) throw new Error('La persona indicada no existe.');
    const hoja = webAsegurarHojaIntereses_(ss);
    const tabla = webLeerTablaConFilas_(hoja);
    const linea = sigcNormalizarTexto(datos.ESCUELA_LINEA);
    const area = sigcNormalizarTexto(datos.AREA_TEMATICA);
    const existente = tabla.filas.find(function(fila) {
      return String(fila.datos.ID_PERSONA || '') === String(datos.ID_PERSONA) &&
        sigcNormalizarClave(fila.datos.ESCUELA_LINEA) === sigcNormalizarClave(linea) &&
        sigcNormalizarClave(fila.datos.AREA_TEMATICA) === sigcNormalizarClave(area);
    });
    const ahora = new Date();
    if (existente) {
      webActualizarFilaPorEncabezados_(
        hoja,
        tabla.encabezados,
        existente.numeroFila,
        {
          ESTADO_INTERES: 'Activo',
          ULTIMA_ACTUALIZACION: ahora,
          OBSERVACIONES: sigcNormalizarTexto(datos.OBSERVACIONES)
        }
      );
      sigcRegistrarLog('ACTUALIZAR', 'INTERES', existente.datos.ID_INTERES, 'Interés reactivado o actualizado.');
      sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
      return {
        ok: true,
        id: existente.datos.ID_INTERES,
        mensaje: 'El interés ya existía y quedó actualizado.'
      };
    }
    const id = webSiguienteId_(hoja, 'ID_INTERES', 'INT-', 6);
    webAgregarFilaPorEncabezados_(hoja, tabla.encabezados, {
      ID_INTERES: id,
      ID_PERSONA: datos.ID_PERSONA,
      ESCUELA_LINEA: linea,
      AREA_TEMATICA: area,
      FECHA_REGISTRO: ahora,
      ORIGEN_REGISTRO: sigcNormalizarTexto(datos.ORIGEN_REGISTRO) || 'Aplicación web',
      ESTADO_INTERES: 'Activo',
      ULTIMA_ACTUALIZACION: ahora,
      OBSERVACIONES: sigcNormalizarTexto(datos.OBSERVACIONES)
    });
    sigcRegistrarLog('CREAR', 'INTERES', id, datos.ID_PERSONA + ' | ' + linea + ' | ' + area);
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
    return {ok: true, id: id, mensaje: 'Interés de capacitación registrado.'};
  } finally {
    lock.releaseLock();
  }
}

/** Activa o desactiva un interés sin eliminar su historial. */
function actualizarEstadoInteres(idInteres, estado) {
  const nuevoEstado = sigcNormalizarClave(estado) === 'activo' ? 'Activo' : 'Inactivo';
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const hoja = webAsegurarHojaIntereses_(ss);
    const tabla = webLeerTablaConFilas_(hoja);
    const fila = tabla.filas.find(function(item) {
      return String(item.datos.ID_INTERES || '') === String(idInteres || '');
    });
    if (!fila) throw new Error('No se encontró el interés indicado.');
    webActualizarFilaPorEncabezados_(hoja, tabla.encabezados, fila.numeroFila, {
      ESTADO_INTERES: nuevoEstado,
      ULTIMA_ACTUALIZACION: new Date()
    });
    sigcRegistrarLog('ACTUALIZAR', 'INTERES', idInteres, 'Estado: ' + nuevoEstado);
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
    return {ok: true, mensaje: 'Interés marcado como ' + nuevoEstado.toLowerCase() + '.'};
  } finally {
    lock.releaseLock();
  }
}

/** Devuelve la matriz Demanda -> Capacitación efectiva. */
function obtenerAnalisisDemanda() {
  const ss = sigcSpreadsheetCentral_();
  const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS);
  const actividades = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  const participaciones = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
  const hojaIntereses = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
  const intereses = hojaIntereses ? webLeerTablaConCache_(ss, hojaIntereses.getName()) : [];
  return webConstruirAnalisisDemanda_(personas, intereses, actividades, participaciones);
}

/**
 * Segmenta destinatarios para comunicaciones. No envía correos: solo entrega
 * la lista que la interfaz copiará para CCO.
 */
function obtenerDestinatariosComunicacion(filtros) {
  filtros = filtros || {};
  const ss = sigcSpreadsheetCentral_();
  const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS);
  const actividades = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  const participaciones = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES)
    .filter(webEsRegistroActivo_);
  const hojaIntereses = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
  const intereses = hojaIntereses ? webLeerTablaConCache_(ss, hojaIntereses.getName()) : [];
  const personasPorId = webIndexar_(personas, 'ID_PERSONA');
  const actividadesPorId = webIndexar_(actividades, 'ID_ACTIVIDAD');
  const fuente = String(filtros.fuente || 'actividad');
  const ids = new Set();
  const pendientePorId = {};
  const ordenRecientePorId = {};

  function registrarFechaReciente(idPersona, valor) {
    const numero = webFechaNumero_(valor);
    if (!idPersona || !numero) return;
    ordenRecientePorId[idPersona] = Math.max(ordenRecientePorId[idPersona] || 0, numero);
  }

  if (fuente === 'actividad') {
    const idActividad = String(filtros.idActividad || '');
    const grupo = String(filtros.grupo || 'Seleccionados');
    participaciones.forEach(function(p) {
      if (String(p.ID_ACTIVIDAD || '') !== idActividad) return;
      if (grupo === 'Seleccionados' && !sigcEsSeleccionado(p)) return;
      if (grupo === 'Confirmados' && (!sigcEsSeleccionado(p) || sigcNormalizarSiNo(p.CONFIRMA_PARTICIPACION, 'No informado') !== 'Sí')) return;
      if (grupo === 'Asistentes' && (!sigcEsSeleccionado(p) || webNumeroNoNegativo_(p.SESIONES_ASISTIDAS, 0) <= 0)) return;
      const idPersona = String(p.ID_PERSONA || '');
      ids.add(idPersona);
      registrarFechaReciente(idPersona, p.FECHA_INSCRIPCION || p.ULTIMA_ACTUALIZACION);
    });
  } else if (fuente === 'interes') {
    const linea = sigcNormalizarClave(filtros.escuelaLinea);
    const area = sigcNormalizarClave(filtros.areaTematica);
    const cobertura = webMapaCoberturaPersonaArea_(actividades, participaciones);
    intereses.forEach(function(interes) {
      if (sigcNormalizarClave(interes.ESTADO_INTERES || 'Activo') === 'inactivo') return;
      if (linea && sigcNormalizarClave(interes.ESCUELA_LINEA) !== linea) return;
      if (area && sigcNormalizarClave(interes.AREA_TEMATICA) !== area) return;
      const idPersona = String(interes.ID_PERSONA || '');
      const claveArea = webClaveArea_(interes.ESCUELA_LINEA, interes.AREA_TEMATICA);
      const capacitada = !!(cobertura[idPersona] && cobertura[idPersona][claveArea]);
      if (filtros.soloPendientes && capacitada) return;
      ids.add(idPersona);
      pendientePorId[idPersona] = !capacitada;
      registrarFechaReciente(idPersona, interes.FECHA_REGISTRO || interes.ULTIMA_ACTUALIZACION);
    });
  } else {
    personas.forEach(function(persona) {
      ids.add(String(persona.ID_PERSONA || ''));
    });
  }

  const comuna = sigcNormalizarClave(filtros.comuna);
  const soloAutorizados = filtros.soloAutorizados === true;
  const destinatarios = Array.from(ids).map(function(idPersona) {
    const persona = personasPorId[idPersona] || {};
    return {
      ID_PERSONA: idPersona,
      NOMBRE_COMPLETO: persona.NOMBRE_COMPLETO || '',
      CORREO: sigcNormalizarCorreo(persona.CORREO),
      TELEFONO: persona.TELEFONO || '',
      COMUNA: persona.COMUNA || '',
      AUTORIZA_CONTACTO: sigcNormalizarSiNo(persona.AUTORIZA_CONTACTO, 'No informado'),
      DEMANDA_PENDIENTE: pendientePorId[idPersona] === true ? 'Sí' : (pendientePorId[idPersona] === false ? 'No' : ''),
      ORDEN_RECIENTE: ordenRecientePorId[idPersona] || webFechaNumero_(
        persona.FECHA_REGISTRO || persona.ULTIMA_ACTUALIZACION
      )
    };
  }).filter(function(persona) {
    if (!persona.ID_PERSONA) return false;
    if (comuna && sigcNormalizarClave(persona.COMUNA) !== comuna) return false;
    if (soloAutorizados && persona.AUTORIZA_CONTACTO !== 'Sí') return false;
    return true;
  }).sort(function(a, b) {
    return (b.ORDEN_RECIENTE || 0) - (a.ORDEN_RECIENTE || 0) ||
      String(a.NOMBRE_COMPLETO).localeCompare(String(b.NOMBRE_COMPLETO), 'es', {sensitivity: 'base'});
  });
  return {
    destinatarios: destinatarios,
    resumen: {
      personas: destinatarios.length,
      conCorreo: destinatarios.filter(function(p) { return !!p.CORREO; }).length,
      sinCorreo: destinatarios.filter(function(p) { return !p.CORREO; }).length
    }
  };
}
/**
 * Registra una persona o completa su ficha sin borrar información anterior.
 * Puede recibir INTERESES como arreglo (o INTERESES_JSON) para capturar la
 * demanda en el punto de ingreso, nunca desde el dashboard de Demanda.
 */
function guardarPersona(datos) {
  datos = datos || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const hoja = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.PERSONAS);
    if (!hoja) throw new Error('No se encontró la hoja PERSONAS.');
    webAsegurarColumna_(hoja, 'TIPO_DOCUMENTO');
    webAsegurarColumna_(hoja, 'NUMERO_DOCUMENTO');
    const tabla = webLeerTablaConFilas_(hoja);
    const tipo = sigcNormalizarTipoDocumento(datos.TIPO_DOCUMENTO, datos.RUT);
    const numero = sigcNormalizarDocumento(
      tipo,
      datos.NUMERO_DOCUMENTO,
      datos.RUT
    );
    const documento = sigcValidarDocumento(
      tipo,
      numero,
      datos.NACIONALIDAD
    );
    const nombre = sigcNormalizarNombre(datos.NOMBRE_COMPLETO);
    const correo = sigcNormalizarCorreo(datos.CORREO);
    const telefono = sigcNormalizarTelefono(datos.TELEFONO);
    const nacionalidad = sigcNormalizarTexto(datos.NACIONALIDAD);
    const fechaNacimiento = webNormalizarFechaNacimiento_(datos.FECHA_NACIMIENTO);
    const rut = documento.tipo === 'RUT' ? documento.numero : '';
    if (!nombre) throw new Error('Debe completar el nombre completo.');
    if (!sigcValidarCorreo(correo)) throw new Error('El correo electrónico no es válido.');
    if (!sigcValidarTelefono(telefono)) throw new Error('El teléfono no tiene un formato chileno válido.');
    const existente = tabla.filas.find(function(fila) {
      const persona = fila.datos;
      const tipoExistente = sigcNormalizarTipoDocumento(
        persona.TIPO_DOCUMENTO,
        persona.RUT
      );
      const numeroExistente = sigcNormalizarDocumento(
        tipoExistente,
        persona.NUMERO_DOCUMENTO,
        persona.RUT
      );
      let coincideDocumento = false;
      if (documento.tipo === 'RUT') {
        coincideDocumento =
          tipoExistente === 'RUT' && numeroExistente === documento.numero;
      } else {
        coincideDocumento =
          tipoExistente === 'Pasaporte' &&
          numeroExistente === documento.numero &&
          sigcNormalizarClave(persona.NACIONALIDAD) ===
            sigcNormalizarClave(nacionalidad);
      }
      if (coincideDocumento) return true;
      if (!numeroExistente) {
        const mismoNombre =
          sigcNormalizarEncabezado(persona.NOMBRE_COMPLETO) ===
          sigcNormalizarEncabezado(nombre);
        const mismoCorreo = correo &&
          sigcNormalizarCorreo(persona.CORREO) === correo;
        const mismoTelefono = telefono &&
          sigcNormalizarTelefono(persona.TELEFONO) === telefono;
        return mismoNombre && (mismoCorreo || mismoTelefono);
      }
      return false;
    });
    const ahora = new Date();
    const cambios = {
      RUT: rut,
      TIPO_DOCUMENTO: documento.tipo,
      NUMERO_DOCUMENTO: documento.numero,
      NOMBRE_COMPLETO: nombre,
      CORREO: correo,
      TELEFONO: telefono,
      COMUNA: sigcNormalizarTexto(datos.COMUNA),
      BARRIO: sigcNormalizarTexto(datos.BARRIO),
      DIRECCION: sigcNormalizarTexto(datos.DIRECCION),
      FECHA_NACIMIENTO: fechaNacimiento,
      GENERO: sigcNormalizarTexto(datos.GENERO),
      NACIONALIDAD: nacionalidad,
      AUTORIZA_CONTACTO: sigcNormalizarSiNo(
        datos.AUTORIZA_CONTACTO,
        'No informado'
      ),
      PARTICIPA_PMJH: sigcNormalizarSiNo(
        datos.PARTICIPA_PMJH,
        'No informado'
      ),
      ORIGEN_REGISTRO: 'Aplicación web',
      ESTADO_CONTACTO: correo || telefono ? 'Activo' : 'Sin contacto',
      ULTIMA_ACTUALIZACION: ahora,
      OBSERVACIONES: sigcNormalizarTexto(datos.OBSERVACIONES)
    };
    if (existente) {
      webActualizarPersonaSinBorrar_(
        hoja,
        tabla.encabezados,
        existente.numeroFila,
        cambios
      );
      const idExistente = existente.datos.ID_PERSONA;
      const interesesGuardados = webGuardarInteresesDesdePersona_(ss, idExistente, datos);
      sigcRegistrarLog(
        'ACTUALIZAR',
        'PERSONA',
        idExistente,
        'Ficha completada desde la aplicación web.'
      );
      sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.PERSONAS);
      if (interesesGuardados) sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
      const personaActualizada = Object.assign({}, existente.datos, cambios, { ID_PERSONA: idExistente });
      return {
        ok: true,
        mensaje: 'La persona ya existía y su ficha fue actualizada sin borrar datos anteriores.' +
          (interesesGuardados ? ' Se registraron ' + interesesGuardados + ' interés(es) de capacitación.' : ''),
        id: idExistente,
        persona: webNormalizarPersonaSalida_(personaActualizada)
      };
    }
    const id = webCalcularSiguienteIdDesdeFilas_(
      tabla.filas,
      'ID_PERSONA',
      'PER-',
      6
    );
    const personaNueva = Object.assign({
      ID_PERSONA: id,
      FECHA_PRIMER_REGISTRO: ahora
    }, cambios);
    webAgregarFilaPorEncabezados_(hoja, tabla.encabezados, personaNueva);
    const interesesGuardados = webGuardarInteresesDesdePersona_(ss, id, datos);
    sigcRegistrarLog(
      'CREAR',
      'PERSONA',
      id,
      'Registro desde la aplicación web.'
    );
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.PERSONAS);
    if (interesesGuardados) sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
    return {
      ok: true,
      mensaje: 'La persona fue registrada.' +
        (interesesGuardados ? ' Se registraron ' + interesesGuardados + ' interés(es) de capacitación.' : ''),
      id: id,
      persona: webNormalizarPersonaSalida_(personaNueva)
    };
  } finally {
    lock.releaseLock();
  }
}

/** Guarda intereses incluidos en el alta de una persona de forma masiva y optimizada. */
function webGuardarInteresesDesdePersona_(ss, idPersona, datos) {
  let intereses = datos && datos.INTERESES;
  if (!Array.isArray(intereses)) {
    const crudo = datos && datos.INTERESES_JSON;
    if (crudo) {
      try { intereses = JSON.parse(crudo); } catch (error) { intereses = []; }
    }
  }
  if (!Array.isArray(intereses) || !intereses.length) return 0;
  const hoja = webAsegurarHojaIntereses_(ss);
  const tabla = webLeerTablaConFilas_(hoja);
  const ahora = new Date();
  let guardados = 0;
  let maxIdNum = (tabla.filas || []).reduce(function(acc, fila) {
    const txt = String(fila.datos.ID_INTERES || '');
    if (txt.startsWith('INT-')) {
      const n = parseInt(txt.substring(4), 10);
      return !isNaN(n) && n > acc ? n : acc;
    }
    return acc;
  }, 0);

  intereses.forEach(function(interes) {
    const linea = sigcNormalizarTexto(interes && interes.ESCUELA_LINEA);
    const area = sigcNormalizarTexto(interes && interes.AREA_TEMATICA);
    if (!linea || !area) return;
    const existente = tabla.filas.find(function(fila) {
      return String(fila.datos.ID_PERSONA || '') === String(idPersona) &&
        sigcNormalizarClave(fila.datos.ESCUELA_LINEA) === sigcNormalizarClave(linea) &&
        sigcNormalizarClave(fila.datos.AREA_TEMATICA) === sigcNormalizarClave(area);
    });
    if (existente) {
      webActualizarFilaPorEncabezados_(hoja, tabla.encabezados, existente.numeroFila, {
        ESTADO_INTERES: 'Activo',
        ULTIMA_ACTUALIZACION: ahora
      });
      guardados++;
      return;
    }
    maxIdNum++;
    const id = 'INT-' + String(maxIdNum).padStart(6, '0');
    const nuevoRegistro = {
      ID_INTERES: id,
      ID_PERSONA: idPersona,
      ESCUELA_LINEA: linea,
      AREA_TEMATICA: area,
      FECHA_REGISTRO: ahora,
      ORIGEN_REGISTRO: 'Nueva persona',
      ESTADO_INTERES: 'Activo',
      ULTIMA_ACTUALIZACION: ahora,
      OBSERVACIONES: ''
    };
    webAgregarFilaPorEncabezados_(hoja, tabla.encabezados, nuevoRegistro);
    tabla.filas.push({ numeroFila: tabla.filas.length + 2, datos: nuevoRegistro });
    guardados++;
  });
  return guardados;
}

/**
 * Actualiza una persona existente por ID_PERSONA con alta velocidad.
 */
function actualizarPersona(datos) {
  datos = datos || {};
  webValidarObjeto_(datos, ['ID_PERSONA', 'TIPO_DOCUMENTO', 'NUMERO_DOCUMENTO', 'NOMBRE_COMPLETO']);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const hoja = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.PERSONAS);
    if (!hoja) throw new Error('No se encontró la hoja PERSONAS.');
    webAsegurarColumna_(hoja, 'TIPO_DOCUMENTO');
    webAsegurarColumna_(hoja, 'NUMERO_DOCUMENTO');
    const tabla = webLeerTablaConFilas_(hoja);
    const idPersona = String(datos.ID_PERSONA || '').trim();
    const existente = tabla.filas.find(function(fila) {
      return String(fila.datos.ID_PERSONA || '').trim() === idPersona;
    });
    if (!existente) throw new Error('No se encontró la persona: ' + idPersona);
    const tipo = sigcNormalizarTipoDocumento(datos.TIPO_DOCUMENTO, datos.RUT);
    const numero = sigcNormalizarDocumento(tipo, datos.NUMERO_DOCUMENTO, datos.RUT);
    const documento = sigcValidarDocumento(tipo, numero, datos.NACIONALIDAD);
    const nombre = sigcNormalizarNombre(datos.NOMBRE_COMPLETO);
    const correo = sigcNormalizarCorreo(datos.CORREO);
    const telefono = sigcNormalizarTelefono(datos.TELEFONO);
    const nacionalidad = sigcNormalizarTexto(datos.NACIONALIDAD);
    const fechaNacimiento = webNormalizarFechaNacimiento_(datos.FECHA_NACIMIENTO);
    if (!nombre) throw new Error('Debe completar el nombre completo.');
    if (!sigcValidarCorreo(correo)) throw new Error('El correo electrónico no es válido.');
    if (!sigcValidarTelefono(telefono)) throw new Error('El teléfono no tiene un formato chileno válido.');
    const duplicada = tabla.filas.find(function(fila) {
      if (String(fila.datos.ID_PERSONA || '').trim() === idPersona) return false;
      const tipoOtro = sigcNormalizarTipoDocumento(fila.datos.TIPO_DOCUMENTO, fila.datos.RUT);
      const numeroOtro = sigcNormalizarDocumento(tipoOtro, fila.datos.NUMERO_DOCUMENTO, fila.datos.RUT);
      if (documento.tipo === 'RUT') {
        return tipoOtro === 'RUT' && numeroOtro === documento.numero;
      }
      return tipoOtro === 'Pasaporte' &&
        numeroOtro === documento.numero &&
        sigcNormalizarClave(fila.datos.NACIONALIDAD) === sigcNormalizarClave(nacionalidad);
    });
    if (duplicada) {
      throw new Error('El documento ingresado ya pertenece a otra persona: ' + duplicada.datos.ID_PERSONA);
    }
    const ahora = new Date();
    const cambios = {
      RUT: documento.tipo === 'RUT' ? documento.numero : '',
      TIPO_DOCUMENTO: documento.tipo,
      NUMERO_DOCUMENTO: documento.numero,
      NOMBRE_COMPLETO: nombre,
      CORREO: correo,
      TELEFONO: telefono,
      COMUNA: sigcNormalizarTexto(datos.COMUNA),
      BARRIO: sigcNormalizarTexto(datos.BARRIO),
      DIRECCION: sigcNormalizarTexto(datos.DIRECCION),
      FECHA_NACIMIENTO: fechaNacimiento,
      GENERO: sigcNormalizarTexto(datos.GENERO),
      NACIONALIDAD: nacionalidad,
      AUTORIZA_CONTACTO: sigcNormalizarSiNo(datos.AUTORIZA_CONTACTO, 'No informado'),
      PARTICIPA_PMJH: sigcNormalizarSiNo(datos.PARTICIPA_PMJH, 'No informado'),
      ESTADO_CONTACTO: correo || telefono ? 'Activo' : 'Sin contacto',
      ULTIMA_ACTUALIZACION: ahora,
      OBSERVACIONES: sigcNormalizarTexto(datos.OBSERVACIONES)
    };
    webActualizarFilaPorEncabezados_(hoja, tabla.encabezados, existente.numeroFila, cambios);
    SpreadsheetApp.flush();
    sigcRegistrarLog('ACTUALIZAR', 'PERSONA', idPersona, 'Ficha editada desde la aplicación web.');
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.PERSONAS);
    const personaActualizada = Object.assign({}, existente.datos, cambios, { ID_PERSONA: idPersona });
    return {
      ok: true,
      id: idPersona,
      mensaje: 'La ficha de la persona fue actualizada correctamente.',
      persona: webNormalizarPersonaSalida_(personaActualizada)
    };
  } finally {
    lock.releaseLock();
  }
}
/**
 * Registra una actividad con un ID distinto para cada ejecución o cohorte.
 */
function guardarActividad(datos) {
  datos = datos || {};
  webValidarObjeto_(datos, ['NOMBRE_ACTIVIDAD', 'TIPO_ACTIVIDAD', 'PROGRAMA']);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const hoja = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
    if (!hoja) throw new Error('No se encontró la hoja ACTIVIDADES.');
    const tabla = webLeerTablaConFilas_(hoja);
    webAsegurarEncabezadosActividades_(hoja, tabla.encabezados);
    const anio = String(datos.ANO || new Date().getFullYear());
    const id = webCalcularSiguienteIdDesdeFilas_(
      tabla.filas,
      'ID_ACTIVIDAD',
      'CAP-' + anio + '-',
      3
    );
    const regla = sigcNormalizarEncabezado(
      datos.REGLA_RESULTADO || 'Asistencia'
    ) === 'PORCENTAJE'
      ? 'Porcentaje'
      : 'Asistencia';
    const detalleSesiones = typeof datos.DETALLE_SESIONES === 'string'
      ? datos.DETALLE_SESIONES
      : JSON.stringify(datos.DETALLE_SESIONES || []);
    const nuevaActividad = {
      ID_ACTIVIDAD: id,
      NOMBRE_ACTIVIDAD: sigcNormalizarTexto(datos.NOMBRE_ACTIVIDAD),
      TIPO_ACTIVIDAD: sigcNormalizarTexto(datos.TIPO_ACTIVIDAD),
      PROGRAMA: sigcNormalizarTexto(datos.PROGRAMA),
      ESCUELA_LINEA: sigcNormalizarTexto(datos.ESCUELA_LINEA),
      AREA_TEMATICA: sigcNormalizarTexto(datos.AREA_TEMATICA),
      ANO: anio,
      MES_INICIO: sigcNormalizarTexto(datos.MES_INICIO),
      MES_TERMINO: sigcNormalizarTexto(datos.MES_TERMINO),
      FECHA_INICIO: datos.FECHA_INICIO || '',
      FECHA_TERMINO: datos.FECHA_TERMINO || '',
      HORARIO: sigcNormalizarTexto(datos.HORARIO),
      DETALLE_SESIONES: detalleSesiones === '[]' ? '' : detalleSesiones,
      SESIONES_TOTALES: Math.max(1, Number(datos.SESIONES_TOTALES || 1)),
      PORCENTAJE_APROBACION: regla === 'Porcentaje'
        ? sigcConvertirPorcentaje(datos.PORCENTAJE_APROBACION || 0.8)
        : '',
      REGLA_RESULTADO: regla,
      CUPOS: datos.CUPOS || '',
      REQUIERE_SELECCION: sigcNormalizarSiNo(
        datos.REQUIERE_SELECCION,
        'No'
      ),
      MODALIDAD: sigcNormalizarTexto(datos.MODALIDAD) || 'Presencial',
      INSTITUCION_ASOCIADA: sigcNormalizarTexto(datos.INSTITUCION_ASOCIADA),
      RESPONSABLE: sigcNormalizarTexto(datos.RESPONSABLE),
      ESTADO_ACTIVIDAD: sigcNormalizarTexto(datos.ESTADO_ACTIVIDAD) || 'Planificada',
      CARPETA_DRIVE: sigcNormalizarTexto(datos.CARPETA_DRIVE),
      OBSERVACIONES: sigcNormalizarTexto(datos.OBSERVACIONES),
      LINK_INSCRIPCION: String(datos.LINK_INSCRIPCION || '').trim(),
      REQUISITOS: sigcNormalizarTexto(datos.REQUISITOS),
      DESCRIPCION_CORTA: sigcNormalizarTexto(datos.DESCRIPCION_CORTA)
    };
    webAgregarFilaPorEncabezados_(hoja, tabla.encabezados, nuevaActividad);
    sigcRegistrarLog(
      'CREAR',
      'ACTIVIDAD',
      id,
      sigcNormalizarTexto(datos.NOMBRE_ACTIVIDAD)
    );
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
    return {
      ok: true,
      mensaje: 'La actividad fue registrada.',
      id: id,
      actividad: nuevaActividad
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Actualiza una actividad existente y sincroniza sus participaciones en bloque.
 */
function actualizarActividad(datos) {
  datos = datos || {};
  webValidarObjeto_(
    datos,
    ['ID_ACTIVIDAD', 'NOMBRE_ACTIVIDAD', 'TIPO_ACTIVIDAD', 'PROGRAMA']
  );
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const hojaActividades = ss.getSheetByName(
      WEBAPP_CONFIG.HOJAS.ACTIVIDADES
    );
    const hojaParticipaciones = ss.getSheetByName(
      WEBAPP_CONFIG.HOJAS.PARTICIPACIONES
    );
    if (!hojaActividades) throw new Error('No se encontró la hoja ACTIVIDADES.');
    if (!hojaParticipaciones) throw new Error('No se encontró la hoja PARTICIPACIONES.');

    const tablaActividades = webLeerTablaConFilas_(hojaActividades);
    webAsegurarEncabezadosActividades_(hojaActividades, tablaActividades.encabezados);
    const idActividad = String(datos.ID_ACTIVIDAD || '').trim();
    const filaActividad = tablaActividades.filas.find(function(fila) {
      return String(fila.datos.ID_ACTIVIDAD || '').trim() === idActividad;
    });
    if (!filaActividad) throw new Error('No se encontró la actividad: ' + idActividad);

    const anio = Math.trunc(
      webNumeroNoNegativo_(
        datos.ANO,
        filaActividad.datos.ANO || new Date().getFullYear()
      )
    );
    if (anio < 2000 || anio > 2100) throw new Error('El año debe estar entre 2000 y 2100.');

    const sesionesTotales = Math.trunc(
      webNumeroNoNegativo_(
        datos.SESIONES_TOTALES,
        filaActividad.datos.SESIONES_TOTALES || 1
      )
    );
    if (sesionesTotales < 1) throw new Error('Las sesiones totales deben ser al menos 1.');

    const porcentajeAprobacion = sigcConvertirPorcentaje(
      datos.PORCENTAJE_APROBACION !== undefined &&
        datos.PORCENTAJE_APROBACION !== ''
        ? datos.PORCENTAJE_APROBACION
        : filaActividad.datos.PORCENTAJE_APROBACION || 0.8
    );
    const regla = sigcNormalizarEncabezado(
      datos.REGLA_RESULTADO || filaActividad.datos.REGLA_RESULTADO || 'Asistencia'
    ) === 'PORCENTAJE'
      ? 'Porcentaje'
      : 'Asistencia';
    const cupos = webEnteroVacioOPositivo_(
      datos.CUPOS,
      filaActividad.datos.CUPOS
    );
    const estado = sigcNormalizarTexto(
      datos.ESTADO_ACTIVIDAD || filaActividad.datos.ESTADO_ACTIVIDAD || 'Planificada'
    );
    const estadosPermitidos = [
      'Planificada',
      'Difusión',
      'Inscripción abierta',
      'En ejecución',
      'Ejecutada',
      'Suspendida',
      'Cerrada'
    ];
    if (estadosPermitidos.indexOf(estado) < 0) {
      throw new Error('El estado de la actividad no es válido.');
    }
    const fechaInicio = String(datos.FECHA_INICIO || '').trim();
    const fechaTermino = String(datos.FECHA_TERMINO || '').trim();
    const numeroInicio = webFechaNumero_(fechaInicio);
    const numeroTermino = webFechaNumero_(fechaTermino);
    if (numeroInicio && numeroTermino && numeroTermino < numeroInicio) {
      throw new Error('La fecha de término no puede ser anterior a la fecha de inicio.');
    }

    const tablaParticipaciones = webLeerTablaConFilas_(hojaParticipaciones);
    const participacionesActividad = tablaParticipaciones.filas.filter(
      function(fila) {
        return String(fila.datos.ID_ACTIVIDAD || '').trim() === idActividad &&
          webEsRegistroActivo_(fila.datos);
      }
    );
    const conAsistenciaIncompatible = participacionesActividad.find(
      function(fila) {
        return webNumeroNoNegativo_(fila.datos.SESIONES_ASISTIDAS, 0) > sesionesTotales;
      }
    );
    if (conAsistenciaIncompatible) {
      throw new Error(
        'No se puede reducir la actividad a ' +
        sesionesTotales +
        ' sesiones porque la participación ' +
        conAsistenciaIncompatible.datos.ID_PARTICIPACION +
        ' registra una asistencia superior. Corrija primero esa asistencia.'
      );
    }
    const detalleSesiones = typeof datos.DETALLE_SESIONES === 'string'
      ? datos.DETALLE_SESIONES
      : JSON.stringify(datos.DETALLE_SESIONES || []);

    const cambios = {
      NOMBRE_ACTIVIDAD: sigcNormalizarTexto(datos.NOMBRE_ACTIVIDAD),
      TIPO_ACTIVIDAD: sigcNormalizarTexto(datos.TIPO_ACTIVIDAD),
      PROGRAMA: sigcNormalizarTexto(datos.PROGRAMA),
      ESCUELA_LINEA: sigcNormalizarTexto(datos.ESCUELA_LINEA),
      AREA_TEMATICA: sigcNormalizarTexto(datos.AREA_TEMATICA),
      ANO: anio,
      MES_INICIO: webMesDesdeFecha_(fechaInicio),
      MES_TERMINO: webMesDesdeFecha_(fechaTermino),
      FECHA_INICIO: fechaInicio,
      FECHA_TERMINO: fechaTermino,
      HORARIO: sigcNormalizarTexto(datos.HORARIO),
      DETALLE_SESIONES: detalleSesiones === '[]' ? '' : detalleSesiones,
      SESIONES_TOTALES: sesionesTotales,
      PORCENTAJE_APROBACION: porcentajeAprobacion,
      REGLA_RESULTADO: regla,
      CUPOS: cupos,
      REQUIERE_SELECCION: sigcNormalizarSiNo(datos.REQUIERE_SELECCION, 'No'),
      MODALIDAD: sigcNormalizarTexto(datos.MODALIDAD) || 'Presencial',
      INSTITUCION_ASOCIADA: sigcNormalizarTexto(datos.INSTITUCION_ASOCIADA),
      RESPONSABLE: sigcNormalizarTexto(datos.RESPONSABLE),
      ESTADO_ACTIVIDAD: estado,
      CARPETA_DRIVE: String(datos.CARPETA_DRIVE || '').trim(),
      OBSERVACIONES: sigcNormalizarTexto(datos.OBSERVACIONES),
      LINK_INSCRIPCION: String(datos.LINK_INSCRIPCION || '').trim(),
      REQUISITOS: sigcNormalizarTexto(datos.REQUISITOS),
      DESCRIPCION_CORTA: sigcNormalizarTexto(datos.DESCRIPCION_CORTA)
    };
    webActualizarFilaPorEncabezados_(
      hojaActividades,
      tablaActividades.encabezados,
      filaActividad.numeroFila,
      cambios
    );
    const actividadActualizada = Object.assign(
      {},
      filaActividad.datos,
      cambios,
      {ID_ACTIVIDAD: idActividad}
    );
    const ahora = new Date();
    const finalizada = sigcActividadFinalizada(actividadActualizada);
    let sincronizadas = 0;
    let resultadosRecalculados = 0;

    // Sincronización masiva en matriz
    const mapaP = {};
    tablaParticipaciones.encabezados.forEach(function(enc, idx) {
      mapaP[sigcNormalizarEncabezado(enc)] = idx;
    });

    const rangoP = hojaParticipaciones.getDataRange();
    const matrizP = rangoP.getValues();

    participacionesActividad.forEach(function(fila) {
      const asistidas = webNumeroNoNegativo_(fila.datos.SESIONES_ASISTIDAS, 0);
      const porcentajeAsistencia = asistidas / sesionesTotales;
      const idxMatriz = fila.numeroFila - 1;
      if (idxMatriz < 1 || idxMatriz >= matrizP.length) return;

      const colSesTot = mapaP['SESIONES TOTALES'] !== undefined ? mapaP['SESIONES TOTALES'] : mapaP['SESIONES_TOTALES'];
      const colPctAsis = mapaP['PORCENTAJE ASISTENCIA'] !== undefined ? mapaP['PORCENTAJE ASISTENCIA'] : mapaP['PORCENTAJE_ASISTENCIA'];
      const colUltAct = mapaP['ULTIMA ACTUALIZACION'] !== undefined ? mapaP['ULTIMA ACTUALIZACION'] : mapaP['ULTIMA_ACTUALIZACION'];
      const colResAsis = mapaP['RESULTADO ASISTENCIA'] !== undefined ? mapaP['RESULTADO ASISTENCIA'] : mapaP['RESULTADO_ASISTENCIA'];
      const colResFin = mapaP['RESULTADO FINAL'] !== undefined ? mapaP['RESULTADO FINAL'] : mapaP['RESULTADO_FINAL'];

      if (colSesTot !== undefined) matrizP[idxMatriz][colSesTot] = sesionesTotales;
      if (colPctAsis !== undefined) matrizP[idxMatriz][colPctAsis] = porcentajeAsistencia;
      if (colUltAct !== undefined) matrizP[idxMatriz][colUltAct] = ahora;

      if (finalizada) {
        const seleccionada = sigcEsSeleccionado(fila.datos);
        const resultado = seleccionada
          ? sigcCalcularResultado(actividadActualizada, asistidas, sesionesTotales, true)
          : { resultadoAsistencia: 'Pendiente', resultadoFinal: 'Pendiente' };
        if (colResAsis !== undefined) matrizP[idxMatriz][colResAsis] = resultado.resultadoAsistencia;
        if (colResFin !== undefined) matrizP[idxMatriz][colResFin] = resultado.resultadoFinal;
        if (seleccionada) resultadosRecalculados++;
      }
      sincronizadas++;
    });

    if (sincronizadas > 0) {
      rangoP.setValues(matrizP);
    }
    SpreadsheetApp.flush();
    sigcRegistrarLog(
      'ACTUALIZAR',
      'ACTIVIDAD',
      idActividad,
      'Estado: ' + String(filaActividad.datos.ESTADO_ACTIVIDAD || 'Sin estado') +
        ' → ' + estado + '. Participaciones sincronizadas: ' + sincronizadas +
        '. Resultados recalculados: ' + resultadosRecalculados + '.'
    );
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
    if (sincronizadas > 0) sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
    return {
      ok: true,
      id: idActividad,
      actividad: actividadActualizada,
      participacionesSincronizadas: sincronizadas,
      resultadosRecalculados: resultadosRecalculados,
      mensaje: 'La actividad fue actualizada. ' +
        (sincronizadas ? 'Se sincronizaron ' + sincronizadas + ' participaciones. ' : 'No tenía participaciones asociadas. ') +
        (finalizada ? 'Se recalcularon ' + resultadosRecalculados + ' resultados de seleccionados.' : '')
    };
  } finally {
    lock.releaseLock();
  }
}

/** Revisa vínculos antes de quitar una actividad. No modifica datos. */
function obtenerImpactoQuitarActividad(idActividad) {
  const ss = sigcSpreadsheetCentral_();
  const impacto = webCalcularImpactoQuitarActividad_(ss, idActividad);
  return {
    idActividad: impacto.idActividad,
    nombre: impacto.nombre,
    participaciones: impacto.participaciones.length,
    formularios: impacto.formularios.length,
    formulariosActivos: impacto.formulariosActivos.length,
    accion: impacto.participaciones.length || impacto.formularios.length
      ? 'archivar'
      : 'eliminar'
  };
}

/**
 * Quita una actividad de forma segura. Solo elimina físicamente una fila sin
 * vínculos; cuando existe historial, archiva la actividad y desactiva sus Forms.
 */
function quitarActividad(payload) {
  payload = payload || {};
  if (payload.confirmar !== true) {
    throw new Error('Debe confirmar expresamente que desea quitar la actividad.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const impacto = webCalcularImpactoQuitarActividad_(ss, payload.idActividad);
    if (webEsActividadArchivada_(impacto.filaActividad.datos)) {
      throw new Error('La actividad ya está archivada.');
    }
    const tieneVinculos = impacto.participaciones.length > 0 ||
      impacto.formularios.length > 0;
    if (!tieneVinculos) {
      impacto.hojaActividades.deleteRow(impacto.filaActividad.numeroFila);
      SpreadsheetApp.flush();
      sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
      sigcRegistrarLog(
        'ELIMINAR',
        'ACTIVIDAD',
        impacto.idActividad,
        'Actividad sin participaciones ni formularios eliminada desde la Web App.'
      );
      return {
        ok: true,
        accion: 'eliminada',
        mensaje: 'La actividad fue eliminada porque no tenía registros asociados.'
      };
    }

    webAsegurarValidacionEstadosActividad_(impacto.hojaActividades);
    webActualizarFilaPorEncabezados_(
      impacto.hojaActividades,
      impacto.tablaActividades.encabezados,
      impacto.filaActividad.numeroFila,
      {ESTADO_ACTIVIDAD:'Archivada'}
    );
    const spreadsheetsARevisar = new Set();
    impacto.formulariosActivos.forEach(function(fila) {
      webActualizarFilaPorEncabezados_(
        impacto.hojaFormularios,
        impacto.tablaFormularios.encabezados,
        fila.numeroFila,
        {ESTADO:'Inactivo'}
      );
      const spreadsheetId = String(
        fila.datos.SPREADSHEET_RESPUESTAS_ID || ''
      ).trim();
      if (spreadsheetId) spreadsheetsARevisar.add(spreadsheetId);
    });
    SpreadsheetApp.flush();
    let advertenciasActivadores = 0;
    spreadsheetsARevisar.forEach(function(spreadsheetId) {
      try {
        eliminarTriggerFormularioVinculadoSiNoSeUsa_(spreadsheetId);
      } catch (error) {
        advertenciasActivadores++;
      }
    });
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS');
    sigcRegistrarLog(
      'ARCHIVAR',
      'ACTIVIDAD',
      impacto.idActividad,
      'Participaciones conservadas: ' + impacto.participaciones.length +
        '. Formularios desactivados: ' + impacto.formulariosActivos.length +
        '. Advertencias de activadores: ' + advertenciasActivadores + '.'
    );
    return {
      ok: true,
      accion: 'archivada',
      participacionesConservadas: impacto.participaciones.length,
      formulariosDesactivados: impacto.formulariosActivos.length,
      mensaje: 'La actividad fue archivada y se conservó su historial. ' +
        (impacto.formulariosActivos.length
          ? 'Se desactivaron ' + impacto.formulariosActivos.length + ' formularios vinculados.'
          : 'No tenía formularios activos.') +
        (advertenciasActivadores
          ? ' Revise manualmente los activadores de las hojas vinculadas.'
          : '')
    };
  } finally {
    lock.releaseLock();
  }
}
/**
 * Registra manualmente una participación.
 */
function guardarParticipacion(datos) {
  datos = datos || {};
  webValidarObjeto_(datos, ['ID_PERSONA', 'ID_ACTIVIDAD']);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const hoja = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
    if (!hoja) throw new Error('No se encontró la hoja PARTICIPACIONES.');
    const tabla = webLeerTablaConFilas_(hoja);
    const persona = webBuscarRegistro_(
      ss,
      WEBAPP_CONFIG.HOJAS.PERSONAS,
      'ID_PERSONA',
      datos.ID_PERSONA
    );
    const actividad = webBuscarRegistro_(
      ss,
      WEBAPP_CONFIG.HOJAS.ACTIVIDADES,
      'ID_ACTIVIDAD',
      datos.ID_ACTIVIDAD
    );
    if (!persona) throw new Error('La persona indicada no existe.');
    if (!actividad) throw new Error('La actividad indicada no existe.');
    const duplicada = tabla.filas.some(function(fila) {
      return String(fila.datos.ID_PERSONA) === String(datos.ID_PERSONA) &&
        String(fila.datos.ID_ACTIVIDAD) === String(datos.ID_ACTIVIDAD) &&
        sigcNormalizarSiNo(fila.datos.REGISTRO_ACTIVO, 'Sí') !== 'No';
    });
    if (duplicada) {
      throw new Error('La persona ya posee una participación activa en esta actividad.');
    }
    const seleccion = sigcNormalizarSeleccion(
      datos.ESTADO_SELECCION || 'Pendiente'
    );
    const cumple = sigcNormalizarCumple(
      datos.CUMPLE_REQUISITOS || 'Pendiente'
    );
    if (cumple === 'No' && seleccion === 'Seleccionado') {
      throw new Error('No puede seleccionar a una persona que no cumple requisitos.');
    }
    const total = Math.max(
      1,
      Number(datos.SESIONES_TOTALES || actividad.SESIONES_TOTALES || 1)
    );
    const asistidas = webNumeroNoNegativo_(datos.SESIONES_ASISTIDAS, 0);
    if (asistidas > total) {
      throw new Error('Las sesiones asistidas no pueden superar las sesiones totales.');
    }
    if (seleccion !== 'Seleccionado' && asistidas > 0) {
      throw new Error('Solo se puede registrar asistencia en personas seleccionadas.');
    }
    const finalizar = seleccion === 'Seleccionado' &&
      sigcActividadFinalizada(actividad);
    const resultado = seleccion === 'Seleccionado'
      ? sigcCalcularResultado(actividad, asistidas, total, finalizar)
      : {resultadoAsistencia: 'Pendiente', resultadoFinal: 'Pendiente'};
    const prefijoId = 'PAR-' + new Date().getFullYear() + '-';
    const id = webCalcularSiguienteIdDesdeFilas_(
      tabla.filas,
      'ID_PARTICIPACION',
      prefijoId,
      6
    );
    const ahora = new Date();
    const nuevaParticipacion = {
      ID_PARTICIPACION: id,
      ID_PERSONA: datos.ID_PERSONA,
      ID_ACTIVIDAD: datos.ID_ACTIVIDAD,
      FECHA_INSCRIPCION: datos.FECHA_INSCRIPCION || ahora,
      CANAL_INSCRIPCION: sigcNormalizarTexto(datos.CANAL_INSCRIPCION) || 'Aplicación web',
      CUMPLE_REQUISITOS: cumple,
      ESTADO_SELECCION: seleccion,
      FECHA_NOTIFICACION: datos.FECHA_NOTIFICACION || '',
      MEDIO_NOTIFICACION: sigcNormalizarTexto(datos.MEDIO_NOTIFICACION) || 'No informado',
      CONFIRMA_PARTICIPACION: sigcNormalizarSiNo(
        datos.CONFIRMA_PARTICIPACION,
        'No informado'
      ),
      SESIONES_ASISTIDAS: asistidas,
      SESIONES_TOTALES: total,
      PORCENTAJE_ASISTENCIA: total ? asistidas / total : 0,
      RESULTADO_ASISTENCIA: resultado.resultadoAsistencia,
      RESULTADO_FINAL: resultado.resultadoFinal,
      CERTIFICADO: sigcNormalizarSiNo(datos.CERTIFICADO, 'No informado'),
      FECHA_CERTIFICACION: datos.FECHA_CERTIFICACION || '',
      OBSERVACIONES: sigcNormalizarTexto(datos.OBSERVACIONES),
      ARCHIVO_ORIGEN: 'Aplicación web',
      FILA_ORIGEN: '',
      REGISTRO_ACTIVO: 'Sí',
      ULTIMA_ACTUALIZACION: ahora
    };
    webAgregarFilaPorEncabezados_(hoja, tabla.encabezados, nuevaParticipacion);
    sigcRegistrarLog(
      'CREAR',
      'PARTICIPACION',
      id,
      datos.ID_PERSONA + ' | ' + datos.ID_ACTIVIDAD
    );
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
    const participacionEnriquecida = Object.assign({}, nuevaParticipacion, {
      NOMBRE_COMPLETO: persona.NOMBRE_COMPLETO || '',
      RUT: persona.RUT || '',
      DOCUMENTO: persona.NUMERO_DOCUMENTO || persona.RUT || '',
      NOMBRE_ACTIVIDAD: actividad.NOMBRE_ACTIVIDAD || '',
      PROGRAMA: actividad.PROGRAMA || '',
      AREA_TEMATICA: actividad.AREA_TEMATICA || '',
      REGLA_RESULTADO: actividad.REGLA_RESULTADO || '',
      ESTADO_ACTIVIDAD: actividad.ESTADO_ACTIVIDAD || ''
    });
    return {
      ok: true,
      mensaje: 'La participación fue registrada.',
      id: id,
      participacion: participacionEnriquecida
    };
  } finally {
    lock.releaseLock();
  }
}
/**
 * Obtiene la gestión completa de participantes de una actividad.
 */
function obtenerGestionActividad(idActividad) {
  webValidarObjeto_(
    {ID_ACTIVIDAD: idActividad},
    ['ID_ACTIVIDAD']
  );
  const ss = sigcSpreadsheetCentral_();
  const actividad = webBuscarRegistro_(
    ss,
    WEBAPP_CONFIG.HOJAS.ACTIVIDADES,
    'ID_ACTIVIDAD',
    idActividad
  );
  if (!actividad) throw new Error('No se encontró la actividad seleccionada.');

  // Depurar y unificar duplicados para esta actividad automáticamente
  try {
    depurarDuplicadosActividad(idActividad);
  } catch (eDup) {
    console.warn('Advertencia al depurar duplicados de participaciones: ' + eDup.message);
  }

  // Homogeneizar y reparar sesiones de las participaciones para esta actividad
  try {
    corregirYSincronizarSesionesParticipaciones(idActividad);
  } catch (eCorr) {
    console.warn('Advertencia al sincronizar sesiones de participaciones: ' + eCorr.message);
  }

  const sesionesOficiales = Math.max(1, Number(actividad.SESIONES_TOTALES || 1));
  const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS, true);
  const personasPorId = webIndexar_(personas, 'ID_PERSONA');
  const participaciones = webLeerTablaConCache_(
    ss,
    WEBAPP_CONFIG.HOJAS.PARTICIPACIONES,
    true
  )
    .filter(function(participacion) {
      return String(participacion.ID_ACTIVIDAD) === String(idActividad) &&
        sigcNormalizarSiNo(participacion.REGISTRO_ACTIVO, 'Sí') !== 'No';
    })
    .map(function(participacion) {
      const persona = personasPorId[participacion.ID_PERSONA] || {};
      const tipo = sigcNormalizarTipoDocumento(
        persona.TIPO_DOCUMENTO,
        persona.RUT
      );
      const documento = sigcNormalizarDocumento(
        tipo,
        persona.NUMERO_DOCUMENTO,
        persona.RUT
      );
      return Object.assign({}, participacion, {
        SESIONES_TOTALES: sesionesOficiales,
        NOMBRE_COMPLETO: persona.NOMBRE_COMPLETO || '',
        RUT: persona.RUT || '',
        TIPO_DOCUMENTO: tipo,
        NUMERO_DOCUMENTO: documento,
        DOCUMENTO: documento,
        PARTICIPA_PMJH: sigcNormalizarSiNo(
          persona.PARTICIPA_PMJH,
          'No informado'
        ),
        FECHA_NACIMIENTO: persona.FECHA_NACIMIENTO || '',
        EDAD: webCalcularEdad_(persona.FECHA_NACIMIENTO),
        CORREO: persona.CORREO || '',
        TELEFONO: persona.TELEFONO || ''
      });
    })
    .sort(function(a, b) {
      return String(a.NOMBRE_COMPLETO).localeCompare(
        String(b.NOMBRE_COMPLETO),
        'es',
        {sensitivity: 'base'}
      );
    });
  const cuposTotales = Number(actividad.CUPOS || 0);
  const seleccionadas = participaciones.filter(sigcEsSeleccionado);
  const vacantesDisponibles = cuposTotales > 0 ? Math.max(0, cuposTotales - seleccionadas.length) : 'Sin límite';
  const resumen = {
    inscritos: participaciones.length,
    cupos: cuposTotales,
    vacantes: vacantesDisponibles,
    seleccionados: seleccionadas.length,
    confirmados: seleccionadas.filter(function(participacion) {
      return sigcNormalizarSiNo(
        participacion.CONFIRMA_PARTICIPACION,
        'No informado'
      ) === 'Sí';
    }).length,
    asistentes: seleccionadas.filter(function(participacion) {
      return webNumeroNoNegativo_(
        participacion.SESIONES_ASISTIDAS,
        0
      ) > 0;
    }).length,
    aprobados: seleccionadas.filter(function(participacion) {
      return sigcNormalizarResultado(
        participacion.RESULTADO_FINAL
      ) === 'Aprobado';
    }).length
  };
  return {
    actividad: actividad,
    participaciones: participaciones,
    resumen: resumen
  };
}

/**
 * Ejecuta la depuración y unificación manual de duplicados desde la Web App.
 */
function depurarDuplicadosActividadWeb(idActividad) {
  webValidarObjeto_({ ID_ACTIVIDAD: idActividad }, ['ID_ACTIVIDAD']);
  return depurarDuplicadosActividad(idActividad);
}
/**
 * Guarda selección, asistencia y resultados de forma masiva.
 */
function guardarGestionMasiva(payload) {
  if (!payload || !Array.isArray(payload.registros) || !payload.registros.length) {
    throw new Error('No hay registros para guardar.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sigcSpreadsheetCentral_();
    const hoja = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
    if (!hoja) throw new Error('No se encontró la hoja PARTICIPACIONES.');
    const actividad = webBuscarRegistro_(
      ss,
      WEBAPP_CONFIG.HOJAS.ACTIVIDADES,
      'ID_ACTIVIDAD',
      payload.idActividad
    );
    if (!actividad) throw new Error('La actividad indicada no existe.');
    const rango = hoja.getDataRange();
    const valores = rango.getValues();
    if (valores.length < 2) throw new Error('La hoja PARTICIPACIONES no contiene registros.');
    const encabezados = valores[0].map(function(valor) { return String(valor).trim(); });
    webAsegurarEncabezadosParticipaciones_(hoja, encabezados);
    const mapa = {};
    encabezados.forEach(function(encabezado, indice) {
      mapa[sigcNormalizarEncabezado(encabezado)] = indice;
    });
    const colId = mapa[sigcNormalizarEncabezado('ID_PARTICIPACION')];
    const colActividad = mapa[sigcNormalizarEncabezado('ID_ACTIVIDAD')];
    if (colId === undefined || colActividad === undefined) {
      throw new Error('Faltan columnas obligatorias en PARTICIPACIONES.');
    }
    const filaPorId = new Map();
    for (let i = 1; i < valores.length; i++) {
      const id = String(valores[i][colId] || '').trim();
      if (id) filaPorId.set(id, i);
    }
    const ahora = new Date();
    const filasActualizadas = [];
    const errores = [];
    payload.registros.forEach(function(registro, indice) {
      try {
        const id = String(registro.ID_PARTICIPACION || '').trim();
        const indiceMatriz = filaPorId.get(id);
        if (indiceMatriz === undefined) throw new Error('Participación no encontrada: ' + id);
        if (String(valores[indiceMatriz][colActividad]) !== String(payload.idActividad)) {
          throw new Error('La participación no pertenece a la actividad seleccionada.');
        }
        const total = Math.max(1, Number(actividad.SESIONES_TOTALES || 1));
        let asistidas = webNumeroNoNegativo_(registro.SESIONES_ASISTIDAS, 0);
        let asistSesiones = registro.ASISTENCIA_SESIONES;
        if (asistSesiones !== undefined && asistSesiones !== null) {
          if (typeof asistSesiones !== 'string') {
            asistSesiones = JSON.stringify(asistSesiones);
          }
        } else {
          asistSesiones = '';
        }

        let parsedSesiones = [];
        if (asistSesiones) {
          try {
            parsedSesiones = typeof asistSesiones === 'string' ? JSON.parse(asistSesiones) : asistSesiones;
          } catch (e) { parsedSesiones = []; }
        }
        if (Array.isArray(parsedSesiones) && parsedSesiones.length > 0) {
          asistidas = parsedSesiones.length;
        }

        if (total < 1) throw new Error('Las sesiones totales deben ser al menos 1.');
        if (asistidas > total) throw new Error('Las sesiones asistidas no pueden superar las sesiones totales.');
        const cumple = sigcNormalizarCumple(registro.CUMPLE_REQUISITOS);
        const seleccion = sigcNormalizarSeleccion(registro.ESTADO_SELECCION);
        if (cumple === 'No' && seleccion === 'Seleccionado') {
          throw new Error('No se puede seleccionar a una persona que no cumple requisitos.');
        }
        // Las personas no seleccionadas no deben conservar asistencia.
        if (seleccion !== 'Seleccionado') {
          asistidas = 0;
          asistSesiones = '';
        }
        const porcentaje = total > 0 ? asistidas / total : 0;
        const resultado = seleccion === 'Seleccionado'
          ? sigcCalcularResultado(actividad, asistidas, total, sigcActividadFinalizada(actividad))
          : {resultadoAsistencia: 'Pendiente', resultadoFinal: 'Pendiente'};
        const cambios = {
          CUMPLE_REQUISITOS: cumple,
          ESTADO_SELECCION: seleccion,
          CONFIRMA_PARTICIPACION: sigcNormalizarSiNo(registro.CONFIRMA_PARTICIPACION, 'No informado'),
          SESIONES_ASISTIDAS: asistidas,
          ASISTENCIA_SESIONES: seleccion === 'Seleccionado' ? asistSesiones : '',
          SESIONES_TOTALES: total,
          PORCENTAJE_ASISTENCIA: porcentaje,
          RESULTADO_ASISTENCIA: resultado.resultadoAsistencia,
          RESULTADO_FINAL: resultado.resultadoFinal,
          CERTIFICADO: webNormalizarCertificado_(registro.CERTIFICADO),
          OBSERVACIONES: sigcNormalizarTexto(registro.OBSERVACIONES || ''),
          ULTIMA_ACTUALIZACION: ahora
        };
        Object.keys(cambios).forEach(function(campo) {
          const col = mapa[sigcNormalizarEncabezado(campo)];
          if (col !== undefined) valores[indiceMatriz][col] = cambios[campo];
        });
        filasActualizadas.push(indiceMatriz);
      } catch (error) {
        errores.push('Registro ' + (indice + 1) + ': ' + error.message);
      }
    });
    if (errores.length) {
      throw new Error('No se guardaron cambios porque se detectaron errores:\n' + errores.slice(0, 10).join('\n'));
    }
    filasActualizadas.sort(function(a, b) { return a - b; });
    const bloques = [];
    filasActualizadas.forEach(function(indiceMatriz) {
      const ultimo = bloques[bloques.length - 1];
      if (!ultimo || indiceMatriz !== ultimo.fin + 1) {
        bloques.push({inicio: indiceMatriz, fin: indiceMatriz});
      } else {
        ultimo.fin = indiceMatriz;
      }
    });
    bloques.forEach(function(bloque) {
      const cantidad = bloque.fin - bloque.inicio + 1;
      hoja.getRange(bloque.inicio + 1, 1, cantidad, encabezados.length)
        .setValues(valores.slice(bloque.inicio, bloque.fin + 1));
    });
    SpreadsheetApp.flush();
    sigcRegistrarLog(
      'ACTUALIZACION MASIVA',
      'PARTICIPACION',
      payload.idActividad,
      filasActualizadas.length + ' registros modificados mediante guardado selectivo.'
    );
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
    return {
      ok: true,
      actualizados: filasActualizadas.length,
      mensaje: 'Se guardaron ' + filasActualizadas.length + ' participaciones correctamente.'
    };
  } finally {
    lock.releaseLock();
  }
}
/* =======================
 * FUNCIONES PRIVADAS WEB
 * ======================= */
function webAsegurarHojaIntereses_(ss) {
  const nombre = WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION';
  let hoja = ss.getSheetByName(nombre);
  const encabezados = [
    'ID_INTERES', 'ID_PERSONA', 'ESCUELA_LINEA', 'AREA_TEMATICA',
    'FECHA_REGISTRO', 'ORIGEN_REGISTRO', 'ESTADO_INTERES',
    'ULTIMA_ACTUALIZACION', 'OBSERVACIONES'
  ];
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  } else if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  } else {
    encabezados.forEach(function(encabezado) {
      webAsegurarColumna_(hoja, encabezado);
    });
  }
  hoja.setFrozenRows(1);
  return hoja;
}

function webClaveArea_(linea, area) {
  return sigcNormalizarClave(linea) + '|' + sigcNormalizarClave(area);
}

/** Mapa ID_PERSONA -> área -> true cuando la capacitación fue efectiva. */
function webMapaCoberturaPersonaArea_(actividades, participaciones) {
  const actividadesPorId = webIndexar_(actividades.filter(function(actividad) {
    return !webEsActividadArchivada_(actividad);
  }), 'ID_ACTIVIDAD');
  const cobertura = {};
  participaciones.filter(webEsRegistroActivo_).forEach(function(p) {
    if (!sigcEsSeleccionado(p)) return;
    const resultado = sigcNormalizarResultado(p.RESULTADO_FINAL);
    if (['Participó', 'Aprobado'].indexOf(resultado) < 0) return;
    const actividad = actividadesPorId[p.ID_ACTIVIDAD] || {};
    if (!actividad.ESCUELA_LINEA || !actividad.AREA_TEMATICA) return;
    const idPersona = String(p.ID_PERSONA || '');
    if (!idPersona) return;
    if (!cobertura[idPersona]) cobertura[idPersona] = {};
    cobertura[idPersona][webClaveArea_(actividad.ESCUELA_LINEA, actividad.AREA_TEMATICA)] = true;
  });
  return cobertura;
}

function webConstruirAnalisisDemanda_(personas, intereses, actividades, participaciones) {
  const personasPorId = webIndexar_(personas, 'ID_PERSONA');
  const cobertura = webMapaCoberturaPersonaArea_(actividades, participaciones);
  const areas = {};
  const detalle = [];
  const indiceDetallePorClave = {};
  const personasConDemanda = new Set();

  function asegurarArea(linea, area) {
    const clave = webClaveArea_(linea, area);
    if (!areas[clave]) {
      areas[clave] = {
        clave: clave,
        escuelaLinea: linea,
        areaTematica: area,
        demandantes: new Set(),
        capacitadas: new Set(),
        inscritos: new Set(),
        seleccionados: new Set(),
        actividades: new Set()
      };
    }
    return areas[clave];
  }

  intereses.forEach(function(interes) {
    if (sigcNormalizarClave(interes.ESTADO_INTERES || 'Activo') === 'inactivo') return;
    const idPersona = String(interes.ID_PERSONA || '');
    const linea = sigcNormalizarTexto(interes.ESCUELA_LINEA);
    const area = sigcNormalizarTexto(interes.AREA_TEMATICA);
    if (!idPersona || !linea || !area) return;
    const agrupacion = asegurarArea(linea, area);
    const capacitada = !!(cobertura[idPersona] && cobertura[idPersona][agrupacion.clave]);
    agrupacion.demandantes.add(idPersona);
    personasConDemanda.add(idPersona);
    if (capacitada) agrupacion.capacitadas.add(idPersona);
    const claveDetalle = idPersona + '|' + agrupacion.clave;
    const persona = personasPorId[idPersona] || {};
    const ordenReciente = webFechaNumero_(
      interes.FECHA_REGISTRO || interes.ULTIMA_ACTUALIZACION ||
      persona.FECHA_REGISTRO || persona.ULTIMA_ACTUALIZACION
    );
    if (indiceDetallePorClave[claveDetalle] === undefined) {
      indiceDetallePorClave[claveDetalle] = detalle.length;
      detalle.push({
        ID_PERSONA: idPersona,
        NOMBRE_COMPLETO: persona.NOMBRE_COMPLETO || '',
        CORREO: persona.CORREO || '',
        COMUNA: persona.COMUNA || '',
        ESCUELA_LINEA: linea,
        AREA_TEMATICA: area,
        CAPACITADA: capacitada ? 'Sí' : 'No',
        ORDEN_RECIENTE: ordenReciente
      });
    } else {
      const existente = detalle[indiceDetallePorClave[claveDetalle]];
      existente.ORDEN_RECIENTE = Math.max(existente.ORDEN_RECIENTE || 0, ordenReciente);
    }
  });

  const actividadesPorId = webIndexar_(actividades.filter(function(actividad) {
    return !webEsActividadArchivada_(actividad);
  }), 'ID_ACTIVIDAD');
  actividades.forEach(function(actividad) {
    if (webEsActividadArchivada_(actividad)) return;
    if (!actividad.ESCUELA_LINEA || !actividad.AREA_TEMATICA) return;
    asegurarArea(actividad.ESCUELA_LINEA, actividad.AREA_TEMATICA)
      .actividades.add(String(actividad.ID_ACTIVIDAD || ''));
  });
  participaciones.filter(webEsRegistroActivo_).forEach(function(p) {
    const actividad = actividadesPorId[p.ID_ACTIVIDAD] || {};
    if (!actividad.ESCUELA_LINEA || !actividad.AREA_TEMATICA) return;
    const agrupacion = asegurarArea(actividad.ESCUELA_LINEA, actividad.AREA_TEMATICA);
    const idPersona = String(p.ID_PERSONA || '');
    if (!idPersona) return;
    // El embudo de Demanda solo considera a quienes declararon ese mismo interés.
    // Así no se mezclan participantes del área que nunca formaron parte de la demanda declarada.
    if (!agrupacion.demandantes.has(idPersona)) return;
    agrupacion.inscritos.add(idPersona);
    if (sigcEsSeleccionado(p)) agrupacion.seleccionados.add(idPersona);
  });

  const filas = Object.keys(areas).map(function(clave) {
    const item = areas[clave];
    const demanda = item.demandantes.size;
    const capacitadas = item.capacitadas.size;
    return {
      CLAVE: clave,
      ESCUELA_LINEA: item.escuelaLinea,
      AREA_TEMATICA: item.areaTematica,
      DEMANDANTES: demanda,
      ACTIVIDADES_OFERTADAS: Array.from(item.actividades).filter(Boolean).length,
      INSCRITOS: item.inscritos.size,
      SELECCIONADOS: item.seleccionados.size,
      CAPACITADAS: capacitadas,
      PENDIENTES: Math.max(demanda - capacitadas, 0),
      COBERTURA: demanda ? capacitadas / demanda : 0
    };
  }).filter(function(item) {
    return item.DEMANDANTES > 0;
  }).sort(function(a, b) {
    return b.DEMANDANTES - a.DEMANDANTES || b.PENDIENTES - a.PENDIENTES;
  });

  const totalVinculos = filas.reduce(function(total, fila) { return total + fila.DEMANDANTES; }, 0);
  const totalAtendidos = filas.reduce(function(total, fila) { return total + fila.CAPACITADAS; }, 0);
  const porEscuela = {};
  filas.forEach(function(fila) {
    porEscuela[fila.ESCUELA_LINEA] = (porEscuela[fila.ESCUELA_LINEA] || 0) + fila.DEMANDANTES;
  });
  const escuelas = Object.keys(porEscuela).map(function(nombre) {
    return {nombre: nombre, valor: porEscuela[nombre]};
  }).sort(function(a, b) { return b.valor - a.valor; });
  const areasRanking = filas.map(function(fila) {
    return {
      nombre: fila.AREA_TEMATICA,
      escuela: fila.ESCUELA_LINEA,
      valor: fila.DEMANDANTES,
      capacitadas: fila.CAPACITADAS,
      pendientes: fila.PENDIENTES
    };
  }).sort(function(a, b) { return b.valor - a.valor; });
  return {
    resumen: {
      personasConDemanda: personasConDemanda.size,
      interesesActivos: totalVinculos,
      demandasAtendidas: totalAtendidos,
      demandasPendientes: Math.max(totalVinculos - totalAtendidos, 0),
      cobertura: totalVinculos ? totalAtendidos / totalVinculos : 0,
      escuelaMasDemandada: escuelas.length ? escuelas[0].nombre : '',
      areaMasDemandada: areasRanking.length ? areasRanking[0].nombre : ''
    },
    filas: filas,
    detalle: detalle.sort(function(a, b) {
      return (b.ORDEN_RECIENTE || 0) - (a.ORDEN_RECIENTE || 0) ||
        String(a.NOMBRE_COMPLETO).localeCompare(String(b.NOMBRE_COMPLETO), 'es', {sensitivity: 'base'});
    }),
    graficos: {
      porEscuela: escuelas,
      rankingAreas: areasRanking.slice(0, 10)
    }
  };
}

function webCeldaAString_(valor) {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return '';
    const anio = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, '0');
    const dia = String(valor.getDate()).padStart(2, '0');
    const horas = valor.getHours();
    const minutos = valor.getMinutes();
    const segundos = valor.getSeconds();
    if (horas !== 0 || minutos !== 0 || segundos !== 0) {
      return `${anio}-${mes}-${dia} ${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
    }
    return `${anio}-${mes}-${dia}`;
  }
  return String(valor).trim();
}

/**
 * Almacenamiento seguro en CacheService con segmentación para tablas de cualquier tamaño.
 */
function sigcGuardarEnCache_(clave, datos, ttlSegundos) {
  try {
    const cache = CacheService.getScriptCache();
    const ttl = Math.min(ttlSegundos || 21600, 21600);
    const json = typeof datos === 'string' ? datos : JSON.stringify(datos);
    const chunkSize = 85000;
    if (json.length <= chunkSize) {
      cache.put(clave, json, ttl);
      cache.put(clave + '_chunks', '1', ttl);
    } else {
      const totalChunks = Math.ceil(json.length / chunkSize);
      const chunksMap = {};
      chunksMap[clave + '_chunks'] = String(totalChunks);
      for (let i = 0; i < totalChunks; i++) {
        chunksMap[clave + '_chunk_' + i] = json.substring(i * chunkSize, (i + 1) * chunkSize);
      }
      cache.putAll(chunksMap, ttl);
    }
  } catch (e) {
    console.warn('Error al guardar en CacheService (' + clave + '): ' + e.message);
  }
}

/**
 * Recupera datos de CacheService reconstruyendo los segmentos si fuera necesario.
 */
function sigcObtenerDeCache_(clave) {
  try {
    const cache = CacheService.getScriptCache();
    const chunksVal = cache.get(clave + '_chunks');
    if (!chunksVal) {
      const raw = cache.get(clave);
      if (!raw) return null;
      return JSON.parse(raw);
    }
    const totalChunks = parseInt(chunksVal, 10);
    if (isNaN(totalChunks) || totalChunks < 1) return null;
    if (totalChunks === 1) {
      const single = cache.get(clave);
      return single ? JSON.parse(single) : null;
    }
    const chunkKeys = [];
    for (let i = 0; i < totalChunks; i++) {
      chunkKeys.push(clave + '_chunk_' + i);
    }
    const chunks = cache.getAll(chunkKeys);
    let fullJson = '';
    for (let i = 0; i < totalChunks; i++) {
      const piece = chunks[clave + '_chunk_' + i];
      if (piece === undefined || piece === null) return null;
      fullJson += piece;
    }
    return JSON.parse(fullJson);
  } catch (e) {
    console.warn('Error al leer de CacheService (' + clave + '): ' + e.message);
    return null;
  }
}

/**
 * Invalida selectivamente la caché de una tabla específica y del resumen.
 */
function sigcInvalidarCacheTabla_(nombreHoja) {
  try {
    const cache = CacheService.getScriptCache();
    const clave = 'SIGC_TABLA_' + String(nombreHoja || '').toUpperCase().trim();
    const chunksVal = cache.get(clave + '_chunks');
    const keysToRemove = [clave, clave + '_chunks'];
    if (chunksVal) {
      const total = parseInt(chunksVal, 10) || 0;
      for (let i = 0; i < total; i++) {
        keysToRemove.push(clave + '_chunk_' + i);
      }
    }
    cache.removeAll(keysToRemove);
  } catch (e) {
    console.warn('Error al invalidar caché de tabla ' + nombreHoja + ': ' + e.message);
  }
  if (typeof webInvalidarDashboard_ === 'function') {
    webInvalidarDashboard_();
  }
}

/**
 * Lee una tabla desde la caché compartida de alto rendimiento o desde la hoja si no existe.
 */
function webLeerTablaConCache_(ss, nombreHoja, forzar) {
  const clave = 'SIGC_TABLA_' + String(nombreHoja || '').toUpperCase().trim();
  if (!forzar) {
    const cached = sigcObtenerDeCache_(clave);
    if (cached && Array.isArray(cached)) {
      return cached;
    }
  }
  const datos = webLeerTabla_(ss, nombreHoja);
  if (datos && Array.isArray(datos)) {
    sigcGuardarEnCache_(clave, datos, 21600);
  }
  return datos;
}

function webLeerTabla_(ss, nombreHoja) {
  const hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) throw new Error('No se encontró la hoja: ' + nombreHoja);
  const valores = hoja.getDataRange().getValues();
  if (valores.length < 2) return [];
  const encabezados = valores[0].map(function(valor) {
    return String(valor || '').trim();
  });
  return valores.slice(1)
    .filter(function(fila) {
      return fila.some(function(celda) {
        return celda !== null && celda !== undefined && String(celda).trim() !== '';
      });
    })
    .map(function(fila) {
      return webObjetoDesdeFilaRapida_(encabezados, fila);
    });
}

function webLeerTablaConFilas_(hoja) {
  const valores = hoja.getDataRange().getValues();
  const encabezados = valores.length ? valores[0].map(function(valor) {
    return String(valor || '').trim();
  }) : [];
  const filas = valores.slice(1)
    .map(function(fila, indice) {
      return {
        numeroFila: indice + 2,
        datos: webObjetoDesdeFilaRapida_(encabezados, fila)
      };
    })
    .filter(function(fila) {
      return Object.values(fila.datos).some(function(valor) {
        return String(valor).trim() !== '';
      });
    });
  return {
    encabezados: encabezados,
    filas: filas
  };
}

function webObjetoDesdeFilaRapida_(encabezados, fila) {
  const objeto = {};
  for (let i = 0; i < encabezados.length; i++) {
    const enc = encabezados[i];
    if (enc) {
      objeto[enc] = webCeldaAString_(fila[i]);
    }
  }
  return objeto;
}
function webObjetoDesdeFila_(encabezados, fila) {
  return encabezados.reduce(function(objeto, encabezado, indice) {
    if (encabezado) objeto[encabezado] = fila[indice] ?? '';
    return objeto;
  }, {});
}
function webIndexar_(lista, campo) {
  return lista.reduce(function(objeto, elemento) {
    objeto[elemento[campo]] = elemento;
    return objeto;
  }, {});
}
function webEsRegistroActivo_(participacion) {
  return sigcNormalizarSiNo(
    participacion.REGISTRO_ACTIVO,
    'Sí'
  ) !== 'No';
}
function webCalcularImpactoQuitarActividad_(ss, idActividad) {
  idActividad = String(idActividad || '').trim();
  if (!idActividad) throw new Error('Seleccione una actividad para quitar.');
  const hojaActividades = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  const hojaParticipaciones = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
  const hojaFormularios = ss.getSheetByName(
    WEBAPP_CONFIG.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS'
  );
  if (!hojaActividades) throw new Error('No se encontró la hoja ACTIVIDADES.');
  const tablaActividades = webLeerTablaConFilas_(hojaActividades);
  const filaActividad = tablaActividades.filas.find(function(fila) {
    return String(fila.datos.ID_ACTIVIDAD || '').trim() === idActividad;
  });
  if (!filaActividad) throw new Error('No se encontró la actividad: ' + idActividad);
  const participaciones = hojaParticipaciones
    ? webLeerTablaConFilas_(hojaParticipaciones).filas.filter(function(fila) {
        return String(fila.datos.ID_ACTIVIDAD || '').trim() === idActividad;
      })
    : [];
  const tablaFormularios = hojaFormularios
    ? webLeerTablaConFilas_(hojaFormularios)
    : {encabezados:[], filas:[]};
  const formularios = tablaFormularios.filas.filter(function(fila) {
    return String(fila.datos.ID_ACTIVIDAD || '').trim() === idActividad;
  });
  const formulariosActivos = formularios.filter(function(fila) {
    return sigcNormalizarEncabezado(fila.datos.ESTADO) === 'ACTIVO';
  });
  return {
    idActividad: idActividad,
    nombre: filaActividad.datos.NOMBRE_ACTIVIDAD || idActividad,
    hojaActividades: hojaActividades,
    tablaActividades: tablaActividades,
    filaActividad: filaActividad,
    participaciones: participaciones,
    hojaFormularios: hojaFormularios,
    tablaFormularios: tablaFormularios,
    formularios: formularios,
    formulariosActivos: formulariosActivos
  };
}
function webAsegurarValidacionEstadosActividad_(hoja) {
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0];
  const indice = encabezados.map(sigcNormalizarEncabezado)
    .indexOf(sigcNormalizarEncabezado('ESTADO_ACTIVIDAD'));
  if (indice < 0) throw new Error('ACTIVIDADES no contiene la columna ESTADO_ACTIVIDAD.');
  const estados = [
    'Planificada', 'Difusión', 'Inscripción abierta', 'En ejecución',
    'Ejecutada', 'Suspendida', 'Cerrada', 'Archivada'
  ];
  hoja.getRange(2, indice + 1, Math.max(hoja.getMaxRows() - 1, 1), 1)
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(estados, true)
        .setAllowInvalid(false)
        .build()
    );
}
function webInvalidarDashboard_() {
  CacheService.getScriptCache().remove('SIGC_DASHBOARD_RESUMEN_V3');
  const propiedades = PropertiesService.getScriptProperties();
  propiedades.deleteProperty('SIGC_DASHBOARD_ULTIMO_VALIDO_V3');
  propiedades.deleteProperty('SIGC_DASHBOARD_ULTIMO_VALIDO_3_6_3');
}
function webEsActividadArchivada_(actividad) {
  return sigcNormalizarEncabezado(
    actividad && actividad.ESTADO_ACTIVIDAD
  ) === 'ARCHIVADA';
}
function webConstruirResumen_(personas, actividades, participaciones, intereses) {
  const actividadesOperativas = actividades.filter(function(actividad) {
    return !webEsActividadArchivada_(actividad);
  });
  const idsActividadesOperativas = new Set(actividadesOperativas.map(function(actividad) {
    return String(actividad.ID_ACTIVIDAD || '');
  }));
  const activas = actividadesOperativas.filter(function(actividad) {
    return [
      'PLANIFICADA',
      'DIFUSION',
      'INSCRIPCION ABIERTA',
      'EN EJECUCION'
    ].indexOf(sigcNormalizarEncabezado(actividad.ESTADO_ACTIVIDAD)) >= 0;
  }).length;
  const activasRegistro = participaciones.filter(function(participacion) {
    return webEsRegistroActivo_(participacion) &&
      idsActividadesOperativas.has(String(participacion.ID_ACTIVIDAD || ''));
  });
  const seleccionadas = activasRegistro.filter(sigcEsSeleccionado);
  const resultadosDefinitivos = seleccionadas.filter(function(participacion) {
    return sigcEsResultadoDefinitivo(participacion.RESULTADO_FINAL);
  });
  const efectivas = seleccionadas.filter(function(participacion) {
    return ['Participó', 'Aprobado'].indexOf(
      sigcNormalizarResultado(participacion.RESULTADO_FINAL)
    ) >= 0;
  }).length;
  const actividadesPorId = webIndexar_(actividadesOperativas, 'ID_ACTIVIDAD');
  const evaluables = seleccionadas.filter(function(participacion) {
    const actividad = actividadesPorId[participacion.ID_ACTIVIDAD] || {};
    const reglaPorcentaje =
      sigcNormalizarEncabezado(actividad.REGLA_RESULTADO) === 'PORCENTAJE';
    const resultado = sigcNormalizarResultado(participacion.RESULTADO_FINAL);
    return reglaPorcentaje &&
      ['Aprobado', 'Desaprobado'].indexOf(resultado) >= 0;
  });
  const aprobados = evaluables.filter(function(participacion) {
    return sigcNormalizarResultado(
      participacion.RESULTADO_FINAL
    ) === 'Aprobado';
  }).length;
  const participantes = resultadosDefinitivos.filter(function(participacion) {
    return ['Participó', 'Aprobado', 'Desaprobado'].indexOf(
      sigcNormalizarResultado(participacion.RESULTADO_FINAL)
    ) >= 0;
  }).length;
  const cupos = actividadesOperativas.reduce(function(s, a) { return s + (Number(a.CUPOS) || 0); }, 0);
  const asistentes = seleccionadas.filter(function(p) {
    return Number(p.SESIONES_ASISTIDAS || 0) > 0 || ['Participó', 'Aprobado', 'Desaprobado'].indexOf(sigcNormalizarResultado(p.RESULTADO_FINAL)) >= 0;
  });
  const certificados = seleccionadas.filter(function(p) { return sigcNormalizarSiNo(p.CERTIFICADO, 'No') === 'Sí'; });
  const demandaPersonas = new Set((intereses || []).filter(function(i) {
    return sigcNormalizarClave(i.ESTADO_INTERES || 'Activo') !== 'inactivo';
  }).map(function(i) { return String(i.ID_PERSONA || ''); }).filter(Boolean));
  const capacitadas = new Set(asistentes.map(function(p) { return String(p.ID_PERSONA || ''); }).filter(Boolean));
  return {
    totalPersonas: personas.length,
    totalActividades: actividadesOperativas.length,
    actividadesActivas: activas,
    totalParticipaciones: activasRegistro.length,
    participacionEfectiva: efectivas,
    tasaAprobacion: evaluables.length
      ? aprobados / evaluables.length
      : 0,
    tasaParticipacion: resultadosDefinitivos.length ? participantes / resultadosDefinitivos.length : 0,
    cuposOfrecidos: cupos,
    cuposOcupados: seleccionadas.length,
    tasaSeleccion: activasRegistro.length ? seleccionadas.length / activasRegistro.length : 0,
    tasaAsistencia: seleccionadas.length ? asistentes.length / seleccionadas.length : 0,
    tasaInasistencia: seleccionadas.length ? 1 - asistentes.length / seleccionadas.length : 0,
    tasaCertificacion: asistentes.length ? certificados.length / asistentes.length : 0,
    demandaRegistrada: demandaPersonas.size,
    personasCapacitadas: capacitadas.size,
    brechaDemanda: Math.max(0, demandaPersonas.size - capacitadas.size)
  };
}

function webEdadNumeroValida_(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  const edad = Number(valor);
  return Number.isFinite(edad) && edad >= 0 && edad <= 120 ? edad : null;
}
function webTramoEdad_(valor) {
  const edad = webEdadNumeroValida_(valor);
  if (edad === null) return 'No informado';
  if (edad <= 17) return '0–17 años';
  if (edad <= 24) return '18–24 años';
  if (edad <= 34) return '25–34 años';
  if (edad <= 44) return '35–44 años';
  if (edad <= 54) return '45–54 años';
  if (edad <= 64) return '55–64 años';
  return '65 años o más';
}
function webAgruparTramosEdad_(personas) {
  const orden = [
    '0–17 años', '18–24 años', '25–34 años', '35–44 años',
    '45–54 años', '55–64 años', '65 años o más'
  ];
  const conteo = {};
  orden.forEach(function(nombre) { conteo[nombre] = 0; });
  let noInformado = 0;
  (personas || []).forEach(function(persona) {
    const nombre = webTramoEdad_(persona.EDAD);
    if (nombre === 'No informado') noInformado++;
    else conteo[nombre]++;
  });
  const salida = orden.map(function(nombre) {
    return {nombre: nombre, valor: conteo[nombre]};
  });
  if (noInformado) salida.push({nombre: 'No informado', valor: noInformado});
  return salida;
}

/** Demografía agregada; nunca devuelve una nómina de personas. */
function webConstruirDemografia_(participaciones) {
  const porId = {};
  (participaciones || []).forEach(function(p) {
    const id = String(p.ID_PERSONA || '');
    if (id && !porId[id]) porId[id] = p;
  });
  const personas = Object.keys(porId).map(function(id) { return porId[id]; });
  const edades = personas.map(function(p) {
    return webEdadNumeroValida_(p.EDAD);
  }).filter(function(e) { return e !== null; });
  return {
    personasConDatoEdad: edades.length,
    edadPromedio: edades.length ? edades.reduce(function(s, e) { return s + e; }, 0) / edades.length : null,
    porGenero: webAgruparConteo_(personas.map(function(p) { return {valor: p.GENERO || 'No informado'}; }), 'valor'),
    porTramoEdad: webAgruparTramosEdad_(personas),
    porComuna: webAgruparConteo_(personas.map(function(p) { return {valor: p.COMUNA || 'No informado'}; }), 'valor'),
    porPMJH: webAgruparConteo_(personas.map(function(p) { return {valor: p.PARTICIPA_PMJH || 'No informado'}; }), 'valor')
  };
}
function webConstruirGraficos_(actividades, participaciones) {
  const actividadesOperativas = actividades.filter(function(actividad) {
    return !webEsActividadArchivada_(actividad);
  });
  const idsActividadesOperativas = new Set(actividadesOperativas.map(function(actividad) {
    return String(actividad.ID_ACTIVIDAD || '');
  }));
  const activas = participaciones.filter(function(participacion) {
    return webEsRegistroActivo_(participacion) &&
      idsActividadesOperativas.has(String(participacion.ID_ACTIVIDAD || ''));
  });
  const seleccionadasDefinitivas = activas.filter(function(participacion) {
    return sigcEsSeleccionado(participacion) &&
      sigcEsResultadoDefinitivo(participacion.RESULTADO_FINAL);
  });
  const efectivas = activas.filter(function(participacion) {
    const resultado = sigcNormalizarResultado(participacion.RESULTADO_FINAL);
    return sigcEsSeleccionado(participacion) &&
      ['Participó', 'Aprobado'].indexOf(resultado) >= 0;
  });
  return {
    actividadesPorEstado: webAgruparConteo_(
      actividadesOperativas,
      'ESTADO_ACTIVIDAD'
    ),
    actividadesPorArea: webAgruparConteo_(
      actividadesOperativas,
      'AREA_TEMATICA'
    ).slice(0, 10),
    resultados: webAgruparConteoNormalizadoResultados_(
      seleccionadasDefinitivas
    ),
    participacionesPorActividad: webAgruparConteo_(
      activas,
      'NOMBRE_ACTIVIDAD'
    ).slice(0, 10),
    participacionEfectivaPorActividad: webAgruparConteo_(
      efectivas,
      'NOMBRE_ACTIVIDAD'
    ).slice(0, 10)
  };
}
function webAgruparConteo_(lista, campo) {
  const conteo = {};
  lista.forEach(function(item) {
    const clave = String(item[campo] || 'No informado').trim() ||
      'No informado';
    conteo[clave] = (conteo[clave] || 0) + 1;
  });
  return Object.entries(conteo)
    .map(function(entrada) {
      return {nombre: entrada[0], valor: entrada[1]};
    })
    .sort(function(a, b) {
      return b.valor - a.valor;
    });
}
function webAgruparConteoNormalizadoResultados_(lista) {
  const orden = ['Aprobado', 'Participó', 'Desaprobado', 'No participó'];
  const conteo = {};
  lista.forEach(function(item) {
    const resultado = sigcNormalizarResultado(item.RESULTADO_FINAL);
    if (!resultado) return;
    conteo[resultado] = (conteo[resultado] || 0) + 1;
  });
  return orden
    .filter(function(resultado) {
      return conteo[resultado] !== undefined;
    })
    .map(function(resultado) {
      return {nombre: resultado, valor: conteo[resultado]};
    });
}
function webAgregarFilaPorEncabezados_(hoja, encabezados, datos) {
  const normalizados = {};
  Object.keys(datos).forEach(function(campo) {
    normalizados[sigcNormalizarEncabezado(campo)] = datos[campo];
  });
  hoja.appendRow(
    encabezados.map(function(encabezado) {
      const clave = sigcNormalizarEncabezado(encabezado);
      return Object.prototype.hasOwnProperty.call(normalizados, clave)
        ? normalizados[clave]
        : '';
    })
  );
}
function webActualizarFilaPorEncabezados_(
  hoja,
  encabezados,
  numeroFila,
  datos
) {
  const rango = hoja.getRange(
    numeroFila,
    1,
    1,
    encabezados.length
  );
  const actual = rango.getValues()[0];
  const normalizados = {};
  Object.keys(datos).forEach(function(campo) {
    normalizados[sigcNormalizarEncabezado(campo)] = datos[campo];
  });
  const nueva = encabezados.map(function(encabezado, indice) {
    const clave = sigcNormalizarEncabezado(encabezado);
    return Object.prototype.hasOwnProperty.call(normalizados, clave)
      ? normalizados[clave]
      : actual[indice];
  });
  rango.setValues([nueva]);
}
function webActualizarPersonaSinBorrar_(
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
    mapa[sigcNormalizarEncabezado(encabezado)] = indice;
  });
  Object.keys(cambios).forEach(function(campo) {
    const clave = sigcNormalizarEncabezado(campo);
    const indice = mapa[clave];
    if (indice === undefined) return;
    const nuevo = cambios[campo];
    if (nuevo === '' || nuevo === null || nuevo === undefined) return;
    if ((clave === 'PARTICIPA PMJH' || clave === 'AUTORIZA CONTACTO') &&
        nuevo === 'No informado' &&
        ['Sí', 'No'].indexOf(
          sigcNormalizarSiNo(actual[indice], 'No informado')
        ) >= 0) {
      return;
    }
    actual[indice] = nuevo;
  });
  rango.setValues([actual]);
}
function webBuscarRegistro_(ss, nombreHoja, campo, valor) {
  return webLeerTablaConCache_(ss, nombreHoja).find(function(registro) {
    return String(registro[campo]) === String(valor);
  }) || null;
}
function webCalcularSiguienteIdDesdeFilas_(filas, campo, prefijo, largo) {
  const numeros = (filas || []).map(function(item) {
    const datos = item && item.datos ? item.datos : item;
    const texto = String(datos && datos[campo] || '');
    if (!texto.startsWith(prefijo)) return 0;
    const numero = parseInt(texto.substring(prefijo.length), 10);
    return isNaN(numero) ? 0 : numero;
  });
  const max = numeros.length ? Math.max.apply(null, numeros) : 0;
  return prefijo + String(max + 1).padStart(largo, '0');
}

function webSiguienteId_(hoja, campo, prefijo, largo) {
  const tabla = webLeerTablaConFilas_(hoja);
  return webCalcularSiguienteIdDesdeFilas_(tabla.filas, campo, prefijo, largo);
}

function webSiguienteIdActividad_(hoja, anio) {
  return webSiguienteId_(
    hoja,
    'ID_ACTIVIDAD',
    'CAP-' + anio + '-',
    3
  );
}

function webValidarObjeto_(objeto, campos) {
  campos.forEach(function(campo) {
    if (!objeto ||
        String(objeto[campo] || '').trim() === '') {
      throw new Error('Debe completar el campo: ' + campo);
    }
  });
}

function webNumeroNoNegativo_(valor, defecto) {
  const texto = String(valor ?? '').replace(',', '.').trim();
  const numero = texto === ''
    ? Number(defecto || 0)
    : Number(texto);
  if (!isFinite(numero) || numero < 0) {
    throw new Error('Se detectó un valor numérico inválido.');
  }
  return numero;
}

function webEnteroVacioOPositivo_(valor, defecto) {
  if (valor === '' || valor === null || valor === undefined) {
    if (defecto === '' || defecto === null || defecto === undefined) return '';
    valor = defecto;
  }
  const texto = String(valor).trim();
  if (texto === '') return '';
  const num = parseInt(texto, 10);
  if (isNaN(num) || num < 0) return '';
  return num;
}

function webNormalizarCertificado_(valor) {
  const clave = sigcNormalizarClave(valor);
  if (clave === 'no aplica') return 'No aplica';
  return sigcNormalizarSiNo(valor, 'No informado');
}

function webPartesFechaNacimiento_(valor) {
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return {
      anio: valor.getFullYear(),
      mes: valor.getMonth() + 1,
      dia: valor.getDate()
    };
  }
  const texto = String(valor || '').trim();
  if (!texto) return null;
  let m = texto.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return {
      anio: Number(m[1]),
      mes: Number(m[2]),
      dia: Number(m[3])
    };
  }
  m = texto.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    return {
      anio: Number(m[3]),
      mes: Number(m[2]),
      dia: Number(m[1])
    };
  }
  return null;
}

function webFechaNacimientoValida_(partes) {
  if (!partes) return false;
  const fecha = new Date(
    partes.anio,
    partes.mes - 1,
    partes.dia
  );
  return fecha.getFullYear() === partes.anio &&
    fecha.getMonth() === partes.mes - 1 &&
    fecha.getDate() === partes.dia;
}

function webCalcularEdad_(valor) {
  const partes = webPartesFechaNacimiento_(valor);
  if (!webFechaNacimientoValida_(partes)) return '';
  const nacimiento = new Date(
    partes.anio,
    partes.mes - 1,
    partes.dia
  );
  const hoy = new Date();
  if (nacimiento.getTime() > hoy.getTime()) return '';
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const aunNoCumple =
    hoy.getMonth() < nacimiento.getMonth() ||
    (
      hoy.getMonth() === nacimiento.getMonth() &&
      hoy.getDate() < nacimiento.getDate()
    );
  if (aunNoCumple) edad--;
  return edad >= 0 && edad <= 120 ? edad : '';
}

function webNormalizarFechaNacimiento_(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return '';
  const partes = webPartesFechaNacimiento_(valor);
  if (!webFechaNacimientoValida_(partes)) {
    throw new Error('La fecha de nacimiento no es válida.');
  }
  const edad = webCalcularEdad_(valor);
  if (edad === '') {
    const fecha = new Date(
      partes.anio,
      partes.mes - 1,
      partes.dia
    );
    if (fecha.getTime() > new Date().getTime()) {
      throw new Error('La fecha de nacimiento no puede ser futura.');
    }
    throw new Error('La fecha de nacimiento está fuera del rango permitido.');
  }
  return [
    String(partes.anio).padStart(4, '0'),
    String(partes.mes).padStart(2, '0'),
    String(partes.dia).padStart(2, '0')
  ].join('-');
}

function webFechaNumero_(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return 0;
  let coincidencia = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (coincidencia) {
    return new Date(
      Number(coincidencia[1]),
      Number(coincidencia[2]) - 1,
      Number(coincidencia[3])
    ).getTime();
  }
  coincidencia = texto.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/
  );
  if (coincidencia) {
    return new Date(
      Number(coincidencia[3]),
      Number(coincidencia[2]) - 1,
      Number(coincidencia[1])
    ).getTime();
  }
  const fecha = new Date(texto);
  return isNaN(fecha.getTime()) ? 0 : fecha.getTime();
}

function webMesDesdeFecha_(valor) {
  const numero = webFechaNumero_(valor);
  if (!numero) return '';
  const meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril',
    'Mayo', 'Junio', 'Julio', 'Agosto',
    'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  return meses[new Date(numero).getMonth()] || '';
}

const _schemaHeadersCache = new Map();

function webAsegurarColumna_(hoja, encabezado) {
  const nombreHoja = hoja.getName();
  let encabezados = _schemaHeadersCache.get(nombreHoja);
  if (!encabezados) {
    const ultimaColumna = Math.max(hoja.getLastColumn(), 1);
    encabezados = hoja.getRange(1, 1, 1, ultimaColumna).getValues()[0].map(sigcNormalizarEncabezado);
    _schemaHeadersCache.set(nombreHoja, encabezados);
  }
  const norm = sigcNormalizarEncabezado(encabezado);
  if (encabezados.indexOf(norm) >= 0) return;
  const colIndex = hoja.getLastColumn() + 1;
  hoja.getRange(1, colIndex).setValue(encabezado);
  encabezados.push(norm);
}

function webAsegurarEncabezadosActividades_(hoja, tablaEncabezados) {
  ['HORARIO', 'DETALLE_SESIONES', 'LINK_INSCRIPCION', 'REQUISITOS', 'DESCRIPCION_CORTA'].forEach(function(col) {
    webAsegurarColumna_(hoja, col);
    const norm = sigcNormalizarEncabezado(col);
    if (!tablaEncabezados.some(function(enc) { return sigcNormalizarEncabezado(enc) === norm; })) {
      tablaEncabezados.push(col);
    }
  });
}

function webAsegurarEncabezadosParticipaciones_(hoja, tablaEncabezados) {
  ['ASISTENCIA_SESIONES'].forEach(function(col) {
    webAsegurarColumna_(hoja, col);
    const norm = sigcNormalizarEncabezado(col);
    if (!tablaEncabezados.some(function(enc) { return sigcNormalizarEncabezado(enc) === norm; })) {
      tablaEncabezados.push(col);
    }
  });
}

function webGuardarSpreadsheetId(nuevoId) {
  return sigcGuardarSpreadsheetId(nuevoId);
}

/**
 * Envía un correo de prueba con el diseño HTML de la cartelera de capacitaciones al usuario activo.
 */
function enviarPruebaCarteleraCorreo(datos) {
  datos = datos || {};
  const html = String(datos.html || '').trim();
  const asunto = String(datos.asunto || 'Cartelera de Capacitaciones — Municipalidad de Santiago · DIDEL').trim();
  if (!html) throw new Error('El contenido HTML de la cartelera está vacío.');

  let destinatario = '';
  try {
    destinatario = Session.getActiveUser().getEmail();
  } catch (e) {}

  if (!destinatario && datos.correoDestino) {
    destinatario = String(datos.correoDestino).trim();
  }

  if (!destinatario || !sigcValidarCorreo(destinatario)) {
    throw new Error('No se pudo identificar una casilla de correo válida para el envío de prueba. Ingrese su correo en la configuración.');
  }

  GmailApp.sendEmail(destinatario, asunto, 'Por favor visualice este correo en un cliente compatible con HTML.', {
    htmlBody: html,
    name: 'Capacitaciones DIDEL · Municipalidad de Santiago'
  });

  return {
    ok: true,
    mensaje: 'Correo de prueba enviado con éxito a: ' + destinatario,
    destinatario: destinatario
  };
}



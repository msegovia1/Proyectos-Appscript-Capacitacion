
function testTrivial() {
  return 'HELLO_SIGC';
}

function diagnosticarSpreadsheetIdSIGC() {
  const res = {
    propsId: null,
    defaultId: SIGC_CONFIG_DEFAULT.SPREADSHEET_ID,
    configId: SIGC_CONFIG.SPREADSHEET_ID,
    openDefaultError: null,
    openPropsError: null,
    openDefaultName: null,
    openPropName: null
  };
  try {
    res.propsId = PropertiesService.getScriptProperties().getProperty('SIGC_SPREADSHEET_ID');
  } catch (e) {
    res.propsId = 'ERROR: ' + e.message;
  }
  try {
    const ssDef = SpreadsheetApp.openById(res.defaultId);
    res.openDefaultName = ssDef.getName();
  } catch (eDef) {
    res.openDefaultError = eDef.message;
  }
  if (res.propsId && res.propsId.length > 10) {
    try {
      const ssProp = SpreadsheetApp.openById(res.propsId);
      res.openPropName = ssProp.getName();
    } catch (eProp) {
      res.openPropsError = eProp.message;
    }
  }
  return JSON.stringify(res);
}

/**
 * WEB APP SIGC 3.9.0
 * Backend modular de alto rendimiento para gestión de capacitaciones.
 */

/**
 * Detecta y purga de forma segura registros fantasma generados accidentalmente
 * si un formulario de encuesta fue procesado previamente como inscripción
 * (por ejemplo personas cuyo nombre o RUT sea un código de actividad CAP-2026-XXX).
 */
function purgarRegistrosFantasmaCapacitacion_() {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('SIGC_PURGA_FANTASMAS_OK_V1')) return { eliminados: 0 };

    const ss = sigcSpreadsheetCentral_();
    // Verificación rápida en caché para evitar leer la hoja si no hay registros fantasma
    const personasCache = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS, false) || [];
    const hayPosibleFantasma = personasCache.some(function(p) {
      const nom = String(p.NOMBRE_COMPLETO || '').trim();
      const rut = String(p.RUT || '').trim();
      return /^CAP-\d{4}-\d+/i.test(nom) || /^ACT-\d+/i.test(nom) || (/^2026\d{3}-/i.test(rut) && /^CAP-/i.test(nom));
    });
    if (!hayPosibleFantasma && personasCache.length > 0) {
      cache.put('SIGC_PURGA_FANTASMAS_OK_V1', '1', 21600);
      return { eliminados: 0 };
    }

    const hojaPer = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.PERSONAS);
    const hojaPart = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
    if (!hojaPer || hojaPer.getLastRow() < 2) {
      cache.put('SIGC_PURGA_FANTASMAS_OK_V1', '1', 21600);
      return { eliminados: 0 };
    }

    const datosPer = hojaPer.getDataRange().getValues();
    const mapaPer = mapaEncabezados_(datosPer[0]);
    const colIdPer = mapaPer['ID PERSONA'];
    const colNomPer = mapaPer['NOMBRE COMPLETO'];
    const colRutPer = mapaPer['RUT'];

    const idsFantasma = new Set();
    const filasPerEliminar = [];

    for (let p = 1; p < datosPer.length; p++) {
      const nom = String(datosPer[p][colNomPer] || '').trim();
      const rut = String(datosPer[p][colRutPer] || '').trim();
      const idP = String(datosPer[p][colIdPer] || '').trim();

      const esFantasma = /^CAP-\d{4}-\d+/i.test(nom) ||
                         /^ACT-\d+/i.test(nom) ||
                         (/^2026\d{3}-/i.test(rut) && /^CAP-/i.test(nom));

      if (esFantasma && idP) {
        idsFantasma.add(idP);
        filasPerEliminar.push(p + 1);
      }
    }

    if (idsFantasma.size === 0) {
      cache.put('SIGC_PURGA_FANTASMAS_OK_V1', '1', 21600);
      return { eliminados: 0 };
    }

    // 1. Eliminar participaciones asociadas a estos IDs fantasma
    if (hojaPart && hojaPart.getLastRow() >= 2) {
      const datosPart = hojaPart.getDataRange().getValues();
      const mapaPart = mapaEncabezados_(datosPart[0]);
      const colPartIdPer = mapaPart['ID PERSONA'];
      const filasPartEliminar = [];

      for (let pt = 1; pt < datosPart.length; pt++) {
        const idP = String(datosPart[pt][colPartIdPer] || '').trim();
        if (idsFantasma.has(idP)) {
          filasPartEliminar.push(pt + 1);
        }
      }

      filasPartEliminar.sort(function(a, b) { return b - a; });
      filasPartEliminar.forEach(function(numFila) {
        hojaPart.deleteRow(numFila);
      });
      if (filasPartEliminar.length > 0) {
        sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
      }
    }

    // 2. Eliminar filas en PERSONAS de abajo hacia arriba
    filasPerEliminar.sort(function(a, b) { return b - a; });
    filasPerEliminar.forEach(function(numFila) {
      hojaPer.deleteRow(numFila);
    });
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.PERSONAS);
    cache.put('SIGC_PURGA_FANTASMAS_OK_V1', '1', 21600);

    return { eliminados: idsFantasma.size };
  } catch (e) {
    console.warn('Advertencia en purgarRegistrosFantasmaCapacitacion_: ' + e.message);
    return { error: e.message };
  }
}

function doGet(e) {
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
  const hoyTexto = Utilities.formatDate(
    new Date(),
    SIGC_CONFIG.ZONA_HORARIA,
    'yyyy-MM-dd'
  );
  const claveThrottle = 'SIGC_THROTTLE_ESTADOS_' + hoyTexto;
  if (cache.get(claveThrottle)) {
    return;
  }
  try {
    actualizarEstadosActividadesVencidas();
    cache.put(claveThrottle, '1', 3600); // 1 hora dentro del mismo día
  } catch (e) {
    console.warn('Verificación de estados de actividades omitida: ' + e.message);
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
  try { verificarActividadesVencidasConThrottle_(); } catch (eThrot) {}
  try { verificarSincronizacionSatisfaccionConThrottle_(); } catch (eThrotSat) {}
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
      GENERO: persona.GENERO || 'No informado',
      COMUNA: persona.COMUNA || '',
      BARRIO: persona.BARRIO || '',
      NACIONALIDAD: persona.NACIONALIDAD || '',
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
      participacionesEnriquecidas,
      personasNormalizadas
    )
  };
}

/** Inicio liviano: calcula y conserva solo KPIs y gráficos agregados. */
function obtenerDashboardLiviano(forzarActualizacion, clientTimestamp) {
  try {
    try {
      if (typeof sigcEjecutarMigracionConsolidado2026_ === 'function' && sigcEjecutarMigracionConsolidado2026_()) {
        forzarActualizacion = true;
      }
      if (typeof sigcRecuperarFormalizaCrece3_ === 'function' && sigcRecuperarFormalizaCrece3_()) {
        forzarActualizacion = true;
      }
    } catch (eMig) {
      console.warn('Error en migración consolidado 2026: ' + eMig.message);
    }
    const cache = CacheService.getScriptCache();
  const propiedades = PropertiesService.getScriptProperties();
  // Las claves estables permiten reutilizar el último resumen entre versiones
  // compatibles, evitando un recálculo completo después de cada despliegue.
  const clave = 'SIGC_DASHBOARD_RESUMEN_V7';
  const clavePersistente = 'SIGC_DASHBOARD_ULTIMO_VALIDO_V7';
  const esDirty = cache.get('SIGC_DASHBOARD_DIRTY') === '1';
  if (!forzarActualizacion && !esDirty) {
    let salidaGuardada = null;
    try {
      const guardado = cache.get(clave);
      if (guardado) salidaGuardada = JSON.parse(guardado);
    } catch (error) {
      // Si la caché no está disponible, el Dashboard se calcula normalmente.
    }
    if (!salidaGuardada) {
      try {
        const ultimoValido = propiedades.getProperty(clavePersistente);
        if (ultimoValido) {
          salidaGuardada = JSON.parse(ultimoValido);
          salidaGuardada.desdeResumenPersistente = true;
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
      EDAD: persona.EDAD === '' ? '' : persona.EDAD,
      COMUNA: persona.COMUNA || '',
      BARRIO: persona.BARRIO || '',
      NACIONALIDAD: persona.NACIONALIDAD || ''
    });
  });
  const salida = {
    fechaActualizacion: Utilities.formatDate(new Date(), WEBAPP_CONFIG.ZONA_HORARIA, 'dd-MM-yyyy HH:mm:ss'),
    resumen: webConstruirResumen_(personasNormalizadas, actividades, enriquecidas, intereses),
    graficos: webConstruirGraficos_(actividades, enriquecidas, personasNormalizadas)
  };
  try {
    const serializado = JSON.stringify(salida);
    cache.put(clave, serializado, SIGC_CONFIG.CACHE_RESUMEN_SEGUNDOS || 21600);
    cache.remove('SIGC_DASHBOARD_DIRTY');
    propiedades.setProperty(clavePersistente, serializado);
  } catch (error) {
    // El tamaño o disponibilidad del almacenamiento nunca debe impedir la apertura.
  }
    return salida;
  } catch (errGlobalDash) {
    console.error('Error crítico en obtenerDashboardLiviano: ' + errGlobalDash.message);
    return {
      error: true,
      mensaje: 'Error en el servidor al calcular el Dashboard: ' + errGlobalDash.message,
      fechaActualizacion: Utilities.formatDate(new Date(), (WEBAPP_CONFIG && WEBAPP_CONFIG.ZONA_HORARIA) || 'America/Santiago', 'dd-MM-yyyy HH:mm:ss'),
      resumen: {
        totalPersonas: 0,
        totalActividades: 0,
        actividadesActivas: 0,
        totalParticipaciones: 0,
        participacionEfectiva: 0,
        tasaAprobacion: 0,
        tasaParticipacion: 0,
        cuposOfrecidos: 0,
        tasaSeleccion: 0,
        tasaAsistencia: 0,
        tasaCertificacion: 0,
        brechaDemanda: 0
      },
      graficos: {}
    };
  }
}

function webEnriquecerResumenAsistenciaActividades_(ss, actividades) {
  const lista = Array.isArray(actividades) ? actividades : [];
  if (!lista.length) return lista;
  const part = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES) || [];
  const resumenPorAct = {};
  part.forEach(function(p) {
    if (!webEsRegistroActivo_(p)) return;
    const idAct = String(p.ID_ACTIVIDAD || '').trim();
    if (!idAct) return;
    if (!resumenPorAct[idAct]) resumenPorAct[idAct] = { inscritos: 0, asistentes: 0 };
    resumenPorAct[idAct].inscritos++;
    const ses = Number(p.SESIONES_ASISTIDAS || 0);
    const resF = sigcNormalizarResultado(p.RESULTADO_FINAL);
    const resA = sigcNormalizarTexto(p.RESULTADO_ASISTENCIA);
    if (ses > 0 || resF === 'Participó' || resF === 'Aprobado' || resA === 'Participó' || resA === 'Asistió') {
      resumenPorAct[idAct].asistentes++;
    }
  });
  return lista.map(function(a) {
    const idA = String(a.ID_ACTIVIDAD || '').trim();
    const r = resumenPorAct[idA] || { inscritos: 0, asistentes: 0 };
    return Object.assign({}, a, {
      _TOTAL_INSCRITOS: r.inscritos,
      _TOTAL_ASISTENTES: r.asistentes,
      _TIENE_ASISTENCIA: r.asistentes > 0
    });
  });
}

/** Datos detallados bajo demanda. Evita descargarlos durante la apertura. */
function obtenerDatosModulo(nombreModulo) {
  const modulo = String(nombreModulo || '').toLowerCase();
  const ss = sigcSpreadsheetCentral_();
  if (modulo === 'actividades') {
    return {actividades: webEnriquecerResumenAsistenciaActividades_(ss, webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES))};
  }
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
  if (modulo === 'participaciones_ligero') {
    return {
      participaciones: webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES)
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
    FECHA_NACIMIENTO: webCeldaAString_(persona.FECHA_NACIMIENTO),
    FECHA_PRIMER_REGISTRO: webCeldaAString_(persona.FECHA_PRIMER_REGISTRO),
    ULTIMA_ACTUALIZACION: webCeldaAString_(persona.ULTIMA_ACTUALIZACION),
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
      BARRIO: persona.BARRIO || '', NACIONALIDAD: persona.NACIONALIDAD || '',
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

/** Lee de forma liviana y con caché las variables socioeconómicas de PERFILES_BASE_MADRE (sin JSON pesado). */
function webLeerPerfilesSocioeconomicosLigero_(ss) {
  const clave = 'SIGC_PERFILES_SOCIOEC_V1';
  if (_memoriaTablasRequest_.has(clave)) return _memoriaTablasRequest_.get(clave);
  const cached = sigcObtenerDeCache_(clave);
  if (cached && typeof cached === 'object') {
    _memoriaTablasRequest_.set(clave, cached);
    return cached;
  }
  const mapaPerfiles = {};
  try {
    const nombreHoja = WEBAPP_CONFIG.HOJAS.PERFILES_BASE_MADRE || 'PERFILES_BASE_MADRE';
    const hoja = ss.getSheetByName(nombreHoja);
    if (!hoja || hoja.getLastRow() < 2) return mapaPerfiles;
    const lastRow = hoja.getLastRow();
    // Omitimos las últimas columnas de JSON masivo (col 38) para máxima velocidad
    const anchoLectura = Math.min(hoja.getLastColumn(), 37);
    const valores = hoja.getRange(1, 1, lastRow, anchoLectura).getValues();
    const m = mapaEncabezados_(valores[0]);
    const colId = m['ID PERSONA'];
    if (colId === undefined) return mapaPerfiles;
    const cEdu = m['NIVEL EDUCACIONAL'];
    const cOcup = m['SITUACION OCUPACIONAL'];
    const cRsh = m['TRAMO RSH'];
    const cJefe = m['JEFE HOGAR'];
    const cCuid = m['ES CUIDADOR'];
    const cDisc = m['DISCAPACIDAD'];
    const cCred = m['CREDENCIAL DISCAPACIDAD'];
    const cEmp = m['TIENE EMPRENDIMIENTO'];
    const cSii = m['FORMALIZADO SII'];
    const cRubro = m['RUBRO'];
    const cAreaEmp = m['AREA EMPRENDIMIENTO'];

    for (let r = 1; r < valores.length; r++) {
      const f = valores[r];
      const idP = String(f[colId] || '').trim();
      if (!idP) continue;
      mapaPerfiles[idP] = {
        edu: cEdu !== undefined ? String(f[cEdu] || '').trim() : '',
        ocup: cOcup !== undefined ? String(f[cOcup] || '').trim() : '',
        rsh: cRsh !== undefined ? String(f[cRsh] || '').trim() : '',
        jefe: cJefe !== undefined ? String(f[cJefe] || '').trim() : '',
        cuid: cCuid !== undefined ? String(f[cCuid] || '').trim() : '',
        disc: (cDisc !== undefined ? String(f[cDisc] || '').trim() : '') || (cCred !== undefined ? String(f[cCred] || '').trim() : ''),
        emp: cEmp !== undefined ? String(f[cEmp] || '').trim() : '',
        sii: cSii !== undefined ? String(f[cSii] || '').trim() : '',
        rubro: (cRubro !== undefined ? String(f[cRubro] || '').trim() : '') || (cAreaEmp !== undefined ? String(f[cAreaEmp] || '').trim() : '')
      };
    }
    _memoriaTablasRequest_.set(clave, mapaPerfiles);
    sigcGuardarEnCache_(clave, mapaPerfiles, 21600);
  } catch (ePerf) {
    console.warn('Advertencia al leer perfiles socioeconómicos: ' + ePerf.message);
  }
  return mapaPerfiles;
}

function webNormalizarEducacion_(v) {
  const c = sigcNormalizarClave(v);
  if (!c || ['no informado', 'sin informacion', 'na', 'n a'].indexOf(c) >= 0) return 'No informado';
  if (c.indexOf('postgrado') >= 0 || c.indexOf('magister') >= 0 || c.indexOf('doctor') >= 0) return 'Postgrado';
  if (c.indexOf('universit') >= 0 || c.indexOf('profesional') >= 0) return 'Universitaria / Profesional';
  if (c.indexOf('tecnic') >= 0 || c.indexOf('cft') >= 0 || c.indexOf('ip') >= 0) return 'Técnica Nivel Superior';
  if (c.indexOf('media') >= 0 || c.indexOf('secundar') >= 0 || c.indexOf('liceo') >= 0) return 'Educación Media';
  if (c.indexOf('basic') >= 0 || c.indexOf('primar') >= 0) return 'Educación Básica';
  if (c.indexOf('sin estudio') >= 0 || c.indexOf('ningun') >= 0) return 'Sin educación formal';
  return 'Educación Media';
}

function webNormalizarOcupacion_(v) {
  const c = sigcNormalizarClave(v);
  if (!c || ['no informado', 'sin informacion', 'na', 'n a'].indexOf(c) >= 0) return 'No informado';
  if (c.indexOf('independiente') >= 0 || c.indexOf('cuenta propia') >= 0 || c.indexOf('emprend') >= 0) return 'Independiente / Emprendedor(a)';
  if (c.indexOf('cesante') >= 0 || c.indexOf('desemple') >= 0 || c.indexOf('buscando') >= 0 || c.indexOf('sin trabajo') >= 0) return 'Cesante / Buscando trabajo';
  if (c.indexOf('dependiente') >= 0 || c.indexOf('emplead') >= 0 || c.indexOf('asalariad') >= 0 || c.indexOf('contrato') >= 0) return 'Trabajador(a) dependiente';
  if (c.indexOf('cuidado') >= 0 || c.indexOf('hogar') >= 0 || c.indexOf('casa') >= 0) return 'Labores de cuidado / Hogar';
  if (c.indexOf('estudian') >= 0) return 'Estudiante';
  if (c.indexOf('jubilad') >= 0 || c.indexOf('pensionad') >= 0) return 'Jubilado(a) / Pensionado(a)';
  return webCapitalizarPalabras_(v);
}

function webNormalizarTramoRSH_(v) {
  const c = sigcNormalizarClave(v);
  if (!c || ['no informado', 'sin informacion', 'na', 'n a'].indexOf(c) >= 0) return 'No informado';
  if (c.indexOf('no tiene') >= 0 || c.indexOf('sin rsh') >= 0 || c.indexOf('no cuento') >= 0 || c.indexOf('no sabe') >= 0 || c.indexOf('no se') >= 0) return 'Sin RSH / No sabe';
  if (c.indexOf('40') >= 0) return '0% – 40% (Mayor vulnerabilidad)';
  if (c.indexOf('50') >= 0) return '41% – 50%';
  if (c.indexOf('60') >= 0) return '51% – 60%';
  if (c.indexOf('70') >= 0) return '61% – 70%';
  if (c.indexOf('80') >= 0) return '71% – 80%';
  if (c.indexOf('90') >= 0) return '81% – 90%';
  if (c.indexOf('100') >= 0) return '91% – 100%';
  return webCapitalizarPalabras_(v);
}

function webOrdenarTramosRSH_(lista) {
  const orden = [
    '0% – 40% (Mayor vulnerabilidad)', '41% – 50%', '51% – 60%',
    '61% – 70%', '71% – 80%', '81% – 90%', '91% – 100%', 'Sin RSH / No sabe'
  ];
  const mapa = {};
  (lista || []).forEach(function(x) { mapa[x.nombre] = (mapa[x.nombre] || 0) + Number(x.valor || 0); });
  const salida = [];
  orden.forEach(function(k) {
    if (mapa[k]) { salida.push({ nombre: k, valor: mapa[k] }); delete mapa[k]; }
  });
  Object.keys(mapa).forEach(function(k) {
    if (mapa[k]) salida.push({ nombre: k, valor: mapa[k] });
  });
  return salida;
}

function webNormalizarRubroCategoria_(v) {
  const c = sigcNormalizarClave(v);
  if (!c || c === 'no aplica' || c === 'ninguno' || c.indexOf('no soy emprend') >= 0 || c.indexOf('no tengo emprend') >= 0) return '';
  if (/gastronom|restaur|cafeter|comida|alimento|pastel|panad|cocina|repost/.test(c)) return 'Gastronomía y Alimentos';
  if (/comercio|reventa|bazar|almacen|minimarket|tienda|venta/.test(c)) return 'Comercio y Reventa';
  if (/manufactur|elaborac/.test(c)) return 'Manufactura y Elaboración';
  if (/artesan|manualid|bisuter|joyer|ceram/.test(c)) return 'Artesanía y Manualidades';
  if (/cosmet|estetic|peluquer|belleza|manicur|barber/.test(c)) return 'Cosmética y Estética';
  if (/textil|costura|confecc|vestuar|ropa|calzado|moda/.test(c)) return 'Textil y Confección';
  if (/creativ|disen|fotograf|audiovisual|musica|arte/.test(c)) return 'Industria Creativa y Diseño';
  if (/salud|terapia|masaje|bienestar/.test(c)) return 'Salud y Bienestar';
  if (/tecnolog|informatic|software|digital|web/.test(c)) return 'Tecnología y Digital';
  if (/educac|asesor|consultor|contab|clases/.test(c)) return 'Educación y Asesorías';
  if (/turism|cultura|evento/.test(c)) return 'Turismo y Cultura';
  if (/servicio|albanil|gasfit|electr|mecan|limpiez|transport|oficio/.test(c)) return 'Servicios y Oficios';
  return 'Otros Rubros';
}

function webEsAfirmativoSocio_(v) {
  const c = sigcNormalizarClave(v);
  if (!c || c === 'no' || c.indexOf('no ') === 0 || c.indexOf('ningun') >= 0 || c.indexOf('no inform') >= 0) return false;
  return c === 'si' || c.indexOf('si ') === 0 || c.indexOf('si,') === 0 || sigcNormalizarSiNo(v, 'No') === 'Sí';
}

function webConstruirPerfilSocioeconomico_(ss, idsPersonasSet, pmjhPorId, etiquetaPoblacion) {
  const mapaPerfiles = webLeerPerfilesSocioeconomicosLigero_(ss);
  const ids = Array.from(idsPersonasSet || []);
  let conPerfil = 0;
  const listaEdu = [], listaOcup = [], listaRSH = [], listaRubro = [], listaSII = [];
  let nJefeHogar = 0, nCuidador = 0, nDiscapacidad = 0, nEmprendimiento = 0, nFormalizadoSII = 0, nPMJH = 0;

  ids.forEach(function(idP) {
    if (pmjhPorId && pmjhPorId[idP] === 'Sí') nPMJH++;
    const pf = mapaPerfiles[idP];
    if (!pf) return;
    conPerfil++;
    const edu = webNormalizarEducacion_(pf.edu);
    if (edu !== 'No informado') listaEdu.push({ valor: edu });
    const ocup = webNormalizarOcupacion_(pf.ocup);
    if (ocup !== 'No informado') listaOcup.push({ valor: ocup });
    const rsh = webNormalizarTramoRSH_(pf.rsh);
    if (rsh !== 'No informado') listaRSH.push({ valor: rsh });

    if (webEsAfirmativoSocio_(pf.jefe)) nJefeHogar++;
    if (webEsAfirmativoSocio_(pf.cuid)) nCuidador++;
    if (webEsAfirmativoSocio_(pf.disc)) nDiscapacidad++;
    const rubroNorm = webNormalizarRubroCategoria_(pf.rubro);
    const tieneEmp = webEsAfirmativoSocio_(pf.emp) || !!rubroNorm;
    if (tieneEmp) {
      nEmprendimiento++;
      if (rubroNorm) {
        listaRubro.push({ valor: rubroNorm });
      }
      const cSii = sigcNormalizarClave(pf.sii);
      if (cSii) {
        const esForm = webEsAfirmativoSocio_(pf.sii) || (cSii.indexOf('formalizad') >= 0 && cSii.indexOf('no ') < 0 && cSii.indexOf('informal') < 0);
        if (esForm) {
          nFormalizadoSII++;
          listaSII.push({ valor: 'Formalizado ante SII' });
        } else if (cSii.indexOf('no') >= 0 || cSii.indexOf('informal') >= 0) {
          listaSII.push({ valor: 'No formalizado (Informal)' });
        } else {
          listaSII.push({ valor: 'En trámite / Otro' });
        }
      }
    }
  });

  const gruposFocalizacion = [
    { nombre: 'Tiene emprendimiento', valor: nEmprendimiento },
    { nombre: 'Jefatura de hogar', valor: nJefeHogar },
    { nombre: 'Emprendimiento formalizado SII', valor: nFormalizadoSII },
    { nombre: 'Persona cuidadora', valor: nCuidador },
    { nombre: 'Programa Mujeres Jefas de Hogar (PMJH)', valor: nPMJH },
    { nombre: 'Situación de discapacidad', valor: nDiscapacidad }
  ].filter(function(g) { return g.valor > 0; }).sort(function(a, b) { return b.valor - a.valor; });

  return {
    poblacionEvaluada: etiquetaPoblacion || 'Asistentes efectivos',
    totalEvaluados: ids.length,
    personasConPerfilBaseMadre: conPerfil,
    coberturaPerfil: ids.length ? conPerfil / ids.length : 0,
    porNivelEducacional: webAgruparConteo_(listaEdu, 'valor'),
    porSituacionOcupacional: webAgruparConteo_(listaOcup, 'valor'),
    porTramoRSH: webOrdenarTramosRSH_(webAgruparConteo_(listaRSH, 'valor')),
    gruposFocalizacion: gruposFocalizacion,
    porFormalizacionSII: webAgruparConteo_(listaSII, 'valor'),
    porRubroEmprendimiento: webAgruparConteo_(listaRubro, 'valor').slice(0, 10)
  };
}

/** Reporte filtrado calculado en servidor: separa Inscritos vs. Asistentes, Embudo, Recurrencia, Demanda y Perfil Socioeconómico. */
function obtenerReporteEstadistico(filtros) {
  try {
    filtros = filtros || {};
    const ss = sigcSpreadsheetCentral_();
    const personasRaw = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS);
    const pmjhPorId = {};
    const personas = personasRaw.map(function(p) {
      const idP = String(p.ID_PERSONA || '').trim();
      const pmjh = sigcNormalizarSiNo(p.PARTICIPA_PMJH, 'No informado');
      if (idP) pmjhPorId[idP] = pmjh;
      return {
        ID_PERSONA: idP,
        GENERO: p.GENERO || 'No informado',
        FECHA_NACIMIENTO: p.FECHA_NACIMIENTO || '',
        EDAD: webCalcularEdad_(p.FECHA_NACIMIENTO),
        COMUNA: p.COMUNA || '',
        BARRIO: p.BARRIO || '',
        NACIONALIDAD: p.NACIONALIDAD || '',
        PARTICIPA_PMJH: pmjh
      };
    });
    const todasActividades = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
    const todasParticipacionesRaw = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
    const coincide = function(valor, filtro) {
      return !filtro || sigcNormalizarClave(valor) === sigcNormalizarClave(filtro);
    };
    const actividades = todasActividades.filter(function(a) {
      if (!filtros.estado && webEsActividadArchivada_(a)) return false;
      return coincide(a.ANO, filtros.ano) &&
        coincide(a.ESCUELA_LINEA || a.PROGRAMA, filtros.escuelaLinea) &&
        coincide(a.AREA_TEMATICA, filtros.areaTematica) &&
        coincide(a.INSTITUCION_ASOCIADA, filtros.institucion) &&
        coincide(a.MODALIDAD, filtros.modalidad) &&
        coincide(a.ESTADO_ACTIVIDAD, filtros.estado);
    });
    const idsActividad = new Set(actividades.map(function(a) { return String(a.ID_ACTIVIDAD || ''); }));
    const participacionesTodasEnriq = webEnriquecerParticipaciones_(todasParticipacionesRaw, personas, todasActividades);
    const participaciones = participacionesTodasEnriq.filter(function(p) {
      return idsActividad.has(String(p.ID_ACTIVIDAD || '')) && webEsRegistroActivo_(p);
    });

    const seleccionadas = participaciones.filter(function(p) {
      return sigcEsSeleccionado(p) || webEsAsistenteReal_(p);
    });
    const confirmadas = participaciones.filter(webEsParticipacionConfirmada_);
    const asistentes = participaciones.filter(webEsAsistenteReal_);
    const aprobadas = participaciones.filter(function(p) {
      const r = sigcNormalizarResultado(p.RESULTADO_FINAL);
      return r === 'Aprobado' || r === 'Participó';
    });
    const certificados = participaciones.filter(function(p) {
      return sigcNormalizarSiNo(p.CERTIFICADO, 'No') === 'Sí';
    });
    const cupos = actividades.reduce(function(s, a) { return s + (Number(a.CUPOS) || 0); }, 0);
    const unicasInscritas = new Set(participaciones.map(function(p) { return String(p.ID_PERSONA || ''); }).filter(Boolean));
    const unicasAsistentes = new Set(asistentes.map(function(p) { return String(p.ID_PERSONA || ''); }).filter(Boolean));

    const hojaIntereses = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
    const intereses = hojaIntereses ? webLeerTablaConCache_(ss, hojaIntereses.getName()) : [];
    const interesesFiltrados = intereses.filter(function(i) {
      return sigcNormalizarClave(i.ESTADO_INTERES || 'Activo') !== 'inactivo' &&
        coincide(i.ESCUELA_LINEA, filtros.escuelaLinea) &&
        coincide(i.AREA_TEMATICA, filtros.areaTematica);
    });

    // Análisis rápido de demanda con omitirDetalle = true para evitar ordenar miles de textos
    const analisisDemanda = webConstruirAnalisisDemanda_(personas, interesesFiltrados, actividades, participaciones, todasActividades, participacionesTodasEnriq, true);
    const coberturaMapa = webMapaCoberturaPersonaArea_(todasActividades, participacionesTodasEnriq);

    const tasaAsistencia = seleccionadas.length ? asistentes.length / seleccionadas.length : 0;
    const demografiaInscritos = webConstruirDemografia_(participaciones);
    const demografiaAsistentes = webConstruirDemografia_(asistentes);
    const comparativaDemografica = webConstruirComparativaDemografica_(demografiaInscritos, demografiaAsistentes);
    const trayectoria = webConstruirEmbudoYTrayectoria_(participaciones, interesesFiltrados, coberturaMapa);

    const idsSocio = unicasAsistentes.size > 0 ? unicasAsistentes : unicasInscritas;
    const etiquetaSocio = unicasAsistentes.size > 0 ? 'Asistentes efectivos' : 'Inscritos (actividades aún sin asistencia)';
    const socioeconomico = webConstruirPerfilSocioeconomico_(ss, idsSocio, pmjhPorId, etiquetaSocio);
    const mapaPerfilesTodos = webLeerPerfilesSocioeconomicosLigero_(ss);
    const idsBaseMadre = new Set(Object.keys(mapaPerfilesTodos));
    const socioeconomicoBaseMadre = webConstruirPerfilSocioeconomico_(ss, idsBaseMadre, pmjhPorId, 'Base Madre completa');

    const hojaEval = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.EVALUACIONES || 'EVALUACIONES_SATISFACCION');
    const evaluacionesTodas = hojaEval ? webLeerTablaConCache_(ss, hojaEval.getName()) : [];
    const evaluacionesFiltradas = evaluacionesTodas.filter(function(ev) {
      return idsActividad.has(String(ev.ID_ACTIVIDAD || '')) && webEsRegistroActivo_(ev);
    });
    const resumenSatRaw = webCalcularResumenSatisfaccion_(evaluacionesFiltradas);
    const resumenSatGlobal = {
      totalEncuestas: resumenSatRaw.totalEncuestas || 0,
      promedioGeneral: resumenSatRaw.promedioGeneral || 0,
      porcentajeSatisfaccion: resumenSatRaw.porcentajeSatisfaccion || 0,
      promedioRelator: resumenSatRaw.promedioRelator || 0,
      promedioContenidos: resumenSatRaw.promedioContenidos || 0,
      promedioOrganizacion: resumenSatRaw.promedioOrganizacion || 0
    };

    const participacionesPorAct = {};
    participaciones.forEach(function(p) {
      const k = String(p.ID_ACTIVIDAD || '');
      if (!participacionesPorAct[k]) participacionesPorAct[k] = [];
      participacionesPorAct[k].push(p);
    });
    const evalsPorAct = {};
    evaluacionesFiltradas.forEach(function(ev) {
      const k = String(ev.ID_ACTIVIDAD || '');
      if (!evalsPorAct[k]) evalsPorAct[k] = [];
      evalsPorAct[k].push(ev);
    });

    const salida = {
      ok: true,
      fechaActualizacion: Utilities.formatDate(new Date(), WEBAPP_CONFIG.ZONA_HORARIA, 'dd-MM-yyyy HH:mm:ss'),
      indicadores: {
        actividades: actividades.length,
        personasUnicas: unicasInscritas.size,
        asistentesUnicos: unicasAsistentes.size,
        inscripciones: participaciones.length,
        seleccionadas: seleccionadas.length,
        confirmadas: confirmadas.length,
        asistentes: asistentes.length,
        aprobadas: aprobadas.length,
        certificadas: certificados.length,
        cupos: cupos,
        ocupacion: cupos ? seleccionadas.length / cupos : 0,
        seleccion: participaciones.length ? seleccionadas.length / participaciones.length : 0,
        tasaConfirmacion: seleccionadas.length ? confirmadas.length / seleccionadas.length : 0,
        asistencia: tasaAsistencia,
        inasistencia: seleccionadas.length ? 1 - tasaAsistencia : 0,
        aprobacion: asistentes.length ? aprobadas.length / asistentes.length : 0,
        certificacion: asistentes.length ? certificados.length / asistentes.length : 0,
        personasRecurrentes: trayectoria.personasRecurrentes,
        tasaRecurrencia: trayectoria.tasaRecurrencia,
        promedioCursosPorAsistente: trayectoria.promedioCursosPorAsistente,
        tasaOrigenBaseMadre: trayectoria.tasaOrigenBaseMadre,
        demandaRegistrada: analisisDemanda.resumen.personasConDemanda,
        interesesActivos: analisisDemanda.resumen.interesesActivos,
        demandasAtendidas: analisisDemanda.resumen.demandasAtendidas,
        personasCapacitadas: unicasAsistentes.size,
        brechaDemanda: analisisDemanda.resumen.demandasPendientes,
        coberturaDemanda: analisisDemanda.resumen.cobertura,
        satisfaccionPromedio: resumenSatGlobal.promedioGeneral,
        satisfaccionPorcentaje: resumenSatGlobal.porcentajeSatisfaccion,
        totalEncuestas: resumenSatGlobal.totalEncuestas
      },
      satisfaccionGlobal: resumenSatGlobal,
      porTematica: webAgruparConteo_(actividades.map(function(a) { return { valor: a.AREA_TEMATICA ? webCapitalizarPalabras_(a.AREA_TEMATICA) : 'Sin área' }; }), 'valor'),
      porInstitucion: webAgruparConteo_(actividades.map(function(a) { return { valor: webNormalizarInstitucionCategoria_(a.INSTITUCION_ASOCIADA) }; }), 'valor'),
      porModalidad: webAgruparConteo_(actividades.map(function(a) { return { valor: webNormalizarModalidadCategoria_(a.MODALIDAD) }; }), 'valor'),
      porGenero: demografiaAsistentes.porGenero,
      porTramoEdad: demografiaAsistentes.porTramoEdad,
      porComuna: demografiaAsistentes.porComuna,
      porPMJH: demografiaAsistentes.porPMJH,
      demografia: demografiaAsistentes,
      demografiaInscritos: demografiaInscritos,
      demografiaAsistentes: demografiaAsistentes,
      comparativaDemografica: comparativaDemografica,
      socioeconomico: socioeconomico,
      socioeconomicoBaseMadre: socioeconomicoBaseMadre,
      embudo: trayectoria.embudo,
      recurrenciaAsistentes: trayectoria.recurrenciaAsistentes,
      recurrenciaInscritos: trayectoria.recurrenciaInscritos,
      origenAsistentes: trayectoria.origenAsistentes,
      trayectoriaPersonas: (trayectoria.trayectoriaPersonas || []).slice(0, 600),
      demanda: {
        resumen: analisisDemanda.resumen,
        filas: analisisDemanda.filas,
        demografiaDemandantes: analisisDemanda.demografiaDemandantes,
        demografiaPendientes: analisisDemanda.demografiaPendientes
      },
      actividades: actividades.map(function(a) {
        const idA = String(a.ID_ACTIVIDAD || '');
        const grupo = participacionesPorAct[idA] || [];
        const evalsAct = evalsPorAct[idA] || [];
        const satAct = webCalcularResumenSatisfaccion_(evalsAct);
        const cuposAct = Number(a.CUPOS) || 0;
        const selAct = grupo.filter(function(p) { return sigcEsSeleccionado(p) || webEsAsistenteReal_(p); }).length;
        const confAct = grupo.filter(webEsParticipacionConfirmada_).length;
        const asisAct = grupo.filter(webEsAsistenteReal_).length;
        const aprobAct = grupo.filter(function(p) {
          const rf = sigcNormalizarResultado(p.RESULTADO_FINAL);
          return rf === 'Aprobado' || rf === 'Participó';
        }).length;
        const certAct = grupo.filter(function(p) { return sigcNormalizarSiNo(p.CERTIFICADO, 'No') === 'Sí'; }).length;
        return {
          ID_ACTIVIDAD: idA,
          NOMBRE_ACTIVIDAD: String(a.NOMBRE_ACTIVIDAD || ''),
          ANO: String(a.ANO || ''),
          ESCUELA_LINEA: String(a.ESCUELA_LINEA || a.PROGRAMA || ''),
          AREA_TEMATICA: String(a.AREA_TEMATICA || ''),
          INSTITUCION_ASOCIADA: String(a.INSTITUCION_ASOCIADA || ''),
          MODALIDAD: String(a.MODALIDAD || ''),
          ESTADO_ACTIVIDAD: String(a.ESTADO_ACTIVIDAD || ''),
          CUPOS: cuposAct,
          INSCRIPCIONES: grupo.length,
          SELECCIONADAS: selAct,
          CONFIRMADAS: confAct,
          ASISTENTES: asisAct,
          APROBADAS: aprobAct,
          CERTIFICADAS: certAct,
          TASA_OCUPACION: cuposAct ? selAct / cuposAct : 0,
          TASA_ASISTENCIA: selAct ? asisAct / selAct : 0,
          ENCUESTAS: satAct.totalEncuestas || 0,
          NOTA_SATISFACCION: satAct.promedioGeneral || 0,
          PORCENTAJE_SATISFACCION: satAct.porcentajeSatisfaccion || 0
        };
      })
    };
    return JSON.parse(JSON.stringify(salida));
  } catch (errRep) {
    console.error('Error en obtenerReporteEstadistico: ' + errRep.message);
    return {
      ok: false,
      error: true,
      mensaje: 'Error al calcular reporte: ' + errRep.message
    };
  }
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
 * Helper para verificar si un registro de participación está confirmado.
 */
function webEsParticipacionConfirmada_(p) {
  if (!p) return false;
  const raw = String(p.CONFIRMA_PARTICIPACION || '').trim();
  const c = sigcNormalizarClave(raw);
  if (['si', 'sí', 's', 'yes', '1', 'true'].indexOf(c) >= 0) return true;
  if (/confirmad|confirmo|asistira|asistirá/.test(c)) return true;
  return sigcNormalizarSiNo(raw, 'No informado') === 'Sí';
}

/**
 * Segmenta destinatarios para comunicaciones. No envía correos: solo entrega
 * la lista que la interfaz copiará para CCO.
 */
function obtenerDestinatariosComunicacion(filtros) {
  filtros = filtros || {};
  const ss = sigcSpreadsheetCentral_();
  // Se fuerza lectura fresca para evitar desincronizaciones con cambios recién guardados
  const personas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS, true);
  const actividades = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  const participaciones = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PARTICIPACIONES, true)
    .filter(webEsRegistroActivo_);
  const hojaIntereses = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.INTERESES || 'INTERESES_CAPACITACION');
  const intereses = hojaIntereses ? webLeerTablaConCache_(ss, hojaIntereses.getName(), true) : [];
  const personasPorId = webIndexar_(personas, 'ID_PERSONA');
  const actividadesPorId = webIndexar_(actividades, 'ID_ACTIVIDAD');
  const fuente = String(filtros.fuente || 'actividad');
  const ids = new Set();
  const pendientePorId = {};
  const ordenRecientePorId = {};
  const participacionInfoPorId = {};

  function registrarFechaReciente(idPersona, valor) {
    const numero = webFechaNumero_(valor);
    if (!idPersona || !numero) return;
    ordenRecientePorId[idPersona] = Math.max(ordenRecientePorId[idPersona] || 0, numero);
  }

  if (fuente === 'actividad') {
    const idActividad = String(filtros.idActividad || '').trim();
    const grupo = String(filtros.grupo || 'Confirmados').trim();
    participaciones.forEach(function(p) {
      if (String(p.ID_ACTIVIDAD || '').trim() !== idActividad) return;
      if (grupo === 'Seleccionados' && !sigcEsSeleccionado(p)) return;
      if (grupo === 'Confirmados' && !webEsParticipacionConfirmada_(p)) return;
      if (grupo === 'Asistentes') {
        const resFinal = sigcNormalizarClave(p.RESULTADO_FINAL || '');
        const esAsistente = webNumeroNoNegativo_(p.SESIONES_ASISTIDAS, 0) > 0 ||
          resFinal === 'aprobado' || resFinal === 'participo' || resFinal === 'asistio' || resFinal === 'asistió';
        if (!esAsistente) return;
      }
      const idPersona = String(p.ID_PERSONA || p.ID_PARTICIPACION || '').trim();
      if (!idPersona) return;
      ids.add(idPersona);
      if (!participacionInfoPorId[idPersona]) {
        participacionInfoPorId[idPersona] = p;
      }
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
      const idPersona = String(interes.ID_PERSONA || '').trim();
      if (!idPersona) return;
      const claveArea = webClaveArea_(interes.ESCUELA_LINEA, interes.AREA_TEMATICA);
      const capacitada = !!(cobertura[idPersona] && cobertura[idPersona][claveArea]);
      if (filtros.soloPendientes && capacitada) return;
      ids.add(idPersona);
      pendientePorId[idPersona] = !capacitada;
      registrarFechaReciente(idPersona, interes.FECHA_REGISTRO || interes.ULTIMA_ACTUALIZACION);
    });
  } else {
    personas.forEach(function(persona) {
      const idPersona = String(persona.ID_PERSONA || '').trim();
      if (idPersona) ids.add(idPersona);
    });
  }

  const comuna = sigcNormalizarClave(filtros.comuna);
  const soloAutorizados = filtros.soloAutorizados === true;
  const destinatarios = Array.from(ids).map(function(idPersona) {
    const persona = personasPorId[idPersona] || {};
    const part = participacionInfoPorId[idPersona] || {};
    const correo = sigcNormalizarCorreo(persona.CORREO || part.CORREO);
    return {
      ID_PERSONA: idPersona,
      NOMBRE_COMPLETO: persona.NOMBRE_COMPLETO || part.NOMBRE_COMPLETO || 'Sin nombre',
      CORREO: correo,
      TELEFONO: persona.TELEFONO || part.TELEFONO || '',
      COMUNA: persona.COMUNA || part.COMUNA || '',
      AUTORIZA_CONTACTO: sigcNormalizarSiNo(persona.AUTORIZA_CONTACTO || part.AUTORIZA_CONTACTO, 'No informado'),
      DEMANDA_PENDIENTE: pendientePorId[idPersona] === true ? 'Sí' : (pendientePorId[idPersona] === false ? 'No' : ''),
      ORDEN_RECIENTE: ordenRecientePorId[idPersona] || webFechaNumero_(
        persona.FECHA_REGISTRO || persona.ULTIMA_ACTUALIZACION || part.FECHA_INSCRIPCION
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
      const p = fila.datos;
      const personaExistente = {
        id: p.ID_PERSONA,
        rut: p.RUT,
        tipoDocumento: p.TIPO_DOCUMENTO,
        numeroDocumento: p.NUMERO_DOCUMENTO,
        nombre: p.NOMBRE_COMPLETO,
        correo: p.CORREO,
        telefono: p.TELEFONO,
        nacionalidad: p.NACIONALIDAD
      };
      const personaNueva = {
        rut: rut,
        tipoDocumento: documento.tipo,
        numeroDocumento: documento.numero,
        nombre: nombre,
        correo: correo,
        telefono: telefono,
        nacionalidad: nacionalidad
      };
      return sigcSonMismaPersona(personaExistente, personaNueva);
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
      const p = fila.datos;
      const tipoOtro = sigcNormalizarTipoDocumento(p.TIPO_DOCUMENTO, p.RUT);
      const numeroOtro = sigcNormalizarDocumento(tipoOtro, p.NUMERO_DOCUMENTO, p.RUT);
      const rutOtro = sigcNormalizarRut(p.RUT || (tipoOtro === 'RUT' ? numeroOtro : ''));
      const rutEditado = documento.tipo === 'RUT' ? documento.numero : '';
      if (rutEditado && rutOtro && (rutEditado === rutOtro || sigcRutsCoincidentes(rutEditado, rutOtro))) {
        return true;
      }
      return tipoOtro === 'Pasaporte' &&
        numeroOtro === documento.numero &&
        sigcNormalizarClave(p.NACIONALIDAD) === sigcNormalizarClave(nacionalidad);
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
    const anio = Math.trunc(
      webNumeroNoNegativo_(datos.ANO, new Date().getFullYear())
    );
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
    const fechaIni = String(datos.FECHA_INICIO || '').trim();
    const fechaFin = String(datos.FECHA_TERMINO || '').trim();
    const mesIni = sigcNormalizarTexto(datos.MES_INICIO) || webMesDesdeFecha_(fechaIni);
    const mesFin = sigcNormalizarTexto(datos.MES_TERMINO) || webMesDesdeFecha_(fechaFin);
    const modalidadNorm = webNormalizarModalidadCategoria_(datos.MODALIDAD || 'Presencial');
    const cuposVal = (datos.CUPOS !== '' && datos.CUPOS !== null && datos.CUPOS !== undefined)
      ? Math.max(0, Math.trunc(Number(datos.CUPOS) || 0))
      : '';
    const nuevaActividad = {
      ID_ACTIVIDAD: id,
      NOMBRE_ACTIVIDAD: sigcNormalizarTexto(datos.NOMBRE_ACTIVIDAD),
      TIPO_ACTIVIDAD: sigcNormalizarTexto(datos.TIPO_ACTIVIDAD),
      PROGRAMA: sigcNormalizarTexto(datos.PROGRAMA),
      ESCUELA_LINEA: sigcNormalizarTexto(datos.ESCUELA_LINEA),
      AREA_TEMATICA: sigcNormalizarTexto(datos.AREA_TEMATICA),
      ANO: anio,
      MES_INICIO: mesIni,
      MES_TERMINO: mesFin,
      FECHA_INICIO: fechaIni,
      FECHA_TERMINO: fechaFin,
      HORARIO: sigcNormalizarTexto(datos.HORARIO),
      DETALLE_SESIONES: detalleSesiones === '[]' ? '' : detalleSesiones,
      SESIONES_TOTALES: Math.max(1, Number(datos.SESIONES_TOTALES || 1)),
      PORCENTAJE_APROBACION: regla === 'Porcentaje'
        ? sigcConvertirPorcentaje(datos.PORCENTAJE_APROBACION || 0.8)
        : '',
      REGLA_RESULTADO: regla,
      CUPOS: cuposVal,
      REQUIERE_SELECCION: sigcNormalizarSiNo(
        datos.REQUIERE_SELECCION,
        'No'
      ),
      MODALIDAD: modalidadNorm,
      INSTITUCION_ASOCIADA: sigcNormalizarTexto(datos.INSTITUCION_ASOCIADA),
      RESPONSABLE: sigcNormalizarTexto(datos.RESPONSABLE),
      ESTADO_ACTIVIDAD: sigcNormalizarTexto(datos.ESTADO_ACTIVIDAD) || 'Planificada',
      CARPETA_DRIVE: sigcNormalizarTexto(datos.CARPETA_DRIVE),
      OBSERVACIONES: sigcNormalizarTexto(datos.OBSERVACIONES),
      LINK_INSCRIPCION: String(datos.LINK_INSCRIPCION || '').trim(),
      REQUISITOS: sigcNormalizarTexto(datos.REQUISITOS),
      DESCRIPCION_CORTA: sigcNormalizarTexto(datos.DESCRIPCION_CORTA)
    };
    try {
      webAgregarFilaPorEncabezados_(hoja, tabla.encabezados, nuevaActividad);
    } catch (errInsert) {
      // Si Google Sheets bloquea por una validación de datos estricta heredada (ej. lista desplegable),
      // se flexibiliza la validación en la fila destino y se reintenta la escritura.
      if (/validaci[oó]n|validation/i.test(String(errInsert && errInsert.message || ''))) {
        const filaDestino = hoja.getLastRow() + 1;
        hoja.getRange(filaDestino, 1, 1, tabla.encabezados.length).clearDataValidations();
        webAgregarFilaPorEncabezados_(hoja, tabla.encabezados, nuevaActividad);
      } else {
        throw errInsert;
      }
    }
    try {
      webIntentarSincronizarCalendarApp_(hoja, tabla.encabezados, hoja.getLastRow(), nuevaActividad);
    } catch (eCal) {}
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
      MODALIDAD: webNormalizarModalidadCategoria_(datos.MODALIDAD || 'Presencial'),
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
    try {
      webIntentarSincronizarCalendarApp_(hojaActividades, tablaActividades.encabezados, filaActividad.numeroFila, actividadActualizada);
    } catch (eCal) {}
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
      FECHA_INSCRIPCION: webCeldaAString_(nuevaParticipacion.FECHA_INSCRIPCION),
      FECHA_NOTIFICACION: webCeldaAString_(nuevaParticipacion.FECHA_NOTIFICACION),
      FECHA_CERTIFICACION: webCeldaAString_(nuevaParticipacion.FECHA_CERTIFICACION),
      ULTIMA_ACTUALIZACION: webCeldaAString_(nuevaParticipacion.ULTIMA_ACTUALIZACION),
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
function obtenerGestionActividad(idActividad, forzarFresca) {
  webValidarObjeto_(
    {ID_ACTIVIDAD: idActividad},
    ['ID_ACTIVIDAD']
  );
  try { purgarRegistrosFantasmaCapacitacion_(); } catch (ePurge) {}
  const idActStr = String(idActividad || '').trim();
  const ss = sigcSpreadsheetCentral_();
  const actividad = webBuscarRegistro_(
    ss,
    WEBAPP_CONFIG.HOJAS.ACTIVIDADES,
    'ID_ACTIVIDAD',
    idActStr
  );
  if (!actividad) throw new Error('No se encontró la actividad seleccionada.');

  const sesionesOficiales = Math.max(1, Number(actividad.SESIONES_TOTALES || 1));

  // 1. Leer matriz cruda de PARTICIPACIONES y filtrar SOLO las filas de esta actividad (evita construir miles de objetos)
  const hojaPart = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
  if (!hojaPart) throw new Error('No se encontró la hoja PARTICIPACIONES.');
  let valoresPart = hojaPart.getDataRange().getValues();
  if (valoresPart.length < 2) {
    return {
      actividad: actividad,
      participaciones: [],
      resumen: { inscritos: 0, cupos: Number(actividad.CUPOS || 0), vacantes: Number(actividad.CUPOS || 0) || 'Sin límite', seleccionados: 0, confirmados: 0, asistentes: 0, aprobados: 0 }
    };
  }

  let encPart = valoresPart[0].map(function(v) { return String(v || '').trim(); });
  let colIdAct = encPart.indexOf('ID_ACTIVIDAD');
  let colRegActivo = encPart.indexOf('REGISTRO_ACTIVO');
  let colSesTot = encPart.indexOf('SESIONES_TOTALES');
  if (colIdAct < 0) {
    encPart.forEach(function(h, idx) {
      const n = sigcNormalizarEncabezado(h);
      if (n === 'ID ACTIVIDAD') colIdAct = idx;
      if (n === 'REGISTRO ACTIVO') colRegActivo = idx;
      if (n === 'SESIONES TOTALES') colSesTot = idx;
    });
  }

  // Verificar solo en las filas de esta actividad si alguna tiene SESIONES_TOTALES desincronizadas
  let requiereRepararSesiones = false;
  for (let i = 1; i < valoresPart.length; i++) {
    const fila = valoresPart[i];
    if (String(fila[colIdAct] || '').trim() !== idActStr) continue;
    if (colRegActivo >= 0 && sigcNormalizarSiNo(fila[colRegActivo], 'Sí') === 'No') continue;
    if (colSesTot >= 0 && Number(fila[colSesTot] || 0) !== sesionesOficiales) {
      requiereRepararSesiones = true;
      break;
    }
  }

  if (requiereRepararSesiones) {
    try {
      corregirYSincronizarSesionesParticipaciones(idActStr);
      valoresPart = hojaPart.getDataRange().getValues();
    } catch (eCorr) {
      console.warn('Advertencia al sincronizar sesiones de participaciones: ' + eCorr.message);
    }
  }

  const participacionesAct = [];
  const idsPersonasSet = new Set();
  for (let i = 1; i < valoresPart.length; i++) {
    const fila = valoresPart[i];
    if (String(fila[colIdAct] || '').trim() !== idActStr) continue;
    if (colRegActivo >= 0 && sigcNormalizarSiNo(fila[colRegActivo], 'Sí') === 'No') continue;
    const objPart = webObjetoDesdeFilaRapida_(encPart, fila);
    participacionesAct.push(objPart);
    const idPer = String(objPart.ID_PERSONA || '').trim();
    if (idPer) idsPersonasSet.add(idPer);
  }

  // 2. Detectar historial de penalizaciones ("Confirmó pero no asistió" en capacitaciones anteriores)
  //    con regla de Rectificación (Opción 1): si la persona participa y cumple/asiste regularmente
  //    en una actividad posterior, su penalización activa queda subsanada.
  const inasistenciasConfirmadasPorPersona = {};
  const rectificacionesPorPersona = {};
  if (idsPersonasSet.size > 0) {
    let colIdPerPart = encPart.indexOf('ID_PERSONA');
    let colConfPart = encPart.indexOf('CONFIRMA_PARTICIPACION');
    let colSesAsisPart = encPart.indexOf('SESIONES_ASISTIDAS');
    let colSesTotPart = encPart.indexOf('SESIONES_TOTALES');
    let colResAsisPart = encPart.indexOf('RESULTADO_ASISTENCIA');
    let colResFinPart = encPart.indexOf('RESULTADO_FINAL');
    let colFechaInsPart = encPart.indexOf('FECHA_INSCRIPCION');
    encPart.forEach(function(h, idx) {
      const n = sigcNormalizarEncabezado(h);
      if (colIdPerPart < 0 && n === 'ID PERSONA') colIdPerPart = idx;
      if (colConfPart < 0 && n === 'CONFIRMA PARTICIPACION') colConfPart = idx;
      if (colSesAsisPart < 0 && n === 'SESIONES ASISTIDAS') colSesAsisPart = idx;
      if (colSesTotPart < 0 && n === 'SESIONES TOTALES') colSesTotPart = idx;
      if (colResAsisPart < 0 && n === 'RESULTADO ASISTENCIA') colResAsisPart = idx;
      if (colResFinPart < 0 && n === 'RESULTADO FINAL') colResFinPart = idx;
      if (colFechaInsPart < 0 && n === 'FECHA INSCRIPCION') colFechaInsPart = idx;
    });

    const actividadesLista = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES) || [];
    const actividadesPorIdMap = {};
    const hoyTexto = Utilities.formatDate(new Date(), SIGC_CONFIG.ZONA_HORARIA || 'America/Santiago', 'yyyy-MM-dd');
    const hoyNum = webFechaNumero_(hoyTexto);

    actividadesLista.forEach(function(actItem) {
      const k = String(actItem.ID_ACTIVIDAD || '').trim();
      if (!k) return;
      const estAct = sigcNormalizarEncabezado(actItem.ESTADO_ACTIVIDAD || '');
      const fIniNum = webFechaNumero_(actItem.FECHA_INICIO || actItem.FECHA_TERMINO || '');
      const fFinNum = webFechaNumero_(actItem.FECHA_TERMINO || actItem.FECHA_INICIO || '');
      const yaOcurrio = ['EJECUTADA', 'CERRADA'].indexOf(estAct) >= 0 || (fFinNum > 0 && hoyNum > 0 && fFinNum < hoyNum);
      const numId = Number(k.replace(/\D/g, '')) || 0;
      actividadesPorIdMap[k] = {
        nombre: String(actItem.NOMBRE_ACTIVIDAD || k),
        yaOcurrio: yaOcurrio,
        fechaOrden: fIniNum || fFinNum || 0,
        numId: numId,
        sesionesTotales: Number(actItem.SESIONES_TOTALES || 1),
        porcentajeAprobacion: sigcConvertirPorcentaje(actItem.PORCENTAJE_APROBACION) || 0.75
      };
    });

    const eventosPorPersona = {};
    for (let i = 1; i < valoresPart.length; i++) {
      const fila = valoresPart[i];
      const idPerFila = colIdPerPart >= 0 ? String(fila[colIdPerPart] || '').trim() : '';
      if (!idPerFila || !idsPersonasSet.has(idPerFila)) continue;
      const idActFila = String(fila[colIdAct] || '').trim();
      if (!idActFila || idActFila === idActStr) continue;
      if (colRegActivo >= 0 && sigcNormalizarSiNo(fila[colRegActivo], 'Sí') === 'No') continue;

      const infoActOtra = actividadesPorIdMap[idActFila];
      const etiquetaAct = infoActOtra ? (idActFila + ' (' + infoActOtra.nombre + ')') : idActFila;
      const confirmoSi = colConfPart >= 0 && sigcNormalizarSiNo(fila[colConfPart], 'No informado') === 'Sí';
      const asistidasFila = colSesAsisPart >= 0 ? Number(fila[colSesAsisPart] || 0) : 0;
      const totalesFila = Number((colSesTotPart >= 0 && fila[colSesTotPart]) || (infoActOtra && infoActOtra.sesionesTotales) || 1);
      const resAsisFila = colResAsisPart >= 0 ? sigcNormalizarEncabezado(fila[colResAsisPart]) : '';
      const resFila = colResFinPart >= 0 ? sigcNormalizarResultado(fila[colResFinPart]) : '';

      const esInasistenciaConfirmada =
        confirmoSi &&
        asistidasFila === 0 &&
        (resFila === 'No participó' || resFila === 'Desaprobado' || (infoActOtra && infoActOtra.yaOcurrio));

      const porcMin = (infoActOtra && infoActOtra.porcentajeAprobacion) || 0.75;
      const cumplePorSesiones = asistidasFila > 0 && totalesFila > 0 && (asistidasFila / totalesFila) >= porcMin;
      const esCumplimientoRegular =
        resFila === 'Aprobado' ||
        resFila === 'Participó' ||
        resAsisFila === 'CUMPLE' ||
        (asistidasFila > 0 && resFila !== 'Desaprobado' && resFila !== 'No participó' && (cumplePorSesiones || totalesFila <= 1));

      if (!esInasistenciaConfirmada && !esCumplimientoRegular) continue;

      const fInsNum = colFechaInsPart >= 0 ? webFechaNumero_(fila[colFechaInsPart]) : 0;
      const fechaOrden = (infoActOtra && infoActOtra.fechaOrden) || fInsNum || 0;
      const numId = (infoActOtra && infoActOtra.numId) || Number(idActFila.replace(/\D/g, '')) || 0;

      if (!eventosPorPersona[idPerFila]) eventosPorPersona[idPerFila] = [];
      eventosPorPersona[idPerFila].push({
        idAct: idActFila,
        etiqueta: etiquetaAct,
        tipo: esCumplimientoRegular ? 'RECTIFICACION' : 'FALTA',
        fechaOrden: fechaOrden,
        numId: numId,
        ordenFila: i
      });
    }

    Object.keys(eventosPorPersona).forEach(function(idPerKey) {
      const eventos = eventosPorPersona[idPerKey];
      eventos.sort(function(a, b) {
        if (a.fechaOrden !== b.fechaOrden) return a.fechaOrden - b.fechaOrden;
        if (a.numId !== b.numId) return a.numId - b.numId;
        if (a.tipo !== b.tipo) return a.tipo === 'FALTA' ? -1 : 1;
        return a.ordenFila - b.ordenFila;
      });

      let faltasActivas = [];
      let todasLasFaltasPrevias = [];
      let ultimaRectificacion = '';

      eventos.forEach(function(ev) {
        if (ev.tipo === 'FALTA') {
          if (faltasActivas.indexOf(ev.etiqueta) < 0) faltasActivas.push(ev.etiqueta);
          if (todasLasFaltasPrevias.indexOf(ev.etiqueta) < 0) todasLasFaltasPrevias.push(ev.etiqueta);
        } else if (ev.tipo === 'RECTIFICACION') {
          if (faltasActivas.length > 0) {
            faltasActivas = [];
            ultimaRectificacion = ev.etiqueta;
          }
        }
      });

      inasistenciasConfirmadasPorPersona[idPerKey] = faltasActivas;
      if (faltasActivas.length === 0 && ultimaRectificacion && todasLasFaltasPrevias.length > 0) {
        rectificacionesPorPersona[idPerKey] = {
          rectificada: true,
          actividadRectificadora: ultimaRectificacion,
          faltasSubsanadas: todasLasFaltasPrevias.join(' · ')
        };
      }
    });
  }

  // 3. Obtener personas mediante caché de alto rendimiento en memoria para las personas inscritas
  const personasPorId = {};
  if (idsPersonasSet.size > 0) {
    const listaPersonas = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.PERSONAS, Boolean(forzarFresca)) || [];
    for (let j = 0; j < listaPersonas.length; j++) {
      const p = listaPersonas[j];
      const idP = String(p.ID_PERSONA || '').trim();
      if (idP && idsPersonasSet.has(idP)) {
        personasPorId[idP] = p;
      }
    }
  }

  const participaciones = participacionesAct
    .filter(function(participacion) {
      const idPerKey = String(participacion.ID_PERSONA || '').trim();
      const persona = personasPorId[idPerKey] || {};
      const nom = String(persona.NOMBRE_COMPLETO || '').trim();
      const rut = String(persona.RUT || '').trim();
      if (/^CAP-\d{4}-\d+/i.test(nom) || /^ACT-\d+/i.test(nom) || (/^2026\d{3}-/i.test(rut) && /^CAP-/i.test(nom))) {
        return false;
      }
      return true;
    })
    .map(function(participacion) {
      const idPerKey = String(participacion.ID_PERSONA || '').trim();
      const persona = personasPorId[idPerKey] || {};
      const tipo = sigcNormalizarTipoDocumento(
        persona.TIPO_DOCUMENTO,
        persona.RUT
      );
      const documento = sigcNormalizarDocumento(
        tipo,
        persona.NUMERO_DOCUMENTO,
        persona.RUT
      );
      const histInasistencias = inasistenciasConfirmadasPorPersona[idPerKey] || [];
      const infoRect = rectificacionesPorPersona[idPerKey] || null;
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
        TELEFONO: persona.TELEFONO || '',
        PENALIZADO_INASISTENCIA: histInasistencias.length > 0,
        CANTIDAD_INASISTENCIAS_CONFIRMADAS: histInasistencias.length,
        DETALLE_INASISTENCIAS_CONFIRMADAS: histInasistencias.join(' · '),
        PENALIZACION_RECTIFICADA: Boolean(infoRect && infoRect.rectificada),
        DETALLE_RECTIFICACION: infoRect ? ('Rectificó asistiendo regularmente en ' + infoRect.actividadRectificadora + ' (falta previa subsanada: ' + infoRect.faltasSubsanadas + ')') : ''
      });
    })
    .sort(function(a, b) {
      const penA = Number(a.CANTIDAD_INASISTENCIAS_CONFIRMADAS || 0);
      const penB = Number(b.CANTIDAD_INASISTENCIAS_CONFIRMADAS || 0);
      if ((penA > 0) !== (penB > 0)) {
        return penA > 0 ? 1 : -1; // Personas que confirmaron y no asistieron quedan SIEMPRE al final
      }
      if (penA !== penB) {
        return penA - penB; // Quien tiene más inasistencias confirmadas queda más abajo
      }
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
    confirmados: participaciones.filter(function(participacion) {
      return sigcNormalizarSiNo(
        participacion.CONFIRMA_PARTICIPACION,
        'No informado'
      ) === 'Sí';
    }).length,
    asistentes: participaciones.filter(function(participacion) {
      return webNumeroNoNegativo_(
        participacion.SESIONES_ASISTIDAS,
        0
      ) > 0;
    }).length,
    aprobados: participaciones.filter(function(participacion) {
      return sigcNormalizarResultado(
        participacion.RESULTADO_FINAL
      ) === 'Aprobado' || sigcNormalizarResultado(participacion.RESULTADO_FINAL) === 'Participó';
    }).length
  };
  const hojaEvalGestion = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.EVALUACIONES || 'EVALUACIONES_SATISFACCION');
  const evalsActividad = hojaEvalGestion
    ? webLeerTablaConCache_(ss, hojaEvalGestion.getName()).filter(function(ev) {
        return String(ev.ID_ACTIVIDAD || '').trim() === String(idActividad).trim() && webEsRegistroActivo_(ev);
      })
    : [];
  const satisfaccionResumen = webCalcularResumenSatisfaccion_(evalsActividad);
  resumen.satisfaccionPromedio = satisfaccionResumen.promedioGeneral;
  resumen.satisfaccionPorcentaje = satisfaccionResumen.porcentajeSatisfaccion;
  resumen.totalEncuestas = satisfaccionResumen.totalEncuestas;
  return {
    actividad: actividad,
    participaciones: participaciones,
    resumen: resumen,
    satisfaccion: satisfaccionResumen
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
 * Ejecuta la depuración y unificación manual de personas duplicadas desde la Web App.
 */
function depurarDuplicadosPersonasWeb() {
  return depurarDuplicadosPersonas();
}
/**
 * Analiza los postulantes de una o más actividades origen para traspaso hacia una actividad destino.
 */
function obtenerResumenTraspasoActividadWeb(idsOrigen, idDestino, soloSinParticipacion) {
  if (!idsOrigen || (Array.isArray(idsOrigen) && !idsOrigen.length) || !idDestino) {
    throw new Error('Debe especificar al menos una actividad de origen y la actividad de destino.');
  }
  return obtenerResumenTraspasoActividad(idsOrigen, idDestino, soloSinParticipacion !== false);
}
/**
 * Ejecuta el traspaso de postulantes no seleccionados o en lista de espera hacia una nueva actividad.
 */
function ejecutarTraspasoPostulantesWeb(payload) {
  if (!payload) throw new Error('Datos de traspaso no proporcionados.');
  const origenes = Array.isArray(payload.idsOrigen) && payload.idsOrigen.length
    ? payload.idsOrigen
    : (payload.idOrigen ? [payload.idOrigen] : []);
  if (!origenes.length || !payload.idDestino) {
    throw new Error('Debe especificar al menos una actividad de origen y la actividad de destino.');
  }
  payload.idsOrigen = origenes;
  return traspasarPostulantesActividad(payload);
}
/**
 * Guarda selección, asistencia y resultados de forma masiva.
 */
function guardarGestionMasiva(payload) {
  if (!payload || !Array.isArray(payload.registros) || !payload.registros.length) {
    throw new Error('No hay registros para guardar.');
  }
  // 1. Lecturas de contexto previas FUERA del candado para minimizar el tiempo de bloqueo
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

  // 2. Adquirir candado exclusivamente para la lectura-modificación-escritura de PARTICIPACIONES
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    Utilities.sleep(600);
    lock.waitLock(20000);
  }
  let cantidadActualizados = 0;
  try {
    const rango = hoja.getDataRange();
    const valores = rango.getValues();
    if (valores.length < 2) throw new Error('La hoja PARTICIPACIONES no contiene registros.');
    const encabezados = valores[0].map(function(valor) { return String(valor).trim(); });
    if (encabezados.map(sigcNormalizarEncabezado).indexOf('ASISTENCIA SESIONES') < 0) {
      webAsegurarEncabezadosParticipaciones_(hoja, encabezados);
    }
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

        if (total < 1) total = 1;
        if (asistidas > total) total = asistidas;
        let cumple = sigcNormalizarCumple(registro.CUMPLE_REQUISITOS);
        let seleccion = sigcNormalizarSeleccion(registro.ESTADO_SELECCION);
        const confirmaNorm = sigcNormalizarSiNo(registro.CONFIRMA_PARTICIPACION, 'No informado');

        // Regla de confiabilidad 1: Si confirma "No", liberar el cupo automáticamente si estaba Seleccionado
        if (confirmaNorm === 'No' && seleccion === 'Seleccionado') {
          seleccion = 'No seleccionado';
          asistidas = 0;
          asistSesiones = '';
        }
        // Regla de confiabilidad 2: Si tiene asistencia (>0) o confirma "Sí" y estaba Pendiente, promover a Seleccionado para no perder su asistencia
        if ((asistidas > 0 || confirmaNorm === 'Sí') && (seleccion === 'Pendiente' || seleccion === 'No informado')) {
          seleccion = 'Seleccionado';
        }
        // Evitar rechazo de todo el lote si se seleccionó a alguien que tenía Cumple = No
        if (cumple === 'No' && seleccion === 'Seleccionado') {
          cumple = 'Sí';
        }
        // Las personas descartadas (No seleccionado / Lista de espera) no conservan asistencia
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
          CONFIRMA_PARTICIPACION: confirmaNorm,
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
    cantidadActualizados = filasActualizadas.length;
  } finally {
    try { lock.releaseLock(); } catch (eLock) {}
  }

  // 3. Operaciones secundarias (caché y log) FUERA del candado para no bloquear a otros usuarios o formularios
  try {
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.PARTICIPACIONES);
  } catch (eCache) {}
  try {
    sigcRegistrarLog(
      'ACTUALIZACION MASIVA',
      'PARTICIPACION',
      payload.idActividad,
      cantidadActualizados + ' registros modificados mediante guardado selectivo.'
    );
  } catch (eLog) {}

  return {
    ok: true,
    actualizados: cantidadActualizados,
    mensaje: 'Se guardaron ' + cantidadActualizados + ' participaciones correctamente.'
  };
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

/** Mapa ID_PERSONA -> área -> true cuando la capacitación fue efectiva o tuvo asistencia real. */
function webMapaCoberturaPersonaArea_(actividades, participaciones) {
  const actividadesPorId = webIndexar_(actividades.filter(function(actividad) {
    return !webEsActividadArchivada_(actividad);
  }), 'ID_ACTIVIDAD');
  const cobertura = {};
  participaciones.filter(webEsRegistroActivo_).forEach(function(p) {
    if (!webEsParticipacionEfectivaReal_(p)) return;
    const actividad = actividadesPorId[p.ID_ACTIVIDAD] || {};
    const lineaAct = actividad.ESCUELA_LINEA || actividad.PROGRAMA;
    if (!lineaAct || !actividad.AREA_TEMATICA) return;
    const idPersona = String(p.ID_PERSONA || '');
    if (!idPersona) return;
    if (!cobertura[idPersona]) cobertura[idPersona] = {};
    cobertura[idPersona][webClaveArea_(lineaAct, actividad.AREA_TEMATICA)] = true;
  });
  return cobertura;
}

function webConstruirAnalisisDemanda_(personas, intereses, actividades, participaciones, actividadesCobertura, participacionesCobertura, omitirDetalle) {
  const personasPorId = webIndexar_(personas, 'ID_PERSONA');
  const cobertura = webMapaCoberturaPersonaArea_(
    actividadesCobertura || actividades,
    participacionesCobertura || participaciones
  );
  const areas = {};
  const detalle = [];
  const indiceDetallePorClave = {};
  const personasConDemanda = new Set();
  const personasConDemandaPendiente = new Set();

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
        inscritosTotalesOferta: 0,
        asistentesTotalesOferta: 0,
        cuposOfertados: 0,
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
    else personasConDemandaPendiente.add(idPersona);
    if (omitirDetalle) return;
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
        COMUNA: webNormalizarComunaCategoria_(persona.COMUNA),
        BARRIO: webNormalizarBarrioCategoria_(persona.BARRIO),
        GENERO: webNormalizarGeneroCategoria_(persona.GENERO),
        EDAD: persona.EDAD !== undefined && persona.EDAD !== '' ? persona.EDAD : webCalcularEdad_(persona.FECHA_NACIMIENTO),
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
    const lineaAct = actividad.ESCUELA_LINEA || actividad.PROGRAMA;
    if (!lineaAct || !actividad.AREA_TEMATICA) return;
    const ag = asegurarArea(lineaAct, actividad.AREA_TEMATICA);
    const idAct = String(actividad.ID_ACTIVIDAD || '');
    if (idAct && !ag.actividades.has(idAct)) {
      ag.actividades.add(idAct);
      ag.cuposOfertados += Number(actividad.CUPOS || 0);
    }
  });
  participaciones.filter(webEsRegistroActivo_).forEach(function(p) {
    const actividad = actividadesPorId[p.ID_ACTIVIDAD] || {};
    const lineaAct = actividad.ESCUELA_LINEA || actividad.PROGRAMA;
    if (!lineaAct || !actividad.AREA_TEMATICA) return;
    const agrupacion = asegurarArea(lineaAct, actividad.AREA_TEMATICA);
    agrupacion.inscritosTotalesOferta++;
    if (webEsAsistenteReal_(p)) agrupacion.asistentesTotalesOferta++;
    const idPersona = String(p.ID_PERSONA || '');
    if (!idPersona) return;
    // El embudo de Demanda considera a quienes declararon ese mismo interés.
    if (!agrupacion.demandantes.has(idPersona)) return;
    agrupacion.inscritos.add(idPersona);
    if (sigcEsSeleccionado(p) || webEsAsistenteReal_(p)) agrupacion.seleccionados.add(idPersona);
  });

  const filas = Object.keys(areas).map(function(clave) {
    const item = areas[clave];
    const demanda = item.demandantes.size;
    const capacitadas = item.capacitadas.size;
    const cuposOf = item.cuposOfertados;
    return {
      CLAVE: clave,
      ESCUELA_LINEA: item.escuelaLinea,
      AREA_TEMATICA: item.areaTematica,
      DEMANDANTES: demanda,
      ACTIVIDADES_OFERTADAS: Array.from(item.actividades).filter(Boolean).length,
      CUPOS_OFERTADOS: cuposOf,
      PRESION_CUPOS: cuposOf > 0 ? demanda / cuposOf : null,
      INSCRITOS_OFERTA: item.inscritosTotalesOferta,
      ASISTENTES_OFERTA: item.asistentesTotalesOferta,
      INSCRITOS: item.inscritos.size,
      SELECCIONADOS: item.seleccionados.size,
      CAPACITADAS: capacitadas,
      PENDIENTES: Math.max(demanda - capacitadas, 0),
      COBERTURA: demanda ? capacitadas / demanda : 0
    };
  }).filter(function(item) {
    return item.DEMANDANTES > 0 || item.ACTIVIDADES_OFERTADAS > 0;
  }).sort(function(a, b) {
    return b.DEMANDANTES - a.DEMANDANTES || b.PENDIENTES - a.PENDIENTES || b.ASISTENTES_OFERTA - a.ASISTENTES_OFERTA;
  });

  const filasConDemanda = filas.filter(function(f) { return f.DEMANDANTES > 0; });
  const totalVinculos = filasConDemanda.reduce(function(total, fila) { return total + fila.DEMANDANTES; }, 0);
  const totalAtendidos = filasConDemanda.reduce(function(total, fila) { return total + fila.CAPACITADAS; }, 0);
  const porEscuela = {};
  filasConDemanda.forEach(function(fila) {
    porEscuela[fila.ESCUELA_LINEA] = (porEscuela[fila.ESCUELA_LINEA] || 0) + fila.DEMANDANTES;
  });
  const escuelas = Object.keys(porEscuela).map(function(nombre) {
    return {nombre: nombre, valor: porEscuela[nombre]};
  }).sort(function(a, b) { return b.valor - a.valor; });
  const areasRanking = filasConDemanda.map(function(fila) {
    return {
      nombre: fila.AREA_TEMATICA,
      escuela: fila.ESCUELA_LINEA,
      valor: fila.DEMANDANTES,
      capacitadas: fila.CAPACITADAS,
      pendientes: fila.PENDIENTES
    };
  }).sort(function(a, b) { return b.valor - a.valor; });

  const listaDemandantes = Array.from(personasConDemanda).map(function(idP) {
    return personasPorId[idP] || { ID_PERSONA: idP };
  });
  const listaPendientes = Array.from(personasConDemandaPendiente).map(function(idP) {
    return personasPorId[idP] || { ID_PERSONA: idP };
  });
  const demDemandantes = webConstruirDemografia_(listaDemandantes);
  const demPendientes = webConstruirDemografia_(listaPendientes);

  return {
    resumen: {
      personasConDemanda: personasConDemanda.size,
      personasConDemandaPendiente: personasConDemandaPendiente.size,
      interesesActivos: totalVinculos,
      demandasAtendidas: totalAtendidos,
      demandasPendientes: Math.max(totalVinculos - totalAtendidos, 0),
      cobertura: totalVinculos ? totalAtendidos / totalVinculos : 0,
      escuelaMasDemandada: escuelas.length ? escuelas[0].nombre : '',
      areaMasDemandada: areasRanking.length ? areasRanking[0].nombre : ''
    },
    filas: filas,
    demografiaDemandantes: demDemandantes,
    demografiaPendientes: demPendientes,
    detalle: omitirDetalle ? [] : detalle.sort(function(a, b) {
      const dif = (b.ORDEN_RECIENTE || 0) - (a.ORDEN_RECIENTE || 0);
      if (dif !== 0) return dif;
      return String(a.NOMBRE_COMPLETO) < String(b.NOMBRE_COMPLETO) ? -1 : 1;
    }),
    graficos: {
      porEscuela: escuelas,
      rankingAreas: areasRanking.slice(0, 10),
      porGenero: demDemandantes.porGenero,
      porTramoEdad: demDemandantes.porTramoEdad,
      porComuna: demDemandantes.porComuna.slice(0, 10),
      porBarrioPendiente: demPendientes.porBarrio.slice(0, 10)
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
 * Caché en memoria viva durante la ejecución de la petición actual (0 ms).
 */
var _memoriaTablasRequest_ = (typeof _memoriaTablasRequest_ !== 'undefined') ? _memoriaTablasRequest_ : new Map();

/**
 * Almacenamiento seguro en CacheService con segmentación para tablas de cualquier tamaño.
 */
function sigcGuardarEnCache_(clave, datos, ttlSegundos) {
  try {
    const cache = CacheService.getScriptCache();
    const ttl = Math.min(ttlSegundos || 21600, 21600);
    if (Array.isArray(datos) && datos.length > 8000) return;
    const json = typeof datos === 'string' ? datos : JSON.stringify(datos);
    if (json.length > 1800000) return;
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
    _memoriaTablasRequest_.delete(clave);
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
    if (_memoriaTablasRequest_.has(clave)) {
      return _memoriaTablasRequest_.get(clave);
    }
    const cached = sigcObtenerDeCache_(clave);
    if (cached && Array.isArray(cached)) {
      _memoriaTablasRequest_.set(clave, cached);
      return cached;
    }
  }
  const datos = webLeerTabla_(ss, nombreHoja);
  if (datos && Array.isArray(datos)) {
    _memoriaTablasRequest_.set(clave, datos);
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
  try {
    const cache = CacheService.getScriptCache();
    cache.remove('SIGC_DASHBOARD_RESUMEN_V3');
    cache.remove('SIGC_DASHBOARD_RESUMEN_V4');
    cache.remove('SIGC_DASHBOARD_RESUMEN_V5');
    cache.remove('SIGC_DASHBOARD_RESUMEN_V6');
    cache.remove('SIGC_DASHBOARD_RESUMEN_V7');
    cache.put('SIGC_DASHBOARD_DIRTY', '1', 21600);
  } catch (e) {
    console.warn('Error al invalidar caché de dashboard: ' + e.message);
  }
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
  const seleccionadas = activasRegistro.filter(function(p) {
    return sigcEsSeleccionado(p) || Number(p.SESIONES_ASISTIDAS || 0) > 0 || ['Participó', 'Aprobado'].indexOf(sigcNormalizarResultado(p.RESULTADO_FINAL)) >= 0;
  });
  const resultadosDefinitivos = activasRegistro.filter(function(participacion) {
    return sigcEsResultadoDefinitivo(participacion.RESULTADO_FINAL);
  });
  const efectivas = activasRegistro.filter(function(participacion) {
    return ['Participó', 'Aprobado'].indexOf(
      sigcNormalizarResultado(participacion.RESULTADO_FINAL)
    ) >= 0;
  }).length;
  const actividadesPorId = webIndexar_(actividadesOperativas, 'ID_ACTIVIDAD');
  const evaluables = activasRegistro.filter(function(participacion) {
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
    ) === 'Aprobado' || sigcNormalizarResultado(participacion.RESULTADO_FINAL) === 'Participó';
  }).length;
  const participantes = resultadosDefinitivos.filter(function(participacion) {
    return ['Participó', 'Aprobado', 'Desaprobado'].indexOf(
      sigcNormalizarResultado(participacion.RESULTADO_FINAL)
    ) >= 0;
  }).length;
  const cupos = actividadesOperativas.reduce(function(s, a) { return s + (Number(a.CUPOS) || 0); }, 0);
  const asistentes = activasRegistro.filter(webEsAsistenteReal_);
  const certificados = activasRegistro.filter(function(p) { return sigcNormalizarSiNo(p.CERTIFICADO, 'No') === 'Sí'; });
  const inscritosUnicos = new Set(activasRegistro.map(function(p) { return String(p.ID_PERSONA || ''); }).filter(Boolean));
  const demandaPersonas = new Set((intereses || []).filter(function(i) {
    return sigcNormalizarClave(i.ESTADO_INTERES || 'Activo') !== 'inactivo';
  }).map(function(i) { return String(i.ID_PERSONA || ''); }).filter(Boolean));
  const capacitadas = new Set(asistentes.map(function(p) { return String(p.ID_PERSONA || ''); }).filter(Boolean));
  return {
    totalPersonas: personas.length,
    totalInscritosUnicos: inscritosUnicos.size,
    totalAsistentesUnicos: capacitadas.size,
    totalActividades: actividadesOperativas.length,
    actividadesActivas: activas,
    totalParticipaciones: activasRegistro.length,
    totalAsistencias: asistentes.length,
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

function webNormalizarGeneroCategoria_(valor) {
  const c = sigcNormalizarClave(valor);
  if (!c || c === 'no informado' || c === 'sin informacion' || c === 'na' || c === 'n a' || c.indexOf('prefiere no') >= 0 || c.indexOf('prefiero no') >= 0) {
    return 'No informado';
  }
  if (c.indexOf('mujer') >= 0 || c.indexOf('femen') >= 0 || c === 'f') return 'Femenino';
  if (c.indexOf('hombre') >= 0 || c.indexOf('mascul') >= 0 || c === 'm') return 'Masculino';
  return 'Otro';
}

function webCapitalizarPalabras_(texto) {
  return String(texto || '').trim().replace(/\s+/g, ' ').split(' ').map(function(w, idx) {
    const low = w.toLowerCase();
    if (idx > 0 && ['de', 'del', 'la', 'las', 'los', 'el', 'y', 'en'].indexOf(low) >= 0) return low;
    return low ? low.charAt(0).toUpperCase() + low.slice(1) : '';
  }).join(' ');
}

function webNormalizarComunaCategoria_(valor) {
  const c = sigcNormalizarClave(valor);
  if (!c || ['no informado', 'sin informacion', 'na', 'n a', 'sin comuna', 'ninguna', '-'].indexOf(c) >= 0) {
    return 'No informado';
  }
  const mapaComunas = {
    'santiago': 'Santiago', 'santiago centro': 'Santiago', 'stgo': 'Santiago', 'stgo centro': 'Santiago',
    'estacion central': 'Estación Central', 'maipu': 'Maipú', 'nunoa': 'Ñuñoa',
    'penalolen': 'Peñalolén', 'conchali': 'Conchalí', 'san joaquin': 'San Joaquín',
    'san ramon': 'San Ramón', 'curacavi': 'Curacaví', 'alhue': 'Alhué', 'maria pinto': 'María Pinto',
    'jose maria caro': 'Lo Espejo', 'puente alto': 'Puente Alto', 'la florida': 'La Florida',
    'san miguel': 'San Miguel', 'independencia': 'Independencia', 'recoleta': 'Recoleta',
    'quinta normal': 'Quinta Normal', 'pedro aguirre cerda': 'Pedro Aguirre Cerda',
    'providencia': 'Providencia', 'las condes': 'Las Condes', 'macul': 'Macul',
    'san bernardo': 'San Bernardo', 'quilicura': 'Quilicura', 'pudahuel': 'Pudahuel',
    'cerro navia': 'Cerro Navia', 'lo prado': 'Lo Prado', 'cerrillos': 'Cerrillos',
    'la cisterna': 'La Cisterna', 'el bosque': 'El Bosque', 'la granja': 'La Granja',
    'la pintana': 'La Pintana', 'lo espejo': 'Lo Espejo', 'renca': 'Renca', 'huechuraba': 'Huechuraba'
  };
  return mapaComunas[c] || webCapitalizarPalabras_(valor);
}

function webNormalizarBarrioCategoria_(valor) {
  let c = sigcNormalizarClave(valor);
  if (!c || ['no informado', 'sin informacion', 'na', 'n a', 'sin barrio', 'no se', 'ninguno', '-'].indexOf(c) >= 0) {
    return 'No informado';
  }
  if (c.indexOf('fuera de la comuna') >= 0 || c.indexOf('otra comuna') >= 0) return 'Fuera de Santiago';
  if (c.indexOf('otro sector') >= 0) return 'Otro sector de Santiago';
  c = c.replace(/^barrio\s+/, '').replace(/^sector\s+/, '').trim();
  const mapaBarrios = {
    'yungay': 'Yungay', 'franklin': 'Franklin', 'brasil': 'Brasil', 'meiggs': 'Meiggs',
    'lastarria': 'Lastarria', 'republica': 'República', 'ejercito': 'Ejército',
    'matta sur': 'Matta Sur', 'matta norte': 'Matta Norte', 'santa isabel': 'Santa Isabel',
    'parque ohiggins': "Parque O'Higgins", 'parque o higgins': "Parque O'Higgins",
    'parque almagro': 'Parque Almagro', 'paris londres': 'París - Londres',
    'santa lucia forestal': 'Santa Lucía - Forestal', 'concha y toro': 'Concha y Toro',
    'dieciocho': 'Dieciocho', 'huemul': 'Huemul', 'bogota': 'Bogotá',
    'san eugenio': 'San Eugenio', 'san vicente': 'San Vicente', 'san borja': 'San Borja',
    'san diego': 'San Diego', 'plaza de armas': 'Plaza de Armas', 'civico': 'Cívico',
    'arturo prat': 'Arturo Prat', 'balmaceda': 'Balmaceda', 'club hipico': 'Club Hípico',
    'panama': 'Panamá', 'viel': 'Viel'
  };
  return mapaBarrios[c] || webCapitalizarPalabras_(c);
}

function webNormalizarEstadoActividadCategoria_(valor) {
  const c = sigcNormalizarClave(valor);
  if (!c) return 'Planificada';
  if (c.indexOf('planific') >= 0) return 'Planificada';
  if (c.indexOf('difus') >= 0) return 'Difusión';
  if (c.indexOf('inscripc') >= 0) return 'Inscripción abierta';
  if (c.indexOf('ejecuc') >= 0) return 'En ejecución';
  if (c.indexOf('ejecutad') >= 0) return 'Ejecutada';
  if (c.indexOf('cerrad') >= 0) return 'Cerrada';
  if (c.indexOf('suspend') >= 0) return 'Suspendida';
  return webCapitalizarPalabras_(valor);
}

function webNormalizarEscuelaCategoria_(valor) {
  const c = sigcNormalizarClave(valor);
  if (!c) return 'Sin línea';
  if (c.indexOf('emprend') >= 0) return 'Emprendimiento';
  if (c.indexOf('empleo') >= 0 || c.indexOf('empleabil') >= 0) return 'Empleo';
  if (c.indexOf('transvers') >= 0 || c.indexOf('digital') >= 0) return 'Transversal';
  return webCapitalizarPalabras_(valor);
}

function webNormalizarModalidadCategoria_(valor) {
  const c = sigcNormalizarClave(valor);
  if (!c) return 'Presencial';
  if (c.indexOf('presenc') >= 0) return 'Presencial';
  if (c.indexOf('virtual') >= 0 || c.indexOf('online') >= 0 || c.indexOf('linea') >= 0) return 'Virtual';
  if (c.indexOf('hibrid') >= 0 || c.indexOf('mixta') >= 0 || c.indexOf('semipresenc') >= 0) return 'Híbrida';
  return webCapitalizarPalabras_(valor);
}

function webNormalizarInstitucionCategoria_(valor) {
  const c = sigcNormalizarClave(valor);
  if (!c || c === 'no informado' || c === 'sin institucion') return 'Sin institución / Interna';
  if (c.indexOf('sence') >= 0) return 'SENCE';
  if (c.indexOf('sercotec') >= 0) return 'SERCOTEC';
  if (c.indexOf('fosis') >= 0) return 'FOSIS';
  if (c.indexOf('ipchile') >= 0 || c.indexOf('ip chile') >= 0) return 'IPChile';
  if (c.indexOf('aiep') >= 0) return 'AIEP';
  if (c.indexOf('santiago') >= 0 || c.indexOf('didel') >= 0 || c.indexOf('municipal') >= 0) return 'Municipalidad de Santiago';
  return webCapitalizarPalabras_(valor);
}

function webNormalizarNacionalidadCategoria_(valor) {
  const c = sigcNormalizarClave(valor);
  if (!c || ['no informado', 'sin informacion', 'na', 'n a', '-'].indexOf(c) >= 0) {
    return 'No informado';
  }
  if (c.indexOf('chil') === 0) return 'Chilena';
  if (c.indexOf('venez') === 0) return 'Venezolana';
  if (c.indexOf('peru') === 0) return 'Peruana';
  if (c.indexOf('colomb') === 0) return 'Colombiana';
  if (c.indexOf('hait') === 0) return 'Haitiana';
  if (c.indexOf('boliv') === 0) return 'Boliviana';
  if (c.indexOf('ecuat') === 0 || c.indexOf('ecuad') === 0) return 'Ecuatoriana';
  if (c.indexOf('argent') === 0) return 'Argentina';
  if (c.indexOf('dominic') >= 0) return 'Dominicana';
  if (c.indexOf('cuban') === 0 || c === 'cuba') return 'Cubana';
  if (c.indexOf('brasil') === 0) return 'Brasileña';
  if (c.indexOf('paragu') === 0) return 'Paraguaya';
  if (c.indexOf('urugu') === 0) return 'Uruguaya';
  if (c.indexOf('mexic') === 0) return 'Mexicana';
  if (c.indexOf('espan') === 0) return 'Española';
  return webCapitalizarPalabras_(valor);
}

function webEsAsistenteReal_(p) {
  if (!p) return false;
  const ses = Number(p.SESIONES_ASISTIDAS || 0);
  const resF = sigcNormalizarResultado(p.RESULTADO_FINAL);
  const resA = sigcNormalizarTexto(p.RESULTADO_ASISTENCIA);
  return ses > 0 || ['Participó', 'Aprobado', 'Desaprobado'].indexOf(resF) >= 0 ||
    ['Participó', 'Asistió'].indexOf(resA) >= 0;
}

function webEsParticipacionEfectivaReal_(p) {
  if (!p) return false;
  const resF = sigcNormalizarResultado(p.RESULTADO_FINAL);
  if (['Participó', 'Aprobado'].indexOf(resF) >= 0) return true;
  return Number(p.SESIONES_ASISTIDAS || 0) > 0 && !sigcEsResultadoDefinitivo(p.RESULTADO_FINAL);
}

/** Demografía agregada sobre personas únicas; nunca devuelve PII directa. */
function webConstruirDemografia_(registros) {
  const porId = {};
  (registros || []).forEach(function(p, idx) {
    const id = String(p.ID_PERSONA || '').trim() || ('_ANON_' + idx);
    if (!porId[id]) {
      porId[id] = Object.assign({}, p);
    } else {
      ['GENERO', 'EDAD', 'COMUNA', 'BARRIO', 'NACIONALIDAD', 'PARTICIPA_PMJH'].forEach(function(k) {
        const act = porId[id][k];
        if ((act === '' || act === null || act === undefined || act === 'No informado') &&
            p[k] !== '' && p[k] !== null && p[k] !== undefined && p[k] !== 'No informado') {
          porId[id][k] = p[k];
        }
      });
    }
  });
  const personas = Object.keys(porId).map(function(id) { return porId[id]; });
  const edades = personas.map(function(p) {
    const e = webEdadNumeroValida_(p.EDAD !== undefined && p.EDAD !== '' ? p.EDAD : webCalcularEdad_(p.FECHA_NACIMIENTO));
    return e;
  }).filter(function(e) { return e !== null; }).sort(function(a, b) { return a - b; });
  const medianaEdad = edades.length
    ? (edades.length % 2 === 1
        ? edades[Math.floor(edades.length / 2)]
        : (edades[edades.length / 2 - 1] + edades[edades.length / 2]) / 2)
    : null;
  const porGenero = webAgruparConteo_(personas.map(function(p) { return {valor: webNormalizarGeneroCategoria_(p.GENERO)}; }), 'valor');
  const porTramoEdad = webAgruparTramosEdad_(personas.map(function(p) {
    return { EDAD: p.EDAD !== undefined && p.EDAD !== '' ? p.EDAD : webCalcularEdad_(p.FECHA_NACIMIENTO) };
  }));
  const porComuna = webAgruparConteo_(personas.map(function(p) { return {valor: webNormalizarComunaCategoria_(p.COMUNA)}; }), 'valor');
  const porBarrioTodos = webAgruparConteo_(personas.map(function(p) { return {valor: webNormalizarBarrioCategoria_(p.BARRIO)}; }), 'valor');
  const barriosInformados = porBarrioTodos.filter(function(x) { return x.nombre !== 'No informado'; });
  const porNacionalidad = webAgruparConteo_(personas.map(function(p) { return {valor: webNormalizarNacionalidadCategoria_(p.NACIONALIDAD)}; }), 'valor');
  const porPMJH = webAgruparConteo_(personas.map(function(p) { return {valor: p.PARTICIPA_PMJH || 'No informado'}; }), 'valor');

  const totalGeneroInf = porGenero.filter(function(x) { return x.nombre !== 'No informado'; }).reduce(function(s, x) { return s + x.valor; }, 0);
  const fem = (porGenero.find(function(x) { return x.nombre === 'Femenino'; }) || {valor: 0}).valor;
  const totalNacInf = porNacionalidad.filter(function(x) { return x.nombre !== 'No informado'; }).reduce(function(s, x) { return s + x.valor; }, 0);
  const chil = (porNacionalidad.find(function(x) { return x.nombre === 'Chilena'; }) || {valor: 0}).valor;
  const totalComInf = porComuna.filter(function(x) { return x.nombre !== 'No informado'; }).reduce(function(s, x) { return s + x.valor; }, 0);
  const stgo = (porComuna.find(function(x) { return x.nombre === 'Santiago'; }) || {valor: 0}).valor;

  return {
    totalPersonas: personas.length,
    personasConDatoEdad: edades.length,
    edadPromedio: edades.length ? edades.reduce(function(s, e) { return s + e; }, 0) / edades.length : null,
    medianaEdad: medianaEdad,
    porcentajeFemenino: totalGeneroInf ? fem / totalGeneroInf : 0,
    porcentajeExtranjeros: totalNacInf ? Math.max(0, totalNacInf - chil) / totalNacInf : 0,
    porcentajeSantiago: totalComInf ? stgo / totalComInf : 0,
    porGenero: porGenero,
    porTramoEdad: porTramoEdad,
    porComuna: porComuna,
    porBarrio: barriosInformados.length ? barriosInformados : porBarrioTodos,
    porBarrioCompleto: porBarrioTodos,
    porNacionalidad: porNacionalidad,
    porPMJH: porPMJH
  };
}

function webConstruirSerieComparativa_(listaInscritos, listaAsistentes, limite, mantenerOrdenInscritos) {
  const mapaAsis = {};
  (listaAsistentes || []).forEach(function(x) { mapaAsis[x.nombre] = Number(x.valor || 0); });
  const base = (listaInscritos || []).map(function(x) {
    const ins = Number(x.valor || 0);
    const asis = mapaAsis[x.nombre] || 0;
    return {
      nombre: x.nombre,
      inscritos: ins,
      asistentes: asis,
      tasaAsistencia: ins > 0 ? asis / ins : 0
    };
  });
  if (!mantenerOrdenInscritos) {
    base.sort(function(a, b) { return b.inscritos - a.inscritos || b.asistentes - a.asistentes; });
  }
  return limite ? base.slice(0, limite) : base;
}

function webConstruirComparativaDemografica_(demInscritos, demAsistentes) {
  const ins = demInscritos || {};
  const asis = demAsistentes || {};
  return {
    porGenero: webConstruirSerieComparativa_(ins.porGenero, asis.porGenero, 0, true),
    porTramoEdad: webConstruirSerieComparativa_(ins.porTramoEdad, asis.porTramoEdad, 0, true),
    porComuna: webConstruirSerieComparativa_(ins.porComuna, asis.porComuna, 10, true),
    porBarrio: webConstruirSerieComparativa_(ins.porBarrio, asis.porBarrio, 10, true),
    porNacionalidad: webConstruirSerieComparativa_(ins.porNacionalidad, asis.porNacionalidad, 8, true)
  };
}

function webConstruirEmbudoYTrayectoria_(participacionesActivas, interesesActivos, coberturaMapa) {
  const lista = Array.isArray(participacionesActivas) ? participacionesActivas : [];
  const seleccionadas = lista.filter(function(p) {
    return sigcEsSeleccionado(p) || webEsAsistenteReal_(p);
  });
  const confirmadas = lista.filter(function(p) {
    return webEsParticipacionConfirmada_(p);
  });
  const asistentes = lista.filter(webEsAsistenteReal_);
  const efectivas = lista.filter(function(p) {
    return ['Participó', 'Aprobado'].indexOf(sigcNormalizarResultado(p.RESULTADO_FINAL)) >= 0;
  });
  const certificadas = lista.filter(function(p) {
    return sigcNormalizarSiNo(p.CERTIFICADO, 'No') === 'Sí';
  });

  const embudo = [
    { nombre: '1. Inscripciones', valor: lista.length },
    { nombre: '2. Seleccionadas', valor: seleccionadas.length },
    { nombre: '3. Confirmadas', valor: confirmadas.length },
    { nombre: '4. Asistentes (≥1 ses.)', valor: asistentes.length },
    { nombre: '5. Aprobadas / Participó', valor: efectivas.length },
    { nombre: '6. Certificadas', valor: certificadas.length }
  ];

  // Agrupación por persona única para trayectoria y recurrencia
  const demandaPorPersona = {};
  (interesesActivos || []).forEach(function(i) {
    const idP = String(i.ID_PERSONA || '').trim();
    if (!idP) return;
    demandaPorPersona[idP] = (demandaPorPersona[idP] || 0) + 1;
  });

  const porPersona = {};
  lista.forEach(function(p) {
    const idP = String(p.ID_PERSONA || '').trim();
    if (!idP) return;
    if (!porPersona[idP]) {
      porPersona[idP] = {
        ID_PERSONA: idP,
        GENERO: webNormalizarGeneroCategoria_(p.GENERO),
        EDAD: p.EDAD !== undefined && p.EDAD !== '' ? p.EDAD : webCalcularEdad_(p.FECHA_NACIMIENTO),
        COMUNA: webNormalizarComunaCategoria_(p.COMUNA),
        BARRIO: webNormalizarBarrioCategoria_(p.BARRIO),
        NACIONALIDAD: webNormalizarNacionalidadCategoria_(p.NACIONALIDAD),
        INSCRIPCIONES: 0,
        SELECCIONES: 0,
        ASISTENCIAS: 0,
        EFECTIVAS: 0,
        CERTIFICADOS: 0,
        DEMANDAS_DECLARADAS: demandaPorPersona[idP] || 0,
        DEMANDAS_CUBIERTAS: coberturaMapa && coberturaMapa[idP] ? Object.keys(coberturaMapa[idP]).length : 0
      };
    }
    const item = porPersona[idP];
    item.INSCRIPCIONES++;
    if (sigcEsSeleccionado(p) || webEsAsistenteReal_(p)) item.SELECCIONES++;
    if (webEsAsistenteReal_(p)) item.ASISTENCIAS++;
    if (['Participó', 'Aprobado'].indexOf(sigcNormalizarResultado(p.RESULTADO_FINAL)) >= 0) item.EFECTIVAS++;
    if (sigcNormalizarSiNo(p.CERTIFICADO, 'No') === 'Sí') item.CERTIFICADOS++;
  });

  const personasArr = Object.keys(porPersona).map(function(idP) { return porPersona[idP]; });
  const asistentesUnicosArr = personasArr.filter(function(x) { return x.ASISTENCIAS > 0; });
  const tramosRecAsis = { '1 capacitación': 0, '2 capacitaciones': 0, '3 capacitaciones': 0, '4 o más': 0 };
  const tramosRecIns = { '1 inscripción': 0, '2 inscripciones': 0, '3 inscripciones': 0, '4 o más': 0 };
  let recurrentesAsis = 0;
  let conBaseMadreAsis = 0;
  let conPertinenciaDemanda = 0;

  personasArr.forEach(function(x) {
    if (x.INSCRIPCIONES === 1) tramosRecIns['1 inscripción']++;
    else if (x.INSCRIPCIONES === 2) tramosRecIns['2 inscripciones']++;
    else if (x.INSCRIPCIONES === 3) tramosRecIns['3 inscripciones']++;
    else if (x.INSCRIPCIONES >= 4) tramosRecIns['4 o más']++;
  });

  asistentesUnicosArr.forEach(function(x) {
    if (x.ASISTENCIAS === 1) tramosRecAsis['1 capacitación']++;
    else if (x.ASISTENCIAS === 2) { tramosRecAsis['2 capacitaciones']++; recurrentesAsis++; }
    else if (x.ASISTENCIAS === 3) { tramosRecAsis['3 capacitaciones']++; recurrentesAsis++; }
    else if (x.ASISTENCIAS >= 4) { tramosRecAsis['4 o más']++; recurrentesAsis++; }
    if (x.DEMANDAS_DECLARADAS > 0) conBaseMadreAsis++;
    if (x.DEMANDAS_CUBIERTAS > 0) conPertinenciaDemanda++;
  });

  personasArr.sort(function(a, b) {
    return b.ASISTENCIAS - a.ASISTENCIAS || b.INSCRIPCIONES - a.INSCRIPCIONES;
  });

  return {
    embudo: embudo,
    inscritosUnicos: personasArr.length,
    asistentesUnicos: asistentesUnicosArr.length,
    personasRecurrentes: recurrentesAsis,
    tasaRecurrencia: asistentesUnicosArr.length ? recurrentesAsis / asistentesUnicosArr.length : 0,
    promedioCursosPorAsistente: asistentesUnicosArr.length ? asistentes.length / asistentesUnicosArr.length : 0,
    asistentesDesdeBaseMadre: conBaseMadreAsis,
    tasaOrigenBaseMadre: asistentesUnicosArr.length ? conBaseMadreAsis / asistentesUnicosArr.length : 0,
    asistentesConDemandaCubierta: conPertinenciaDemanda,
    recurrenciaAsistentes: Object.keys(tramosRecAsis).map(function(k) { return { nombre: k, valor: tramosRecAsis[k] }; }),
    recurrenciaInscritos: Object.keys(tramosRecIns).map(function(k) { return { nombre: k, valor: tramosRecIns[k] }; }),
    origenAsistentes: [
      { nombre: 'Con registro en Base Madre', valor: conBaseMadreAsis },
      { nombre: 'Inscripción directa a curso', valor: Math.max(0, asistentesUnicosArr.length - conBaseMadreAsis) }
    ],
    trayectoriaPersonas: personasArr.slice(0, 2000)
  };
}

function webConstruirGraficos_(actividades, participaciones, personas) {
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
  const asistentesReales = activas.filter(webEsAsistenteReal_);
  const seleccionadasDefinitivas = activas.filter(function(participacion) {
    return sigcEsSeleccionado(participacion) &&
      sigcEsResultadoDefinitivo(participacion.RESULTADO_FINAL);
  });
  const efectivas = activas.filter(function(participacion) {
    const resultado = sigcNormalizarResultado(participacion.RESULTADO_FINAL);
    return sigcEsSeleccionado(participacion) &&
      ['Participó', 'Aprobado'].indexOf(resultado) >= 0;
  });
  const personasBase = Array.isArray(personas) ? personas : [];
  const demBase = webConstruirDemografia_(personasBase);
  const demInscritos = webConstruirDemografia_(activas);
  const demAsistentes = webConstruirDemografia_(asistentesReales);
  const comparativa = webConstruirComparativaDemografica_(demInscritos, demAsistentes);
  const trayectoria = webConstruirEmbudoYTrayectoria_(activas, [], null);

  const insPorAct = webAgruparConteo_(activas, 'NOMBRE_ACTIVIDAD');
  const asisPorAct = webAgruparConteo_(asistentesReales, 'NOMBRE_ACTIVIDAD');
  const comparativaActividades = webConstruirSerieComparativa_(insPorAct, asisPorAct, 10, false);

  return {
    actividadesPorEstado: webAgruparConteo_(
      actividadesOperativas.map(function(a) { return { valor: webNormalizarEstadoActividadCategoria_(a.ESTADO_ACTIVIDAD) }; }),
      'valor'
    ),
    actividadesPorEscuela: webAgruparConteo_(
      actividadesOperativas.map(function(a) { return { valor: webNormalizarEscuelaCategoria_(a.ESCUELA_LINEA || a.PROGRAMA) }; }),
      'valor'
    ),
    actividadesPorArea: webAgruparConteo_(
      actividadesOperativas.map(function(a) { return { valor: a.AREA_TEMATICA ? webCapitalizarPalabras_(a.AREA_TEMATICA) : 'Sin área' }; }),
      'valor'
    ).slice(0, 10),
    resultados: webAgruparConteoNormalizadoResultados_(
      seleccionadasDefinitivas
    ),
    comparativaActividades: comparativaActividades,
    participacionesPorActividad: insPorAct.slice(0, 10),
    participacionEfectivaPorActividad: webAgruparConteo_(
      efectivas,
      'NOMBRE_ACTIVIDAD'
    ).slice(0, 10),
    embudoParticipacion: trayectoria.embudo,
    recurrenciaAsistentes: trayectoria.recurrenciaAsistentes,
    personasPorGenero: demBase.porGenero,
    personasPorTramoEdad: demBase.porTramoEdad,
    personasPorComuna: demBase.porComuna.slice(0, 10),
    personasPorNacionalidad: demBase.porNacionalidad.slice(0, 8),
    participantesPorGenero: demAsistentes.porGenero,
    inscritosPorGenero: demInscritos.porGenero,
    asistentesPorGenero: demAsistentes.porGenero,
    asistentesPorTramoEdad: demAsistentes.porTramoEdad,
    asistentesPorComuna: demAsistentes.porComuna.slice(0, 10),
    asistentesPorNacionalidad: demAsistentes.porNacionalidad.slice(0, 8),
    comparativaGenero: comparativa.porGenero,
    comparativaEdad: comparativa.porTramoEdad,
    comparativaComuna: comparativa.porComuna
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
  const filaValores = encabezados.map(function(encabezado) {
    const clave = sigcNormalizarEncabezado(encabezado);
    return Object.prototype.hasOwnProperty.call(normalizados, clave)
      ? normalizados[clave]
      : '';
  });
  try {
    hoja.appendRow(filaValores);
  } catch (errInsert) {
    if (/validaci[oó]n|validation/i.test(String(errInsert && errInsert.message || ''))) {
      const filaDestino = hoja.getLastRow() + 1;
      hoja.getRange(filaDestino, 1, 1, encabezados.length).clearDataValidations();
      hoja.appendRow(filaValores);
    } else {
      throw errInsert;
    }
  }
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
  try {
    rango.setValues([nueva]);
  } catch (errUpd) {
    if (/validaci[oó]n|validation/i.test(String(errUpd && errUpd.message || ''))) {
      rango.clearDataValidations();
      rango.setValues([nueva]);
    } else {
      throw errUpd;
    }
  }
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
  if (valor === null || valor === undefined || valor === '') return '';
  const partes = webPartesFechaNacimiento_(valor);
  if (webFechaNacimientoValida_(partes)) {
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
  const texto = String(valor || '').trim();
  const mEdad = texto.match(/^(\d{1,3})(?:\s*(?:a[ñn]os?|a\.?))?$/i);
  if (mEdad) {
    const edadDirecta = Number(mEdad[1]);
    if (edadDirecta >= 10 && edadDirecta <= 110) return edadDirecta;
  }
  const mAnio = texto.match(/^(19\d{2}|20[0-1]\d)$/);
  if (mAnio) {
    const dif = new Date().getFullYear() - Number(mAnio[1]);
    if (dif >= 10 && dif <= 110) return dif;
  }
  return '';
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
  if (!valor) return 0;
  if (valor instanceof Date) {
    return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate()).getTime();
  }
  const texto = String(valor || '').trim();
  if (!texto) return 0;
  let coincidencia = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (coincidencia) {
    return new Date(
      Number(coincidencia[1]),
      Number(coincidencia[2]) - 1,
      Number(coincidencia[3])
    ).getTime();
  }
  coincidencia = texto.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/
  );
  if (coincidencia) {
    return new Date(
      Number(coincidencia[3]),
      Number(coincidencia[2]) - 1,
      Number(coincidencia[1])
    ).getTime();
  }
  const fecha = new Date(texto);
  return isNaN(fecha.getTime()) ? 0 : new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime();
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
  ['HORARIO', 'DETALLE_SESIONES', 'LINK_INSCRIPCION', 'REQUISITOS', 'DESCRIPCION_CORTA', 'GOOGLE_CALENDAR_IDS'].forEach(function(col) {
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

/**
 * Sincroniza una actividad y sus sesiones con el Google Calendar de la cuenta si tiene permisos,
 * o devuelve los enlaces directos y datos listos para calendarizar.
 */
function sincronizarActividadGoogleCalendarWeb(idActividad) {
  const ss = sigcSpreadsheetCentral_();
  const hoja = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  if (!hoja) throw new Error('No se encontró la hoja ACTIVIDADES.');
  const tabla = webLeerTablaConFilas_(hoja);
  webAsegurarEncabezadosActividades_(hoja, tabla.encabezados);
  const filaAct = tabla.filas.find(function(f) {
    return String(f.datos.ID_ACTIVIDAD || '').trim() === String(idActividad || '').trim();
  });
  if (!filaAct) throw new Error('No se encontró la actividad: ' + idActividad);

  const act = filaAct.datos;
  const resultado = webIntentarSincronizarCalendarApp_(hoja, tabla.encabezados, filaAct.numeroFila, act);
  return resultado;
}

function webIntentarSincronizarCalendarApp_(hojaActividades, encabezados, numeroFila, act) {
  try {
    const calApp = globalThis['Calendar' + 'App'];
    if (!calApp) {
      return { ok: false, requiereEnlaceDirecto: true, mensaje: 'Use el botón directo de Google Calendar.' };
    }
    const cal = calApp.getDefaultCalendar();
    if (!cal) {
      return { ok: false, requiereEnlaceDirecto: true, mensaje: 'No se encontró calendario predeterminado.' };
    }

    // Eliminar eventos previos asociados a esta actividad para evitar duplicados al reprogramar
    const idsPreviosRaw = String(act.GOOGLE_CALENDAR_IDS || '').trim();
    if (idsPreviosRaw) {
      try {
        const idsPrevios = JSON.parse(idsPreviosRaw);
        if (Array.isArray(idsPrevios)) {
          idsPrevios.forEach(function(evId) {
            try {
              const ev = cal.getEventById(evId);
              if (ev) ev.deleteEvent();
            } catch (eDel) {}
          });
        }
      } catch (eParse) {}
    }

    const estadoNorm = sigcNormalizarEncabezado(act.ESTADO_ACTIVIDAD || '');
    if (['SUSPENDIDA', 'ARCHIVADA'].indexOf(estadoNorm) >= 0) {
      if (hojaActividades && numeroFila) {
        webActualizarFilaPorEncabezados_(hojaActividades, encabezados, numeroFila, { GOOGLE_CALENDAR_IDS: '' });
      }
      return { ok: true, eventosCreados: 0, mensaje: 'Actividad suspendida/archivada: eventos removidos de Google Calendar.' };
    }

    let sesiones = [];
    if (act.DETALLE_SESIONES) {
      try {
        sesiones = typeof act.DETALLE_SESIONES === 'string' ? JSON.parse(act.DETALLE_SESIONES) : act.DETALLE_SESIONES;
      } catch (e) { sesiones = []; }
    }

    // Si no cuenta con detalle de sesiones JSON pero tiene múltiples sesiones o rango de fechas,
    // reconstruir las sesiones individuales para que CalendarApp agende TODAS las fechas y no solo la primera.
    const matchHoras = String(act.HORARIO || '').match(/(\d{1,2}:\d{2}).*?(\d{1,2}:\d{2})/);
    const hIniDef = matchHoras ? matchHoras[1] : '10:00';
    const hFinDef = matchHoras ? matchHoras[2] : '12:00';

    if ((!Array.isArray(sesiones) || sesiones.length === 0) && act.FECHA_INICIO) {
      const tot = Math.max(1, Number(act.SESIONES_TOTALES || 1));
      if (act.FECHA_TERMINO && act.FECHA_TERMINO !== act.FECHA_INICIO && tot > 1) {
        const pIni = String(act.FECHA_INICIO).split('-');
        const pFin = String(act.FECHA_TERMINO).split('-');
        if (pIni.length === 3 && pFin.length === 3) {
          const dIni = new Date(Number(pIni[0]), Number(pIni[1]) - 1, Number(pIni[2]), 12, 0, 0);
          const dFin = new Date(Number(pFin[0]), Number(pFin[1]) - 1, Number(pFin[2]), 12, 0, 0);
          const diffDias = Math.round((dFin - dIni) / (24 * 60 * 60 * 1000));
          if (diffDias > 0) {
            sesiones = [];
            const paso = Math.max(1, Math.round(diffDias / (tot - 1)));
            for (let sIdx = 0; sIdx < tot; sIdx++) {
              const dCur = new Date(dIni.getTime() + Math.min(diffDias, sIdx * paso) * 24 * 60 * 60 * 1000);
              const y = dCur.getFullYear();
              const m = String(dCur.getMonth() + 1).padStart(2, '0');
              const d = String(dCur.getDate()).padStart(2, '0');
              sesiones.push({
                numero: sIdx + 1,
                fecha: y + '-' + m + '-' + d,
                horaInicio: hIniDef,
                horaFin: hFinDef
              });
            }
          }
        }
      }
    }

    const ubicacion = [act.MODALIDAD || 'Presencial', act.INSTITUCION_ASOCIADA].filter(Boolean).join(' · ');
    const descripcion = [
      '📌 Código SIGC: ' + (act.ID_ACTIVIDAD || ''),
      '🏫 Escuela / Línea: ' + (act.ESCUELA_LINEA || 'General') + (act.AREA_TEMATICA ? ' — ' + act.AREA_TEMATICA : ''),
      '👤 Responsable / Relator: ' + (act.RESPONSABLE || 'Equipo Capacitación DIDEL'),
      '👥 Cupos: ' + (act.CUPOS || 'Sin límite'),
      '⏰ Horario general: ' + (act.HORARIO || 'Según programación'),
      act.LINK_INSCRIPCION ? ('🔗 Enlace: ' + act.LINK_INSCRIPCION) : '',
      act.OBSERVACIONES ? ('📝 Observaciones: ' + act.OBSERVACIONES) : '',
      '',
      'Agendado automáticamente desde SIGC · Municipalidad de Santiago (DIDEL)'
    ].filter(Boolean).join('\n');

    const nuevosIds = [];

    function parseFechaHoraLocal_(fechaStr, horaStr, horaDefectoH, horaDefectoM) {
      const m = String(fechaStr || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) return null;
      let hh = horaDefectoH;
      let mm = horaDefectoM;
      const mh = String(horaStr || '').trim().match(/^(\d{1,2}):(\d{2})/);
      if (mh) {
        hh = Number(mh[1]);
        mm = Number(mh[2]);
      }
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm, 0);
    }

    if (Array.isArray(sesiones) && sesiones.length > 0) {
      sesiones.forEach(function(s) {
        if (!s || !s.fecha) return;
        const inicio = parseFechaHoraLocal_(s.fecha, s.horaInicio, 10, 0);
        let fin = parseFechaHoraLocal_(s.fecha, s.horaFin, 12, 0);
        if (!inicio) return;
        if (!fin || fin <= inicio) {
          fin = new Date(inicio.getTime() + 2 * 60 * 60 * 1000);
        }
        const titulo = '[' + (act.ID_ACTIVIDAD || 'CAP') + '] ' + (act.NOMBRE_ACTIVIDAD || 'Capacitación') +
          (sesiones.length > 1 ? ' (Sesión ' + (s.numero || 1) + '/' + sesiones.length + ')' : '');
        const ev = cal.createEvent(titulo, inicio, fin, {
          description: descripcion,
          location: ubicacion
        });
        if (ev && ev.getId()) nuevosIds.push(ev.getId());
      });
    } else if (act.FECHA_INICIO) {
      const inicio = parseFechaHoraLocal_(act.FECHA_INICIO, hIniDef, 10, 0);
      const finBase = parseFechaHoraLocal_(act.FECHA_TERMINO || act.FECHA_INICIO, hFinDef, 12, 0);
      if (inicio && finBase) {
        const fin = finBase <= inicio ? new Date(inicio.getTime() + 2 * 60 * 60 * 1000) : finBase;
        const titulo = '[' + (act.ID_ACTIVIDAD || 'CAP') + '] ' + (act.NOMBRE_ACTIVIDAD || 'Capacitación');
        const ev = cal.createEvent(titulo, inicio, fin, {
          description: descripcion,
          location: ubicacion
        });
        if (ev && ev.getId()) nuevosIds.push(ev.getId());
      }
    }

    if (hojaActividades && numeroFila && nuevosIds.length > 0) {
      webActualizarFilaPorEncabezados_(hojaActividades, encabezados, numeroFila, {
        GOOGLE_CALENDAR_IDS: JSON.stringify(nuevosIds)
      });
      sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
    }

    return {
      ok: true,
      eventosCreados: nuevosIds.length,
      mensaje: nuevosIds.length > 0
        ? 'Se agendaron ' + nuevosIds.length + ' sesión(es) en Google Calendar correctamente.'
        : 'La actividad no tiene fechas definidas para agendar en Google Calendar.'
    };
  } catch (e) {
    return {
      ok: false,
      requiereEnlaceDirecto: true,
      mensaje: 'Para agendar en su cuenta personal o institucional se abrirá el asistente directo de Google Calendar.'
    };
  }
}

/**
 * Registra en la hoja ACTIVIDADES que una actividad (o conjunto de actividades) fue calendarizada en Google Calendar.
 */
function marcarActividadCalendarizadaWeb(idActividad, agendada) {
  const ss = sigcSpreadsheetCentral_();
  const hoja = ss.getSheetByName(WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  if (!hoja) throw new Error('No se encontró la hoja ACTIVIDADES.');
  const tabla = webLeerTablaConFilas_(hoja);
  webAsegurarEncabezadosActividades_(hoja, tabla.encabezados);

  const idsLista = Array.isArray(idActividad)
    ? idActividad.map(function(x) { return String(x || '').trim(); }).filter(Boolean)
    : [String(idActividad || '').trim()].filter(Boolean);

  if (!idsLista.length) throw new Error('Debe indicar al menos una actividad.');
  const idsSet = new Set(idsLista);
  const marcaTiempo = Utilities.formatDate(new Date(), SIGC_CONFIG.ZONA_HORARIA || 'America/Santiago', 'yyyy-MM-dd HH:mm');
  let actualizadas = 0;

  tabla.filas.forEach(function(f) {
    const idAct = String(f.datos.ID_ACTIVIDAD || '').trim();
    if (!idsSet.has(idAct)) return;
    let valorGCal = '';
    if (agendada !== false) {
      const syncAuto = webIntentarSincronizarCalendarApp_(hoja, tabla.encabezados, f.numeroFila, f.datos);
      if (syncAuto && syncAuto.ok && syncAuto.eventosCreados > 0) {
        actualizadas++;
        return;
      }
      valorGCal = JSON.stringify(['AGENDADO-' + marcaTiempo]);
    }
    webActualizarFilaPorEncabezados_(hoja, tabla.encabezados, f.numeroFila, {
      GOOGLE_CALENDAR_IDS: valorGCal
    });
    actualizadas++;
  });

  if (actualizadas > 0) {
    sigcInvalidarCacheTabla_(WEBAPP_CONFIG.HOJAS.ACTIVIDADES);
  }

  return {
    ok: true,
    actualizadas: actualizadas,
    valorGCal: agendada !== false ? JSON.stringify(['AGENDADO-' + marcaTiempo]) : '',
    mensaje: agendada !== false
      ? (actualizadas === 1 ? 'Actividad marcada como calendarizada en Google Calendar.' : actualizadas + ' actividades marcadas como calendarizadas en Google Calendar.')
      : 'Estado de Google Calendar restablecido.'
  };
}


/* ============================================================================
 * SISTEMA DE EVALUACIÓN Y ENCUESTAS DE SATISFACCIÓN (FÍSICO, DIGITAL Y CONSOLIDADO)
 * ============================================================================ */

function asegurarHojaEvaluaciones_(ss) {
  ss = ss || sigcSpreadsheetCentral_();
  const nombreHoja = (WEBAPP_CONFIG && WEBAPP_CONFIG.HOJAS && WEBAPP_CONFIG.HOJAS.EVALUACIONES) || 'EVALUACIONES_SATISFACCION';
  let hoja = ss.getSheetByName(nombreHoja);
  const encabezados = [
    'ID_EVALUACION',
    'ID_ACTIVIDAD',
    'NOMBRE_ACTIVIDAD',
    'FECHA_REGISTRO',
    'CANAL',
    'CANTIDAD_RESPUESTAS',
    'NOTA_RELATOR',
    'NOTA_CONTENIDOS',
    'NOTA_ORGANIZACION',
    'NOTA_GLOBAL',
    'PROMEDIO_GENERAL',
    'PORCENTAJE_SATISFACCION',
    'RECOMIENDA',
    'LO_MAS_VALIOSO',
    'SUGERENCIAS',
    'FILA_ORIGEN',
    'REGISTRO_ACTIVO'
  ];
  if (!hoja) {
    hoja = ss.insertSheet(nombreHoja);
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, encabezados.length)
      .setFontWeight('bold')
      .setBackground('#173B57')
      .setFontColor('#FFFFFF');
  } else if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function webFormatearValor_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return '';
    return Utilities.formatDate(valor, (WEBAPP_CONFIG && WEBAPP_CONFIG.ZONA_HORARIA) || 'America/Santiago', 'dd-MM-yyyy HH:mm');
  }
  const texto = String(valor).trim();
  const fechaIntent = new Date(texto);
  if (!isNaN(fechaIntent.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(texto)) {
    return Utilities.formatDate(fechaIntent, (WEBAPP_CONFIG && WEBAPP_CONFIG.ZONA_HORARIA) || 'America/Santiago', 'dd-MM-yyyy HH:mm');
  }
  return texto;
}

function webFormatearNombreCapacitacion_(texto) {
  if (!texto) return '';
  let str = String(texto).replace(/[\r\n]+/g, ' ').trim();
  str = str.replace(/^CAP-\d{4}-\d+\s*[—–-]\s*/i, '').replace(/^ACT-\d+\s*[—–-]\s*/i, '').trim();
  str = str.replace(/\s*[—–-]\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/, '').trim();

  const letras = str.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '');
  const mayusculas = str.replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
  const esTodoMayus = letras.length > 3 && (mayusculas.length / letras.length) > 0.7;

  const siglas = ['DUOC', 'UDLA', 'IA', 'MIPE', 'PMJH', 'CANVA', 'TI', 'SGC', 'SIGC', 'RRHH', 'SII', 'RUT', 'DIDECO', 'DIDEL', 'Power BI', 'Excel'];

  if (esTodoMayus) {
    const minusculas = ['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'para', 'con', 'por', 'a', 'al', 'o', 'u'];
    const palabras = str.toLowerCase().split(' ');
    str = palabras.map(function(p, i) {
      if (!p) return '';
      const pUpper = p.toUpperCase();
      const matchSigla = siglas.find(function(s) { return s.toUpperCase() === pUpper; });
      if (matchSigla) return matchSigla;
      if (i > 0 && minusculas.indexOf(p) >= 0) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' ');
  } else {
    siglas.forEach(function(s) {
      const reg = new RegExp('\\b' + s + '\\b', 'gi');
      str = str.replace(reg, s);
    });
    if (str.length > 0) {
      str = str.charAt(0).toUpperCase() + str.slice(1);
    }
  }
  return str;
}

function webExtraerNotaEscala_(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number' && !isNaN(valor)) {
    return Math.min(5, Math.max(1, Number(valor)));
  }
  const texto = String(valor).trim().replace(',', '.');
  const match = texto.match(/([1-5](?:\.\d+)?)/);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num >= 1 && num <= 5) return num;
  }
  return 0;
}

function webCalcularResumenSatisfaccion_(registros) {
  const activos = (registros || []).filter(webEsRegistroActivo_);
  let totalEncuestas = 0;
  let encuestasDigitales = 0;
  let encuestasFisicas = 0;

  let sumaRelator = 0, pesoRelator = 0;
  let sumaContenidos = 0, pesoContenidos = 0;
  let sumaOrganizacion = 0, pesoOrganizacion = 0;
  let sumaGlobal = 0, pesoGlobal = 0;

  let recomiendaSi = 0;
  let recomiendaTalVez = 0;
  let recomiendaNo = 0;

  const detalleRegistros = [];

  activos.forEach(function(r) {
    const peso = Math.max(1, Number(r.CANTIDAD_RESPUESTAS || 1));
    totalEncuestas += peso;

    const canalStr = String(r.CANAL || 'Digital');
    if (sigcNormalizarClave(canalStr).indexOf('papel') >= 0 || sigcNormalizarClave(canalStr).indexOf('fisic') >= 0) {
      encuestasFisicas += peso;
    } else {
      encuestasDigitales += peso;
    }

    const nRel = webExtraerNotaEscala_(r.NOTA_RELATOR);
    const nCon = webExtraerNotaEscala_(r.NOTA_CONTENIDOS);
    const nOrg = webExtraerNotaEscala_(r.NOTA_ORGANIZACION);
    const nGlo = webExtraerNotaEscala_(r.NOTA_GLOBAL);

    if (nRel > 0) { sumaRelator += nRel * peso; pesoRelator += peso; }
    if (nCon > 0) { sumaContenidos += nCon * peso; pesoContenidos += peso; }
    if (nOrg > 0) { sumaOrganizacion += nOrg * peso; pesoOrganizacion += peso; }
    if (nGlo > 0) { sumaGlobal += nGlo * peso; pesoGlobal += peso; }

    const rec = sigcNormalizarClave(r.RECOMIENDA || 'Sí');
    if (rec.indexOf('no') === 0) {
      recomiendaNo += peso;
    } else if (rec.indexOf('tal') >= 0 || rec.indexOf('quiz') >= 0) {
      recomiendaTalVez += peso;
    } else {
      recomiendaSi += peso;
    }

    const notasValidas = [nRel, nCon, nOrg, nGlo].filter(function(n) { return n > 0; });
    const promFila = notasValidas.length
      ? Number((notasValidas.reduce(function(a, b) { return a + b; }, 0) / notasValidas.length).toFixed(2))
      : 0;

    detalleRegistros.push({
      ID_EVALUACION: String(r.ID_EVALUACION || ''),
      ID_ACTIVIDAD: String(r.ID_ACTIVIDAD || ''),
      FECHA_REGISTRO: webFormatearValor_(r.FECHA_REGISTRO),
      CANAL: canalStr,
      CANTIDAD_RESPUESTAS: peso,
      NOTA_RELATOR: nRel,
      NOTA_CONTENIDOS: nCon,
      NOTA_ORGANIZACION: nOrg,
      NOTA_GLOBAL: nGlo,
      PROMEDIO_GENERAL: Number(r.PROMEDIO_GENERAL || promFila || 0),
      PORCENTAJE_SATISFACCION: Number(r.PORCENTAJE_SATISFACCION || Math.round((promFila / 5) * 100) || 0),
      RECOMIENDA: String(r.RECOMIENDA || 'Sí'),
      LO_MAS_VALIOSO: String(r.LO_MAS_VALIOSO || ''),
      SUGERENCIAS: String(r.SUGERENCIAS || '')
    });
  });

  const promedioRelator = pesoRelator > 0 ? Number((sumaRelator / pesoRelator).toFixed(2)) : 0;
  const promedioContenidos = pesoContenidos > 0 ? Number((sumaContenidos / pesoContenidos).toFixed(2)) : 0;
  const promedioOrganizacion = pesoOrganizacion > 0 ? Number((sumaOrganizacion / pesoOrganizacion).toFixed(2)) : 0;
  const promedioGlobal = pesoGlobal > 0 ? Number((sumaGlobal / pesoGlobal).toFixed(2)) : 0;

  const dimensionesActivas = [promedioRelator, promedioContenidos, promedioOrganizacion, promedioGlobal].filter(function(n) { return n > 0; });
  const promedioGeneral = dimensionesActivas.length
    ? Number((dimensionesActivas.reduce(function(a, b) { return a + b; }, 0) / dimensionesActivas.length).toFixed(2))
    : 0;
  const porcentajeSatisfaccion = promedioGeneral > 0 ? Math.round((promedioGeneral / 5) * 100) : 0;
  const porcentajeRecomienda = totalEncuestas > 0 ? Math.round((recomiendaSi / totalEncuestas) * 100) : 0;

  return {
    totalRegistros: detalleRegistros.length,
    totalEncuestas: totalEncuestas,
    encuestasDigitales: encuestasDigitales,
    encuestasFisicas: encuestasFisicas,
    promedioRelator: promedioRelator,
    promedioContenidos: promedioContenidos,
    promedioOrganizacion: promedioOrganizacion,
    promedioGlobal: promedioGlobal,
    promedioGeneral: promedioGeneral,
    porcentajeSatisfaccion: porcentajeSatisfaccion,
    recomiendaSi: recomiendaSi,
    recomiendaTalVez: recomiendaTalVez,
    recomiendaNo: recomiendaNo,
    porcentajeRecomienda: porcentajeRecomienda,
    registros: detalleRegistros.reverse()
  };
}

/**
 * Verifica si una pestaña corresponde a una hoja de respuestas de Encuesta de Satisfacción.
 */
function esHojaRespuestasSatisfaccion_(hoja) {
  if (!hoja || hoja.getLastRow() < 1 || hoja.getLastColumn() < 3) return false;
  const nombreNorm = normalizarEncabezado_(hoja.getName());
  const hojasSistema = [
    'PERSONAS', 'ACTIVIDADES', 'PARTICIPACIONES', 'ASISTENCIA',
    'INTERESES CAPACITACION', 'EVALUACIONES SATISFACCION', 'CONFIG FORMULARIOS',
    'HISTORIAL IMPORTACIONES', 'CONTROL CALIDAD', 'LOGS'
  ];
  if (hojasSistema.indexOf(nombreNorm) >= 0) return false;
  try {
    const encs = hoja.getRange(1, 1, 1, Math.min(hoja.getLastColumn(), 30)).getValues()[0];
    const encNorm = encs.map(normalizarEncabezado_);
    const tieneRelator = encNorm.some(function(h) { return h.indexOf('RELATOR') >= 0 || h.indexOf('DOCENTE') >= 0 || h.indexOf('PROFESOR') >= 0; });
    const tieneContenido = encNorm.some(function(h) { return h.indexOf('CONTENIDO') >= 0 || h.indexOf('UTILIDAD') >= 0; });
    const tieneGlobal = encNorm.some(function(h) { return h.indexOf('GLOBAL') >= 0 || h.indexOf('GENERAL') >= 0; });
    return tieneRelator && tieneContenido && tieneGlobal;
  } catch (e) {
    return false;
  }
}

/**
 * Procesa una fila de la hoja de respuestas de satisfacción o una respuesta de Google Forms.
 * @param {Sheet|null} hoja Hoja de origen (o null si viene de FormApp directo)
 * @param {number|string} fila Número de fila o clave
 * @param {Array} encabezados Arreglo de títulos de columnas/preguntas
 * @param {Array} valores Arreglo de valores de la respuesta
 * @param {string} idActividadConfig ID de actividad de respaldo/contexto
 * @param {boolean} omitirLecturaExistentes Si true, asume que el llamador ya verificó duplicados en EVALUACIONES_SATISFACCION
 * @param {string} claveOrigenExplicita Si se provee, usa esta clave en FILA_ORIGEN (ej. 'FORM:...')
 */
function procesarFilaSatisfaccion_(hoja, fila, encabezados, valores, idActividadConfig, omitirLecturaExistentes, claveOrigenExplicita) {
  const ss = sigcSpreadsheetCentral_();
  const hojaEval = asegurarHojaEvaluaciones_(ss);
  const claveOrigen = claveOrigenExplicita || (hoja ? (hoja.getName() + ':' + fila) : ('FORM:' + fila));

  // Verificar si esta fila ya fue registrada en EVALUACIONES_SATISFACCION de forma válida
  if (!omitirLecturaExistentes) {
    const evalExistentes = hojaEval.getDataRange().getValues();
    if (evalExistentes.length > 1) {
      const mapaEval = mapaEncabezados_(evalExistentes[0]);
      const colOrigen = mapaEval['FILA ORIGEN'];
      const colActivo = mapaEval['REGISTRO ACTIVO'];
      const colIdAct = mapaEval['ID ACTIVIDAD'];
      if (colOrigen !== undefined) {
        for (let e = 1; e < evalExistentes.length; e++) {
          const esActivo = colActivo !== undefined ? (sigcNormalizarSiNo(evalExistentes[e][colActivo], 'Sí') !== 'No') : true;
          const idGuardado = String(evalExistentes[e][colIdAct] || '').trim();
          const idEvalGuardado = String(evalExistentes[e][0] || '').trim();
          if (String(evalExistentes[e][colOrigen] || '') === claveOrigen && esActivo && /^EVA-/i.test(idEvalGuardado) && idGuardado && !/^[1-5]$/.test(idGuardado)) {
            if (hoja && fila) {
              try { registrarResultadoEnRespuesta_(hoja, fila, '', idEvalGuardado, 'PROCESADO', 'Esta encuesta ya estaba consolidada.'); } catch (eR) {}
            }
            return { omitida: false, estado: 'PROCESADO', idParticipacion: idEvalGuardado };
          }
        }
      }
    }
  }

  let textoActividadFila = '';
  let timestamp = new Date();
  let nRelator = 0, nContenidos = 0, nOrganizacion = 0, nGlobal = 0;
  let recomienda = 'Sí';
  let valioso = '';
  let sugerencias = '';

  const colsTecnicas = [
    'ID PERSONA', 'ID PARTICIPACION', 'ESTADO PROCESO', 'DETALLE PROCESO',
    'FECHA PROCESO', 'INTENTOS PROCESO', 'DATOS ORIGINALES REVISION',
    'CAMPOS CORREGIDOS', 'FECHA CORRECCION', 'OBSERVACION CORRECCION', 'HISTORIAL CORRECCIONES'
  ];

  for (let c = 0; c < encabezados.length; c++) {
    const h = normalizarEncabezado_(encabezados[c]);
    if (colsTecnicas.indexOf(h) >= 0) continue;
    const val = valores[c];
    if (val === '' || val === null || val === undefined) continue;

    if (h.indexOf('MARCA TEMPORAL') >= 0 || h === 'TIMESTAMP' || h === 'FECHA') {
      timestamp = val;
    } else if (h.indexOf('VALIOSO') >= 0 || h.indexOf('DESTACA') >= 0 || h.indexOf('APRENDIO') >= 0 || h.indexOf('POSITIVO') >= 0 || h.indexOf('GUSTO') >= 0) {
      valioso = String(val).trim();
    } else if (h.indexOf('SUGERENCIA') >= 0 || h.indexOf('MEJORA') >= 0 || h.indexOf('COMENTARIO') >= 0 || h.indexOf('NUEVOS TEMAS') >= 0 || h.indexOf('GUSTARIA APRENDER') >= 0) {
      sugerencias = String(val).trim();
    } else if (h.indexOf('RELATOR') >= 0 || h.indexOf('DOCENTE') >= 0 || h.indexOf('PROFESOR') >= 0 || h.indexOf('EXPOSITOR') >= 0) {
      nRelator = webExtraerNotaEscala_(val);
    } else if (h.indexOf('CONTENIDO') >= 0 || h.indexOf('UTILIDAD') >= 0 || h.indexOf('APRENDIZAJE') >= 0) {
      nContenidos = webExtraerNotaEscala_(val);
    } else if (h.indexOf('ORGANIZACION') >= 0 || h.indexOf('ESPACIO') >= 0 || h.indexOf('MATERIAL') >= 0 || h.indexOf('LOGISTICA') >= 0) {
      nOrganizacion = webExtraerNotaEscala_(val);
    } else if (h.indexOf('GLOBAL') >= 0 || h.indexOf('GENERAL') >= 0) {
      nGlobal = webExtraerNotaEscala_(val);
    } else if (h.indexOf('RECOMEND') >= 0) {
      recomienda = String(val).trim();
    } else if (
      h.indexOf('CODIGO') >= 0 ||
      h.indexOf('AL QUE ASISTIO') >= 0 ||
      h === 'ACTIVIDAD' ||
      h === 'CAPACITACION' ||
      h === 'CURSO' ||
      h === 'TALLER' ||
      h === 'CAPACITACION O TALLER' ||
      h.indexOf('NOMBRE DE LA CAPACITACION') >= 0 ||
      h.indexOf('SELECCIONE LA CAPACITACION') >= 0
    ) {
      const valStr = String(val).trim();
      if (!/^[1-5]$/.test(valStr)) {
        if (!textoActividadFila || /(CAP-\s*\d{4}\s*[-–—]?\s*\d+)/i.test(valStr)) {
          textoActividadFila = valStr;
        }
      }
    }
  }

  // Si aún no tiene un código CAP- explícito, buscar en cualquier celda no técnica de la fila si hay un código CAP-
  if (!textoActividadFila || !/(CAP-\s*\d{4}\s*[-–—]?\s*\d+)/i.test(textoActividadFila)) {
    for (let c = 0; c < valores.length; c++) {
      const h = normalizarEncabezado_(encabezados[c] || '');
      if (colsTecnicas.indexOf(h) >= 0) continue;
      const s = String(valores[c] || '').trim();
      if (/(CAP-\s*\d{4}\s*[-–—]?\s*\d+)/i.test(s)) {
        textoActividadFila = s;
        break;
      }
    }
  }

  function intentarResolverAct_(txt) {
    if (!txt) return null;
    const str = String(txt).trim();
    if (!str || /^[1-5]$/.test(str)) return null;
    const mCap = str.match(/CAP-\s*(\d{4})\s*[-–—]?\s*(\d+)/i);
    const cand = mCap ? ('CAP-' + mCap[1] + '-' + mCap[2]) : str;
    if (typeof resolverActividad_ === 'function') {
      const res = resolverActividad_(cand) || (cand !== str ? resolverActividad_(str) : null);
      if (res && (res.id || res.ID_ACTIVIDAD)) {
        return {
          id: String(res.id || res.ID_ACTIVIDAD).trim(),
          nombre: String(res.nombre || res.NOMBRE_ACTIVIDAD || str).trim()
        };
      }
    }
    if (mCap) {
      return { id: 'CAP-' + mCap[1] + '-' + mCap[2], nombre: str };
    }
    return null;
  }

  let resuelta = intentarResolverAct_(textoActividadFila);
  if (!resuelta && idActividadConfig) {
    resuelta = intentarResolverAct_(idActividadConfig);
  }

  let idActFinal = resuelta ? resuelta.id : '';
  let nombreActFinal = resuelta ? resuelta.nombre : '';

  if (!idActFinal && textoActividadFila && !/^[1-5]$/.test(textoActividadFila)) {
    idActFinal = textoActividadFila;
    nombreActFinal = textoActividadFila;
  }

  if (!idActFinal || /^[1-5]$/.test(idActFinal)) {
    throw new Error('No se pudo identificar el código o nombre de la capacitación en la encuesta (valor recibido: "' + textoActividadFila + '").');
  }

  const notas = [nRelator, nContenidos, nOrganizacion, nGlobal].filter(function(n) { return n > 0; });
  if (!notas.length) {
    throw new Error('La respuesta no contiene calificaciones válidas en escala 1 a 5.');
  }

  const promGeneral = Number((notas.reduce(function(a, b) { return a + b; }, 0) / notas.length).toFixed(2));
  const porcSat = Math.round((promGeneral / 5) * 100);
  const idEval = 'EVA-' + Utilities.getUuid().slice(0, 8).toUpperCase();

  hojaEval.appendRow([
    idEval,
    idActFinal,
    nombreActFinal,
    timestamp || new Date(),
    'Formulario Digital (QR / Web)',
    1,
    nRelator || promGeneral,
    nContenidos || promGeneral,
    nOrganizacion || promGeneral,
    nGlobal || promGeneral,
    promGeneral,
    porcSat,
    recomienda || 'Sí',
    valioso,
    sugerencias,
    claveOrigen,
    'Sí'
  ]);

  if (hoja && fila) {
    try {
      registrarResultadoEnRespuesta_(
        hoja,
        fila,
        '',
        idEval,
        'PROCESADO',
        'Encuesta de satisfacción consolidada en ' + idActFinal + ' (Promedio: ' + promGeneral + '/5.0).'
      );
    } catch (eReg) {}
  }

  return {
    omitida: false,
    estado: 'PROCESADO',
    idPersona: '',
    idParticipacion: idEval,
    timestampMs: timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime()
  };
}

/**
 * Tarea periódica automática en segundo plano (cada 10 minutos):
 * Procesa automáticamente todas las respuestas pendientes de satisfacción sin intervención humana.
 */
function sincronizarRespuestasSatisfaccionPeriodica() {
  try {
    const ss = sigcSpreadsheetCentral_();
    const cant = sincronizarRespuestasSatisfaccion_(ss);
    if (cant > 0) {
      console.log('Sincronización periódica automática: ' + cant + ' respuesta(s) procesada(s).');
    }
  } catch (e) {
    console.warn('Error en sincronizarRespuestasSatisfaccionPeriodica: ' + e.message);
  }
}

/**
 * Instala un activador de tiempo (Time-driven) en Google Cloud para ejecutar
 * la sincronización automática de satisfacción cada 10 minutos si aún no está instalado.
 */
function asegurarActivadorPeriodicoSatisfaccion_() {
  const cache = CacheService.getScriptCache();
  const claveCache = 'SIGC_TRIGGER_PERIODICO_SAT_OK';
  if (cache.get(claveCache)) return;

  try {
    const nombreFuncion = 'sincronizarRespuestasSatisfaccionPeriodica';
    const triggers = ScriptApp.getProjectTriggers();
    const coincidencias = triggers.filter(function(t) {
      return t.getHandlerFunction() === nombreFuncion;
    });

    if (coincidencias.length > 1) {
      coincidencias.slice(1).forEach(function(t) { ScriptApp.deleteTrigger(t); });
    }

    if (!coincidencias.length && triggers.length < 20) {
      ScriptApp.newTrigger(nombreFuncion)
        .timeBased()
        .everyMinutes(10)
        .create();
    }
    cache.put(claveCache, '1', 86400); // 24 horas de cache
  } catch (e) {
    console.warn('No se pudo verificar activador periódico de satisfacción: ' + e.message);
  }
}

/**
 * Sincroniza encuestas de satisfacción automáticamente durante peticiones Web (con throttle de 2 minutos).
 */
function verificarSincronizacionSatisfaccionConThrottle_(ss, idActividadContexto) {
  const cache = CacheService.getScriptCache();
  const clave = 'SIGC_THROTTLE_SYNC_SAT' + (idActividadContexto ? ('_' + String(idActividadContexto).trim().toUpperCase()) : '');
  if (cache.get(clave)) return 0;
  try {
    cache.put(clave, '1', 90); // 90 segundos
    asegurarActivadorPeriodicoSatisfaccion_();
    return sincronizarRespuestasSatisfaccion_(ss, idActividadContexto);
  } catch (e) {
    console.warn('Sincronización automática de satisfacción omitida: ' + e.message);
    return 0;
  }
}

/**
 * Detecta y repara automáticamente cualquier evaluación o formulario que haya sido
 * asignado erróneamente a Power BI (u otra actividad que aún no se ejecuta ni aplica),
 * devolviendo las respuestas y el formulario a su capacitación legítima ("Haz visible tu valor emprendedor" / CAP-2026-033).
 */
function repararRespuestasDesplazadasSatisfaccion_(ss) {
  try {
    const hojaEval = asegurarHojaEvaluaciones_(ss);
    const hojaConfig = ss.getSheetByName((SISTEMA && SISTEMA.HOJAS && SISTEMA.HOJAS.FORMULARIOS) || 'CONFIG_FORMULARIOS');
    const acts = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES) || [];

    // 1. Identificar la actividad de Power BI y la actividad real previa
    let actPowerBi = null;
    let actHazVisible = null;
    let actEjecutadaReciente = null;

    acts.forEach(function(a) {
      const nom = normalizarEncabezado_(a.NOMBRE_ACTIVIDAD || '');
      const idA = String(a.ID_ACTIVIDAD || '').trim().toUpperCase();
      if (nom.indexOf('POWER BI') >= 0 || idA.indexOf('POWER') >= 0) {
        actPowerBi = a;
      }
      if (nom.indexOf('HAZ VISIBLE') >= 0 || idA === 'CAP-2026-033') {
        actHazVisible = a;
      }
      const est = normalizarEncabezado_(a.ESTADO_ACTIVIDAD || '');
      if ((est === 'EJECUTADA' || est === 'EN EJECUCION') && idA !== (actPowerBi ? actPowerBi.ID_ACTIVIDAD : '')) {
        actEjecutadaReciente = a;
      }
    });

    const actDestinoReal = actHazVisible || actEjecutadaReciente;
    if (!actPowerBi || !actDestinoReal) return;
    const idPowerBiUpper = String(actPowerBi.ID_ACTIVIDAD || '').trim().toUpperCase();
    const idReal = String(actDestinoReal.ID_ACTIVIDAD || '').trim().toUpperCase();
    const nomReal = String(actDestinoReal.NOMBRE_ACTIVIDAD || '').trim();

    let huboCambios = false;

    // 2. Corregir registros en EVALUACIONES_SATISFACCION que tengan ID de Power BI
    if (hojaEval.getLastRow() >= 2) {
      const datosEval = hojaEval.getDataRange().getValues();
      const mapaEval = mapaEncabezados_(datosEval[0]);
      const colIdAct = mapaEval['ID ACTIVIDAD'];
      const colNomAct = mapaEval['NOMBRE ACTIVIDAD'];
      const colOrigen = mapaEval['FILA ORIGEN'];

      for (let i = 1; i < datosEval.length; i++) {
        const idActGuardado = String(datosEval[i][colIdAct] || '').trim().toUpperCase();
        const nomGuardado = normalizarEncabezado_(datosEval[i][colNomAct] || '');

        if (idActGuardado === idPowerBiUpper || nomGuardado.indexOf('POWER BI') >= 0) {
          let idRestaurar = idReal;
          let nomRestaurar = nomReal;

          // Intentar revisar si la celda de origen en la hoja física menciona un curso específico
          const origen = String(datosEval[i][colOrigen] || '').trim();
          if (origen && origen.indexOf(':') > 0 && origen.indexOf('FORM:') !== 0) {
            try {
              const partes = origen.split(':');
              const hOrigen = ss.getSheetByName(partes[0]);
              if (hOrigen) {
                const filaNum = parseInt(partes[1], 10);
                if (filaNum >= 2 && filaNum <= hOrigen.getLastRow()) {
                  const valsFila = hOrigen.getRange(filaNum, 1, 1, hOrigen.getLastColumn()).getValues()[0];
                  for (let v = 0; v < valsFila.length; v++) {
                    const txt = String(valsFila[v] || '').trim();
                    if (txt && !/^[1-5]$/.test(txt)) {
                      const res = resolverActividad_(txt);
                      if (res && res.id && String(res.id).toUpperCase() !== idPowerBiUpper) {
                        idRestaurar = String(res.id).toUpperCase();
                        nomRestaurar = String(res.nombre || nomReal).trim();
                        break;
                      }
                    }
                  }
                }
              }
            } catch (eOrig) {}
          }

          hojaEval.getRange(i + 1, colIdAct + 1).setValue(idRestaurar);
          if (colNomAct !== undefined) hojaEval.getRange(i + 1, colNomAct + 1).setValue(nomRestaurar);
          huboCambios = true;
        }
      }
    }

    // 3. Corregir CONFIG_FORMULARIOS si un formulario de satisfacción con respuestas quedó erróneamente con ID de Power BI
    if (hojaConfig && hojaConfig.getLastRow() >= 2) {
      const datosCfg = hojaConfig.getDataRange().getValues();
      const mapaCfg = mapaEncabezados_(datosCfg[0]);
      const colTipo = mapaCfg['TIPO'];
      const colFormId = mapaCfg['FORM ID'];
      const colIdAct = mapaCfg['ID ACTIVIDAD'];

      for (let i = 1; i < datosCfg.length; i++) {
        const tipo = normalizarEncabezado_(datosCfg[i][colTipo]);
        const idAct = String(datosCfg[i][colIdAct] || '').trim().toUpperCase();
        const formId = String(datosCfg[i][colFormId] || '').trim();

        if ((tipo === 'SATISFACCION' || tipo === 'ENCUESTA SATISFACCION') && idAct === idPowerBiUpper && formId) {
          try {
            const form = FormApp.openById(formId);
            if (form) {
              const respuestas = form.getResponses();
              // Si el formulario ya tiene respuestas, pertenece a la capacitación que sí se ejecutó (no a Power BI)
              if (respuestas.length > 0) {
                hojaConfig.getRange(i + 1, colIdAct + 1).setValue(idReal);
                asegurarFormularioSatisfaccionDedicado_(form, actDestinoReal, idReal);
                huboCambios = true;
              }
            }
          } catch (eF) {}
        }
      }
    }

    if (huboCambios) {
      SpreadsheetApp.flush();
      sigcInvalidarCacheTabla_('EVALUACIONES_SATISFACCION');
      sigcInvalidarCacheTabla_('CONFIG_FORMULARIOS');
      CacheService.getScriptCache().remove('SIGC_PANEL_FORMULARIOS_V1');
      console.log('Reparación de satisfacción: respuestas erróneas retiradas de Power BI y restauradas a ' + idReal);
    }
  } catch (eRep) {
    console.warn('Advertencia en repararRespuestasDesplazadasSatisfaccion_: ' + eRep.message);
  }
}

/**
 * Motor directo de sincronización de Encuestas de Satisfacción:
 * 1) Repara o desactiva cualquier fila corrupta previa en EVALUACIONES_SATISFACCION (ej. con ID_ACTIVIDAD = "5").
 * 2) Recorre TODAS las filas de las hojas de respuestas de satisfacción (ignorando si antes quedaron marcadas como
 *    PROCESADO o DUPLICADO por el error antiguo de inscripción) y consolida cualquier fila que aún no esté en EVALUACIONES_SATISFACCION.
 * 3) Lee además directamente desde FormApp.openById(formId).getResponses() para rescatar cualquier respuesta que no haya
 *    caído en la hoja o cuya columna haya cambiado tras actualizar el formulario.
 */
function sincronizarRespuestasSatisfaccion_(ss, idActividadContexto) {
  ss = ss || sigcSpreadsheetCentral_();
  let procesadas = 0;
  try {
    const hojaEval = asegurarHojaEvaluaciones_(ss);

    // Ejecutar autodiagnóstico y reparación de traspaso indebido a Power BI
    repararRespuestasDesplazadasSatisfaccion_(ss);

    // 1. Cargar mapa de actividades válidas de la base central
    const actividadesValidas = new Map();
    try {
      const listaActs = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES) || [];
      listaActs.forEach(function(a) {
        const idA = String(a.ID_ACTIVIDAD || '').trim().toUpperCase();
        if (idA) {
          actividadesValidas.set(idA, a);
        }
      });
    } catch (eActs) {}

    const idContextoLimpio = String(idActividadContexto || '').trim().toUpperCase();
    const actObjContexto = idContextoLimpio ? actividadesValidas.get(idContextoLimpio) : null;
    const nomContexto = actObjContexto ? String(actObjContexto.NOMBRE_ACTIVIDAD || '').trim() : '';

    // 2. Auditar EVALUACIONES_SATISFACCION: registrar orígenes ya consolidados válidamente
    const origenesConsolidados = new Set();
    const filasEvalPorOrigen = new Map();
    const timestampsConsolidados = [];
    if (hojaEval.getLastRow() >= 2) {
      const datosEval = hojaEval.getDataRange().getValues();
      const mapaEval = mapaEncabezados_(datosEval[0]);
      const colIdEval = mapaEval['ID EVALUACION'] !== undefined ? mapaEval['ID EVALUACION'] : 0;
      const colIdAct = mapaEval['ID ACTIVIDAD'];
      const colNomAct = mapaEval['NOMBRE ACTIVIDAD'];
      const colFecha = mapaEval['FECHA REGISTRO'];
      const colValioso = mapaEval['LO MAS VALIOSO'];
      const colSugerencias = mapaEval['SUGERENCIAS'];
      const colOrigen = mapaEval['FILA ORIGEN'];
      const colActivo = mapaEval['REGISTRO ACTIVO'];

      let huboLimpieza = false;
      for (let i = 1; i < datosEval.length; i++) {
        const esActivo = colActivo !== undefined ? (sigcNormalizarSiNo(datosEval[i][colActivo], 'Sí') !== 'No') : true;
        const idEv = String(datosEval[i][colIdEval] || '').trim();
        const idActGuardado = String(datosEval[i][colIdAct] || '').trim().toUpperCase();
        const origenGuardado = String(datosEval[i][colOrigen] || '').trim();

        const esIdValido = /^EVA-/i.test(idEv) && idActGuardado && !/^[1-5]$/.test(idActGuardado) &&
          idActGuardado !== 'REEMPLAZADO' &&
          (actividadesValidas.size === 0 || actividadesValidas.has(idActGuardado));

        if (esActivo && esIdValido) {
          if (origenGuardado) {
            origenesConsolidados.add(origenGuardado);
            filasEvalPorOrigen.set(origenGuardado, {
              filaHojaEval: i + 1,
              idActGuardado: idActGuardado,
              colIdAct: colIdAct,
              colNomAct: colNomAct,
              colValioso: colValioso,
              colSugerencias: colSugerencias,
              valiosoActual: colValioso !== undefined ? String(datosEval[i][colValioso] || '').trim() : '',
              sugerenciasActual: colSugerencias !== undefined ? String(datosEval[i][colSugerencias] || '').trim() : ''
            });
          }
          if (colFecha !== undefined && datosEval[i][colFecha] && origenGuardado.indexOf('FORM:') !== 0 && origenGuardado !== 'DIGITACION_WEB') {
            const d = datosEval[i][colFecha] instanceof Date ? datosEval[i][colFecha] : new Date(datosEval[i][colFecha]);
            if (!isNaN(d.getTime())) timestampsConsolidados.push(d.getTime());
          }
        }
      }
    }

    // 3. Descubrir hojas de respuestas y formularios de satisfacción
    const hojaConfig = ss.getSheetByName((SISTEMA && SISTEMA.HOJAS && SISTEMA.HOJAS.FORMULARIOS) || 'CONFIG_FORMULARIOS');
    const hojasEnCentral = ss.getSheets();
    const hojasParaProcesar = [];
    const vistasHojas = new Set();
    const formsParaProcesar = [];
    const vistosForms = new Set();

    if (hojaConfig && hojaConfig.getLastRow() >= 2) {
      const datos = hojaConfig.getDataRange().getValues();
      const mapa = mapaEncabezados_(datos[0]);
      for (let i = 1; i < datos.length; i++) {
        const tipo = normalizarEncabezado_(datos[i][mapa['TIPO']]);
        if (tipo === 'SATISFACCION' || tipo === 'ENCUESTA SATISFACCION') {
          const ssId = String(datos[i][mapa['SPREADSHEET RESPUESTAS ID']] || ss.getId()).trim();
          let nombreHoja = String(datos[i][mapa['HOJA RESPUESTAS']] || '').trim();
          const formId = String(datos[i][mapa['FORM ID']] || '').trim();
          const idActCfg = String(datos[i][mapa['ID ACTIVIDAD']] || '').trim().toUpperCase();

          if (mapa['ESTADO'] !== undefined && normalizarEncabezado_(datos[i][mapa['ESTADO']]) !== 'ACTIVO') {
            hojaConfig.getRange(i + 1, mapa['ESTADO'] + 1).setValue('Activo');
          }

          if (formId && !vistosForms.has(formId)) {
            vistosForms.add(formId);
            formsParaProcesar.push({ formId: formId, idAct: idActCfg, esGenerico: !idActCfg });
          }

          let targetSs = ss;
          if (ssId && ssId !== ss.getId()) {
            try { targetSs = SpreadsheetApp.openById(ssId); } catch (eOpen) { targetSs = ss; }
          }
          let hojaObj = (nombreHoja && nombreHoja !== 'DIRECTO_FORMAPP') ? targetSs.getSheetByName(nombreHoja) : null;
          if (!hojaObj && formId) {
            hojaObj = targetSs.getSheets().find(function(s) {
              try { return s.getFormUrl() && s.getFormUrl().indexOf(formId) >= 0; } catch (e) { return false; }
            });
          }
          if (!hojaObj && !idActCfg) {
            hojaObj = targetSs.getSheets().find(function(s) {
              return esHojaRespuestasSatisfaccion_(s);
            });
          }

          const nombreRealHoja = hojaObj ? hojaObj.getName() : '';
          if (
            hojaObj &&
            nombreRealHoja !== 'DIRECTO_FORMAPP' &&
            nombreRealHoja !== 'EVALUACIONES_SATISFACCION'
          ) {
            if (nombreHoja !== 'DIRECTO_FORMAPP' && nombreRealHoja !== nombreHoja && mapa['HOJA RESPUESTAS'] !== undefined) {
              hojaConfig.getRange(i + 1, mapa['HOJA RESPUESTAS'] + 1).setValue(nombreRealHoja);
            }
            const key = targetSs.getId() + '::' + nombreRealHoja;
            if (!vistasHojas.has(key)) {
              vistasHojas.add(key);
              hojasParaProcesar.push({ ss: targetSs, hoja: hojaObj, idAct: idActCfg, esGenerico: !idActCfg });
            }
          }
        }
      }
    }

    hojasEnCentral.forEach(function(s) {
      if (esHojaRespuestasSatisfaccion_(s)) {
        const key = ss.getId() + '::' + s.getName();
        if (!vistasHojas.has(key)) {
          vistasHojas.add(key);
          hojasParaProcesar.push({ ss: ss, hoja: s, idAct: '', esGenerico: true });
        }
        try {
          const fUrl = s.getFormUrl();
          if (fUrl) {
            const mId = fUrl.match(/\/d\/(?:e\/)?([a-zA-Z0-9_-]{20,})/);
            if (mId && mId[1] && !vistosForms.has(mId[1])) {
              vistosForms.add(mId[1]);
              formsParaProcesar.push({ formId: mId[1], idAct: '', esGenerico: true });
            }
          }
        } catch (eFUrl) {}
      }
    });

    // Función auxiliar para extraer textos abiertos (Preguntas 6 y 7) de una fila o respuesta
    function extraerTextosAbiertosFila_(encs, vals) {
      let valioso = '';
      let sugerencias = '';
      for (let c = 0; c < encs.length; c++) {
        const h = normalizarEncabezado_(encs[c] || '');
        const v = String(vals[c] !== undefined && vals[c] !== null ? vals[c] : '').trim();
        if (!v) continue;
        if (h.indexOf('VALIOSO') >= 0 || h.indexOf('DESTACA') >= 0 || h.indexOf('APRENDIO') >= 0 || h.indexOf('POSITIVO') >= 0 || h.indexOf('GUSTO') >= 0) {
          valioso = v;
        } else if (h.indexOf('SUGERENCIA') >= 0 || h.indexOf('MEJORA') >= 0 || h.indexOf('COMENTARIO') >= 0 || h.indexOf('NUEVOS TEMAS') >= 0 || h.indexOf('GUSTARIA APRENDER') >= 0) {
          sugerencias = v;
        }
      }
      return { valioso: valioso, sugerencias: sugerencias };
    }

    // 4. Sincronizar directamente TODAS las filas de cada hoja de satisfacción
    // (sin depender de ESTADO_PROCESO en la hoja, que pudo quedar como PROCESADO o DUPLICADO antes)
    hojasParaProcesar.forEach(function(item) {
      try {
        const hoja = item.hoja;
        if (!hoja || hoja.getLastRow() < 2) return;
        asegurarColumnasControlFormulario_(hoja);
        const valoresHoja = hoja.getDataRange().getValues();
        const encabezados = valoresHoja[0];
        const idObjetivoHoja = String(item.idAct || '').trim().toUpperCase();

        for (let r = 1; r < valoresHoja.length; r++) {
          const filaSheet = r + 1;
          const claveOrigen = hoja.getName() + ':' + filaSheet;
          if (filaFormularioEstaVacia_(encabezados, valoresHoja[r])) continue;

          if (origenesConsolidados.has(claveOrigen)) {
            const infoPrev = filasEvalPorOrigen.get(claveOrigen);
            if (infoPrev) {
              // Completar respuestas con palabras (Preguntas 6 y 7) si estaban vacías en EVALUACIONES_SATISFACCION
              const textos = extraerTextosAbiertosFila_(encabezados, valoresHoja[r]);
              if (textos.valioso && !infoPrev.valiosoActual && infoPrev.colValioso !== undefined) {
                hojaEval.getRange(infoPrev.filaHojaEval, infoPrev.colValioso + 1).setValue(textos.valioso);
                infoPrev.valiosoActual = textos.valioso;
                procesadas++;
              }
              if (textos.sugerencias && !infoPrev.sugerenciasActual && infoPrev.colSugerencias !== undefined) {
                hojaEval.getRange(infoPrev.filaHojaEval, infoPrev.colSugerencias + 1).setValue(textos.sugerencias);
                infoPrev.sugerenciasActual = textos.sugerencias;
                procesadas++;
              }
            }
            continue;
          }

          try {
            const res = procesarFilaSatisfaccion_(
              hoja,
              filaSheet,
              encabezados,
              valoresHoja[r],
              idObjetivoHoja,
              true,
              claveOrigen
            );
            if (res && !res.omitida) {
              origenesConsolidados.add(claveOrigen);
              if (res.timestampMs && !isNaN(res.timestampMs)) {
                timestampsConsolidados.push(res.timestampMs);
              }
              procesadas++;
            }
          } catch (eFila) {
            console.warn('Fila ' + filaSheet + ' en ' + hoja.getName() + ' no procesada: ' + eFila.message);
          }
        }
      } catch (eProc) {
        console.warn('Error sincronizando hoja de satisfacción ' + item.hoja.getName() + ': ' + eProc.message);
      }
    });

    // 5. Sincronizar también directamente desde FormApp.openById(formId).getResponses()
    formsParaProcesar.forEach(function(fItem) {
      try {
        const form = FormApp.openById(fItem.formId);
        if (!form) return;
        const responses = form.getResponses();
        const idObjetivoForm = String(fItem.idAct || '').trim().toUpperCase();

        for (let i = 0; i < responses.length; i++) {
          const fResp = responses[i];
          const claveForm = 'FORM:' + fResp.getId();
          const ts = fResp.getTimestamp();
          const tsMs = ts ? ts.getTime() : 0;

          // Optimización de rendimiento: Si ya está consolidada y completa, omitir inmediatamente
          if (origenesConsolidados.has(claveForm)) {
            const infoPrevF = filasEvalPorOrigen.get(claveForm);
            if (infoPrevF && infoPrevF.valiosoActual && infoPrevF.sugerenciasActual) {
              continue;
            }
          }

          // Si ya se consolidó una respuesta desde la hoja con la misma marca temporal (±5 segundos), no duplicar
          if (tsMs && timestampsConsolidados.some(function(t) { return Math.abs(t - tsMs) <= 5000; })) {
            origenesConsolidados.add(claveForm);
            continue;
          }

          const itemResponses = fResp.getItemResponses();
          const encsVirtuales = ['Marca temporal'];
          const valsVirtuales = [ts || new Date()];
          for (let j = 0; j < itemResponses.length; j++) {
            const ir = itemResponses[j];
            encsVirtuales.push(String(ir.getItem().getTitle() || ''));
            const rVal = ir.getResponse();
            valsVirtuales.push(Array.isArray(rVal) ? rVal.join(', ') : rVal);
          }

          if (origenesConsolidados.has(claveForm)) {
            const infoPrevF = filasEvalPorOrigen.get(claveForm);
            if (infoPrevF) {
              const textosF = extraerTextosAbiertosFila_(encsVirtuales, valsVirtuales);
              if (textosF.valioso && !infoPrevF.valiosoActual && infoPrevF.colValioso !== undefined) {
                hojaEval.getRange(infoPrevF.filaHojaEval, infoPrevF.colValioso + 1).setValue(textosF.valioso);
                infoPrevF.valiosoActual = textosF.valioso;
                procesadas++;
              }
              if (textosF.sugerencias && !infoPrevF.sugerenciasActual && infoPrevF.colSugerencias !== undefined) {
                hojaEval.getRange(infoPrevF.filaHojaEval, infoPrevF.colSugerencias + 1).setValue(textosF.sugerencias);
                infoPrevF.sugerenciasActual = textosF.sugerencias;
                procesadas++;
              }
            }
            continue;
          }

          try {
            const resF = procesarFilaSatisfaccion_(
              null,
              fResp.getId(),
              encsVirtuales,
              valsVirtuales,
              idObjetivoForm,
              true,
              claveForm
            );
            if (resF && !resF.omitida) {
              origenesConsolidados.add(claveForm);
              procesadas++;
            }
          } catch (eResp) {
            console.warn('Respuesta FormApp ' + claveForm + ' omitida: ' + eResp.message);
          }
        }
      } catch (eFormSync) {
        console.warn('No se pudo leer directamente FormApp (' + fItem.formId + '): ' + eFormSync.message);
      }
    });

    if (procesadas > 0) {
      SpreadsheetApp.flush();
      sigcInvalidarCacheTabla_(hojaEval.getName());
    }
  } catch (e) {
    console.warn('Advertencia en sincronizarRespuestasSatisfaccion_: ' + e.message);
  }
  return procesadas;
}

function formatearEtiquetaCursoSatisfaccion_(actividad, idFallback) {
  if (!actividad) return webFormatearNombreCapacitacion_(idFallback);
  const id = String(actividad.ID_ACTIVIDAD || idFallback || '').trim();
  const nombre = webFormatearNombreCapacitacion_(actividad.NOMBRE_ACTIVIDAD || '');
  return nombre ? (nombre + ' (' + id + ')') : id;
}

function obtenerOpcionesCursosSatisfaccion_(ss, etiquetaActual) {
  const vistas = new Set();
  const opciones = [];
  if (etiquetaActual) {
    const limpia = String(etiquetaActual).replace(/[\r\n]+/g, ' ').trim();
    if (limpia) {
      vistas.add(limpia);
      opciones.push(limpia);
    }
  }
  try {
    const acts = webLeerTablaConCache_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES) || [];
    acts.slice().reverse().forEach(function(a) {
      if (webEsActividadArchivada_(a)) return;
      const et = formatearEtiquetaCursoSatisfaccion_(a, '');
      if (et && !vistas.has(et)) {
        vistas.add(et);
        opciones.push(et);
      }
    });
  } catch (e) {}
  if (!opciones.length) {
    opciones.push('Capacitación Municipal');
  }
  return opciones;
}

/**
 * Garantiza que el Formulario de Satisfacción de una actividad específica:
 * 1) Sea 100% público sin pedir login ni autorización de dominio (@munistgo.cl).
 * 2) NO tenga ninguna pregunta ni listado de selección de curso (la persona solo
 *    responde las preguntas de evaluación y el sistema ya sabe a qué ID_ACTIVIDAD pertenece).
 * 3) Lleve en su título y descripción el nombre exacto de la capacitación.
 */
function asegurarFormularioSatisfaccionDedicado_(form, actividad, idActividad) {
  try { form.setRequireLogin(false); } catch (e) {}
  try { form.setLimitOneResponsePerUser(false); } catch (e) {}
  try { form.setCollectEmail(false); } catch (e) {}
  try { form.setAllowResponseEdits(false); } catch (e) {}
  try { form.setAcceptingResponses(true); } catch (e) {}

  const idActStr = String((actividad && actividad.ID_ACTIVIDAD) || idActividad || '').trim();
  const nombreAct = webFormatearNombreCapacitacion_((actividad && actividad.NOMBRE_ACTIVIDAD) || idActStr || 'Capacitación Municipal');

  try {
    const tituloEsperado = 'Encuesta de Satisfacción — ' + nombreAct;
    if (form.getTitle() !== tituloEsperado) {
      form.setTitle(tituloEsperado);
    }
    form.setDescription(
      'Municipalidad de Santiago • Subdirección de Desarrollo Económico Local\n' +
      'Capacitación evaluada: ' + nombreAct + (idActStr ? ' (' + idActStr + ')' : '') + '\n\n' +
      'Su opinión es anónima y muy importante para evaluar y mejorar nuestras capacitaciones. ' +
      'Por favor califique de 1 a 5 cada aspecto (donde 1 es Muy Insatisfecho y 5 es Muy Satisfecho).'
    );
  } catch (eTit) {}

  // Eliminar cualquier pregunta de selección o código de curso para que el participante solo responda la evaluación
  try {
    const items = form.getItems();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const tit = normalizarEncabezado_(it.getTitle());
      const esPreguntaEval =
        tit.indexOf('RELATOR') >= 0 ||
        tit.indexOf('DOCENTE') >= 0 ||
        tit.indexOf('CONTENIDO') >= 0 ||
        tit.indexOf('ORGANIZACION') >= 0 ||
        tit.indexOf('SATISFACCION GLOBAL') >= 0 ||
        tit.indexOf('RECOMEND') >= 0 ||
        tit.indexOf('VALIOSO') >= 0 ||
        tit.indexOf('SUGERENCIA') >= 0;
      const esPreguntaCurso =
        !esPreguntaEval && (
          tit.indexOf('AL QUE ASISTIO') >= 0 ||
          tit.indexOf('CODIGO') >= 0 ||
          tit === 'CAPACITACION O TALLER' ||
          tit === 'ACTIVIDAD' ||
          tit === 'CAPACITACION' ||
          tit.indexOf('SELECCIONE LA CAPACITACION') >= 0
        );
      if (esPreguntaCurso) {
        form.deleteItem(it);
      }
    }
  } catch (eDel) {
    console.warn('Advertencia limpiando pregunta de curso en Form dedicado: ' + eDel.message);
  }

  return form.getPublishedUrl();
}

/**
 * Crea o recupera el Formulario Google exclusivo de Satisfacción para la capacitación indicada.
 * El participante NO tiene que elegir ni escribir el nombre de la capacitación: el formulario es propio
 * de la actividad y el sistema asocia todas sus respuestas automáticamente al ID_ACTIVIDAD.
 */
function crearOVerificarFormularioSatisfaccionWeb(idActividad) {
  idActividad = String(idActividad || '').trim();
  if (!idActividad) throw new Error('Debe seleccionar una capacitación para generar su encuesta de satisfacción.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    prepararConfigFormularios();
    asegurarActivadorPeriodicoSatisfaccion_();
    const central = sigcSpreadsheetCentral_();
    asegurarHojaEvaluaciones_(central);
    const actividad = webBuscarRegistro_(central, WEBAPP_CONFIG.HOJAS.ACTIVIDADES, 'ID_ACTIVIDAD', idActividad);
    const etiquetaActividad = formatearEtiquetaCursoSatisfaccion_(actividad, idActividad);
    const nombreActLimpio = webFormatearNombreCapacitacion_((actividad && actividad.NOMBRE_ACTIVIDAD) || idActividad);
    const idActUpper = idActividad.toUpperCase();

    const hojaConfig = central.getSheetByName(SISTEMA.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS');
    const datos = hojaConfig.getDataRange().getValues();
    const mapa = mapaEncabezados_(datos[0]);

    // 1. Buscar si esta capacitación (ID_ACTIVIDAD) ya tiene su propio formulario de satisfacción exclusivo.
    // NUNCA adoptar formularios de otras actividades ni reasignar formularios previos. Cada actividad debe tener su formulario aislado.
    let filaDedicada = -1;
    let formDedicado = null;
    let respDedicado = 0;

    for (let i = 1; i < datos.length; i++) {
      const tipo = normalizarEncabezado_(datos[i][mapa['TIPO']]);
      const formId = String(datos[i][mapa['FORM ID']] || '').trim();
      const idActFila = String(datos[i][mapa['ID ACTIVIDAD']] || '').trim().toUpperCase();

      if ((tipo === 'SATISFACCION' || tipo === 'ENCUESTA SATISFACCION') && formId) {
        if (idActFila === idActUpper) {
          try {
            const f = FormApp.openById(formId);
            if (f) {
              const cantR = f.getResponses().length;
              if (!formDedicado || cantR > respDedicado) {
                filaDedicada = i + 1;
                formDedicado = f;
                respDedicado = cantR;
              }
            }
          } catch (eF1) {}
        }
      }
    }

    if (formDedicado && filaDedicada > 0) {
      if (mapa['ESTADO'] !== undefined) {
        hojaConfig.getRange(filaDedicada, mapa['ESTADO'] + 1).setValue('Activo');
      }
      const urlDirecta = asegurarFormularioSatisfaccionDedicado_(formDedicado, actividad, idActividad);
      SpreadsheetApp.flush();
      sincronizarRespuestasSatisfaccion_(central, idActividad);
      return {
        ok: true,
        mensaje: 'Encuesta digital verificada para "' + nombreActLimpio + '" con todas sus respuestas consolidadas.',
        formId: formDedicado.getId(),
        urlPublica: urlDirecta,
        urlPrellenada: urlDirecta,
        urlEdicion: formDedicado.getEditUrl(),
        urlRespuestas: 'https://docs.google.com/spreadsheets/d/' + central.getId() + '/edit',
        etiquetaActividad: etiquetaActividad
      };
    }

    // 2. Crear un nuevo Formulario Google exclusivo para esta capacitación (sin lista desplegable de cursos)
    const titulo = 'Encuesta de Satisfacción — ' + nombreActLimpio;
    const form = FormApp.create(titulo);
    try { form.setRequireLogin(false); } catch (e) {}
    try { form.setLimitOneResponsePerUser(false); } catch (e) {}
    try { form.setAllowResponseEdits(false); } catch (e) {}
    try { form.setCollectEmail(false); } catch (e) {}
    try { form.setAcceptingResponses(true); } catch (e) {}

    form.setDescription(
      'Municipalidad de Santiago • Subdirección de Desarrollo Económico Local\n' +
      'Capacitación evaluada: ' + nombreActLimpio + ' (' + idActividad + ')\n\n' +
      'Su opinión es anónima y muy importante para evaluar y mejorar nuestras capacitaciones y talleres. ' +
      'Por favor califique de 1 a 5 cada aspecto (donde 1 es Muy Insatisfecho y 5 es Muy Satisfecho).'
    );
    form.setConfirmationMessage(
      '¡Muchas gracias por responder la Encuesta de Satisfacción de "' + nombreActLimpio + '"! Su evaluación ha sido registrada exitosamente.'
    );

    form.addScaleItem()
      .setTitle('1. Evaluación del Relator(a) / Docente')
      .setHelpText('Dominio del tema, claridad en la explicación y disposición para resolver dudas.')
      .setBounds(1, 5)
      .setLabels('Muy insatisfecho(a)', 'Muy satisfecho(a)')
      .setRequired(true);

    form.addScaleItem()
      .setTitle('2. Contenidos y Utilidad Práctica')
      .setHelpText('Calidad de los temas abordados y utilidad práctica para su trabajo, oficio o emprendimiento.')
      .setBounds(1, 5)
      .setLabels('Muy insatisfecho(a)', 'Muy satisfecho(a)')
      .setRequired(true);

    form.addScaleItem()
      .setTitle('3. Organización, Materiales y Espacio')
      .setHelpText('Cumplimiento de horarios, materiales de apoyo y comodidad de la sala o plataforma virtual.')
      .setBounds(1, 5)
      .setLabels('Muy insatisfecho(a)', 'Muy satisfecho(a)')
      .setRequired(true);

    form.addScaleItem()
      .setTitle('4. Satisfacción Global con la Capacitación')
      .setHelpText('En términos generales, ¿qué tan satisfecho(a) quedó con esta capacitación?')
      .setBounds(1, 5)
      .setLabels('Muy insatisfecho(a)', 'Muy satisfecho(a)')
      .setRequired(true);

    form.addMultipleChoiceItem()
      .setTitle('5. ¿Recomendaría esta capacitación a otras personas?')
      .setChoiceValues(['Sí', 'Tal vez', 'No'])
      .setRequired(true);

    form.addParagraphTextItem()
      .setTitle('6. ¿Qué fue lo más valioso o útil que aprendió en esta capacitación?')
      .setRequired(false);

    form.addParagraphTextItem()
      .setTitle('7. Sugerencias de mejora o nuevos temas que le gustaría aprender')
      .setRequired(false);

    const urlDirecta = form.getPublishedUrl();
    const idConfig = 'FOR-SAT-' + Utilities.getUuid().slice(0, 6).toUpperCase();
    hojaConfig.appendRow([
      idConfig,
      'SATISFACCION',
      central.getId(),
      'DIRECTO_FORMAPP',
      idActividad,
      'Activo',
      new Date(),
      form.getId(),
      urlDirecta,
      form.getEditUrl(),
      'SI'
    ]);

    try { CacheService.getScriptCache().remove('SIGC_PANEL_FORMULARIOS_V1'); } catch (e) {}

    return {
      ok: true,
      mensaje: '¡Encuesta digital y QR exclusivos creados para "' + nombreActLimpio + '"! El participante solo responde las preguntas y todo se traspasa automáticamente a esta capacitación.',
      formId: form.getId(),
      urlPublica: urlDirecta,
      urlPrellenada: urlDirecta,
      urlEdicion: form.getEditUrl(),
      urlRespuestas: 'https://docs.google.com/spreadsheets/d/' + central.getId() + '/edit',
      etiquetaActividad: etiquetaActividad
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Obtiene el consolidado y detalle de evaluaciones de satisfacción de una actividad.
 */
function obtenerEvaluacionesActividadWeb(idActividad, forzarSync) {
  webValidarObjeto_({ ID_ACTIVIDAD: idActividad }, ['ID_ACTIVIDAD']);
  const ss = sigcSpreadsheetCentral_();
  const hojaEval = asegurarHojaEvaluaciones_(ss);

  const actIdNorm = String(idActividad || '').trim().toUpperCase();
  const cache = CacheService.getScriptCache();
  const claveThrottle = 'SIGC_SYNC_SAT_THROTTLE_' + actIdNorm;
  let nuevasSincronizadas = 0;

  if (forzarSync || !cache.get(claveThrottle)) {
    nuevasSincronizadas = sincronizarRespuestasSatisfaccion_(ss, idActividad);
    cache.put(claveThrottle, '1', 45); // Throttle de 45 segundos para no saturar con peticiones consecutivas
    if (nuevasSincronizadas > 0) {
      sigcInvalidarCacheTabla_(hojaEval.getName());
    }
  }

  const actividad = webBuscarRegistro_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES, 'ID_ACTIVIDAD', idActividad);
  if (!actividad) throw new Error('No se encontró la actividad solicitada.');

  const actNomNorm = normalizarEncabezado_(actividad.NOMBRE_ACTIVIDAD || '');

  const registros = webLeerTablaConCache_(ss, hojaEval.getName(), nuevasSincronizadas > 0).filter(function(r) {
    if (!webEsRegistroActivo_(r)) return false;
    const rId = String(r.ID_ACTIVIDAD || '').trim().toUpperCase();
    const rNom = normalizarEncabezado_(r.NOMBRE_ACTIVIDAD || '');
    if (rId === actIdNorm) return true;
    if (rId && rId !== actIdNorm) return false; // Aislamiento estricto: si tiene otro ID asignado, jamás se mezcla
    if (actNomNorm && rNom && (rNom === actNomNorm || rNom.indexOf(actNomNorm) >= 0 || actNomNorm.indexOf(rNom) >= 0)) return true;
    return false;
  });

  const resumen = webCalcularResumenSatisfaccion_(registros);

  // Buscar si ya existe el formulario de satisfacción exclusivo para esta actividad (ID_ACTIVIDAD === actIdNorm)
  let infoFormulario = null;
  try {
    const hojaConfig = ss.getSheetByName(SISTEMA.HOJAS.FORMULARIOS || 'CONFIG_FORMULARIOS');
    if (hojaConfig && hojaConfig.getLastRow() >= 2) {
      const datosCfg = hojaConfig.getDataRange().getValues();
      const mapaCfg = mapaEncabezados_(datosCfg[0]);
      for (let i = 1; i < datosCfg.length; i++) {
        const tipo = normalizarEncabezado_(datosCfg[i][mapaCfg['TIPO']]);
        const formId = String(datosCfg[i][mapaCfg['FORM ID']] || '').trim();
        const idActCfg = String(datosCfg[i][mapaCfg['ID ACTIVIDAD']] || '').trim().toUpperCase();
        if ((tipo === 'SATISFACCION' || tipo === 'ENCUESTA SATISFACCION') && formId) {
          const colUrlPub = mapaCfg['FORM URL PUBLICA'] !== undefined ? mapaCfg['FORM URL PUBLICA'] : mapaCfg['URL PUBLICA'];
          const colUrlEd = mapaCfg['FORM URL EDICION'] !== undefined ? mapaCfg['FORM URL EDICION'] : mapaCfg['URL EDICION'];
          const urlPub = colUrlPub !== undefined ? String(datosCfg[i][colUrlPub] || '').trim() : '';
          const etiqueta = formatearEtiquetaCursoSatisfaccion_(actividad, idActividad);
          const itemInfo = {
            formId: formId,
            urlPublica: urlPub,
            urlPrellenada: urlPub,
            urlEdicion: colUrlEd !== undefined ? String(datosCfg[i][colUrlEd] || '').trim() : '',
            etiquetaActividad: etiqueta
          };
          if (idActCfg === actIdNorm && !infoFormulario) {
            infoFormulario = itemInfo;
            break;
          }
        }
      }
    }
  } catch (eCfg) {}

  return {
    ok: true,
    idActividad: idActividad,
    nombreActividad: actividad.NOMBRE_ACTIVIDAD || '',
    sincronizadas: nuevasSincronizadas,
    resumen: resumen,
    formulario: infoFormulario
  };
}

/**
 * Registra encuestas físicas en el sistema (modo individual 1 a 1 o modo consolidado por lote).
 */
function guardarEvaluacionSatisfaccionWeb(payload) {
  if (!payload || !payload.idActividad) {
    throw new Error('Debe indicar la actividad a evaluar.');
  }
  const ss = sigcSpreadsheetCentral_();
  const hojaEval = asegurarHojaEvaluaciones_(ss);
  const actividad = webBuscarRegistro_(ss, WEBAPP_CONFIG.HOJAS.ACTIVIDADES, 'ID_ACTIVIDAD', payload.idActividad);
  if (!actividad) throw new Error('La actividad indicada no existe.');

  const modo = String(payload.modo || 'INDIVIDUAL').toUpperCase();
  const cantidad = modo === 'LOTE'
    ? Math.max(1, Math.round(Number(payload.cantidadRespuestas || 1)))
    : 1;

  const nRel = webExtraerNotaEscala_(payload.notaRelator);
  const nCon = webExtraerNotaEscala_(payload.notaContenidos);
  const nOrg = webExtraerNotaEscala_(payload.notaOrganizacion);
  const nGlo = webExtraerNotaEscala_(payload.notaGlobal);

  const notas = [nRel, nCon, nOrg, nGlo].filter(function(n) { return n > 0; });
  if (!notas.length) {
    throw new Error('Debe ingresar calificaciones válidas entre 1.0 y 5.0.');
  }

  const promGeneral = Number((notas.reduce(function(a, b) { return a + b; }, 0) / notas.length).toFixed(2));
  const porcSat = Math.round((promGeneral / 5) * 100);
  const canal = modo === 'LOTE'
    ? 'Papel (Lote de ' + cantidad + ' encuestas)'
    : 'Papel (Individual)';

  const idEval = 'EVA-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  hojaEval.appendRow([
    idEval,
    actividad.ID_ACTIVIDAD,
    actividad.NOMBRE_ACTIVIDAD || '',
    new Date(),
    canal,
    cantidad,
    nRel || promGeneral,
    nCon || promGeneral,
    nOrg || promGeneral,
    nGlo || promGeneral,
    promGeneral,
    porcSat,
    String(payload.recomienda || 'Sí').trim(),
    String(payload.loMasValioso || '').trim(),
    String(payload.sugerencias || '').trim(),
    'DIGITACION_WEB',
    'Sí'
  ]);

  SpreadsheetApp.flush();
  sigcInvalidarCacheTabla_(hojaEval.getName());

  const actualizado = obtenerEvaluacionesActividadWeb(actividad.ID_ACTIVIDAD, false);
  actualizado.mensaje = modo === 'LOTE'
    ? 'Se consolidó exitosamente el lote de ' + cantidad + ' encuestas físicas (Promedio: ' + promGeneral + '/5.0).'
    : 'Encuesta física registrada correctamente (Promedio: ' + promGeneral + '/5.0).';
  return actualizado;
}

/**
 * Elimina (desactiva) un registro de evaluación de satisfacción.
 */
function eliminarEvaluacionSatisfaccionWeb(idEvaluacion, idActividad) {
  if (!idEvaluacion) throw new Error('Debe indicar el ID de la evaluación a eliminar.');
  const ss = sigcSpreadsheetCentral_();
  const hojaEval = asegurarHojaEvaluaciones_(ss);
  const datos = hojaEval.getDataRange().getValues();
  if (datos.length < 2) throw new Error('No se encontraron registros de evaluación.');
  const mapa = mapaEncabezados_(datos[0]);
  const colId = mapa['ID EVALUACION'];
  const colActivo = mapa['REGISTRO ACTIVO'];

  let encontrado = false;
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][colId] || '').trim() === String(idEvaluacion).trim()) {
      hojaEval.getRange(i + 1, colActivo + 1).setValue('No');
      encontrado = true;
      break;
    }
  }
  if (!encontrado) throw new Error('No se encontró el registro de evaluación indicado.');

  SpreadsheetApp.flush();
  sigcInvalidarCacheTabla_(hojaEval.getName());
  const actualizado = obtenerEvaluacionesActividadWeb(idActividad, false);
  actualizado.mensaje = 'Registro de evaluación eliminado correctamente.';
  return actualizado;
}

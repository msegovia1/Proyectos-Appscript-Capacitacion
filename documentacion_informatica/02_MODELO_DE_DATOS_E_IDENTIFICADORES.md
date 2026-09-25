# Modelo de Datos, Identificadores y Participación Real

Este documento técnico explica la arquitectura relacional, la regla de generación de identificadores únicos y la metodología de cruce de datos para calcular la **participación real y efectiva** de los vecinos en las capacitaciones.

---

## 1. Diagrama Entidad-Relación (ERD)

El sistema opera bajo un modelo relacional en tercera forma normal (3NF) que separa estrictamente la **Persona (Beneficiario)**, la **Actividad (Curso)** y la **Participación (Matrícula y Asistencia)**.

```mermaid
erDiagram
    PERSONAS ||--o{ PARTICIPACIONES : "inscribe (1 a N)"
    ACTIVIDADES ||--o{ PARTICIPACIONES : "agrupa (1 a N)"
    PERSONAS ||--o{ INTERESES_CAPACITACION : "declara (1 a N)"
    ACTIVIDADES ||--o{ SESIONES_ACTIVIDAD : "contiene (1 a N)"
    PARTICIPACIONES ||--o{ ASISTENCIAS_SESION : "registra (1 a N)"

    PERSONAS {
        string ID_PERSONA PK "Ej: PER-000142 (Correlativo único vitalicio)"
        string RUT UK "Llave natural (sin puntos, con guión, Módulo 11)"
        string TIPO_DOCUMENTO "RUT / Pasaporte / DNI Extranjero"
        string NUMERO_DOCUMENTO "Número original limpio"
        string NOMBRES "Nombres del vecino"
        string APELLIDOS "Apellidos del vecino"
        string NOMBRE_COMPLETO "Nombre estandarizado en mayúsculas"
        string GENERO "Femenino / Masculino / No binario / Otro"
        date FECHA_NACIMIENTO "Fecha para cálculo automático de edad"
        string TELEFONO "Celular normalizado (+569...)"
        string CORREO "Correo electrónico en minúsculas"
        string COMUNA "Comuna de residencia"
        string DIRECCION "Domicilio informado"
        string PARTICIPA_PMJH "Indicador grupo vulnerable: Sí / No"
        date FECHA_PRIMER_REGISTRO "Timestamp de creación en el sistema"
        date ULTIMA_ACTUALIZACION "Timestamp de última modificación"
    }

    ACTIVIDADES {
        string ID_ACTIVIDAD PK "Ej: ACT-000035 (Identificador del curso)"
        string NOMBRE_ACTIVIDAD "Nombre de la capacitación"
        string ESCUELA_LINEA "Línea temática (Emprendimiento, Oficios, Digital)"
        string AREA_TEMATICA "Especialidad (Marketing, Gastronomía, etc.)"
        int CUPOS_MAXIMOS "Capacidad máxima permitida"
        int SESIONES_TOTALES "Cantidad total de clases programadas"
        date FECHA_INICIO "Fecha de primera sesión"
        date FECHA_TERMINO "Fecha de última sesión"
        string HORARIO "Días y horas de clases"
        string LUGAR_MODALIDAD "Presencial (Sala) / Online (Zoom/Meet)"
        string NOMBRE_RELATOR "Docente o entidad capacitadora"
        string ESTADO "Planificada / Abierta / En Curso / Finalizada"
    }

    PARTICIPACIONES {
        string ID_PARTICIPACION PK "Ej: PAR-000891 (Cruce relacional N:M)"
        string ID_PERSONA FK "Referencia foránea a PERSONAS"
        string ID_ACTIVIDAD FK "Referencia foránea a ACTIVIDADES"
        string ESTADO_PARTICIPACION "Inscrito / Seleccionado / Lista Espera / Renuncia"
        date FECHA_POSTULACION "Fecha en que solicitó el curso"
        int SESIONES_ASISTIDAS "Contador acumulado de asistencias"
        decimal PORCENTAJE_ASISTENCIA "Cálculo: (Asistidas / Totales) * 100"
        string ESTADO_FINAL "Aprobado / Reprobado / Desertor / Pendiente"
        string MOTIVO_BAJA "Causa en caso de deserción o renuncia"
    }

    SESIONES_ACTIVIDAD {
        string ID_SESION PK "Ej: SES-0001"
        string ID_ACTIVIDAD FK "Vínculo a la actividad"
        int NUMERO_SESION "1, 2, 3... n"
        date FECHA_SESION "Día programado de la clase"
        string CONTENIDO_TRATADO "Tema visto en la sesión"
    }

    ASISTENCIAS_SESION {
        string ID_ASISTENCIA PK "Ej: ASI-0001"
        string ID_PARTICIPACION FK "Vínculo a la matrícula del alumno"
        string ID_SESION FK "Vínculo a la sesión"
        boolean PRESENTE "true = Presente / false = Ausente"
        string OBSERVACION "Justificación médica / Retraso"
        date TIMESTAMP_REGISTRO "Hora exacta en que se marcó la asistencia"
    }

    INTERESES_CAPACITACION {
        string ID_INTERES PK "Ej: INT-0001"
        string ID_PERSONA FK "Vínculo a PERSONAS"
        string ESCUELA_LINEA "Línea solicitada"
        string AREA_TEMATICA "Área demandada"
        date FECHA_DECLARACION "Cuándo manifestó la necesidad"
    }
```

---

## 2. Creación y Ciclo de Vida del Identificador de Persona (`ID_PERSONA`)

### A. Regla de Negocio
1. **Un solo ID por ser humano:** Cada vecino tiene una única ficha en la institución, sin importar cuántos años pasen ni cuántos cursos postule.
2. **Llave Natural vs Llave Subrogada:**
   - La **Llave Natural** es el `RUT` chileno (validado algorítmicamente mediante Módulo 11).
   - La **Llave Primaria Subrogada** es `ID_PERSONA` con estructura `PER-XXXXXX` (prefijo `PER-` seguido de un correlativo numérico de 6 dígitos con ceros a la izquierda, ej. `PER-000045`).
   - Para extranjeros sin RUN definitivo se normaliza su pasaporte o DNI de origen con un prefijo especial (ej. `EXT-XXXX`).

### B. Algoritmo de Normalización y Deduplicación

```mermaid
flowchart TD
    IN["Ingreso de Postulación (Vía Web o Formulario)"] --> N1["Paso 1: Normalización Estricta\n• Elimina puntos, guiones y espacios del RUT\n• Convierte el Dígito Verificador a mayúscula ('K')\n• Convierte nombres a mayúsculas y quita tildes"]
    N1 --> V1{"Paso 2: Validación Algorítmica\n¿RUT chileno válido según Módulo 11?"}
    
    V1 -- "NO" --> ERR["Rechaza o marca para revisión de documento extranjero"]
    V1 -- "SÍ" --> BQ["Paso 3: Búsqueda en Base Maestra por RUT limpio"]
    
    BQ --> COND{"¿Existe coincidencia en la Base de Datos?"}
    
    COND -- "SÍ EXISTE (Vecino Histórico)" --> ACT["RECUPERA ID_PERSONA EXISTENTE\nEjemplo: PER-000318\n• Actualiza teléfono, correo y domicilio actualizados\n• NO duplica la fila en la tabla de personas\n• Mantiene su historial histórico intacto"]
    
    COND -- "NO EXISTE (Nuevo Beneficiario)" --> GEN["GENERA NUEVO CORRELATIVO\nEjemplo: Obtiene MAX(ID) + 1 -> PER-000319\n• Crea registro maestro con fecha de incorporación\n• Asocia RUT validado"]

    ACT --> FIN[("Listo para asociar a la Actividad")]
    GEN --> FIN
```

---

## 3. El Cruce de Datos para la "Participación Real"

Uno de los principales aportes de este diseño es eliminar el sesgo de **"Métricas Infladas"** en las estadísticas municipales.

### A. Definición de Conceptos

1. **Inscripciones Brutas (Demanda Nominal):** 
   - Suma total de registros en `PARTICIPACIONES` con estado `Inscrito`. 
   - Representa el interés de la ciudadanía, pero no indica si se capacitó.
2. **Seleccionados Efectivos (Cupos Utilizados):**
   - Participantes con estado `Seleccionado`. Ocupan la capacidad instalada del curso.
3. **Participación Real / Asistencia Efectiva:**
   - Registros con asistencia comprobada en al menos una clase (`SESIONES_ASISTIDAS >= 1`).
4. **Beneficiarios Aprobados (Impacto Concluido):**
   - Participantes que cumplieron la regla de aprobación institucional:
     $$\text{Porcentaje Asistencia} = \left(\frac{\text{Sesiones Asistidas}}{\text{Sesiones Totales}}\right) \times 100 \ge 75\%$$
5. **Personas Únicas Capacitadas (Métrica de Oro para Alcaldía):**
   - Cantidad de personas distintas (contando `COUNT(DISTINCT ID_PERSONA)`) que aprobaron al menos 1 actividad en el período. Si el vecino `PER-000142` aprobó 3 cursos en el año, cuenta como **1 persona única capacitada** y **3 certificaciones entregadas**.

### B. Matriz de Cruce y Trazabilidad

```mermaid
flowchart LR
    subgraph PERSONAS_DB["Padrón de Beneficiarios"]
        P1["Juan Pérez\nID: PER-000101"]
        P2["María Soto\nID: PER-000102"]
        P3["Pedro Díaz\nID: PER-000103"]
    end

    subgraph CURSOS_DB["Cursos Impartidos"]
        C1["Taller Excel Básico (4 sesiones)\nID: ACT-000010"]
        C2["Taller Marketing Digital (3 sesiones)\nID: ACT-000011"]
    end

    subgraph CRUCE["Tabla de Cruce (PARTICIPACIONES)"]
        R1["PAR-01: Juan Pérez en Excel\nAsistió: 4/4 (100%) -> APROBADO"]
        R2["PAR-02: Juan Pérez en Marketing\nAsistió: 3/3 (100%) -> APROBADO"]
        R3["PAR-03: María Soto en Excel\nAsistió: 1/4 (25%) -> REPROBADO"]
        R4["PAR-04: Pedro Díaz en Marketing\nAsistió: 0/3 (0%) -> DESERTOR"]
    end

    subgraph METRICAS["Reporte de Impacto Real"]
        M1["Inscripciones Totales: 4"]
        M2["Certificados Emitidos: 2"]
        M3["PERSONAS ÚNICAS BENEFICIADAS: 1 (Juan Pérez)"]
        M4["Tasa de Deserción: 25% (Pedro)"]
        M5["Tasa de Reprobación: 25% (María)"]
    end

    P1 --> R1
    P1 --> R2
    P2 --> R3
    P3 --> R4

    C1 --> R1
    C1 --> R3
    C2 --> R2
    C2 --> R4

    R1 --> METRICAS
    R2 --> METRICAS
    R3 --> METRICAS
    R4 --> METRICAS
```

---

## 4. Estructura de Base de Datos Relacional (DDL PostgreSQL)

Para la implementación en un motor de base de datos relacional estándar, se detalla el esquema DDL estructurado:

```sql
-- 1. Tabla Maestra de Personas
CREATE TABLE personas (
    id_persona VARCHAR(12) PRIMARY KEY, -- Ej: PER-000001
    rut VARCHAR(12) UNIQUE NOT NULL,    -- Ej: 12345678-9
    tipo_documento VARCHAR(20) DEFAULT 'RUT',
    numero_documento VARCHAR(20) NOT NULL,
    nombre_completo VARCHAR(255) NOT NULL,
    genero VARCHAR(20),
    fecha_nacimiento DATE,
    telefono VARCHAR(20),
    correo VARCHAR(150),
    comuna VARCHAR(100) DEFAULT 'Santiago',
    direccion TEXT,
    participa_pmjh VARCHAR(2) DEFAULT 'No', -- 'Sí' o 'No'
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Actividades / Capacitaciones
CREATE TABLE actividades (
    id_actividad VARCHAR(12) PRIMARY KEY, -- Ej: ACT-000001
    nombre_actividad VARCHAR(255) NOT NULL,
    escuela_linea VARCHAR(100),
    area_tematica VARCHAR(100),
    cupos_maximos INT NOT NULL DEFAULT 20,
    sesiones_totales INT NOT NULL DEFAULT 1,
    fecha_inicio DATE,
    fecha_termino DATE,
    horario VARCHAR(100),
    modalidad VARCHAR(50) DEFAULT 'Presencial',
    relator VARCHAR(200),
    estado VARCHAR(30) DEFAULT 'Planificada'
);

-- 3. Tabla Cruce de Participaciones (N:M)
CREATE TABLE participaciones (
    id_participacion VARCHAR(12) PRIMARY KEY, -- Ej: PAR-000001
    id_persona VARCHAR(12) REFERENCES personas(id_persona) ON DELETE RESTRICT,
    id_actividad VARCHAR(12) REFERENCES actividades(id_actividad) ON DELETE CASCADE,
    estado_participacion VARCHAR(30) DEFAULT 'Inscrito',
    sesiones_asistidas INT DEFAULT 0,
    porcentaje_asistencia NUMERIC(5,2) DEFAULT 0.00,
    estado_final VARCHAR(30) DEFAULT 'Pendiente',
    fecha_postulacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_persona_actividad UNIQUE (id_persona, id_actividad)
);

-- Índices de alto rendimiento
CREATE INDEX idx_personas_rut ON personas(rut);
CREATE INDEX idx_part_persona ON participaciones(id_persona);
CREATE INDEX idx_part_actividad ON participaciones(id_actividad);
CREATE INDEX idx_part_estado ON participaciones(estado_participacion, estado_final);
```

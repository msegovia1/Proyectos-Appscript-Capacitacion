# Documentación Técnica, Procesos de Negocio y Código Fuente — SIGC
### Departamento de Capacitación — Municipalidad de Santiago

Esta carpeta reúne la documentación técnica, operativa y de datos del **Sistema de Gestión de Capacitaciones (SIGC)**, junto con el **código fuente completo** y las especificaciones necesarias para su despliegue, mantención y evolución tecnológica.

---

## 📂 Contenido de la Carpeta

| Carpeta / Archivo | Tipo | Descripción |
| :--- | :--- | :--- |
| 📁 [**`scripts_sistema/`**](file:///c:/Users/msegovia/Downloads/SGE_v2.1.0_Ficha_Integral_Emprendedor/SGC/documentacion_informatica/scripts_sistema/) | **Subcarpeta de Código** | **Contiene todos los scripts del sistema.** Incluye los 27 archivos `.gs`, `.html` y `appsscript.json`, junto con el archivo **`INSTRUCCIONES_DESPLIEGUE.md`** que detalla el paso a paso para publicarlo vía Clasp o en el editor web de Google Apps Script. |
| 📄 [**`00_RESUMEN_EJECUTIVO_Y_ALCANCE.md`**](file:///c:/Users/msegovia/Downloads/SGE_v2.1.0_Ficha_Integral_Emprendedor/SGC/documentacion_informatica/00_RESUMEN_EJECUTIVO_Y_ALCANCE.md) | Documento Técnico | Diagnóstico del departamento, problemas de las planillas sueltas vs solución integrada, roles de usuarios y mapa de actores. |
| 📄 [**`01_FLUJOGRAMA_PROCESOS_OPERATIVOS.md`**](file:///c:/Users/msegovia/Downloads/SGE_v2.1.0_Ficha_Integral_Emprendedor/SGC/documentacion_informatica/01_FLUJOGRAMA_PROCESOS_OPERATIVOS.md) | Documento Técnico | Flujogramas del trabajo diario de los funcionarios (convocatoria, control de cupos, pase de lista en 1-clic y contacto por WhatsApp). |
| 📄 [**`02_MODELO_DE_DATOS_E_IDENTIFICADORES.md`**](file:///c:/Users/msegovia/Downloads/SGE_v2.1.0_Ficha_Integral_Emprendedor/SGC/documentacion_informatica/02_MODELO_DE_DATOS_E_IDENTIFICADORES.md) | Documento Técnico | Diagrama Entidad-Relación (ERD), lógica del `ID_PERSONA` (`PER-XXXXXX`), el cruce relacional y la fórmula de **Participación Real**. Incluye el script SQL (DDL PostgreSQL). |
| 📄 [**`03_REQUERIMIENTOS_FUNCIONALES_Y_TECNICOS.md`**](file:///c:/Users/msegovia/Downloads/SGE_v2.1.0_Ficha_Integral_Emprendedor/SGC/documentacion_informatica/03_REQUERIMIENTOS_FUNCIONALES_Y_TECNICOS.md) | Documento Técnico | Especificación formal de Requerimientos de Software (RF-01 al RF-17 y RNF de seguridad, concurrencia y exportaciones). |

---

## 🚀 Guía de Uso de la Documentación

1. **Código fuente (`scripts_sistema/`)**: Permite desplegar de inmediato un entorno funcional y auditar el código siguiendo `INSTRUCCIONES_DESPLIEGUE.md`.
2. **Procesos operativos (`01_FLUJOGRAMA_PROCESOS_OPERATIVOS.md`)**: Describe el flujo de trabajo diario de los funcionarios, el control de cupos y la toma de asistencia.
3. **Modelo de datos (`02_MODELO_DE_DATOS_E_IDENTIFICADORES.md`)**: Detalla el modelo relacional, la identificación única por RUT (`PER-XXXXXX`) y el cruce para medir la participación real.
4. **Requerimientos de software (`03_REQUERIMIENTOS_FUNCIONALES_Y_TECNICOS.md`)**: Especifica los requerimientos funcionales (RF) y no funcionales (RNF) del sistema.

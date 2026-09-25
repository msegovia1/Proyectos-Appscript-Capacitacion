# Carpeta de Documentación y Código Fuente para el Equipo de Informática
### Departamento de Capacitación — Municipalidad de Santiago

Esta carpeta contiene todo el material técnico, operativo, relacional y **el código fuente completo del sistema**, diseñado para que el **Equipo de Informática** pueda comprender los procesos, desplegar el sistema en un entorno propio y desarrollar o evolucionar la solución institucional.

---

## 📂 Contenido de la Carpeta

| Carpeta / Archivo | Tipo | Descripción |
| :--- | :--- | :--- |
| 📁 [**`scripts_sistema/`**](file:///c:/Users/msegovia/Downloads/SGE_v2.1.0_Ficha_Integral_Emprendedor/SGC/documentacion_informatica/scripts_sistema/) | **Subcarpeta de Código** | **Contiene todos los scripts listos para desplegar.** Incluye los 27 archivos `.gs`, `.html` y `appsscript.json`, junto con el archivo **`INSTRUCCIONES_DESPLIEGUE.md`** que explica paso a paso cómo publicarlo vía Clasp o en el editor web de Google Apps Script. |
| 📄 [**`00_RESUMEN_EJECUTIVO_Y_ALCANCE.md`**](file:///c:/Users/msegovia/Downloads/SGE_v2.1.0_Ficha_Integral_Emprendedor/SGC/documentacion_informatica/00_RESUMEN_EJECUTIVO_Y_ALCANCE.md) | Documento Técnico | Diagnóstico del departamento, problemas de las planillas sueltas vs solución integrada, roles de usuarios y mapa de actores. |
| 📄 [**`01_FLUJOGRAMA_PROCESOS_OPERATIVOS.md`**](file:///c:/Users/msegovia/Downloads/SGE_v2.1.0_Ficha_Integral_Emprendedor/SGC/documentacion_informatica/01_FLUJOGRAMA_PROCESOS_OPERATIVOS.md) | Documento Técnico | Flujogramas detallados del trabajo diario de los funcionarios (convocatoria, control de cupos, pase de lista en 1-clic y contacto por WhatsApp). |
| 📄 [**`02_MODELO_DE_DATOS_E_IDENTIFICADORES.md`**](file:///c:/Users/msegovia/Downloads/SGE_v2.1.0_Ficha_Integral_Emprendedor/SGC/documentacion_informatica/02_MODELO_DE_DATOS_E_IDENTIFICADORES.md) | Documento Técnico | Diagrama Entidad-Relación (ERD), lógica del `ID_PERSONA` (`PER-XXXXXX`), el cruce relacional y la fórmula de **Participación Real**. Incluye el script SQL (DDL PostgreSQL) listo para desarrolladores. |
| 📄 [**`03_REQUERIMIENTOS_FUNCIONALES_Y_TECNICOS.md`**](file:///c:/Users/msegovia/Downloads/SGE_v2.1.0_Ficha_Integral_Emprendedor/SGC/documentacion_informatica/03_REQUERIMIENTOS_FUNCIONALES_Y_TECNICOS.md) | Documento Técnico | Especificación formal de Requerimientos de Software (RF-01 al RF-17 y RNF de seguridad, concurrencia y exportaciones) para el backlog de Informática. |

---

## 🚀 ¿Cómo trabajar con Informática con este material?

1. **Entregar la subcarpeta `scripts_sistema/`**: Los desarrolladores pueden clonarla o subirla directamente a un Google Apps Script de prueba siguiendo la guía `INSTRUCCIONES_DESPLIEGUE.md`.
2. **Revisar `01_FLUJOGRAMA_PROCESOS_OPERATIVOS.md`**: Permite al equipo de desarrollo entender el día a día del funcionario en la sala de clases y en ventanilla.
3. **Revisar `02_MODELO_DE_DATOS_E_IDENTIFICADORES.md`**: Es la pieza clave para que los ingenieros comprendan por qué el cruce entre `PERSONAS` y `ACTIVIDADES` a través de `PARTICIPACIONES` es indispensable para evitar métricas infladas en el municipio.
4. **Usar `03_REQUERIMIENTOS_FUNCIONALES_Y_TECNICOS.md`**: Sirve como base directa para que Informática arme las historias de usuario (User Stories) en Jira o el levantamiento formal del proyecto.

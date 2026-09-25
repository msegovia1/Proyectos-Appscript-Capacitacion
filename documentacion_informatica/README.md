# Carpeta de Documentación y Especificación para el Equipo de Informática
### Departamento de Capacitación — Municipalidad de Santiago

Esta carpeta contiene todo el material técnico, operativo y relacional diseñado para explicar el funcionamiento del Departamento de Capacitación al **Equipo de Informática**, permitiéndoles comprender las reglas de negocio y desarrollar o evolucionar el sistema institucional.

---

## 📂 Contenido de la Carpeta

| Archivo | Formato | Descripción |
| :--- | :--- | :--- |
| **`04_VISUALIZADOR_INTERACTIVO.html`** | **HTML (Recomendado)** | **Visualizador gráfico completo.** Se abre con doble clic en cualquier navegador (Chrome/Edge). Permite ver todos los flujogramas interactivos, tablas y pestañas, ideal para proyectar en reuniones o guardar como PDF. |
| **`00_RESUMEN_EJECUTIVO_Y_ALCANCE.md`** | Markdown | Diagnóstico, actores, roles y alcance general del sistema. |
| **`01_FLUJOGRAMA_PROCESOS_OPERATIVOS.md`** | Markdown | Flujogramas detallados del trabajo diario de los funcionarios, control de cupos y toma de asistencia. |
| **`02_MODELO_DE_DATOS_E_IDENTIFICADORES.md`** | Markdown | Diagrama Entidad-Relación (ERD), lógica del `ID_PERSONA` (`PER-XXXXXX`) y cálculo de la **Participación Real**. Incluye script DDL SQL sugerido para PostgreSQL. |
| **`03_REQUERIMIENTOS_FUNCIONALES_Y_TECNICOS.md`** | Markdown | Especificación formal de Requerimientos de Software (RF-01 a RF-17 y RNF de seguridad/rendimiento) para el backlog de desarrollo. |

---

## 🚀 ¿Cómo usar este material en la reunión con Informática?

1. **Abre el archivo `04_VISUALIZADOR_INTERACTIVO.html`** en tu navegador.
2. Comienza mostrando la pestaña **1. Resumen y Alcance** para alinear el objetivo: eliminar planillas dispersas y crear un padrón único.
3. Avanza a **2. Flujogramas Operativos** para mostrar el día a día del funcionario (selección de cupos, pase de lista en 1-clic y contacto por WhatsApp).
4. Pasa a **3. Identificadores y Modelo de Datos** para demostrar cómo el cruce entre `PERSONAS` y `ACTIVIDADES` a través de `PARTICIPACIONES` calcula la **participación real de los vecinos** y previene estadísticas infladas.
5. Concluye en **4. Requerimientos** para entregarles formalmente lo que el sistema debe cumplir en base de datos, seguridad y exportaciones.

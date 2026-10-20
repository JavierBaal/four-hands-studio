# Skills de Four Hands

**Desde el 20/10/2026 las sirve la app** (`list_skills` y `load_skill`, herramientas versión 9, extensión 0.3.6). Viajan dentro de Four Hands y Claude las carga solo: `four-hands-basics` al empezar cada conversación y las demás cuando encajan. Ya no hace falta instalarlas en Claude; si las tienes instaladas, bórralas de Customize > Skills para que no haya dos copias. Los ZIP siguen sirviendo para usarlas fuera de Four Hands.

**Tus propias skills:** carpeta `Documentos/Four Hands/Skills`, una carpeta por skill con su `SKILL.md`. Aparecen al momento, sin reiniciar, y si una se llama como una de serie, manda la tuya.

**Versión 2 (20/10/2026)**, tras la prueba de Severance con y sin skills:
- Descripciones más directas para que se carguen solas: `four-hands-basics` al empezar cualquier sesión, `listening-review` después de cada escritura grande y `orchestration-register` antes de escribir con tres o más pistas.
- Esbozos cortos antes de construir la pieza entera.
- Iterar en vez de rehacer.
- Mantener la partitura al día con `annotate` (id) y `remove_annotations`.
- No arrastrar recursos de piezas anteriores.
- Tópicos vecinos: circo siniestro, tristeza romántica y color andaluz o árabe.
- El atlas de estilos es vocabulario, no receta.

Para actualizar: en Customize > Skills, borra cada skill y sube su ZIP nuevo.

**Versión 1 (19/10/2026).**

Primer paso del plan de `ESTUDIO_SKILLS_COMPOSICION.md`. Son cinco skills en inglés, el idioma que mejor siguen los modelos, con ejemplos en español porque los usuarios piden en su idioma.

| Skill | Para qué |
|---|---|
| `listening-review` | Revisar lo escrito antes de entregarlo: barro en el grave, registro medio saturado, bloques copiados, dinámicas en rampa, tópicos, límites de la canción y efectos de los propios arreglos |
| `orchestration-register` | Capas y registros, límites de intervalos en el grave, separación de voces, doblajes y rangos cómodos de cada instrumento |
| `four-hands-basics` | Cómo trabajar en Four Hands: el ciclo, el concepto de la canción con sus límites, intervenciones pequeñas, respetar lo tocado, revisar y contar |
| `feelings-to-music` | Entender a cualquier usuario: reflejar en una frase, preguntar por contraste, tabla de traducción de sensaciones, de la referencia a la técnica y tópicos del género vecino |
| `styles` | Atlas: cabecera experimental, cinematográfico e híbrido, oscuro electrónico y *cyberpunk* |

## Cómo instalarlas

1. En Claude: **Customize > Skills**, subir cada ZIP de la carpeta `zip/`.
2. Activarlas. Claude las usará solo cuando encajen con lo que pides.

Para actualizar una skill más adelante: borrar la anterior y subir el ZIP nuevo, como con el consejo.

## Cómo probarlas

**Uso normal.** Compón como estos días y fíjate en tres cosas:
- si Claude se revisa antes de entregar;
- si el primer borrador cae menos en tópicos;
- si reparte mejor los registros.

**Prueba a ciegas** (sección 7 del estudio). Cada encargo se pide en una canción vacía dos veces: una con las skills desactivadas y otra activadas. Se exporta cada resultado y se escuchan sin saber cuál es cuál.

1. «Una cabecera de 45 segundos para una serie sobre una invasión que nadie ve».
2. Lo mismo en técnico: «Cabecera de 45 s en Re menor con pedal de Re, roce de semitono que crece, ostinato cojo y corte en seco antes del golpe final».
3. «Una persecución de noche por una ciudad de neón, un minuto».
4. «Un tema íntimo de piano y chelo que se abre al final».

Lo que me cuentes de cada encargo (qué ha mejorado, qué sigue fallando) va directo a la siguiente versión de las skills.

# ReadOff 📚⚔️

**¿Quién lee más rápido?** — Duelos de lectura 1 vs 1. Configura un libro, reta a un amigo con un código de 6 caracteres y compite por terminar los capítulos primero.

## Funciones

- **Login sencillo**: usuario + contraseña (sesión de 90 días).
- **Duelos por código**: creas el duelo (título, autor, género, nº de capítulos, portada, fecha límite opcional) y compartes un código de 6 caracteres.
- **Lector integrado**: si el duelo está enlazado a una novela de chikari.moe, puedes leer capítulo por capítulo dentro de ReadOff, con ajustes de tipo de letra, tamaño, interlineado, ancho de columna y tema de lectura (oscuro / sepia / claro). **Al pasar al siguiente capítulo el anterior se marca solo**, así que ya no hace falta el botón ni una segunda ventana. Cada capítulo se descarga una única vez y queda en caché en tu servidor.
- **Autoconfiguración desde chikari.moe**: pega la URL de una novela y se rellenan solos el título, autor, géneros, número de capítulos y la portada oficial. Si el duelo ya existía, puedes enlazarlo después desde la propia pantalla del duelo.
- **Portada configurable**: sube JPG/PNG/WebP (hasta 5MB), tráela de chikari, o deja que se genere una portada elegante automáticamente.
- **Progreso por capítulos**: cuadrícula interactiva (paginada en bloques de 100 para novelas largas), marca el siguiente capítulo leído y puedes revertir el último.
- **Comentarios por capítulo**: notas cortas (máx. 280 caracteres, ilimitadas) entre los dos duelistas, con **anti-spoiler**: los comentarios sobre capítulos más adelantados que tu progreso llegan ocultos hasta que tocas para revelarlos.
- **Estadísticas en vivo**: ventaja, ritmo (caps/día), racha de días, fecha estimada de fin, actividad del duelo, posición del rival.
- **Victoria automática**: el primero en marcar el capítulo final se corona campeón.
- **Eliminar duelos**: desde la tarjeta del dashboard o desde la pantalla del duelo. Para evitar borrados accidentales hay que **escribir el título del libro** para habilitar el botón. Borra el duelo para ambos duelistas junto con el progreso, los comentarios y la portada.
- **Perfil**: victorias, derrotas, capítulos totales, mayor racha e historial de duelos.
- **Modo claro y oscuro** 🌙☀️ y **dos idiomas** (español / inglés), ambos con un clic en el header y recordados en tu navegador.
- **Compatible con el traductor del navegador**: la interfaz está marcada como no traducible (usa el botón ES/EN de la app para eso) y solo el texto del capítulo queda expuesto al traductor de Chrome. Así se puede leer la novela en español sin que se rompan los iconos ni el diseño.
- **Responsive**: funciona igual de bien en computadora y celular.

> El límite es de 2500 capítulos por duelo, así que las novelas largas (tipo *Lord of the Mysteries*, 1432 caps) entran sin problema.

## Correr en local

```bash
npm install
npm start
```

Abre http://localhost:3000. Los datos se guardan en `data/` (SQLite + portadas).

> Cuentas de prueba locales: `leo` / `prueba123` y `mateo` / `prueba123`.

## Publicar en Railway

1. **Sube el repo a GitHub** (si aún no lo has hecho):
   ```bash
   git add -A && git commit -m "ReadOff v1" && git push
   ```
2. Entra a [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → elige `ReadOff`. Railway detecta Node.js y lo despliega solo.
3. **Agrega un volumen** (para que la base de datos y las portadas sobrevivan a los deploys): en el servicio → clic derecho / botón **+ Volume** → móntalo en `/data`.
4. **Variables de entorno** (pestaña *Variables* del servicio):
   | Variable | Valor |
   |---|---|
   | `DATA_DIR` | `/data` |
   | `NODE_ENV` | `production` |
   | `SESSION_SECRET` | una cadena larga aleatoria (ej. genera una con `openssl rand -hex 32`) |
5. En *Settings* → **Networking** → **Generate Domain** para obtener tu URL pública (`xxxx.up.railway.app`).
6. ¡Listo! Comparte la URL con tu rival y a leer.

## Stack

- **Backend**: Node.js + Express + SQLite (`better-sqlite3`), JWT en cookie httpOnly, `bcryptjs`, `multer` para portadas.
- **Frontend**: HTML + Tailwind (CDN) + JS vanilla, design system "Nocturne Salon" (Playfair Display + Plus Jakarta Sans), con paleta clara y oscura en variables CSS.
- Los diseños originales de Stitch están en [`designs/`](designs/).

## Notas

- ReadOff usa la API pública de chikari.moe para traer la ficha de la novela y el texto de los capítulos que ya podrías leer en su web. Es una herramienta **de uso personal** para los dos duelistas: el contenido pertenece a sus autores y traductores, y lo que se guarda en caché es solo lo que ustedes leen.
- Si algún día cambian su API, el lector y la autoconfiguración dejarían de funcionar, pero los duelos y el marcado manual de capítulos seguirían intactos.

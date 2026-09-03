# ReadOff 📚⚔️

**¿Quién lee más rápido?** — Duelos de lectura 1 vs 1. Configura un libro, reta a un amigo con un código de 6 caracteres y compite por terminar los capítulos primero.

## Funciones

- **Login sencillo**: usuario + contraseña (sesión de 90 días).
- **Duelos por código**: creas el duelo (título, autor, género, nº de capítulos, portada, fecha límite opcional) y compartes un código de 6 caracteres.
- **Autoconfiguración desde chikari.moe**: pega la URL de una novela y se rellenan solos el título, autor, géneros, número de capítulos y la portada oficial.
- **Portada configurable**: sube JPG/PNG/WebP (hasta 5MB), tráela de chikari, o deja que se genere una portada elegante automáticamente.
- **Progreso por capítulos**: cuadrícula interactiva (paginada en bloques de 100 para novelas largas), marca el siguiente capítulo leído y puedes revertir el último.
- **Comentarios por capítulo**: notas cortas (máx. 280 caracteres, ilimitadas) entre los dos duelistas, con **anti-spoiler**: los comentarios sobre capítulos más adelantados que tu progreso llegan ocultos hasta que tocas para revelarlos.
- **Estadísticas en vivo**: ventaja, ritmo (caps/día), racha de días, fecha estimada de fin, actividad del duelo, posición del rival.
- **Victoria automática**: el primero en marcar el capítulo final se corona campeón.
- **Perfil**: victorias, derrotas, capítulos totales, mayor racha e historial de duelos.
- **Modo claro y oscuro** 🌙☀️ y **dos idiomas** (español / inglés), ambos con un clic en el header y recordados en tu navegador.
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

- La autoconfiguración solo **consulta los datos públicos** de la ficha de una novela en chikari.moe (título, autor, géneros, nº de capítulos y portada) para ahorrarte escribirlos. No descarga ni almacena el texto de los capítulos: la lectura sigue siendo en su web.
- Si algún día cambian su API, esa función dejaría de rellenar los campos, pero el duelo se puede seguir creando a mano con normalidad.

# ReadOff 📚⚔️

**¿Quién lee más rápido?** — Duelos de lectura 1 vs 1. Configura un libro, reta a un amigo con un código de 6 caracteres y compite por terminar los capítulos primero.

## Funciones

- **Login sencillo**: usuario + contraseña (sesión de 90 días).
- **Duelos por código**: creas el duelo (título, autor, género, nº de capítulos, portada, fecha límite opcional) y compartes un código de 6 caracteres.
- **Portada configurable**: sube JPG/PNG/WebP (hasta 5MB) o se genera una portada elegante automáticamente.
- **Progreso por capítulos**: cuadrícula interactiva, marca el siguiente capítulo leído (y puedes revertir el último).
- **Estadísticas en vivo**: ventaja, ritmo (caps/día), racha de días, fecha estimada de fin, actividad del duelo, posición del rival.
- **Victoria automática**: el primero en marcar el capítulo final se corona campeón.
- **Perfil**: victorias, derrotas, capítulos totales, mayor racha e historial de duelos.
- **Responsive**: funciona igual de bien en computadora y celular.

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
- **Frontend**: HTML + Tailwind (CDN) + JS vanilla, design system "Nocturne Salon" (Playfair Display + Plus Jakarta Sans).
- Los diseños originales de Stitch están en [`designs/`](designs/).

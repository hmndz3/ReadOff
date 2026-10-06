/* Comprueba que todo el JavaScript del proyecto compila: los módulos del
   servidor, los del cliente y los <script> embebidos en cada página.
   Un error de sintaxis en un HTML no se ve al arrancar el servidor pero deja
   la página en blanco, así que conviene pasarlo antes de publicar. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let fallos = 0;

for (const f of ['server/index.js', 'server/db.js', 'server/sources.js', 'public/js/app.js', 'public/js/tw.js']) {
  if (!fs.existsSync(f)) continue;
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'));
    console.log('  ok    ' + f);
  } catch (e) {
    console.log('  FALLA ' + f + ' -> ' + e.message);
    fallos++;
  }
}

for (const f of fs.readdirSync('public').filter((x) => x.endsWith('.html'))) {
  const ruta = path.join('public', f);
  const html = fs.readFileSync(ruta, 'utf8');
  const bloques = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const malos = [];
  bloques.forEach((b, i) => {
    if (!b.trim()) return;
    try {
      new vm.Script(b);
    } catch (e) {
      malos.push(`bloque ${i + 1}: ${e.message}`);
    }
  });
  if (malos.length) {
    console.log('  FALLA ' + ruta + ' -> ' + malos.join(' | '));
    fallos++;
  } else {
    console.log('  ok    ' + ruta);
  }
}

if (fallos) {
  console.error(`\n${fallos} archivo(s) con errores de sintaxis`);
  process.exit(1);
}
console.log('\nTodo compila');

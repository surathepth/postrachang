const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '..');

function readFile(relPath) {
  return fs.readFileSync(path.join(baseDir, relPath), 'utf8');
}

// Escape any </script within JavaScript to <\/script so HTML parser doesn't break
function safeInline(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

// 1. Process index.html
let indexHtml = readFile('index.html');

const jsBarcode = safeInline(readFile('lib/JsBarcode.all.min.js'));
const qrcode = safeInline(readFile('lib/qrcode.min.js'));
const productsPakse = safeInline(readFile('products-pakse-data.js'));
const dbJs = safeInline(readFile('db.js'));
const scaleService = safeInline(readFile('scale-service.js'));
const printerService = safeInline(readFile('printer-service.js'));
const syncService = safeInline(readFile('sync-service.js'));
const authJs = safeInline(readFile('auth.js'));

const indexOldScripts = `  <!-- Scripts -->
  <script src="products-pakse-data.js"></script>
  <script src="db.js"></script>
  <script src="scale-service.js"></script>
  <script src="printer-service.js"></script>
  <script src="sync-service.js"></script>
  <script src="auth.js"></script>`;

const indexNewScripts = `  <!-- Embedded Standalone Scripts for 100% Offline Android & Content:// Support -->
  <script>
/* --- lib/JsBarcode.all.min.js --- */
${jsBarcode}
  </script>
  <script>
/* --- lib/qrcode.min.js --- */
${qrcode}
  </script>
  <script>
/* --- products-pakse-data.js --- */
${productsPakse}
  </script>
  <script>
/* --- db.js --- */
${dbJs}
  </script>
  <script>
/* --- scale-service.js --- */
${scaleService}
  </script>
  <script>
/* --- printer-service.js --- */
${printerService}
  </script>
  <script>
/* --- sync-service.js --- */
${syncService}
  </script>
  <script>
/* --- auth.js --- */
${authJs}
  </script>`;

if (!indexHtml.includes(indexOldScripts)) {
  console.error('ERROR: Could not find exact indexOldScripts chunk in index.html');
  process.exit(1);
}

indexHtml = indexHtml.replace(indexOldScripts, indexNewScripts);
fs.writeFileSync(path.join(baseDir, 'index.html'), indexHtml, 'utf8');
console.log('Successfully bundled standalone scripts into index.html');

// 2. Process admin.html
let adminHtml = readFile('admin.html');

const adminOldScripts = `  <!-- Scripts -->
  <script src="lib/JsBarcode.all.min.js"></script>
  <script src="lib/qrcode.min.js"></script>
  <script src="products-pakse-data.js"></script>
  <script src="db.js"></script>
  <script src="printer-service.js"></script>
  <script src="sync-service.js"></script>
  <script src="auth.js"></script>`;

const adminNewScripts = `  <!-- Embedded Standalone Scripts for 100% Offline Android & Content:// Support -->
  <script>
/* --- lib/JsBarcode.all.min.js --- */
${jsBarcode}
  </script>
  <script>
/* --- lib/qrcode.min.js --- */
${qrcode}
  </script>
  <script>
/* --- products-pakse-data.js --- */
${productsPakse}
  </script>
  <script>
/* --- db.js --- */
${dbJs}
  </script>
  <script>
/* --- printer-service.js --- */
${printerService}
  </script>
  <script>
/* --- sync-service.js --- */
${syncService}
  </script>
  <script>
/* --- auth.js --- */
${authJs}
  </script>`;

if (!adminHtml.includes(adminOldScripts)) {
  console.error('ERROR: Could not find exact adminOldScripts chunk in admin.html');
  process.exit(1);
}

adminHtml = adminHtml.replace(adminOldScripts, adminNewScripts);
fs.writeFileSync(path.join(baseDir, 'admin.html'), adminHtml, 'utf8');
console.log('Successfully bundled standalone scripts into admin.html');

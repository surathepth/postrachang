const fs = require('fs');
const path = require('path');
const vm = require('vm');

const baseDir = path.resolve(__dirname, '..');

function verifyHtml(filename) {
  const content = fs.readFileSync(path.join(baseDir, filename), 'utf8');
  const regex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;
  let errors = 0;

  console.log(`--- Verifying ${filename} ---`);
  while ((match = regex.exec(content)) !== null) {
    scriptIndex++;
    const code = match[1].trim();
    if (!code) continue; // External script tag or empty

    try {
      new vm.Script(code, { filename: `${filename}#script${scriptIndex}` });
      console.log(`  Script ${scriptIndex}: OK (${code.length} chars)`);
    } catch (err) {
      console.error(`  Script ${scriptIndex} ERROR:`, err.message);
      errors++;
    }
  }

  if (errors === 0) {
    console.log(`[PASS] All scripts in ${filename} passed syntax check (0 errors).`);
  } else {
    console.error(`[FAIL] ${filename} had ${errors} script syntax errors.`);
    process.exit(1);
  }
}

verifyHtml('index.html');
verifyHtml('admin.html');

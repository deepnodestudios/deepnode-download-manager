const fs = require('fs');
const path = require('path');
const dir = 'frontend/src/i18n';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'index.js');
const fileData = {};
files.forEach(f => {
  fileData[f] = fs.readFileSync(path.join(dir, f), 'utf8');
});
const enContent = fileData['en.js'];
const trContent = fileData['tr.js'];
const extractKeys = (content) => {
  const keys = {};
  const matches = content.matchAll(/^\s*([a-zA-Z0-9_]+)\s*:\s*(['"`])(.*?)\2,/gm);
  for (const m of matches) {
    keys[m[1]] = m[0];
  }
  return keys;
};
const enKeys = extractKeys(enContent);
const trKeys = extractKeys(trContent);
// Give priority to English, but take missing from Turkish. Also opt_alt_default from other files
let allKeysObj = {...enKeys, ...trKeys};

// Get all keys from ALL files just in case
files.forEach(f => {
    const keys = extractKeys(fileData[f]);
    allKeysObj = {...allKeysObj, ...keys};
});

// Since we want English defaults for missing stuff, let's reset values to EN where they exist
allKeysObj = {...allKeysObj, ...enKeys};

const allKeys = Object.keys(allKeysObj);
files.forEach(f => {
  let content = fileData[f];
  const fKeys = extractKeys(content);
  let added = false;
  allKeys.forEach(k => {
    if (!fKeys[k]) {
      const replacement = allKeysObj[k];
      content = content.replace(/(export default \{|const [a-zA-Z]+ = \{)/, `$1\n${replacement}`);
      added = true;
    }
  });
  if (added) {
    fs.writeFileSync(path.join(dir, f), content, 'utf8');
    console.log('Synced', f);
  }
});

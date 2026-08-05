import fs from 'node:fs';
const src = fs.readFileSync('scripts/cdp-experiment-roster-extension-qa.mjs','utf8');
function extract(name){const m = src.match(new RegExp('const '+name+' = `([\s\S]+?)`;'));if(!m)throw new Error('missing '+name);return m[1];}
for (const name of ['MOCK_FETCH_SOURCE','SEED_SOURCE']) { const body = extract(name); new Function(body); console.log(name, 'OK', body.length, 'chars'); }

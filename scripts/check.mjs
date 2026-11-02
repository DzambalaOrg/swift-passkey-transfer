import {readFile,readdir,lstat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {DEFAULTS} from '../extension/defaults.mjs';
const root=new URL('../extension/',import.meta.url);
const expected=new Set(['manifest.json','open.js','defaults.mjs','remainder.html','remainder.css','remainder.mjs','remainder-codec.mjs','remainder-network.mjs','remainder-controller.mjs','remainder-journal.mjs','verify.mjs','vendor']);
assert.deepEqual(new Set(await readdir(root)),expected);
assert.deepEqual(DEFAULTS,{source:'',recipient:''},'Public project must have blank address defaults.');
const manifest=JSON.parse(await readFile(new URL('manifest.json',root)));
assert.equal(manifest.manifest_version,3);assert.equal(manifest.version,'2.0.1');
assert.deepEqual(new Set(manifest.host_permissions),new Set(['https://trustwallet.com/*','https://bsc-rpc.publicnode.com/*','https://polygon-bor-rpc.publicnode.com/*','https://public.pimlico.io/*']));
assert.equal(manifest.content_scripts,undefined);assert.equal(manifest.web_accessible_resources,undefined);assert.equal(manifest.permissions,undefined);
let count=0;
async function walk(url){for(const name of await readdir(url)){const f=new URL(name,url),stat=await lstat(f);assert.equal(stat.isSymbolicLink(),false);if(stat.isDirectory()){await walk(new URL(name+'/',url));continue;}const text=await readFile(f,'utf8');assert.doesNotMatch(text,/[А-Яа-яЁё]|\/Users\//,'Public extension must be English and free of local paths.');
 if(/\.(?:mjs|js)$/.test(name)){const result=spawnSync(process.execPath,['--check',fileURLToPath(f)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);for(const m of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))assert.ok((await lstat(new URL(m[1],f))).isFile());}
 count++;}}
await walk(root);
const html=await readFile(new URL('remainder.html',root),'utf8'),ui=await readFile(new URL('remainder.mjs',root),'utf8');
assert.match(html,/<html lang="en">/);assert.equal([...html.matchAll(/id="([^"]+)"/g)].length,new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1])).size);
for(const match of ui.matchAll(/el\('([^']+)'\)/g))assert.ok(html.includes(`id="${match[1]}"`),'Missing UI element '+match[1]);
console.log('Checked '+count+' extension files, imports, syntax, English UI, blank defaults and permission policy.');

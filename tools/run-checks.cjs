const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
for(const file of fs.readdirSync(root).filter(name=>/\.(cjs|js)$/.test(name)))run(['--check',file]);
run(['--test',...fs.readdirSync(path.join(root,'tests')).filter(name=>name.endsWith('.test.cjs')).map(name=>'tests/'+name)]);
for(const name of fs.readdirSync(__dirname).filter(name=>/^check-.*\.cjs$/.test(name)&&!['check-publish.cjs','check-image-copy.cjs','check-storage-only.cjs'].includes(name)))run(['tools/'+name]);
console.log('All automated checks passed. Native Electron UI smoke checks remain manual.');

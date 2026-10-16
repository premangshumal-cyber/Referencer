import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(path.join(root,'dist','src'),{recursive:true});
for(const file of ['index.html','src/app.js','src/math.js','src/export.js','src/style.css']){
 await cp(path.join(root,file),path.join(root,'dist',file));
}
let html=await readFile(path.join(root,'dist','index.html'),'utf8');
html=html.replaceAll('href="/src/style.css"','href="./src/style.css"').replaceAll('src="/src/app.js"','src="./src/app.js"');
await writeFile(path.join(root,'dist','index.html'),html);
console.log('Built zero-dependency static Referencer release.');

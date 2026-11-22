import { readdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const dir='dist',html=await readFile(join(dir,'index.html'),'utf8');
const Asset=relative=>join(dir,'assets',relative.split('/').at(-1));
let portable=html;
for(const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)){
  const js=await readFile(Asset(match[1]),'utf8');
  portable=portable.replace(match[0],()=>'<script type="module">'+js.replace(/<\/script/gi,'<\\/script')+'</script>');
}
for(const match of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)){
  const css=await readFile(Asset(match[1]),'utf8');portable=portable.replace(match[0],()=>'<style>'+css+'</style>');
}
portable=portable.replace(/<link\b[^>]*rel="(?:manifest|icon|apple-touch-icon|modulepreload)"[^>]*>/g,'');
portable=portable.replace('<head>','<head><script type="application/json" id="cb-embedded"></script>');
await writeFile(join(dir,'portable.html'),portable);
const assets=(await readdir(join(dir,'assets'))).map(n=>'./assets/'+n);
const paths=['./','./index.html','./manifest.webmanifest','./portable.html',...assets];
const hash=createHash('sha256').update(portable);
for(const name of ['manifest.webmanifest','sw.js',...assets])hash.update(await readFile(join(dir,name)));
const sw=(await readFile(join(dir,'sw.js'),'utf8')).replace("'development'",JSON.stringify(hash.digest('hex').slice(0,16))).replace(/^const SHELL = .*?;$/m,()=> 'const SHELL = '+JSON.stringify(paths)+';');
await writeFile(join(dir,'sw.js'),sw);
console.log('Distribuição offline preparada com '+paths.length+' recursos.');

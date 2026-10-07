import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('app/src/main/assets');
const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.gltf':'model/gltf+json','.bin':'application/octet-stream','.png':'image/png'};
http.createServer((req,res)=>{
 try{const url=new URL(req.url,'http://127.0.0.1:4321');if(!url.pathname.startsWith('/assets/')){res.writeHead(404);res.end();return;}
  const target=path.resolve(root,decodeURIComponent(url.pathname.slice(8)));if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Content-Length':fs.statSync(target).size});fs.createReadStream(target).pipe(res);
 }catch{res.writeHead(400);res.end();}
}).listen(4321,'127.0.0.1',()=>console.log('Packaged assets: http://127.0.0.1:4321/assets/index.html'));

const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'site');
http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(req.method==='POST'&&/^\/__evidence\/[a-z0-9-]+$/.test(u.pathname)){let body='';req.on('data',v=>body+=v);req.on('end',()=>{JSON.parse(body);fs.writeFileSync(path.join(__dirname,u.pathname.split('/').pop()+'.json'),body);res.writeHead(200).end('saved')});return;}const p=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return}fs.readFile(p,(e,b)=>{if(e){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[path.extname(p)]||'text/plain','Cache-Control':'no-store'}).end(b)})}).listen(4220,'127.0.0.1',()=>console.log('Evidence server 4220'));






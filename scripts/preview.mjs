import {createServer} from 'node:http';
import worker from '../dist/server/index.js';
import {database} from '../test/d1.mjs';
const env = {DB:database()};
createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://127.0.0.1:5173');
    if(['/signin-with-chatgpt','/signout-with-chatgpt','/callback'].includes(url.pathname)) {
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('OpenAI sign-in is available on the published site.');return;
    }
    // Local preview is deliberately anonymous. Do not simulate OpenAI identity.
    const response = await worker.fetch(new Request(url,{method:req.method}),env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500);res.end('Preview unavailable');}
}).listen(5173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:5173'));

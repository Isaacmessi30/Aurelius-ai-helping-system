import { getVerifiedCustomer } from './identity-live.js';

const redact = text => String(text)
  .replace(/(?:ptlc_|ptla_|sk-)[A-Za-z0-9_-]{12,}/g,'[REDACTED_KEY]')
  .replace(/(?:token|secret|password|api[_-]?key)\s*[:=]\s*["']?[^\s"'\\]{6,}/gi,'[REDACTED_CREDENTIAL]')
  .replace(/https?:\/\/[^\s]*@/gi,'https://[REDACTED]@');

export async function captureConsole(discordId, serverId, timeoutMs = 12000) {
  const account=await getVerifiedCustomer(discordId);
  const server=account?.servers.find(s=>s.identifier===serverId);
  if(!server) throw new Error('Server ownership could not be verified.');
  const base=new URL(process.env.PTERODACTYL_URL);
  if(base.protocol!=='https:')throw new Error('Panel HTTPS is required.');
  const endpoint=new URL('/api/client/servers/'+encodeURIComponent(serverId)+'/websocket',base);
  const response=await fetch(endpoint,{headers:{
    Authorization:'Bearer '+process.env.PTERODACTYL_CLIENT_API_KEY,
    Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Console authorization HTTP '+response.status);
  const {data}=await response.json();
  const socketUrl=new URL(data?.socket||'');
  if(socketUrl.protocol!=='wss:')throw new Error('Console endpoint must use encrypted WebSocket.');
  if(typeof WebSocket!=='function')throw new Error('WebSocket not available on this Node runtime.');
  const lines=[],cap=12000;
  let authenticated=false;
  const socket=new WebSocket(socketUrl.toString());
  return new Promise((resolve,reject)=>{
    let finished=false;
    const finish=(error)=>{
      if(finished)return;finished=true;clearTimeout(timer);
      try{socket.close();}catch{}
      if(error)reject(error);
      else resolve({server:server.name,logs:redact(lines.join('\n')).slice(-cap)});
    };
    const timer=setTimeout(()=>finish(),Math.min(20000,Math.max(3000,timeoutMs)));
    socket.addEventListener('error',()=>finish(new Error('Console websocket connection failed')));
    socket.addEventListener('open',()=>socket.send(JSON.stringify({event:'auth',args:[data.token]})));
    socket.addEventListener('message',event=>{
      let payload;try{payload=JSON.parse(String(event.data));}catch{return;}
      if(payload.event==='auth success'){
        authenticated=true;
        socket.send(JSON.stringify({event:'send logs',args:[null]}));
      }
      if(payload.event==='console output'&&authenticated){
        for(const part of payload.args||[])if(typeof part==='string'){
          lines.push(part.slice(0,1500));
          if(lines.length>120)lines.shift();
        }
      }
      if(payload.event==='token expired')finish(new Error('Console token expired'));
    });
  });
}

export function summarizeErrors(logs) {
  const lines=String(logs||'').split('\n').filter(x=>/(error|exception|traceback|failed|fatal|cannot find|module not found|econnrefused|enomem|killed|out of memory|exit code|syntaxerror)/i.test(x));
  return lines.length?lines.slice(-25).join('\n').slice(-4500):'No recognizable error lines were found in the captured logs.';
}

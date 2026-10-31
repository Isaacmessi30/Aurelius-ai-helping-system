const normalize = v => String(v||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
function distance(a,b) {
 const prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  let last=prev[0];prev[0]=i;
  for(let j=1;j<=b.length;j++){
   const old=prev[j];
   prev[j]=Math.min(prev[j]+1,prev[j-1]+1,last+(a[i-1]===b[j-1]?0:1));
   last=old;
  }
 }
 return prev[b.length];
}
export function matchServer(query,servers) {
 const q=normalize(query);
 if(!q || q.length<2) return {kind:'none'};
 const full=servers.filter(s=>[s.name,s.identifier,s.uuid,String(s.id||'')].some(v=>normalize(v)===q));
 if(full.length===1)return {kind:'exact',server:full[0]};
 if(full.length>1)return {kind:'none'};
 const ranked=servers.map(s=>{
  const name=normalize(s.name),id=normalize(s.identifier);
  const substr=name.includes(q)||id.startsWith(q);
  const close=Math.min(distance(q,name),...name.split(/\s+/).map(t=>distance(q,t)));
  const score=substr?(q.length>=4?0.94:0.75):1-close/Math.max(q.length,name.length);
  return {server:s,score};
 }).sort((a,b)=>b.score-a.score);
 if(!ranked.length)return {kind:'none'};
 const best=ranked[0],second=ranked[1];
 if(best.score>=0.78 && (!second || best.score-second.score>=0.12))
  return {kind:'suggest',server:best.server};
 return {kind:'none'};
}
export function matchFromRequest(text,servers) {
 const input=String(text||'').toLowerCase();
 const explicit=servers.filter(s=>[s.identifier,s.name].some(v=>v&&input.includes(String(v).toLowerCase())));
 if(explicit.length===1)return {kind:'exact',server:explicit[0]};
 if(explicit.length>1)return {kind:'none'};
 // Remove common request words, then inspect remaining potential server name.
 const candidate=input.replace(/\b(please|can|you|could|would|my|the|server|panel|bot|restart|reboot|start|stop|add|remove|invite|backup|create|change|update|startup|script|to|for|on|in|from|with|i|want|need|a|an|this|that|me|and)\b/g,' ')
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/g,' ')
  .replace(/\b[a-f0-9-]{36}\b/g,' ').trim();
 return matchServer(candidate,servers);
}

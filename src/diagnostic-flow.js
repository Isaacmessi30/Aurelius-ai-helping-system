import { getVerifiedCustomer } from './identity-live.js';
import { captureConsole, summarizeErrors } from './diagnostics.js';
import { pterodactylPowerAction } from './support.js';
const pending=new Map();
const key=(g,c,u)=>g+':'+c+':'+u;
export async function diagnosticRequest(message){
 const account=await getVerifiedCustomer(message.author.id);
 if(!account)return {text:'Connect your account with /account link first.'};
 const input=message.content.toLowerCase();
 const matches=account.servers.filter(s=>input.includes(s.identifier)||input.includes(s.name.toLowerCase()));
 const server=matches.length===1?matches[0]:account.servers.length===1?account.servers[0]:null;
 if(!server)return {text:'Which server should I diagnose?\\n'+account.servers.map(s=>s.name+' | ID: '+s.identifier).join('\\n')};
 pending.set(key(message.guildId,message.channelId,message.author.id),{server:server.identifier,expires:Date.now()+300000});
 const capture=await captureConsole(message.author.id,server.identifier);
 const errors=summarizeErrors(capture.logs);
 return errors!=='No recognizable error lines were found in the captured logs.'
 ? {text:'Console errors for '+server.name+':\\n'+errors.slice(0,1500)}
 : {text:'No recognizable errors in recent logs for '+server.name+'. If it is stopped, I can start it with your confirmation and capture startup logs.',canStart:true};
}
export async function diagnosticStart(guild,channel,user){
 const k=key(guild,channel,user),item=pending.get(k);
 if(!item||item.expires<Date.now())throw Error('Diagnostic request expired');
 pending.delete(k);
 const account=await getVerifiedCustomer(user);
 if(!account?.servers.some(s=>s.identifier===item.server))throw Error('Ownership verification failed');
 if(process.env.PTERODACTYL_ACTIONS_ENABLED!=='true')throw Error('Server actions are disabled');
 await pterodactylPowerAction(item.server,'start');
 await new Promise(resolve=>setTimeout(resolve,2500));
 const result=await captureConsole(user,item.server,12000);
 return {server:item.server,errors:summarizeErrors(result.logs)};
}

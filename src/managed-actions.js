import { getVerifiedCustomer } from './identity-live.js';
const BASE = () => new URL(process.env.PTERODACTYL_URL);
async function api(path,method='GET',body=null,application=false) {
  const base=BASE();
  if(base.protocol!=='https:')throw Error('HTTPS is required');
  const key=application?process.env.PTERODACTYL_APPLICATION_API_KEY:process.env.PTERODACTYL_CLIENT_API_KEY;
  if(!key)throw Error('Required API key is not configured');
  const url=new URL(path,base);
  if(url.origin!==base.origin)throw Error('Unsafe API path');
  const response=await fetch(url,{method,headers:{Authorization:'Bearer '+key,Accept:'application/json','Content-Type':'application/json'},
    ...(body===null?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Panel API returned HTTP '+response.status);
  if(response.status===204)return null;
  return response.json();
}
const serverPath=id=>'/api/client/servers/'+encodeURIComponent(id);
const validServer=id=>/^[a-z0-9]{8}$/.test(id);
const validateEmail=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<=191;
export const MUTATIONS=Object.freeze(['add_subuser','remove_subuser','startup_bash','startup_default','startup_custom','startup_variable','create_backup','restore_backup','create_schedule']);
export async function executeProtected(request) {
  if (!MUTATIONS.includes(request.action))throw Error('Unsupported action');
  if(!validServer(request.serverId))throw Error('Invalid server ID');
  const account=await getVerifiedCustomer(request.discordId);
  const server=account?.servers.find(s=>s.identifier===request.serverId);
  if(!server)throw Error('Account link or server ownership has changed; action denied');
  const base=serverPath(server.identifier),v=request.values||{};
  if(request.action==='add_subuser'){
    if(!validateEmail(v.email))throw Error('Invalid subuser email');
    // Limited starting permissions: console observation only, not admin/database/file rights.
    await api(base+'/users','POST',{email:v.email,permissions:['websocket.connect','control.console']});
    return 'Subuser invitation submitted with read-only console permission.';
  }
  if(request.action==='remove_subuser'){
    let uuid=v.uuid;
    if(!uuid && validateEmail(v.email||'')){
      const users=await api(base+'/users');
      const matches=(users.data||[]).filter(u=>String(u.attributes?.email||'').toLowerCase()===v.email.toLowerCase());
      if(matches.length!==1)throw Error('No unique subuser matches that email');
      uuid=matches[0].attributes.uuid;
    }
    if(!/^[a-f0-9-]{36}$/i.test(uuid||''))throw Error('Invalid subuser UUID');
    await api(base+'/users/'+uuid,'DELETE');return 'Subuser access removed.';
  }
  if(request.action==='create_backup'){
    const details=await api(base),slots=Number(details.attributes?.feature_limits?.backups);
    const existing=await api(base+'/backups');
    if(!Number.isInteger(slots)||slots<=0||(existing.data||[]).length>=slots)
      throw Error('No backup slots available.');
    await api(base+'/backups','POST',{});return 'Backup request submitted.';
  }
  if(request.action==='restore_backup'){
    if(!/^[a-f0-9-]{36}$/i.test(v.uuid||''))throw Error('Invalid backup UUID');
    const available=await api(base+'/backups');
    if(!(available.data||[]).some(b=>b.attributes?.uuid===v.uuid&&b.attributes?.completed_at))
      throw Error('Backup not found or not completed');
    await api(base+'/backups/'+v.uuid+'/restore','POST',{truncate:false});
    return 'Restore submitted. Existing matching files may have been overwritten.';
  }
  if(request.action==='startup_variable'){
    if(!/^[A-Z0-9_]{1,100}$/.test(v.key||'')||/(TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|AUTH)/i.test(v.key||'')||typeof v.value!=='string'||v.value.length>500)
      throw Error('Invalid startup variable');
    const vars=await api(base+'/startup');
    if(!(vars.data||[]).some(x=>x.attributes?.env_variable===v.key&&x.attributes?.is_editable))
      throw Error('Variable cannot be edited');
    await api(base+'/startup/variable','PUT',{key:v.key,value:v.value});
    return 'Startup variable updated. Restart may be required.';
  }
  if(request.action==='create_schedule'){
    const {name,minute,hour,day_of_month,month,day_of_week}=v;
    if(typeof name!=='string'||name.length>80||!name.trim())throw Error('Invalid schedule name');
    const cron=[minute,hour,day_of_month,month,day_of_week];
    if(!cron.every(x=>typeof x==='string'&&/^(\*|\d{1,2})$/.test(x)))
      throw Error('Unsupported schedule fields');
    await api(base+'/schedules','POST',{name,minute,hour,day_of_month,month,day_of_week,is_active:true});
    return 'Schedule created; it has no tasks until configured.';
  }
  let startup;
  if(request.action==='startup_bash') startup='exec /bin/bash --noprofile --norc -i';
  else if(request.action==='startup_default') {
    const egg=await api('/api/application/nests/'+server.nest+'/eggs/'+server.egg,'GET',null,true);
    startup=egg.attributes?.startup;
  } else if(request.action==='startup_custom') startup=v.command;
  if(typeof startup!=='string'||!startup.trim()||startup.length>1000||/[\r\n\0]/.test(startup))
    throw Error('Invalid startup command');
  await api('/api/application/servers/'+server.id+'/startup','PATCH',{
    startup,egg:server.egg,image:server.container?.image,environment:{},skip_scripts:server.container?.skip_scripts||false
  },true);
  return 'Startup command update submitted.';
}

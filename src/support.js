import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

const STORE = path.join(process.cwd(), 'data', 'approvals.json');
const COLORS = { info: 0x3468bc, success: 0x23966d, denied: 0xc64848, warning: 0xe4a23d };
const load = () => { try { return JSON.parse(fs.readFileSync(STORE,'utf8')); } catch { return {}; } };
const write = data => { fs.mkdirSync(path.dirname(STORE),{recursive:true}); fs.writeFileSync(STORE,JSON.stringify(data,null,2)); };
const approvals = load();
const stamp = () => new Date().toISOString();
export function professionalEmbed(title, description, fields = [], color = 'info') {
  return new EmbedBuilder().setColor(COLORS[color]).setAuthor({ name: 'Aurelius Hosting • Support Operations' })
    .setTitle(title).setDescription(description).addFields(fields)
    .setFooter({ text: 'Aurelius AI • Audit trail' }).setTimestamp();
}
export function setupPanel(cfg) {
  const select = new StringSelectMenuBuilder().setCustomId('ai:setup:select').setPlaceholder('Choose a setting to configure')
    .addOptions([
      { label: 'Ticket category', value: 'category', description: 'All tickets within a category' },
      { label: 'Staff role', value: 'staff', description: 'Mention staff on escalation' },
      { label: 'Audit / approvals channel', value: 'logs', description: 'Where requests and results are posted' },
      { label: 'AI model', value: 'model', description: 'Choose a cost-efficient model' }
    ]);
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ai:setup:toggle').setLabel(cfg.enabled ? 'Disable AI' : 'Enable AI').setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ai:setup:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary)
  );
  return {
    embeds: [professionalEmbed('AI Support • Configuration', 'Manage your support bot from this panel. Only server managers can change settings.', [
      { name: 'AI replies', value: cfg.enabled ? 'Enabled' : 'Disabled', inline: true },
      { name: 'Model', value: cfg.model || process.env.DEEPSEEK_MODEL || 'deepseek-flash', inline: true },
      { name: 'Ticket categories', value: cfg.categoryIds.map(x => '<#'+x+'>').join(', ') || 'Not set' },
      { name: 'Staff roles', value: cfg.staffRoleIds.map(x => '<@&'+x+'>').join(', ') || 'Not set' },
      { name: 'Review channel', value: cfg.logChannelId ? '<#'+cfg.logChannelId+'>' : 'Not set' },
      { name: 'Live actions', value: process.env.PTERODACTYL_ACTIONS_ENABLED === 'true' ? 'Owner approval required' : 'Disabled' }
    ])],
    components: [new ActionRowBuilder().addComponents(select), controls]
  };
}
export function setupOptions(kind) {
  if (kind === 'model') return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('ai:setup:choose:model').setPlaceholder('Choose model')
      .addOptions({label:'DeepSeek Flash • low cost',value:'deepseek-flash'},{label:'DeepSeek V4 Pro',value:'deepseek-v4-pro'})
  );
  return null;
}
export function createApproval({ ticketId, customerId, serverId, action, guildId, values = {}, kind = 'legacy' }) {
  const id = crypto.randomUUID();
  approvals[id] = { id, ticketId, customerId, serverId, action, guildId, values, kind, createdAt: stamp(), status: 'pending' };
  write(approvals);
  return approvals[id];
}
export function getApproval(id) { return approvals[id]; }
export function resolveApproval(id, status, reviewerId, detail = '') {
  const p = approvals[id]; if (!p || !['pending','processing'].includes(p.status)) return null;
  p.status = status; p.reviewerId = reviewerId; p.resolvedAt = stamp(); p.detail = detail;
  write(approvals); return p;
}
export function approvalCard(a) {
  return {
    embeds: [professionalEmbed('Pterodactyl • Action approval', 'A customer has requested a server operation. No action will run until the owner approves.', [
      { name: 'Ticket', value: '<#'+a.ticketId+'>', inline: true },
      { name: 'Customer', value: '<@'+a.customerId+'>', inline: true },
      { name: 'Server ID', value: '\`'+a.serverId+'\`' },
      { name: 'Requested action', value: a.action },
      { name: 'Details', value: Object.entries(a.values || {}).map(([key,value])=>key+': '+String(value).slice(0,200)).join(' | ').slice(0,700) || 'None' },
      { name: 'Status', value: a.status.toUpperCase() }
    ], 'warning')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ai:approval:accept:'+a.id).setLabel('Accept Action').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ai:approval:deny:'+a.id).setLabel('Deny Action').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ai:approval:human:'+a.id).setLabel('Staff Takeover').setStyle(ButtonStyle.Secondary)
    )]
  };
}
export async function pterodactylPowerAction(serverId, action) {
  const url = process.env.PTERODACTYL_URL;
  const key = process.env.PTERODACTYL_CLIENT_API_KEY;
  if (process.env.PTERODACTYL_ACTIONS_ENABLED !== 'true' || !url || !key) throw new Error('Pterodactyl actions are disabled or not configured');
  if (!/^https:\/\//i.test(url)) throw new Error('Pterodactyl endpoint must use HTTPS');
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(serverId)) throw new Error('Invalid server identifier');
  if (!['start','stop','restart'].includes(action)) throw new Error('Action not permitted');
  const base = new URL(url);
  if (base.username || base.password || base.search || base.hash) throw new Error('Invalid panel URL');
  const endpoint = new URL('/api/client/servers/'+encodeURIComponent(serverId)+'/power',base);
  const response = await fetch(endpoint, {
    method:'POST', headers:{ Authorization:'Bearer '+key, Accept:'application/json', 'Content-Type':'application/json' },
    body:JSON.stringify({ signal:action }), signal:AbortSignal.timeout(15000), redirect:'error'
  });
  if (!response.ok) throw new Error('Pterodactyl API returned HTTP '+response.status);
  return true;
}
export async function auditLog(client, cfg, title, details, kind='info') {
  if (!cfg.logChannelId) return false;
  const ch = await client.channels.fetch(cfg.logChannelId).catch(()=>null);
  if (!ch?.isTextBased()) return false;
  await ch.send({ embeds:[professionalEmbed(title,details,[],kind)], allowedMentions:{parse:[]} });
  return true;
}
export function humanRequest(text) {
  return /(?:\b(?:human|real person|real agent|staff member|support agent|talk to staff|speak to staff|connect me to (?:a )?(?:human|person|staff)|someone real)\b|människa|personal|riktig person|prata med support|prata med (?:en )?person|kontakta support|mänsklig support)/i.test(text);
}

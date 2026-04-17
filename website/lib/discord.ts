function getAdminRoleNames(): string[] {
  return (process.env.ADMIN_ROLE_NAMES ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

interface DiscordRole { id: string; name: string }
interface DiscordMember { roles: string[] }
export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

async function getDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch Discord user');
  return res.json() as Promise<DiscordUser>;
}

async function getGuildMember(userId: string): Promise<DiscordMember | null> {
  const res = await fetch(
    `https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${userId}`,
    { headers: { Authorization: `Bot ${process.env.TOKEN}` } }
  );
  if (res.status === 404) return null; // user not in guild
  if (!res.ok) throw new Error(`Failed to fetch guild member: ${res.status}`);
  return res.json();
}

async function getGuildRoles(): Promise<DiscordRole[]> {
  const res = await fetch(
    `https://discord.com/api/guilds/${process.env.GUILD_ID}/roles`,
    { headers: { Authorization: `Bot ${process.env.TOKEN}` } }
  );
  if (!res.ok) throw new Error('Failed to fetch guild roles');
  return res.json();
}

async function isAdmin(userId: string): Promise<boolean> {
  const [member, allRoles] = await Promise.all([
    getGuildMember(userId),
    getGuildRoles(),
  ]);
  if (!member) return false;
  const adminRoleIds = new Set(
    allRoles.filter((r: DiscordRole) => getAdminRoleNames().includes(r.name)).map((r: DiscordRole) => r.id)
  );
  return member.roles.some((id: string) => adminRoleIds.has(id));
}

module.exports = { getDiscordUser, isAdmin };

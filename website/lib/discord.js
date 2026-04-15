const ADMIN_ROLE_NAMES = ['S.P.E.W. President', 'S.P.E.W. Secretary'];

async function getDiscordUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch Discord user');
  return res.json();
}

async function getGuildMember(userId) {
  const res = await fetch(
    `https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${userId}`,
    { headers: { Authorization: `Bot ${process.env.TOKEN}` } }
  );
  if (res.status === 404) return null; // user not in guild
  if (!res.ok) throw new Error(`Failed to fetch guild member: ${res.status}`);
  return res.json();
}

async function getGuildRoles() {
  const res = await fetch(
    `https://discord.com/api/guilds/${process.env.GUILD_ID}/roles`,
    { headers: { Authorization: `Bot ${process.env.TOKEN}` } }
  );
  if (!res.ok) throw new Error('Failed to fetch guild roles');
  return res.json();
}

async function isAdmin(userId) {
  const [member, allRoles] = await Promise.all([
    getGuildMember(userId),
    getGuildRoles(),
  ]);
  if (!member) return false;
  const adminRoleIds = new Set(
    allRoles.filter(r => ADMIN_ROLE_NAMES.includes(r.name)).map(r => r.id)
  );
  return member.roles.some(id => adminRoleIds.has(id));
}

module.exports = { getDiscordUser, isAdmin };

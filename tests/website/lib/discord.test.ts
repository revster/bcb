const { isAdmin } = require('../../../website/lib/discord');

// isAdmin calls getGuildMember (fetch call 0) and getGuildRoles (fetch call 1) in parallel
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(memberResponse: any, rolesResponse: any) {
  let call = 0;
  global.fetch = jest.fn().mockImplementation(() => {
    return Promise.resolve(call++ === 0 ? memberResponse : rolesResponse);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonResponse(data: any, status = 200) {
  return { ok: status < 400, status, json: () => Promise.resolve(data) };
}

const ADMIN_ROLE_1 = 'Admin';
const ADMIN_ROLE_2 = 'Moderator';

beforeEach(() => {
  process.env.ADMIN_ROLE_NAMES = `${ADMIN_ROLE_1},${ADMIN_ROLE_2}`;
});

const ALL_ROLES = [
  { id: 'role-admin', name: ADMIN_ROLE_1 },
  { id: 'role-mod',   name: ADMIN_ROLE_2 },
  { id: 'role-member', name: 'Member' },
];

afterEach(() => jest.resetAllMocks());

describe('isAdmin', () => {
  test('returns true when user has an admin role', async () => {
    mockFetch(
      jsonResponse({ roles: ['role-admin', 'role-member'] }),
      jsonResponse(ALL_ROLES)
    );
    expect(await isAdmin('user-1')).toBe(true);
  });

  test('returns true when user has the moderator role', async () => {
    mockFetch(
      jsonResponse({ roles: ['role-mod'] }),
      jsonResponse(ALL_ROLES)
    );
    expect(await isAdmin('user-2')).toBe(true);
  });

  test('returns false when user has no admin role', async () => {
    mockFetch(
      jsonResponse({ roles: ['role-member'] }),
      jsonResponse(ALL_ROLES)
    );
    expect(await isAdmin('user-3')).toBe(false);
  });

  test('returns false when user is not in the guild (404)', async () => {
    mockFetch(
      { ok: false, status: 404, json: () => Promise.resolve(null) },
      jsonResponse(ALL_ROLES)
    );
    expect(await isAdmin('user-4')).toBe(false);
  });

  test('throws when guild member fetch fails with a non-404 error', async () => {
    mockFetch(
      { ok: false, status: 500, json: () => Promise.resolve(null) },
      jsonResponse(ALL_ROLES)
    );
    await expect(isAdmin('user-5')).rejects.toThrow('Failed to fetch guild member');
  });

  test('throws when guild roles fetch fails', async () => {
    mockFetch(
      jsonResponse({ roles: ['role-admin'] }),
      { ok: false, status: 500, json: () => Promise.resolve(null) }
    );
    await expect(isAdmin('user-6')).rejects.toThrow('Failed to fetch guild roles');
  });
});

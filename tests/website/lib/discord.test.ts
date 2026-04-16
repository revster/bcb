const { isAdmin } = require('../../../website/lib/discord');

// isAdmin calls getGuildMember (fetch call 0) and getGuildRoles (fetch call 1) in parallel
function mockFetch(memberResponse, rolesResponse) {
  let call = 0;
  global.fetch = jest.fn().mockImplementation(() => {
    return Promise.resolve(call++ === 0 ? memberResponse : rolesResponse);
  });
}

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: () => Promise.resolve(data) };
}

const ALL_ROLES = [
  { id: 'role-president', name: 'S.P.E.W. President' },
  { id: 'role-secretary', name: 'S.P.E.W. Secretary' },
  { id: 'role-member',    name: 'Member' },
];

afterEach(() => jest.resetAllMocks());

describe('isAdmin', () => {
  test('returns true when user has an admin role', async () => {
    mockFetch(
      jsonResponse({ roles: ['role-president', 'role-member'] }),
      jsonResponse(ALL_ROLES)
    );
    expect(await isAdmin('user-1')).toBe(true);
  });

  test('returns true when user has the secretary role', async () => {
    mockFetch(
      jsonResponse({ roles: ['role-secretary'] }),
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
      jsonResponse({ roles: ['role-president'] }),
      { ok: false, status: 500, json: () => Promise.resolve(null) }
    );
    await expect(isAdmin('user-6')).rejects.toThrow('Failed to fetch guild roles');
  });
});

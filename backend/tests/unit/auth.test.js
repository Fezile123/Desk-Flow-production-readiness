jest.mock('../../src/config/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

const jwt = require('jsonwebtoken');
const { prisma } = require('../../src/config/prisma');
const { protect, authorize } = require('../../src/middleware/auth');

const makeReq = (authHeader) => ({ headers: authHeader ? { authorization: authHeader } : {} });
const sign = (payload, options) => jwt.sign(payload, process.env.JWT_SECRET, options);

beforeEach(() => {
  jest.resetAllMocks();
});

describe('protect', () => {
  test('rejects a request with no Authorization header (401)', async () => {
    const next = jest.fn();
    await protect(makeReq(), {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  test('rejects a header that is not a Bearer token (401)', async () => {
    const next = jest.fn();
    await protect(makeReq('Basic abc'), {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  test('AUTH-11: rejects an invalid token (401)', async () => {
    const next = jest.fn();
    await protect(makeReq('Bearer not-a-real-token'), {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  test('AUTH-11: rejects an expired token (401)', async () => {
    const token = sign({ id: 'u1' }, { expiresIn: -10 });
    const next = jest.fn();
    await protect(makeReq(`Bearer ${token}`), {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  test('AUTH-12: rejects a valid token whose user no longer exists (401)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const token = sign({ id: 'ghost' });
    const next = jest.fn();
    await protect(makeReq(`Bearer ${token}`), {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  test('attaches the user to req and calls next() for a valid token', async () => {
    const user = { id: 'u1', role: 'employee', name: 'Emp' };
    prisma.user.findUnique.mockResolvedValue(user);
    const token = sign({ id: 'u1', role: 'employee' });
    const req = makeReq(`Bearer ${token}`);
    const next = jest.fn();

    await protect(req, {}, next);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('authorize', () => {
  test('RBAC-01: allows a user whose role is permitted', () => {
    const next = jest.fn();
    authorize('admin')({ user: { role: 'admin' } }, {}, next);
    expect(next).toHaveBeenCalled();
  });

  test('RBAC-02: blocks a user whose role is not permitted (403)', () => {
    const next = jest.fn();
    expect(() => authorize('admin')({ user: { role: 'employee' } }, {}, next)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('blocks when there is no user on the request (403)', () => {
    expect(() => authorize('admin')({}, {}, jest.fn())).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  test('accepts any of several allowed roles', () => {
    const next = jest.fn();
    authorize('admin', 'employee')({ user: { role: 'employee' } }, {}, next);
    expect(next).toHaveBeenCalled();
  });
});

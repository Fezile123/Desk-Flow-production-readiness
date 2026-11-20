jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    ticket: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    notification: { findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
  },
  connectDB: jest.fn(),
}));
jest.mock('../../src/middleware/rateLimiter', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
}));
jest.mock('morgan', () => () => (req, res, next) => next());
jest.mock('../../src/services/groqService', () => ({}));
jest.mock('../../src/services/notificationService', () => ({
  addSSEClient: jest.fn(),
  removeSSEClient: jest.fn(),
  notifyAdminsNewTicket: jest.fn(),
  notifyUserTicketUpdated: jest.fn(),
  notifyUserTicketResolved: jest.fn(),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { prisma } = require('../../src/config/prisma');
const app = require('../../src/app');
const { users, tokenFor } = require('../helpers/auth');

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/auth/register', () => {
  const body = { name: 'New User', email: 'new@test.com', password: 'secret123' };

  test('AUTH-01: creates an employee and returns a token', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1', ...body, password: 'hash', role: 'employee' });

    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.role).toBe('employee');
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('AUTH-02: rejects a missing field', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('All fields are required');
  });

  test('AUTH-03: rejects an email that already exists', async () => {
    prisma.user.findUnique.mockResolvedValue(users.employee);

    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('User already exists');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test('AUTH-04: ignores a role sent in the body (no self-promotion to admin)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1', ...body, password: 'hash', role: 'employee' });

    await request(app).post('/api/auth/register').send({ ...body, role: 'admin' });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'employee' }),
    });
  });
});

describe('POST /api/auth/login', () => {
  test('AUTH-05: valid credentials return a token and a user without a password', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...users.employee,
      password: bcrypt.hashSync('secret123', 4),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'emp@test.com', password: 'secret123' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.role).toBe('employee');
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('AUTH-06: wrong password returns 401', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...users.employee,
      password: bcrypt.hashSync('secret123', 4),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'emp@test.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  test('AUTH-07: unknown email returns 401', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'secret123' });

    expect(res.status).toBe(401);
  });

  test('AUTH-08: missing password fails validation with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'emp@test.com' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Email and password are required');
  });
});

describe('GET /api/auth/me', () => {
  test('AUTH-09: returns the current user without a password', async () => {
    prisma.user.findUnique.mockResolvedValue(users.employee);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenFor(users.employee)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('emp@test.com');
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('AUTH-10: no token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/users (RBAC)', () => {
  test('RBAC-03: admin gets the list of admin users', async () => {
    prisma.user.findUnique.mockResolvedValue(users.admin);
    prisma.user.findMany.mockResolvedValue([{ id: 'adm-1', name: 'Admin One', role: 'admin' }]);

    const res = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${tokenFor(users.admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'admin' } })
    );
  });

  test('RBAC-04: employee is forbidden', async () => {
    prisma.user.findUnique.mockResolvedValue(users.employee);

    const res = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${tokenFor(users.employee)}`);

    expect(res.status).toBe(403);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  test('RBAC-05: no token returns 401', async () => {
    const res = await request(app).get('/api/auth/users');

    expect(res.status).toBe(401);
  });
});

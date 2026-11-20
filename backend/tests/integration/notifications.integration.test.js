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
const { prisma } = require('../../src/config/prisma');
const app = require('../../src/app');
const { users, tokenFor } = require('../helpers/auth');

const auth = (req) => req.set('Authorization', `Bearer ${tokenFor(users.employee)}`);

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  prisma.user.findUnique.mockResolvedValue(users.employee);
});

describe('health, root and unknown routes', () => {
  test('HLTH-01: GET /api/health returns 200', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET / returns the API info', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('DeskFlow API');
  });

  test('an unknown route returns 404 in the standard error shape', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Route not found/);
  });
});

describe('POST /api/ai/analyze-ticket', () => {
  test('AI-03: no token returns 401', async () => {
    const res = await request(app).post('/api/ai/analyze-ticket').send({ title: 'x' });

    expect(res.status).toBe(401);
  });
});

describe('notification auth', () => {
  test.each([
    ['get', '/api/notifications'],
    ['get', '/api/notifications/unread-count'],
    ['patch', '/api/notifications/mark-all-read'],
    ['patch', '/api/notifications/n1/read'],
    ['delete', '/api/notifications/clear-all'],
    ['delete', '/api/notifications/n1'],
  ])('NOT-07: %s %s without a token returns 401', async (method, path) => {
    const res = await request(app)[method](path);

    expect(res.status).toBe(401);
  });

  test('NOT-08: the stream rejects a missing token', async () => {
    const res = await request(app).get('/api/notifications/stream');

    expect(res.status).toBe(401);
  });

  test('NOT-08: the stream rejects an invalid token', async () => {
    const res = await request(app).get('/api/notifications/stream?token=garbage');

    expect(res.status).toBe(401);
  });
});

describe('notification endpoints', () => {
  test('NOT-04: lists only the caller\'s notifications with the unread count', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);
    prisma.notification.count.mockResolvedValue(2);

    const res = await auth(request(app).get('/api/notifications?limit=30'));

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(2);
    expect(res.body.unreadCount).toBe(2);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'emp-1' }, take: 30 })
    );
  });

  test('unreadOnly=true filters to unread notifications', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    await auth(request(app).get('/api/notifications?unreadOnly=true'));

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'emp-1', isRead: false } })
    );
  });

  test('returns 500 when the database fails', async () => {
    prisma.notification.findMany.mockRejectedValue(new Error('db down'));
    prisma.notification.count.mockResolvedValue(0);

    const res = await auth(request(app).get('/api/notifications'));

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to fetch notifications');
  });

  test('unread-count returns the number for the caller', async () => {
    prisma.notification.count.mockResolvedValue(3);

    const res = await auth(request(app).get('/api/notifications/unread-count'));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });

  test('mark-all-read updates only the caller\'s unread notifications', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 2 });

    const res = await auth(request(app).patch('/api/notifications/mark-all-read'));

    expect(res.status).toBe(200);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'emp-1', isRead: false },
      data: { isRead: true },
    });
  });

  test('NOT-05: marking one as read is scoped to the caller', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });

    const res = await auth(request(app).patch('/api/notifications/n1/read'));

    expect(res.status).toBe(200);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'emp-1' },
      data: { isRead: true },
    });
  });

  test('NOT-06: deleting one is scoped to the caller', async () => {
    prisma.notification.deleteMany.mockResolvedValue({ count: 1 });

    const res = await auth(request(app).delete('/api/notifications/n1'));

    expect(res.status).toBe(200);
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'emp-1' },
    });
  });

  test('clear-all deletes only the caller\'s notifications (not routed as :id)', async () => {
    prisma.notification.deleteMany.mockResolvedValue({ count: 5 });

    const res = await auth(request(app).delete('/api/notifications/clear-all'));

    expect(res.status).toBe(200);
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'emp-1' },
    });
  });
});

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
const notifications = require('../../src/services/notificationService');
const app = require('../../src/app');
const { users, tokenFor } = require('../helpers/auth');

const asEmployee = (req) => req.set('Authorization', `Bearer ${tokenFor(users.employee)}`);
const asAdmin = (req) => req.set('Authorization', `Bearer ${tokenFor(users.admin)}`);

const validTicket = {
  title: 'VPN down',
  description: 'Cannot connect to the VPN since this morning',
  priority: 'High',
  category: 'Network',
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/tickets', () => {
  test('TKT-01: creates a ticket owned by the logged-in user', async () => {
    prisma.user.findUnique.mockResolvedValue(users.employee);
    prisma.ticket.create.mockResolvedValue({ id: 't1', ...validTicket, createdById: 'emp-1' });

    const res = await asEmployee(request(app).post('/api/tickets')).send(validTicket);

    expect(res.status).toBe(201);
    expect(res.body.data.ticket.id).toBe('t1');
    expect(prisma.ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'VPN down', createdById: 'emp-1' }),
    });
    expect(notifications.notifyAdminsNewTicket).toHaveBeenCalledTimes(1);
  });

  test('TKT-02: rejects a missing title', async () => {
    prisma.user.findUnique.mockResolvedValue(users.employee);

    const res = await asEmployee(request(app).post('/api/tickets')).send({
      description: validTicket.description,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Title/);
    expect(prisma.ticket.create).not.toHaveBeenCalled();
  });

  test('TKT-02: rejects a description that is too short', async () => {
    prisma.user.findUnique.mockResolvedValue(users.employee);

    const res = await asEmployee(request(app).post('/api/tickets')).send({
      title: 'VPN down',
      description: 'short',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Description/);
  });

  test('TKT-08: no token returns 401', async () => {
    const res = await request(app).post('/api/tickets').send(validTicket);

    expect(res.status).toBe(401);
  });
});

describe('GET /api/tickets', () => {
  test('TKT-08: no token returns 401', async () => {
    const res = await request(app).get('/api/tickets');

    expect(res.status).toBe(401);
  });

  test('employee only gets their own tickets', async () => {
    prisma.user.findUnique.mockResolvedValue(users.employee);
    prisma.ticket.findMany.mockResolvedValue([{ id: 't1', createdById: 'emp-1' }]);

    const res = await asEmployee(request(app).get('/api/tickets'));

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdById: 'emp-1' } })
    );
  });

  test('admin gets all tickets and filters are passed through', async () => {
    prisma.user.findUnique.mockResolvedValue(users.admin);
    prisma.ticket.findMany.mockResolvedValue([]);

    const res = await asAdmin(request(app).get('/api/tickets?status=Open&priority=High'));

    expect(res.status).toBe(200);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'Open', priority: 'High' } })
    );
  });
});

describe('PUT /api/tickets/:id', () => {
  const ticket = { id: 't1', title: 'VPN down', createdById: 'emp-1', status: 'Open' };

  test('STAT-08: admin updates status and the owner is notified', async () => {
    prisma.user.findUnique.mockResolvedValue(users.admin);
    prisma.ticket.findUnique.mockResolvedValue(ticket);
    prisma.ticket.update.mockResolvedValue({ ...ticket, status: 'In Progress' });

    const res = await asAdmin(request(app).put('/api/tickets/t1')).send({ status: 'In Progress' });

    expect(res.status).toBe(200);
    expect(res.body.data.ticket.status).toBe('In Progress');
    expect(notifications.notifyUserTicketUpdated).toHaveBeenCalledTimes(1);
  });

  test('admin resolving a ticket triggers the resolved notification', async () => {
    prisma.user.findUnique.mockResolvedValue(users.admin);
    prisma.ticket.findUnique.mockResolvedValue(ticket);
    prisma.ticket.update.mockResolvedValue({ ...ticket, status: 'Resolved' });

    const res = await asAdmin(request(app).put('/api/tickets/t1')).send({ status: 'Resolved' });

    expect(res.status).toBe(200);
    expect(notifications.notifyUserTicketResolved).toHaveBeenCalledTimes(1);
  });

  test('STAT-09: an invalid status is rejected with 400', async () => {
    prisma.user.findUnique.mockResolvedValue(users.admin);

    const res = await asAdmin(request(app).put('/api/tickets/t1')).send({ status: 'Closed' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Status must be/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('STAT-10: employee cannot change status (403)', async () => {
    prisma.user.findUnique.mockResolvedValue(users.employee);
    prisma.ticket.findUnique.mockResolvedValue(ticket);

    const res = await asEmployee(request(app).put('/api/tickets/t1')).send({ status: 'Resolved' });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Only admins can change ticket status');
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('STAT-04: employee cannot update someone else\'s ticket (403)', async () => {
    prisma.user.findUnique.mockResolvedValue(users.employee);
    prisma.ticket.findUnique.mockResolvedValue({ ...ticket, createdById: 'other-user' });

    const res = await asEmployee(request(app).put('/api/tickets/t1')).send({ priority: 'Low' });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You can only update your own tickets');
  });

  test('STAT-06: updating a non-existent ticket returns 404', async () => {
    prisma.user.findUnique.mockResolvedValue(users.admin);
    prisma.ticket.findUnique.mockResolvedValue(null);

    const res = await asAdmin(request(app).put('/api/tickets/missing')).send({ status: 'Open' });

    expect(res.status).toBe(404);
  });

  test('no token returns 401', async () => {
    const res = await request(app).put('/api/tickets/t1').send({ status: 'Open' });

    expect(res.status).toBe(401);
  });
});

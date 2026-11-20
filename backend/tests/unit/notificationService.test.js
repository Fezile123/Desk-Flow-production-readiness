jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    notification: { create: jest.fn() },
  },
}));

const { prisma } = require('../../src/config/prisma');
const svc = require('../../src/services/notificationService');

const ticket = { id: 't1', title: 'VPN down', createdById: 'emp-1' };

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  prisma.notification.create.mockResolvedValue({ id: 'n1' });
});

afterEach(() => {
  ['u1', 'a1', 'a2'].forEach(svc.removeSSEClient);
});

describe('createNotification', () => {
  test('NOT-01: saves the notification and pushes it to a connected user', async () => {
    const res = { write: jest.fn() };
    svc.addSSEClient('u1', res);

    await svc.createNotification({
      userId: 'u1', type: 'ticket_created', title: 'T', message: 'M', ticketId: 't1',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: { userId: 'u1', type: 'ticket_created', title: 'T', message: 'M', ticketId: 't1' },
    });
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write.mock.calls[0][0]).toContain('NEW_NOTIFICATION');
  });

  test('stores a null ticketId when none is given', async () => {
    await svc.createNotification({ userId: 'u1', type: 'x', title: 'T', message: 'M' });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ticketId: null }),
    });
  });

  test('does not fail when the user has no live connection', async () => {
    await expect(
      svc.createNotification({ userId: 'offline', type: 'x', title: 'T', message: 'M' })
    ).resolves.toBeDefined();
  });

  test('swallows database errors instead of throwing', async () => {
    prisma.notification.create.mockRejectedValue(new Error('db down'));

    await expect(
      svc.createNotification({ userId: 'u1', type: 'x', title: 'T', message: 'M' })
    ).resolves.toBeUndefined();
  });
});

describe('notifyAdminsNewTicket', () => {
  test('NOT-02: creates one notification per admin', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

    await svc.notifyAdminsNewTicket(ticket, 'Emp One');

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'admin' },
      select: { id: true },
    });
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    const first = prisma.notification.create.mock.calls[0][0].data;
    expect(first.userId).toBe('a1');
    expect(first.type).toBe('ticket_created');
    expect(first.message).toContain('Emp One');
    expect(first.message).toContain('VPN down');
  });
});

describe('notifyUser* helpers', () => {
  test('NOT-03: status updates go to the ticket owner (createdById)', async () => {
    await svc.notifyUserTicketUpdated(ticket, 'In Progress', 'Admin One');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'emp-1',
        type: 'ticket_updated',
        ticketId: 't1',
        message: expect.stringContaining('In Progress'),
      }),
    });
  });

  test('resolved notifications go to the ticket owner', async () => {
    await svc.notifyUserTicketResolved(ticket, 'Admin One');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'emp-1', type: 'ticket_resolved' }),
    });
  });

  test('comment notifications skip the commenter themselves', async () => {
    await svc.notifyUserNewComment({ ...ticket, commenterId: 'emp-1' }, 'Emp One');

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  test('comment notifications reach the owner when someone else comments', async () => {
    await svc.notifyUserNewComment({ ...ticket, commenterId: 'adm-1' }, 'Admin One');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'emp-1', type: 'new_comment' }),
    });
  });
});

describe('pushToAdmins', () => {
  test('pushes only to admins who are connected', async () => {
    const connected = { write: jest.fn() };
    svc.addSSEClient('a1', connected);
    prisma.user.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

    await svc.pushToAdmins({ type: 'PING' });

    expect(connected.write).toHaveBeenCalledTimes(1);
  });
});

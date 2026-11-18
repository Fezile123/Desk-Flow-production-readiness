jest.mock('../../src/config/prisma', () => ({
  prisma: {
    ticket: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../../src/services/notificationService', () => ({
  notifyAdminsNewTicket: jest.fn(),
  notifyUserTicketUpdated: jest.fn(),
  notifyUserTicketResolved: jest.fn(),
}));

const { prisma } = require('../../src/config/prisma');
const notifications = require('../../src/services/notificationService');
const ticketService = require('../../src/services/ticketService');

const employee = { id: 'emp-1', role: 'employee', name: 'Emp' };
const admin = { id: 'adm-1', role: 'admin', name: 'Admin One' };

beforeEach(() => {
  jest.resetAllMocks();
});

describe('createTicket', () => {
  const input = {
    title: 'VPN down',
    description: 'Cannot connect to VPN at all',
    priority: 'High',
    category: 'Network',
    createdById: 'emp-1',
  };

  test('TKT-03: stores the ticket with the correct createdById', async () => {
    const created = { id: 't1', ...input };
    prisma.ticket.create.mockResolvedValue(created);
    prisma.user.findUnique.mockResolvedValue({ name: 'Emp' });

    const result = await ticketService.createTicket(input);

    expect(result).toEqual(created);
    expect(prisma.ticket.create).toHaveBeenCalledWith({
      data: {
        title: input.title,
        description: input.description,
        priority: input.priority,
        category: input.category,
        createdById: 'emp-1',
      },
    });
  });

  test('TKT-04: notifies admins with the creator name', async () => {
    const created = { id: 't1', ...input };
    prisma.ticket.create.mockResolvedValue(created);
    prisma.user.findUnique.mockResolvedValue({ name: 'Emp' });

    await ticketService.createTicket(input);

    expect(notifications.notifyAdminsNewTicket).toHaveBeenCalledTimes(1);
    expect(notifications.notifyAdminsNewTicket).toHaveBeenCalledWith(created, 'Emp');
  });

  test('falls back to a default name when the creator is not found', async () => {
    const created = { id: 't1', ...input };
    prisma.ticket.create.mockResolvedValue(created);
    prisma.user.findUnique.mockResolvedValue(null);

    await ticketService.createTicket(input);

    expect(notifications.notifyAdminsNewTicket).toHaveBeenCalledWith(created, 'An employee');
  });
});

describe('listTicketsForUser', () => {
  test('TKT-05: employee only sees their own tickets', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);

    await ticketService.listTicketsForUser(employee);

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdById: 'emp-1' } })
    );
  });

  test('TKT-06: admin sees all tickets (no owner filter)', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);

    await ticketService.listTicketsForUser(admin);

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  test('TKT-07: applies status, priority and category filters', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);

    await ticketService.listTicketsForUser(admin, {
      status: 'Open',
      priority: 'High',
      category: 'Network',
    });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'Open', priority: 'High', category: 'Network' },
      })
    );
  });

  test('TKT-07: search matches title or description case-insensitively', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);

    await ticketService.listTicketsForUser(admin, { search: 'vpn' });

    const where = prisma.ticket.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { title: { contains: 'vpn', mode: 'insensitive' } },
      { description: { contains: 'vpn', mode: 'insensitive' } },
    ]);
  });
});

describe('updateTicket', () => {
  const ticket = { id: 't1', title: 'VPN down', createdById: 'emp-1', status: 'Open' };

  test('STAT-06: throws 404 when the ticket does not exist', async () => {
    prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(
      ticketService.updateTicket('missing', {}, admin)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('STAT-04: employee cannot update another user\'s ticket', async () => {
    prisma.ticket.findUnique.mockResolvedValue({ ...ticket, createdById: 'someone-else' });

    await expect(
      ticketService.updateTicket('t1', { adminNotes: 'x' }, employee)
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('STAT-03: employee cannot change ticket status', async () => {
    prisma.ticket.findUnique.mockResolvedValue(ticket);

    await expect(
      ticketService.updateTicket('t1', { status: 'Resolved' }, employee)
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('STAT-05: employee can edit their own ticket without changing status', async () => {
    prisma.ticket.findUnique.mockResolvedValue(ticket);
    prisma.ticket.update.mockResolvedValue({ ...ticket, priority: 'High' });

    const result = await ticketService.updateTicket('t1', { priority: 'High' }, employee);

    expect(result.priority).toBe('High');
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { priority: 'High' },
    });
    expect(notifications.notifyUserTicketUpdated).not.toHaveBeenCalled();
    expect(notifications.notifyUserTicketResolved).not.toHaveBeenCalled();
  });

  test('STAT-01: admin moves Open -> In Progress and the owner is notified', async () => {
    const updated = { ...ticket, status: 'In Progress' };
    prisma.ticket.findUnique.mockResolvedValue(ticket);
    prisma.ticket.update.mockResolvedValue(updated);

    await ticketService.updateTicket('t1', { status: 'In Progress' }, admin);

    expect(notifications.notifyUserTicketUpdated).toHaveBeenCalledWith(
      updated,
      'In Progress',
      'Admin One'
    );
    expect(notifications.notifyUserTicketResolved).not.toHaveBeenCalled();
  });

  test('STAT-02: admin resolves a ticket and the owner gets a resolved notification', async () => {
    const updated = { ...ticket, status: 'Resolved' };
    prisma.ticket.findUnique.mockResolvedValue(ticket);
    prisma.ticket.update.mockResolvedValue(updated);

    await ticketService.updateTicket('t1', { status: 'Resolved' }, admin);

    expect(notifications.notifyUserTicketResolved).toHaveBeenCalledWith(updated, 'Admin One');
    expect(notifications.notifyUserTicketUpdated).not.toHaveBeenCalled();
  });

  test('STAT-07: admin update without a status change sends no notification', async () => {
    prisma.ticket.findUnique.mockResolvedValue(ticket);
    prisma.ticket.update.mockResolvedValue({ ...ticket, assignedTo: 'Admin One' });

    await ticketService.updateTicket('t1', { assignedTo: 'Admin One' }, admin);

    expect(notifications.notifyUserTicketUpdated).not.toHaveBeenCalled();
    expect(notifications.notifyUserTicketResolved).not.toHaveBeenCalled();
  });

  test('uses "Admin" as the name when the admin has no name', async () => {
    const updated = { ...ticket, status: 'Resolved' };
    prisma.ticket.findUnique.mockResolvedValue(ticket);
    prisma.ticket.update.mockResolvedValue(updated);

    await ticketService.updateTicket('t1', { status: 'Resolved' }, { id: 'adm-2', role: 'admin' });

    expect(notifications.notifyUserTicketResolved).toHaveBeenCalledWith(updated, 'Admin');
  });
});

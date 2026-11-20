const { prisma } = require('../config/prisma');

// SSE clients map: userId -> res (response stream)
const sseClients = new Map();

function addSSEClient(userId, res) {
  sseClients.set(userId, res);
}

function removeSSEClient(userId) {
  sseClients.delete(userId);
}

function pushToUser(userId, data) {
  const client = sseClients.get(userId);
  if (client) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

async function pushToAdmins(data) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true },
    });
    admins.forEach(({ id }) => pushToUser(id, data));
  } catch (e) {
    console.error('pushToAdmins error:', e);
  }
}

async function createNotification({ userId, type, title, message, ticketId }) {
  try {
    const notification = await prisma.notification.create({
      data: { userId, type, title, message, ticketId: ticketId || null },
    });
    pushToUser(userId, { type: 'NEW_NOTIFICATION', notification });
    return notification;
  } catch (e) {
    console.error('createNotification error:', e);
  }
}

async function notifyAdminsNewTicket(ticket, submitterName) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true },
    });
    for (const admin of admins) {
      await createNotification({
        userId: admin.id,
        type: 'ticket_created',
        title: '🎫 New Ticket Submitted',
        message: `${submitterName} submitted: "${ticket.title}"`,
        ticketId: ticket.id,
      });
    }
  } catch (e) {
    console.error('notifyAdminsNewTicket error:', e);
  }
}

async function notifyUserTicketUpdated(ticket, newStatus, updatedByName) {
  const statusLabels = {
    Open: 'Open',
    'In Progress': 'In Progress',
    Resolved: 'Resolved',
    Closed: 'Closed',
  };
  await createNotification({
    userId: ticket.createdById,
    type: 'ticket_updated',
    title: '🔄 Ticket Status Updated',
    message: `Your ticket "${ticket.title}" was updated to ${statusLabels[newStatus] || newStatus} by ${updatedByName}.`,
    ticketId: ticket.id,
  });
}

async function notifyUserTicketResolved(ticket, resolvedByName) {
  await createNotification({
    userId: ticket.createdById,
    type: 'ticket_resolved',
    title: '✅ Ticket Resolved',
    message: `Your ticket "${ticket.title}" has been resolved by ${resolvedByName}. Please rate your experience.`,
    ticketId: ticket.id,
  });
}

async function notifyUserNewComment(ticket, commenterName) {
  if (ticket.createdById === ticket.commenterId) return;
  await createNotification({
    userId: ticket.createdById,
    type: 'new_comment',
    title: '💬 New Comment',
    message: `${commenterName} commented on your ticket "${ticket.title}".`,
    ticketId: ticket.id,
  });
}

module.exports = {
  addSSEClient,
  removeSSEClient,
  createNotification,
  notifyAdminsNewTicket,
  notifyUserTicketUpdated,
  notifyUserTicketResolved,
  notifyUserNewComment,
  pushToUser,
  pushToAdmins,
};

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
jest.mock('../../src/services/groqService', () => ({ analyzeTicket: jest.fn() }));
jest.mock('../../src/services/notificationService', () => ({
  addSSEClient: jest.fn(),
  removeSSEClient: jest.fn(),
  notifyAdminsNewTicket: jest.fn(),
  notifyUserTicketUpdated: jest.fn(),
  notifyUserTicketResolved: jest.fn(),
}));

const request = require('supertest');
const { prisma } = require('../../src/config/prisma');
const groqService = require('../../src/services/groqService');
const ApiError = require('../../src/utils/ApiError');
const app = require('../../src/app');
const { users, tokenFor } = require('../helpers/auth');

const post = (body) =>
  request(app)
    .post('/api/ai/analyze-ticket')
    .set('Authorization', `Bearer ${tokenFor(users.employee)}`)
    .send(body);

const analysis = {
  category: 'Network',
  summary: 'VPN cannot connect',
  recommendedPriority: 'High',
  troubleshootingSteps: ['Restart VPN client'],
  suggestedResolution: 'Reset the VPN profile',
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  prisma.user.findUnique.mockResolvedValue(users.employee);
});

describe('POST /api/ai/analyze-ticket', () => {
  test('AI-01: returns the analysis when Groq succeeds', async () => {
    groqService.analyzeTicket.mockResolvedValue(analysis);

    const res = await post({ title: 'VPN down', description: 'Cannot connect to VPN' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(analysis);
    expect(groqService.analyzeTicket).toHaveBeenCalledWith({
      title: 'VPN down',
      description: 'Cannot connect to VPN',
    });
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  test('saves the analysis on the ticket when a ticketId is given', async () => {
    groqService.analyzeTicket.mockResolvedValue(analysis);
    prisma.ticket.update.mockResolvedValue({});

    const res = await post({ title: 'VPN down', description: 'Cannot connect', ticketId: 't1' });

    expect(res.status).toBe(200);
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        category: 'Network',
        aiSummary: 'VPN cannot connect',
        aiTroubleshootingSteps: ['Restart VPN client'],
        aiSuggestedResolution: 'Reset the VPN profile',
        aiRecommendedPriority: 'High',
        aiAnalyzedAt: expect.any(Date),
      }),
    });
  });

  test('rejects a request without a description (400)', async () => {
    const res = await post({ title: 'VPN down' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('title and description are required');
    expect(groqService.analyzeTicket).not.toHaveBeenCalled();
  });

  test('AI-02: a Groq failure is returned as a handled 502, not a crash', async () => {
    groqService.analyzeTicket.mockRejectedValue(
      new ApiError(502, 'AI service returned malformed JSON')
    );

    const res = await post({ title: 'VPN down', description: 'Cannot connect' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('AI service returned malformed JSON');
  });

  test('AI-02: an unexpected error becomes a 500 response', async () => {
    groqService.analyzeTicket.mockRejectedValue(new Error('socket hang up'));

    const res = await post({ title: 'VPN down', description: 'Cannot connect' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

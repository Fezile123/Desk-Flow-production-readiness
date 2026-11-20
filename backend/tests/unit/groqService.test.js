const mockCreate = jest.fn();

jest.mock('groq-sdk', () =>
  jest.fn(() => ({
    chat: { completions: { create: (...args) => mockCreate(...args) } },
  }))
);

const groqService = require('../../src/services/groqService');

const completion = (content) => ({ choices: [{ message: { content } }] });

const validAnalysis = {
  category: 'Network',
  summary: 'VPN cannot connect',
  recommendedPriority: 'High',
  troubleshootingSteps: ['Restart VPN client', 'Check network'],
  suggestedResolution: 'Reset the VPN profile',
};

beforeEach(() => {
  mockCreate.mockReset();
});

describe('analyzeTicket', () => {
  test('returns the parsed analysis', async () => {
    mockCreate.mockResolvedValue(completion(JSON.stringify(validAnalysis)));

    const result = await groqService.analyzeTicket({ title: 'VPN down', description: 'Cannot connect' });

    expect(result).toEqual(validAnalysis);
  });

  test('sends the title and description and requests JSON output', async () => {
    mockCreate.mockResolvedValue(completion(JSON.stringify(validAnalysis)));

    await groqService.analyzeTicket({ title: 'VPN down', description: 'Cannot connect' });

    const args = mockCreate.mock.calls[0][0];
    expect(args.response_format).toEqual({ type: 'json_object' });
    expect(args.messages[1].content).toContain('Title: VPN down');
    expect(args.messages[1].content).toContain('Description: Cannot connect');
  });

  test('falls back to "Other" for an unknown category', async () => {
    mockCreate.mockResolvedValue(
      completion(JSON.stringify({ ...validAnalysis, category: 'Weather' }))
    );

    const result = await groqService.analyzeTicket({ title: 't', description: 'd' });

    expect(result.category).toBe('Other');
  });

  test('falls back to "Medium" for an unknown priority', async () => {
    mockCreate.mockResolvedValue(
      completion(JSON.stringify({ ...validAnalysis, recommendedPriority: 'Urgent' }))
    );

    const result = await groqService.analyzeTicket({ title: 't', description: 'd' });

    expect(result.recommendedPriority).toBe('Medium');
  });

  test('fills in safe defaults for missing fields', async () => {
    mockCreate.mockResolvedValue(completion(JSON.stringify({ category: 'Hardware' })));

    const result = await groqService.analyzeTicket({ title: 't', description: 'd' });

    expect(result).toEqual({
      category: 'Hardware',
      summary: '',
      recommendedPriority: 'Medium',
      troubleshootingSteps: [],
      suggestedResolution: '',
    });
  });

  test('uses an empty list when troubleshootingSteps is not an array', async () => {
    mockCreate.mockResolvedValue(
      completion(JSON.stringify({ ...validAnalysis, troubleshootingSteps: 'restart it' }))
    );

    const result = await groqService.analyzeTicket({ title: 't', description: 'd' });

    expect(result.troubleshootingSteps).toEqual([]);
  });

  test('throws 502 when the response is empty', async () => {
    mockCreate.mockResolvedValue(completion(''));

    await expect(
      groqService.analyzeTicket({ title: 't', description: 'd' })
    ).rejects.toMatchObject({ statusCode: 502, message: 'AI service returned an empty response' });
  });

  test('throws 502 when there are no choices', async () => {
    mockCreate.mockResolvedValue({ choices: [] });

    await expect(
      groqService.analyzeTicket({ title: 't', description: 'd' })
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  test('throws 502 when the response is not valid JSON', async () => {
    mockCreate.mockResolvedValue(completion('this is not json'));

    await expect(
      groqService.analyzeTicket({ title: 't', description: 'd' })
    ).rejects.toMatchObject({ statusCode: 502, message: 'AI service returned malformed JSON' });
  });

  test('lets errors from the Groq SDK propagate', async () => {
    mockCreate.mockRejectedValue(new Error('network down'));

    await expect(
      groqService.analyzeTicket({ title: 't', description: 'd' })
    ).rejects.toThrow('network down');
  });
});

describe('missing API key', () => {
  test('throws 500 when GROQ_API_KEY is not configured', async () => {
    const saved = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;

    let isolated;
    jest.isolateModules(() => {
      isolated = require('../../src/services/groqService');
    });

    await expect(
      isolated.analyzeTicket({ title: 't', description: 'd' })
    ).rejects.toMatchObject({
      statusCode: 500,
      message: 'GROQ_API_KEY is not configured on the server',
    });

    process.env.GROQ_API_KEY = saved;
  });
});

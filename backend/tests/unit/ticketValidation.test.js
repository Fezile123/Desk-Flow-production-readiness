const {
  validateCreateTicket,
  validateUpdateTicket,
} = require('../../src/validations/ticketValidation');

const run = (validator, body) => {
  const next = jest.fn();
  validator({ body }, {}, next);
  return next;
};

describe('validateCreateTicket', () => {
  const valid = {
    title: 'VPN down',
    description: 'Cannot connect to the VPN since morning',
  };

  test('accepts a valid ticket', () => {
    expect(run(validateCreateTicket, valid)).toHaveBeenCalled();
  });

  test('TKT-02: rejects a missing title', () => {
    expect(() => run(validateCreateTicket, { ...valid, title: '' })).toThrow('Title must be');
  });

  test('rejects a title shorter than 3 characters', () => {
    expect(() => run(validateCreateTicket, { ...valid, title: 'ab' })).toThrow('Title must be');
  });

  test('TKT-02: rejects a description shorter than 10 characters', () => {
    expect(() => run(validateCreateTicket, { ...valid, description: 'too short' })).toThrow(
      'Description must be'
    );
  });

  test('rejects an invalid priority', () => {
    expect(() => run(validateCreateTicket, { ...valid, priority: 'Urgent' })).toThrow(
      'Priority must be'
    );
  });

  test('rejects an invalid category', () => {
    expect(() => run(validateCreateTicket, { ...valid, category: 'Food' })).toThrow(
      'Category must be'
    );
  });

  test('accepts a valid priority and category', () => {
    expect(
      run(validateCreateTicket, { ...valid, priority: 'High', category: 'Network' })
    ).toHaveBeenCalled();
  });
});

describe('validateUpdateTicket', () => {
  test('accepts an empty update', () => {
    expect(run(validateUpdateTicket, {})).toHaveBeenCalled();
  });

  test.each(['Open', 'In Progress', 'Resolved'])('accepts status "%s"', (status) => {
    expect(run(validateUpdateTicket, { status })).toHaveBeenCalled();
  });

  test('STAT-09: rejects an unknown status', () => {
    expect(() => run(validateUpdateTicket, { status: 'Closed' })).toThrow('Status must be');
  });

  test('rejects an invalid priority', () => {
    expect(() => run(validateUpdateTicket, { priority: 'Urgent' })).toThrow('Priority must be');
  });

  test('rejects assignedTo longer than 100 characters', () => {
    expect(() => run(validateUpdateTicket, { assignedTo: 'a'.repeat(101) })).toThrow(
      'Assigned To'
    );
  });

  test('rejects adminNotes longer than 1000 characters', () => {
    expect(() => run(validateUpdateTicket, { adminNotes: 'a'.repeat(1001) })).toThrow(
      'Admin Notes'
    );
  });
});

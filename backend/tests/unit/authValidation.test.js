const { validateLogin, validateRegister } = require('../../src/validations/authValidation');

const run = (validator, body) => {
  const next = jest.fn();
  validator({ body }, {}, next);
  return next;
};

describe('validateLogin', () => {
  test('accepts an email and password', () => {
    expect(run(validateLogin, { email: 'a@b.com', password: 'x' })).toHaveBeenCalled();
  });

  test('rejects a missing email', () => {
    expect(() => run(validateLogin, { password: 'x' })).toThrow('Email and password are required');
  });
});

describe('validateRegister', () => {
  const valid = { name: 'A', email: 'a@b.com', password: 'secret123' };

  test('accepts valid details', () => {
    expect(run(validateRegister, valid)).toHaveBeenCalled();
  });

  test('rejects missing fields', () => {
    expect(() => run(validateRegister, { name: 'A' })).toThrow('Name, email and password are required');
  });

  test('rejects a password shorter than 6 characters', () => {
    expect(() => run(validateRegister, { ...valid, password: '12345' })).toThrow(
      'Password must be at least 6 characters'
    );
  });
});

const { Prisma } = require('@prisma/client');
const { notFound, errorHandler } = require('../../src/middleware/errorHandler');
const ApiError = require('../../src/utils/ApiError');

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const prismaError = (code, meta) =>
  new Prisma.PrismaClientKnownRequestError('db error', {
    code,
    clientVersion: 'test',
    meta,
  });

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('notFound', () => {
  test('forwards a 404 ApiError naming the route', () => {
    const next = jest.fn();
    notFound({ originalUrl: '/api/nope' }, {}, next);

    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 404,
      message: 'Route not found: /api/nope',
    });
  });
});

describe('errorHandler', () => {
  test('uses the status code and message of an ApiError', () => {
    const res = makeRes();
    errorHandler(new ApiError(403, 'Forbidden'), {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Forbidden', data: null })
    );
  });

  test('defaults to 500 for an unknown error', () => {
    const res = makeRes();
    errorHandler(new Error('boom'), {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('P2002 (unique constraint) maps to 409 and names the field', () => {
    const res = makeRes();
    errorHandler(prismaError('P2002', { target: ['email'] }), {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'email already exists' })
    );
  });

  test('P2002 without a target falls back to "field"', () => {
    const res = makeRes();
    errorHandler(prismaError('P2002'), {}, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'field already exists' })
    );
  });

  test('P2025 (record not found) maps to 404', () => {
    const res = makeRes();
    errorHandler(prismaError('P2025'), {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('P2003 (foreign key) maps to 400', () => {
    const res = makeRes();
    errorHandler(prismaError('P2003'), {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Related record does not exist' })
    );
  });

  test('an unrecognised Prisma code maps to a generic 400', () => {
    const res = makeRes();
    errorHandler(prismaError('P9999'), {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Database request error' })
    );
  });

  test('a Prisma validation error maps to 400', () => {
    const res = makeRes();
    errorHandler(
      new Prisma.PrismaClientValidationError('bad data', { clientVersion: 'test' }),
      {},
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('JsonWebTokenError maps to 401', () => {
    const res = makeRes();
    const err = new Error('jwt malformed');
    err.name = 'JsonWebTokenError';
    errorHandler(err, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid authentication token' })
    );
  });

  test('TokenExpiredError maps to 401', () => {
    const res = makeRes();
    const err = new Error('jwt expired');
    err.name = 'TokenExpiredError';
    errorHandler(err, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Authentication token expired' })
    );
  });
});

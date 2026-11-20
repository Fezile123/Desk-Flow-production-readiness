module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/config/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'html'],
  coverageThreshold: {
    global: {
      statements: 70,
      lines: 70,
      functions: 70,
      branches: 60,
    },
    './src/services/ticketService.js': {
      statements: 90,
      branches: 80,
      functions: 90,
      lines: 90,
    },
    './src/middleware/auth.js': {
      statements: 90,
      branches: 80,
      functions: 90,
      lines: 90,
    },
  },
};

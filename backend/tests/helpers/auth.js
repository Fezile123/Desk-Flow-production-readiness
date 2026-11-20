const jwt = require('jsonwebtoken');

const users = {
  employee: { id: 'emp-1', name: 'Emp One', email: 'emp@test.com', role: 'employee', password: 'hashed' },
  admin: { id: 'adm-1', name: 'Admin One', email: 'admin@test.com', role: 'admin', password: 'hashed' },
};

const tokenFor = (user) =>
  jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

module.exports = { users, tokenFor };

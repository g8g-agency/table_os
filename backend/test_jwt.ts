import jwt from 'jsonwebtoken';

const payload = {
  sub: '1234',
  tenant_id: '1234',
  branch_id: '1234',
  role: 'admin',
  permissions: [],
  session_id: '1234',
};

const token = jwt.sign(payload, 'secret', { expiresIn: '1h' });
const decoded = jwt.verify(token, 'secret');
console.log(decoded);

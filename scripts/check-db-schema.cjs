// Diagnostic script — checks real DB schema and role state
require('dotenv').config();
const Database = require('better-sqlite3');
const db = new Database('./praconnect.db');

const tblSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
console.log('Actual users table schema in DB:');
console.log(tblSchema.sql);

const users = db.prepare('SELECT id, email, role FROM users ORDER BY createdAt').all();
console.log('\nCurrent users:');
for (const u of users) {
  console.log('  id:', u.id, '| email:', u.email, '| role:', u.role);
}
db.close();

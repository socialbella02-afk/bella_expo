/**
 * Production Server
 * Serves both the API and the frontend from a single process
 * Use this for simpler deployment scenarios
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const twilio = require('twilio');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ============== DATABASE SETUP ==============
const dbPath = process.env.DATABASE_PATH || './data/coupon.db';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'staff' CHECK(role IN ('admin', 'staff')),
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    mobile_number TEXT NOT NULL,
    branch TEXT NOT NULL,
    coupon_code TEXT UNIQUE NOT NULL,
    staff_id INTEGER NOT NULL,
    whatsapp_sent INTEGER DEFAULT 0,
    whatsapp_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (staff_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_coupons_mobile ON coupons(mobile_number);
  CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(coupon_code);
`);

// Create default admin
const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)').run(
    'admin', hashedPassword, 'Administrator', 'admin'
  );
  console.log('✅ Default admin created: admin / admin123');
}

// ============== MIDDLEWARE ==============
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts for frontend
}));
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});
app.use('/api/', limiter);

// ============== CONFIG ==============
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const JWT_EXPIRES_IN = '24h';

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('✅ Twilio configured');
} else {
  console.log('⚠️ Twilio not configured - WhatsApp messages will be simulated');
}

// ============== HELPERS ==============
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
  next();
};

const generateCouponCode = () => {
  const prefix = 'EXPO';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

const formatPhoneNumber = (phone) => {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
  if (!cleaned.startsWith('91')) cleaned = '91' + cleaned;
  return cleaned;
};

const sendWhatsAppMessage = async (to, couponCode) => {
  if (!twilioClient) {
    console.log(`📱 [SIMULATED] WhatsApp to ${to}: Coupon ${couponCode}`);
    return { success: true, simulated: true };
  }

  try {
    const result = await twilioClient.messages.create({
      body: `Welcome! 🎉 Here is your 15% discount coupon code: *${couponCode}*. Valid for 4 months at our showroom. Thank you for visiting our expo stall!`,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:+${formatPhoneNumber(to)}`
    });
    return { success: true, sid: result.sid };
  } catch (error) {
    console.error('WhatsApp error:', error.message);
    return { success: false, error: error.message };
  }
};

// ============== API ROUTES ==============

// Auth
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credentials required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Branches
app.get('/api/branches', authenticateToken, (req, res) => {
  const branches = process.env.BRANCHES?.split(',').map(b => b.trim()) || 
    ['Mabelah', 'Ghobra', 'Barka', 'Nizwa', 'Ibri', 'Sohar', 'Sur', 'Salalah'];
  res.json({ branches });
});

// Coupons
app.post('/api/coupons', authenticateToken, async (req, res) => {
  const { customer_name, mobile_number, branch } = req.body;
  if (!customer_name || !mobile_number || !branch) {
    return res.status(400).json({ error: 'All fields required' });
  }

  const couponCode = generateCouponCode();
  
  try {
    const result = db.prepare(
      'INSERT INTO coupons (customer_name, mobile_number, branch, coupon_code, staff_id) VALUES (?, ?, ?, ?, ?)'
    ).run(customer_name, mobile_number, branch, couponCode, req.user.id);

    const whatsappResult = await sendWhatsAppMessage(mobile_number, couponCode);
    
    db.prepare('UPDATE coupons SET whatsapp_sent = ?, whatsapp_error = ? WHERE id = ?').run(
      whatsappResult.success ? 1 : 0,
      whatsappResult.error || null,
      result.lastInsertRowid
    );

    res.status(201).json({
      message: 'Coupon created',
      coupon: { id: result.lastInsertRowid, customer_name, mobile_number, branch, coupon_code: couponCode, whatsapp_sent: whatsappResult.success },
      whatsapp: whatsappResult
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create coupon' });
  }
});

app.get('/api/coupons', authenticateToken, (req, res) => {
  const { page = 1, limit = 50, branch, search, date } = req.query;
  const offset = (page - 1) * limit;

  let where = '1=1';
  const params = [];

  if (branch) { where += ' AND c.branch = ?'; params.push(branch); }
  if (date) { where += ' AND DATE(c.created_at) = ?'; params.push(date); }
  if (search) {
    where += ' AND (c.customer_name LIKE ? OR c.mobile_number LIKE ? OR c.coupon_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM coupons c WHERE ${where}`).get(...params).count;
  const coupons = db.prepare(`
    SELECT c.*, u.name as staff_name FROM coupons c
    JOIN users u ON c.staff_id = u.id WHERE ${where}
    ORDER BY c.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ coupons, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } });
});

app.get('/api/coupons/export', authenticateToken, requireAdmin, (req, res) => {
  const data = db.prepare(`
    SELECT c.customer_name as "Customer Name", c.mobile_number as "Mobile Number",
      c.branch as "Branch", c.coupon_code as "Coupon Code", u.name as "Staff Name",
      CASE WHEN c.whatsapp_sent = 1 THEN 'Yes' ELSE 'No' END as "WhatsApp Sent",
      c.created_at as "Date & Time"
    FROM coupons c JOIN users u ON c.staff_id = u.id ORDER BY c.created_at DESC
  `).all();

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Coupons');
  
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="coupons-${new Date().toISOString().split('T')[0]}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.post('/api/coupons/:id/resend', authenticateToken, async (req, res) => {
  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
  if (!coupon) return res.status(404).json({ error: 'Not found' });

  const result = await sendWhatsAppMessage(coupon.mobile_number, coupon.coupon_code);
  db.prepare('UPDATE coupons SET whatsapp_sent = ?, whatsapp_error = ? WHERE id = ?').run(
    result.success ? 1 : 0, result.error || null, req.params.id
  );
  res.json(result);
});

// Stats
app.get('/api/stats', authenticateToken, (req, res) => {
  const { date } = req.query;
  const dateFilter = date ? 'WHERE DATE(c.created_at) = ?' : '';
  const params = date ? [date] : [];

  const totalCoupons = db.prepare(`SELECT COUNT(*) as c FROM coupons c ${dateFilter}`).get(...params).c;
  const whatsappSent = db.prepare(`SELECT COUNT(*) as c FROM coupons c ${dateFilter ? dateFilter + ' AND' : 'WHERE'} whatsapp_sent = 1`).get(...params).c;
  const byBranch = db.prepare(`SELECT branch, COUNT(*) as count FROM coupons c ${dateFilter} GROUP BY branch ORDER BY count DESC`).all(...params);
  const byStaff = db.prepare(`SELECT u.name, COUNT(*) as count FROM coupons c JOIN users u ON c.staff_id = u.id ${dateFilter} GROUP BY c.staff_id ORDER BY count DESC`).all(...params);

  res.json({ totalCoupons, whatsappSent, whatsappFailed: totalCoupons - whatsappSent, byBranch, byStaff });
});

// Staff Management
app.get('/api/staff', authenticateToken, requireAdmin, (req, res) => {
  const staff = db.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ staff });
});

app.post('/api/staff', authenticateToken, requireAdmin, (req, res) => {
  const { username, password, name, role = 'staff' } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'All fields required' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: 'Username exists' });

  const hashed = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)').run(username, hashed, name, role);
  res.status(201).json({ staff: { id: result.lastInsertRowid, username, name, role } });
});

app.patch('/api/staff/:id/toggle', authenticateToken, requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(user.active ? 0 : 1, req.params.id);
  res.json({ active: !user.active });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============== SERVE FRONTEND ==============
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
  console.log('✅ Serving frontend from /public');
}

// ============== START SERVER ==============
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     EXPO COUPON SYSTEM - PRODUCTION        ║
╠════════════════════════════════════════════╣
║  Server: http://localhost:${PORT}             ║
║  Database: ${dbPath}        ║
║  Twilio: ${twilioClient ? 'Connected' : 'Not configured'}                   ║
╚════════════════════════════════════════════╝
  `);
});

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
const PORT = process.env.PORT || 3001;

// Database setup
const dbPath = process.env.DATABASE_PATH || './data/coupon.db';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(dbPath);

// Initialize database tables
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
  CREATE INDEX IF NOT EXISTS idx_coupons_staff ON coupons(staff_id);
`);

// Create default admin if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)').run(
    'admin',
    hashedPassword,
    'Administrator',
    'admin'
  );
  console.log('Default admin created: username=admin, password=admin123');
}

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';

// Twilio setup
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Generate unique coupon code
const generateCouponCode = () => {
  const prefix = 'EXPO';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

// Format phone number for WhatsApp (India)
const formatPhoneNumber = (phone) => {
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // If starts with 0, remove it
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  
  // If doesn't start with 91, add it
  if (!cleaned.startsWith('91')) {
    cleaned = '91' + cleaned;
  }
  
  return cleaned;
};

// Send WhatsApp message via Twilio
const sendWhatsAppMessage = async (to, couponCode) => {
  if (!twilioClient) {
    console.log('Twilio not configured. Message would be sent to:', to);
    return { success: false, error: 'Twilio not configured' };
  }

  const formattedNumber = formatPhoneNumber(to);
  const message = `Welcome! 🎉 Here is your 15% discount coupon code: *${couponCode}*. Valid for 4 months at our showroom. Thank you for visiting our expo stall!`;

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:+${formattedNumber}`
    });
    console.log('WhatsApp message sent:', result.sid);
    return { success: true, sid: result.sid };
  } catch (error) {
    console.error('WhatsApp send error:', error.message);
    return { success: false, error: error.message };
  }
};

// ============== AUTH ROUTES ==============

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role
    }
  });
});

// Get current user
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// ============== STAFF ROUTES ==============

// Get all staff (admin only)
app.get('/api/staff', authenticateToken, requireAdmin, (req, res) => {
  const staff = db.prepare(`
    SELECT id, username, name, role, active, created_at 
    FROM users 
    ORDER BY created_at DESC
  `).all();
  res.json({ staff });
});

// Create staff member (admin only)
app.post('/api/staff', authenticateToken, requireAdmin, (req, res) => {
  const { username, password, name, role = 'staff' } = req.body;

  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Username, password, and name required' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  
  try {
    const result = db.prepare(
      'INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)'
    ).run(username, hashedPassword, name, role);

    res.status(201).json({
      message: 'Staff member created',
      staff: { id: result.lastInsertRowid, username, name, role }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create staff member' });
  }
});

// Toggle staff active status (admin only)
app.patch('/api/staff/:id/toggle', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'Staff not found' });
  }

  if (user.role === 'admin' && user.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot deactivate your own admin account' });
  }

  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(user.active ? 0 : 1, id);
  res.json({ message: 'Staff status updated', active: !user.active });
});

// Reset staff password (admin only)
app.patch('/api/staff/:id/password', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'Staff not found' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, id);
  res.json({ message: 'Password updated successfully' });
});

// ============== COUPON ROUTES ==============

// Create coupon (staff)
app.post('/api/coupons', authenticateToken, async (req, res) => {
  const { customer_name, mobile_number, branch } = req.body;

  if (!customer_name || !mobile_number || !branch) {
    return res.status(400).json({ error: 'Customer name, mobile number, and branch required' });
  }

  // Validate mobile number (10 digits for India)
  const cleanedMobile = mobile_number.replace(/\D/g, '');
  if (cleanedMobile.length < 10) {
    return res.status(400).json({ error: 'Invalid mobile number' });
  }

  const couponCode = generateCouponCode();

  try {
    const result = db.prepare(`
      INSERT INTO coupons (customer_name, mobile_number, branch, coupon_code, staff_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(customer_name, mobile_number, branch, couponCode, req.user.id);

    // Send WhatsApp message
    const whatsappResult = await sendWhatsAppMessage(mobile_number, couponCode);

    // Update WhatsApp status
    db.prepare('UPDATE coupons SET whatsapp_sent = ?, whatsapp_error = ? WHERE id = ?').run(
      whatsappResult.success ? 1 : 0,
      whatsappResult.error || null,
      result.lastInsertRowid
    );

    res.status(201).json({
      message: 'Coupon created successfully',
      coupon: {
        id: result.lastInsertRowid,
        customer_name,
        mobile_number,
        branch,
        coupon_code: couponCode,
        whatsapp_sent: whatsappResult.success
      },
      whatsapp: whatsappResult
    });
  } catch (error) {
    console.error('Coupon creation error:', error);
    res.status(500).json({ error: 'Failed to create coupon' });
  }
});

// Get all coupons (with pagination and filters)
app.get('/api/coupons', authenticateToken, (req, res) => {
  const { page = 1, limit = 50, branch, staff_id, date, search } = req.query;
  const offset = (page - 1) * limit;

  let whereClause = '1=1';
  const params = [];

  if (branch) {
    whereClause += ' AND c.branch = ?';
    params.push(branch);
  }

  if (staff_id) {
    whereClause += ' AND c.staff_id = ?';
    params.push(staff_id);
  }

  if (date) {
    whereClause += ' AND DATE(c.created_at) = ?';
    params.push(date);
  }

  if (search) {
    whereClause += ' AND (c.customer_name LIKE ? OR c.mobile_number LIKE ? OR c.coupon_code LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) as total FROM coupons c WHERE ${whereClause}`;
  const total = db.prepare(countQuery).get(...params).total;

  const dataQuery = `
    SELECT 
      c.id, c.customer_name, c.mobile_number, c.branch, c.coupon_code,
      c.whatsapp_sent, c.whatsapp_error, c.created_at,
      u.name as staff_name, u.username as staff_username
    FROM coupons c
    JOIN users u ON c.staff_id = u.id
    WHERE ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const coupons = db.prepare(dataQuery).all(...params, parseInt(limit), offset);

  res.json({
    coupons,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// Get stats
app.get('/api/stats', authenticateToken, (req, res) => {
  const { date } = req.query;
  
  let dateFilter = '';
  const params = [];
  
  if (date) {
    dateFilter = 'WHERE DATE(c.created_at) = ?';
    params.push(date);
  }

  const totalCoupons = db.prepare(`SELECT COUNT(*) as count FROM coupons c ${dateFilter}`).get(...params).count;
  const whatsappSent = db.prepare(`SELECT COUNT(*) as count FROM coupons c ${dateFilter ? dateFilter + ' AND' : 'WHERE'} whatsapp_sent = 1`).get(...params).count;

  const byBranch = db.prepare(`
    SELECT branch, COUNT(*) as count 
    FROM coupons c 
    ${dateFilter}
    GROUP BY branch 
    ORDER BY count DESC
  `).all(...params);

  const byStaff = db.prepare(`
    SELECT u.name, COUNT(*) as count
    FROM coupons c
    JOIN users u ON c.staff_id = u.id
    ${dateFilter}
    GROUP BY c.staff_id
    ORDER BY count DESC
  `).all(...params);

  res.json({
    totalCoupons,
    whatsappSent,
    whatsappFailed: totalCoupons - whatsappSent,
    byBranch,
    byStaff
  });
});

// Export to Excel
app.get('/api/coupons/export', authenticateToken, requireAdmin, (req, res) => {
  const { branch, staff_id, date_from, date_to } = req.query;

  let whereClause = '1=1';
  const params = [];

  if (branch) {
    whereClause += ' AND c.branch = ?';
    params.push(branch);
  }

  if (staff_id) {
    whereClause += ' AND c.staff_id = ?';
    params.push(staff_id);
  }

  if (date_from) {
    whereClause += ' AND DATE(c.created_at) >= ?';
    params.push(date_from);
  }

  if (date_to) {
    whereClause += ' AND DATE(c.created_at) <= ?';
    params.push(date_to);
  }

  const data = db.prepare(`
    SELECT 
      c.customer_name as "Customer Name",
      c.mobile_number as "Mobile Number",
      c.branch as "Branch",
      c.coupon_code as "Coupon Code",
      u.name as "Staff Name",
      CASE WHEN c.whatsapp_sent = 1 THEN 'Yes' ELSE 'No' END as "WhatsApp Sent",
      c.created_at as "Date & Time"
    FROM coupons c
    JOIN users u ON c.staff_id = u.id
    WHERE ${whereClause}
    ORDER BY c.created_at DESC
  `).all(...params);

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Coupons');

  // Set column widths
  worksheet['!cols'] = [
    { wch: 25 }, // Customer Name
    { wch: 15 }, // Mobile
    { wch: 20 }, // Branch
    { wch: 20 }, // Coupon Code
    { wch: 20 }, // Staff Name
    { wch: 12 }, // WhatsApp Sent
    { wch: 20 }  // Date & Time
  ];

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  
  const filename = `coupons-export-${new Date().toISOString().split('T')[0]}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// Resend WhatsApp message
app.post('/api/coupons/:id/resend', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
  if (!coupon) {
    return res.status(404).json({ error: 'Coupon not found' });
  }

  const result = await sendWhatsAppMessage(coupon.mobile_number, coupon.coupon_code);
  
  db.prepare('UPDATE coupons SET whatsapp_sent = ?, whatsapp_error = ? WHERE id = ?').run(
    result.success ? 1 : 0,
    result.error || null,
    id
  );

  res.json({ success: result.success, error: result.error });
});

// Get branches list
app.get('/api/branches', authenticateToken, (req, res) => {
  // You can make this configurable via database or environment
  const branches = process.env.BRANCHES 
    ? process.env.BRANCHES.split(',').map(b => b.trim())
    : ['Mabelah', 'Ghobra', 'Barka', 'Nizwa', 'Ibri', 'Sohar', 'Sur', 'Salalah'];
  res.json({ branches });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Twilio configured: ${twilioClient ? 'Yes' : 'No'}`);
});

module.exports = app;

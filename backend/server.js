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
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// Database setup
const dbPath = process.env.DATABASE_PATH || (
  process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'coupon.db')
    : './data/coupon.db'
);
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
const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
if (twilioSid && twilioToken && twilioSid.startsWith('AC')) {
  twilioClient = twilio(twilioSid, twilioToken);
  console.log('Twilio client initialized');
} else {
  console.log('Twilio not configured - WhatsApp messages will be simulated');
}

// Odoo Configuration
const ODOO_URL = process.env.ODOO_URL || 'https://test.bellastore.in';
const ODOO_DB = process.env.ODOO_DATABASE;
const ODOO_USERNAME = process.env.ODOO_USERNAME;
const ODOO_API_KEY = process.env.ODOO_API_KEY;
let odooUid = null;

// Authenticate with Odoo and get user ID
async function authenticateOdoo() {
  if (odooUid) return odooUid;

  if (!ODOO_DB || !ODOO_USERNAME || !ODOO_API_KEY) {
    throw new Error('Odoo credentials not configured');
  }

  const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "common",
      method: "authenticate",
      args: [ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {}]
    },
    id: Date.now()
  });

  if (response.data.error || !response.data.result) {
    console.error('Odoo auth error:', response.data.error);
    throw new Error('Odoo authentication failed');
  }
  odooUid = response.data.result;
  console.log('Odoo authenticated, uid:', odooUid);
  return odooUid;
}

// Create contact in Odoo
async function createOdooContact(name, phone, city, branchId = null) {
  const uid = await authenticateOdoo();
  const formattedName = `${name.toUpperCase()} ${phone} #IDF2026`;

  const partnerData = {
    name: formattedName,
    phone: phone,
    city: city,
    is_customer_toggle: true  // Mark as customer in Odoo
  };

  // Add branch if provided
  if (branchId) {
    partnerData.branch_id = branchId;
  }

  const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [ODOO_DB, uid, ODOO_API_KEY, "res.partner", "create", [partnerData]]
    },
    id: Date.now()
  });

  if (response.data.error) {
    console.error('Odoo create error:', response.data.error);
    throw new Error(response.data.error.data?.message || 'Odoo API error');
  }
  return response.data.result; // partner_id
}

// Send WhatsApp via Odoo using template
async function sendOdooWhatsApp(partnerId, phone) {
  const uid = await authenticateOdoo();
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'idf_2026';

  console.log(`\n=== WhatsApp Send Attempt ===`);
  console.log(`Partner ID: ${partnerId}, Phone: +968${phone}, Template: ${templateName}`);

  try {
    // Step 1: Find the WhatsApp template by name
    console.log('Step 1: Looking up template...');
    const templateResponse = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [ODOO_DB, uid, ODOO_API_KEY, "whatsapp.template", "search_read",
          [[["name", "=", templateName]]],
          { fields: ["id", "name"], limit: 1 }
        ]
      },
      id: Date.now()
    });

    if (templateResponse.data.error) {
      console.error('Template lookup error:', JSON.stringify(templateResponse.data.error));
      throw new Error(templateResponse.data.error.data?.message || 'Failed to find WhatsApp template');
    }

    const templates = templateResponse.data.result || [];
    console.log(`Templates found: ${templates.length}`, templates);

    if (templates.length === 0) {
      throw new Error(`WhatsApp template '${templateName}' not found`);
    }

    const templateId = templates[0].id;
    console.log(`Step 1 OK: Found template "${templateName}" (ID: ${templateId})`);

    // Step 2: Create WhatsApp composer with the template
    console.log('Step 2: Creating WhatsApp composer...');
    const composerResponse = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [ODOO_DB, uid, ODOO_API_KEY, "whatsapp.composer", "create", [{
          res_model: "res.partner",
          res_ids: [partnerId],
          phone: `+968${phone}`,
          wa_template_id: templateId
        }]]
      },
      id: Date.now()
    });

    if (composerResponse.data.error) {
      console.error('Composer creation error:', JSON.stringify(composerResponse.data.error));
      throw new Error(composerResponse.data.error.data?.message || 'Failed to create WhatsApp composer');
    }

    const composerId = composerResponse.data.result;
    console.log(`Step 2 OK: Composer created (ID: ${composerId})`);

    // Step 3: Send the WhatsApp message
    if (composerId) {
      console.log('Step 3: Sending WhatsApp template...');
      const sendResponse = await axios.post(`${ODOO_URL}/jsonrpc`, {
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [ODOO_DB, uid, ODOO_API_KEY, "whatsapp.composer", "action_send_whatsapp_template", [[composerId]]]
        },
        id: Date.now()
      });

      if (sendResponse.data.error) {
        console.error('Send error:', JSON.stringify(sendResponse.data.error));
        throw new Error(sendResponse.data.error.data?.message || 'Failed to send WhatsApp');
      }
      console.log('Step 3 OK: Send response:', JSON.stringify(sendResponse.data.result));
    }

    console.log(`✓ WhatsApp sent successfully to partner ${partnerId} (phone: +968${phone})`);
    return { success: true };
  } catch (error) {
    console.error('✗ Odoo WhatsApp error:', error.message);
    return { success: false, error: error.message };
  }
}

// Post a log note to partner's chatter
async function postOdooChatterNote(partnerId, staffName) {
  const uid = await authenticateOdoo();
  const noteBody = `<p>Created by <b>${staffName}</b> #IDF2026</p>`;

  try {
    const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_DB,
          uid,
          ODOO_API_KEY,
          "res.partner",
          "message_post",
          [[partnerId]],  // positional args - partner id as list
          {               // keyword args
            body: noteBody,
            message_type: "comment",
            subtype_xmlid: "mail.mt_note"
          }
        ]
      },
      id: Date.now()
    });

    if (response.data.error) {
      console.error('Chatter note error:', JSON.stringify(response.data.error));
      return null;
    }
    console.log(`Chatter note posted for partner ${partnerId}: Created by ${staffName}`);
    return response.data.result;
  } catch (error) {
    console.error('Chatter note error:', error.message);
    return null;
  }
}

// Fetch IDF2026 contacts from Odoo
async function getOdooContacts(limit = 100, offset = 0, branchId = null) {
  const uid = await authenticateOdoo();

  const domain = [["name", "ilike", "#IDF2026"]];
  if (branchId) {
    domain.push(["branch_id", "=", parseInt(branchId)]);
  }

  const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [ODOO_DB, uid, ODOO_API_KEY, "res.partner", "search_read",
        [domain],
        {
          fields: ["id", "name", "phone", "city", "branch_id", "create_date"],
          limit: limit,
          offset: offset,
          order: "create_date desc"
        }
      ]
    },
    id: Date.now()
  });

  return response.data.result || [];
}

// Count IDF2026 contacts in Odoo
async function countOdooContacts(branchId = null) {
  const uid = await authenticateOdoo();

  const domain = [["name", "ilike", "#IDF2026"]];
  if (branchId) {
    domain.push(["branch_id", "=", parseInt(branchId)]);
  }

  const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [ODOO_DB, uid, ODOO_API_KEY, "res.partner", "search_count", [domain]]
    },
    id: Date.now()
  });

  return response.data.result || 0;
}

// Get staff stats from chatter messages
async function getStaffStats() {
  const uid = await authenticateOdoo();

  try {
    const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [ODOO_DB, uid, ODOO_API_KEY, "mail.message", "search_read",
          [[
            ["body", "ilike", "Created by%#IDF2026"],
            ["model", "=", "res.partner"]
          ]],
          { fields: ["body"] }
        ]
      },
      id: Date.now()
    });

    const messages = response.data.result || [];
    const staffCounts = {};

    messages.forEach(msg => {
      const match = msg.body.match(/Created by ([^#]+) #IDF2026/);
      if (match) {
        const staffName = match[1].trim();
        staffCounts[staffName] = (staffCounts[staffName] || 0) + 1;
      }
    });

    return Object.entries(staffCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    console.error('Staff stats error:', error.message);
    return [];
  }
}

// Fetch branches from Odoo
async function getOdooBranches() {
  const uid = await authenticateOdoo();

  const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [ODOO_DB, uid, ODOO_API_KEY, "company.branches", "search_read",
        [[]],  // domain - empty to get all
        { fields: ["id", "name"] }
      ]
    },
    id: Date.now()
  });

  if (response.data.error) {
    console.error('Odoo branches error:', response.data.error);
    throw new Error(response.data.error.data?.message || 'Failed to fetch branches');
  }
  return response.data.result || [];
}

console.log(`Odoo configured: ${ODOO_DB ? 'Yes' : 'No'} (${ODOO_URL})`)

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

// Format phone number for WhatsApp (Oman)
const normalizeOmanMobile = (phone) => {
  let cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }

  if (cleaned.startsWith('968')) {
    cleaned = cleaned.substring(3);
  }

  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  return cleaned;
};

const isValidOmanMobile = (localNumber) => /^[79]\d{7}$/.test(localNumber);

const formatPhoneNumber = (phone) => {
  const local = normalizeOmanMobile(phone);
  return `968${local}`;
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

app.patch('/api/auth/password', authenticateToken, (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password required' });
  }

  if (new_password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const user = db.prepare('SELECT id, password, active FROM users WHERE id = ?').get(req.user.id);
  if (!user || !user.active) {
    return res.status(403).json({ error: 'Account inactive' });
  }

  if (!bcrypt.compareSync(current_password, user.password)) {
    return res.status(400).json({ error: 'Current password incorrect' });
  }

  const hashedPassword = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.user.id);
  res.json({ message: 'Password updated successfully' });
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

  // Validate mobile number (Oman)
  const localMobile = normalizeOmanMobile(mobile_number);
  if (!isValidOmanMobile(localMobile)) {
    return res.status(400).json({ error: 'Invalid Oman mobile number (8 digits, starts with 7 or 9)' });
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

// Get stats from Odoo
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const totalContacts = await countOdooContacts();
    const activeStaff = db.prepare('SELECT COUNT(*) as count FROM users WHERE active = 1').get().count;

    // Get branch-wise counts
    const branches = await getOdooBranches();
    const byBranch = [];
    for (const branch of branches.slice(0, 5)) {
      const count = await countOdooContacts(branch.id);
      if (count > 0) {
        byBranch.push({ branch: branch.name, count });
      }
    }
    byBranch.sort((a, b) => b.count - a.count);

    // Get staff stats from chatter
    const byStaff = await getStaffStats();

    res.json({
      totalContacts,
      activeStaff,
      byBranch,
      byStaff
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
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

// ============== CONTACT ROUTES (ODOO) ==============

// Create contact in Odoo (no local storage)
app.post('/api/contacts', authenticateToken, async (req, res) => {
  try {
    const { name, phone, city, branch_id } = req.body;

    // Validate
    if (!name?.trim() || !phone?.trim() || !city?.trim()) {
      return res.status(400).json({ error: 'Name, phone, and city are required' });
    }

    // Normalize phone (Oman format)
    const normalizedPhone = normalizeOmanMobile(phone);
    if (!isValidOmanMobile(normalizedPhone)) {
      return res.status(400).json({ error: 'Invalid Oman mobile number (8 digits, starts with 7 or 9)' });
    }

    // 1. Create contact in Odoo
    const partnerId = await createOdooContact(name.trim(), normalizedPhone, city.trim(), branch_id);
    const formattedName = `${name.trim().toUpperCase()} ${normalizedPhone} #IDF2026`;

    // 2. Post chatter note with staff name for tracking
    await postOdooChatterNote(partnerId, req.user.name);

    // 3. Send WhatsApp using template via Odoo
    let whatsappResult = { success: false };
    try {
      whatsappResult = await sendOdooWhatsApp(partnerId, normalizedPhone);
    } catch (waError) {
      console.error('WhatsApp error:', waError.message);
      whatsappResult.error = waError.message;
    }

    res.json({
      success: true,
      contact: {
        odoo_partner_id: partnerId,
        name: formattedName,
        phone: normalizedPhone,
        city: city.trim()
      },
      whatsapp_sent: whatsappResult.success
    });

  } catch (error) {
    console.error('Contact creation error:', error);
    res.status(500).json({ error: error.message || 'Failed to create contact' });
  }
});

// Get branches from Odoo
app.get('/api/branches', authenticateToken, async (req, res) => {
  try {
    const branches = await getOdooBranches();
    res.json({ branches });
  } catch (error) {
    console.error('Failed to fetch branches:', error.message);
    // Fallback to env branches if Odoo fails
    const fallbackBranches = process.env.BRANCHES
      ? process.env.BRANCHES.split(',').map((b, i) => ({ id: i + 1, name: b.trim() }))
      : [];
    res.json({ branches: fallbackBranches });
  }
});

// Get all contacts from Odoo (with pagination)
app.get('/api/contacts', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, branch_id } = req.query;
    const offset = (page - 1) * limit;

    const contacts = await getOdooContacts(parseInt(limit), offset, branch_id);
    const total = await countOdooContacts(branch_id);

    res.json({
      contacts: contacts.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        city: c.city,
        branch_id: c.branch_id ? c.branch_id[0] : null,
        branch_name: c.branch_id ? c.branch_id[1] : null,
        created_at: c.create_date
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Fetch contacts error:', error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Export contacts to Excel (from Odoo)
app.get('/api/contacts/export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { branch_id } = req.query;

    // Fetch all contacts from Odoo (up to 10000)
    const contacts = await getOdooContacts(10000, 0, branch_id);

    const data = contacts.map(c => ({
      "Customer Name": c.name,
      "Phone": c.phone,
      "City": c.city,
      "Branch": c.branch_id ? c.branch_id[1] : '',
      "Date & Time": c.create_date
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Contacts');

    worksheet['!cols'] = [
      { wch: 30 }, // Customer Name
      { wch: 12 }, // Phone
      { wch: 15 }, // City
      { wch: 15 }, // Branch
      { wch: 20 }  // Date & Time
    ];

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const filename = `contacts-export-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export contacts' });
  }
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

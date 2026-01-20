import React, { useState, useEffect, createContext, useContext } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { 
  Ticket, LogOut, Users, BarChart3, Download, RefreshCw, 
  Search, ChevronRight, Menu, X, Check, AlertCircle,
  Smartphone, User, Building, Send, Eye, EyeOff, Plus,
  Calendar, Filter, ArrowLeft, Settings, Lock, ToggleLeft, ToggleRight
} from 'lucide-react';
import bellaLogo from './assets/bella_logo.webp';

// API Configuration
const API_URL = import.meta.env.VITE_API_URL || '';

// Auth Context
const AuthContext = createContext(null);

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// API Helper
const api = {
  token: null,
  
  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  },
  
  getToken() {
    if (!this.token) {
      this.token = localStorage.getItem('token');
    }
    return this.token;
  },
  
  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers
    };
    
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers
    });
    
    if (response.status === 401 || response.status === 403) {
      this.setToken(null);
      window.location.reload();
      throw new Error('Session expired');
    }
    
    const data = options.raw ? await response.blob() : await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    
    return data;
  },
  
  get: (endpoint) => api.request(endpoint),
  post: (endpoint, body) => api.request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  patch: (endpoint, body) => api.request(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint) => api.request(endpoint, { method: 'DELETE' }),
  download: (endpoint) => api.request(endpoint, { raw: true })
};

// Auth Provider
function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.setToken(token);
      api.get('/api/auth/me')
        .then(data => setUser(data.user))
        .catch(() => api.setToken(null))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const data = await api.post('/api/auth/login', { username, password });
    api.setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    api.setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

// Login Screen
function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('Please enter username and password');
      return;
    }
    
    setLoading(true);
    try {
      await login(username, password);
      toast.success('Welcome!');
    } catch (error) {
      toast.error(error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 pattern-bg">
      <div className="w-full max-w-md animate-bounce-in">
        {/* Logo Section */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-brand-50 border border-brand-100 mb-4 glow shadow-sm">
            <img src={bellaLogo} alt="IDF EXPO 2026 logo" className="w-14 h-14 object-contain" />
          </div>
          <h1 className="font-display text-3xl font-bold gradient-text">IDF EXPO 2026</h1>
          <p className="text-dark-400 mt-2">Sign in to continue</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="glass rounded-2xl p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-dark-300">Username</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/70 border border-dark-700 rounded-xl py-3.5 pl-12 pr-4 text-dark-900 placeholder-dark-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                placeholder="Enter username"
                autoComplete="username"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-dark-300">Password</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/70 border border-dark-700 rounded-xl py-3.5 pl-12 pr-12 text-dark-900 placeholder-dark-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                placeholder="Enter password"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white font-semibold py-3.5 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ripple shadow-lg shadow-brand-500/25"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <p className="text-center text-dark-500 text-sm mt-6">
          IDF EXPO 2026 Coupon Distribution System
        </p>
      </div>
    </div>
  );
}

// Staff Entry Form
function EntryForm() {
  const { user, logout } = useAuth();
  const [branches, setBranches] = useState([]);
  const [formData, setFormData] = useState({ customer_name: '', mobile_number: '', branch: '' });
  const [loading, setLoading] = useState(false);
  const [lastCoupon, setLastCoupon] = useState(null);
  const [stats, setStats] = useState({ today: 0, total: 0 });

  useEffect(() => {
    loadBranches();
    loadStats();
  }, []);

  const loadBranches = async () => {
    try {
      const data = await api.get('/api/branches');
      setBranches(data.branches);
      if (data.branches.length > 0 && !formData.branch) {
        setFormData(prev => ({ ...prev, branch: data.branches[0] }));
      }
    } catch (error) {
      console.error('Failed to load branches');
    }
  };

  const loadStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const [todayStats, totalStats] = await Promise.all([
        api.get(`/api/stats?date=${today}`),
        api.get('/api/stats')
      ]);
      setStats({ today: todayStats.totalCoupons, total: totalStats.totalCoupons });
    } catch (error) {
      console.error('Failed to load stats');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.customer_name.trim()) {
      toast.error('Please enter customer name');
      return;
    }
    
    const cleanedMobile = formData.mobile_number.replace(/\D/g, '');
    if (cleanedMobile.length < 10) {
      toast.error('Please enter a valid 10-digit mobile number');
      return;
    }
    
    if (!formData.branch) {
      toast.error('Please select a branch');
      return;
    }

    setLoading(true);
    try {
      const data = await api.post('/api/coupons', formData);
      setLastCoupon(data.coupon);
      setFormData(prev => ({ ...prev, customer_name: '', mobile_number: '' }));
      loadStats();
      
      if (data.coupon.whatsapp_sent) {
        toast.success('Coupon sent via WhatsApp!', { icon: '✅' });
      } else {
        toast.success('Coupon created! WhatsApp pending.', { icon: '⚠️' });
      }
    } catch (error) {
      toast.error(error.message || 'Failed to create coupon');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pattern-bg">
      {/* Header */}
      <header className="glass sticky top-0 z-10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center shadow-sm">
            <img src={bellaLogo} alt="IDF EXPO 2026 logo" className="w-8 h-8 object-contain" />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg">IDF EXPO 2026</h1>
            <p className="text-xs text-dark-400">Hi, {user.name}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="p-2 rounded-lg hover:bg-dark-800 transition-colors"
        >
          <LogOut className="w-5 h-5 text-dark-400" />
        </button>
      </header>

      <main className="p-4 max-w-lg mx-auto space-y-4 animate-fade-in">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-xl p-4">
            <p className="text-dark-400 text-sm">Today</p>
            <p className="font-display text-2xl font-bold gradient-text">{stats.today}</p>
          </div>
          <div className="glass rounded-xl p-4">
            <p className="text-dark-400 text-sm">Total</p>
            <p className="font-display text-2xl font-bold text-dark-900">{stats.total}</p>
          </div>
        </div>

        {/* Entry Form */}
        <form onSubmit={handleSubmit} className="glass rounded-2xl p-5 space-y-4">
          <h2 className="font-display font-semibold text-lg flex items-center gap-2">
            <Send className="w-5 h-5 text-brand-500" />
            New Coupon
          </h2>

          <div className="space-y-2">
            <label className="text-sm font-medium text-dark-300">Customer Name</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
              <input
                type="text"
                value={formData.customer_name}
                onChange={(e) => setFormData(prev => ({ ...prev, customer_name: e.target.value }))}
                className="w-full bg-white/70 border border-dark-700 rounded-xl py-3.5 pl-12 pr-4 text-dark-900 placeholder-dark-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                placeholder="Enter customer name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-dark-300">Mobile Number</label>
            <div className="relative">
              <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
              <input
                type="tel"
                value={formData.mobile_number}
                onChange={(e) => setFormData(prev => ({ ...prev, mobile_number: e.target.value }))}
                className="w-full bg-white/70 border border-dark-700 rounded-xl py-3.5 pl-12 pr-4 text-dark-900 placeholder-dark-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                placeholder="10-digit mobile number"
                inputMode="tel"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-dark-300">Branch</label>
            <div className="relative">
              <Building className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
              <select
                value={formData.branch}
                onChange={(e) => setFormData(prev => ({ ...prev, branch: e.target.value }))}
                className="w-full bg-white/70 border border-dark-700 rounded-xl py-3.5 pl-12 pr-4 text-dark-900 appearance-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
              >
                {branches.map(branch => (
                  <option key={branch} value={branch}>{branch}</option>
                ))}
              </select>
              <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500 rotate-90" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white font-semibold py-4 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ripple shadow-lg shadow-brand-500/25 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Submit & Send Coupon
              </>
            )}
          </button>
        </form>

        {/* Last Coupon Success */}
        {lastCoupon && (
          <div className="glass rounded-2xl p-5 animate-slide-up border border-green-200/80 bg-green-50/80">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <Check className="w-5 h-5 text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-green-700">Coupon Created!</p>
                <p className="text-sm text-dark-300 mt-1">{lastCoupon.customer_name}</p>
                <p className="text-sm text-dark-400">{lastCoupon.mobile_number}</p>
                <div className="mt-2 px-3 py-2 bg-dark-900/50 rounded-lg">
                  <p className="text-xs text-dark-400">Coupon Code</p>
                  <p className="font-mono font-bold text-brand-400">{lastCoupon.coupon_code}</p>
                </div>
                {!lastCoupon.whatsapp_sent && (
                  <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    WhatsApp delivery pending
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Admin Dashboard
function AdminDashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [coupons, setCoupons] = useState([]);
  const [staff, setStaff] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', branch: '', date: '' });
  const [branches, setBranches] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'coupons') loadCoupons();
    if (activeTab === 'staff') loadStaff();
  }, [activeTab, filters]);

  const loadData = async () => {
    try {
      const [statsData, branchesData] = await Promise.all([
        api.get('/api/stats'),
        api.get('/api/branches')
      ]);
      setStats(statsData);
      setBranches(branchesData.branches);
      setLoading(false);
    } catch (error) {
      toast.error('Failed to load data');
      setLoading(false);
    }
  };

  const loadCoupons = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.search) params.append('search', filters.search);
      if (filters.branch) params.append('branch', filters.branch);
      if (filters.date) params.append('date', filters.date);
      params.append('limit', '100');
      
      const data = await api.get(`/api/coupons?${params}`);
      setCoupons(data.coupons);
    } catch (error) {
      toast.error('Failed to load coupons');
    }
  };

  const loadStaff = async () => {
    try {
      const data = await api.get('/api/staff');
      setStaff(data.staff);
    } catch (error) {
      toast.error('Failed to load staff');
    }
  };

  const handleExport = async () => {
    try {
      toast.loading('Preparing export...');
      const params = new URLSearchParams();
      if (filters.branch) params.append('branch', filters.branch);
      if (filters.date) params.append('date_from', filters.date);
      if (filters.date) params.append('date_to', filters.date);
      
      const response = await fetch(`${API_URL}/api/coupons/export?${params}`, {
        headers: { Authorization: `Bearer ${api.getToken()}` }
      });
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coupons-export-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast.dismiss();
      toast.success('Export downloaded!');
    } catch (error) {
      toast.dismiss();
      toast.error('Export failed');
    }
  };

  const handleResend = async (couponId) => {
    try {
      toast.loading('Resending...');
      await api.post(`/api/coupons/${couponId}/resend`);
      toast.dismiss();
      toast.success('WhatsApp resent!');
      loadCoupons();
    } catch (error) {
      toast.dismiss();
      toast.error('Resend failed');
    }
  };

  const menuItems = [
    { id: 'dashboard', icon: BarChart3, label: 'Dashboard' },
    { id: 'coupons', icon: Ticket, label: 'Coupons' },
    { id: 'staff', icon: Users, label: 'Staff' }
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pattern-bg">
      {/* Mobile Menu Overlay */}
      {menuOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMenuOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 w-64 glass z-50 transform transition-transform duration-300 lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-dark-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center shadow-sm">
              <img src={bellaLogo} alt="IDF EXPO 2026 logo" className="w-8 h-8 object-contain" />
            </div>
            <div>
              <h1 className="font-display font-bold">IDF EXPO 2026</h1>
              <p className="text-xs text-dark-400">Admin Panel - {user.name}</p>
            </div>
          </div>
        </div>
        
        <nav className="p-4 space-y-2">
          {menuItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setActiveTab(item.id); setMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === item.id 
                  ? 'bg-brand-500/20 text-brand-400' 
                  : 'text-dark-300 hover:bg-dark-800'
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="absolute bottom-4 left-4 right-4">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-dark-400 hover:bg-dark-800 transition-all"
          >
            <LogOut className="w-5 h-5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:pl-64">
        {/* Mobile Header */}
        <header className="glass sticky top-0 z-30 px-4 py-3 flex items-center justify-between lg:hidden">
          <button onClick={() => setMenuOpen(true)} className="p-2 rounded-lg hover:bg-dark-800">
            <Menu className="w-6 h-6" />
          </button>
          <h1 className="font-display font-bold">{menuItems.find(m => m.id === activeTab)?.label}</h1>
          <div className="w-10" />
        </header>

        <main className="p-4 lg:p-6 animate-fade-in">
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && stats && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-bold hidden lg:block">Dashboard</h2>
              
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass rounded-xl p-5">
                  <p className="text-dark-400 text-sm">Total Coupons</p>
                  <p className="font-display text-3xl font-bold gradient-text mt-1">{stats.totalCoupons}</p>
                </div>
                <div className="glass rounded-xl p-5">
                  <p className="text-dark-400 text-sm">WhatsApp Sent</p>
                  <p className="font-display text-3xl font-bold text-emerald-700 mt-1">{stats.whatsappSent}</p>
                </div>
                <div className="glass rounded-xl p-5">
                  <p className="text-dark-400 text-sm">Pending</p>
                  <p className="font-display text-3xl font-bold text-amber-700 mt-1">{stats.whatsappFailed}</p>
                </div>
                <div className="glass rounded-xl p-5">
                  <p className="text-dark-400 text-sm">Staff Active</p>
                  <p className="font-display text-3xl font-bold text-sky-700 mt-1">{stats.byStaff?.length || 0}</p>
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                <div className="glass rounded-xl p-5">
                  <h3 className="font-display font-semibold mb-4">By Branch</h3>
                  <div className="space-y-3">
                    {stats.byBranch?.map(item => (
                      <div key={item.branch} className="flex items-center justify-between">
                        <span className="text-dark-300">{item.branch}</span>
                        <span className="font-semibold">{item.count}</span>
                      </div>
                    ))}
                    {stats.byBranch?.length === 0 && (
                      <p className="text-dark-500 text-center py-4">No data yet</p>
                    )}
                  </div>
                </div>

                <div className="glass rounded-xl p-5">
                  <h3 className="font-display font-semibold mb-4">By Staff</h3>
                  <div className="space-y-3">
                    {stats.byStaff?.map(item => (
                      <div key={item.name} className="flex items-center justify-between">
                        <span className="text-dark-300">{item.name}</span>
                        <span className="font-semibold">{item.count}</span>
                      </div>
                    ))}
                    {stats.byStaff?.length === 0 && (
                      <p className="text-dark-500 text-center py-4">No data yet</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Coupons Tab */}
          {activeTab === 'coupons' && (
            <div className="space-y-4">
              <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
                <h2 className="font-display text-2xl font-bold hidden lg:block">Coupons</h2>
                <button
                  onClick={handleExport}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-xl transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Export Excel
                </button>
              </div>

              {/* Filters */}
              <div className="glass rounded-xl p-4 flex flex-col lg:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                    placeholder="Search name, mobile, code..."
                    className="w-full bg-white/70 border border-dark-700 rounded-lg py-2.5 pl-10 pr-4 text-dark-900 placeholder-dark-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
                <select
                  value={filters.branch}
                  onChange={(e) => setFilters(prev => ({ ...prev, branch: e.target.value }))}
                  className="bg-white/70 border border-dark-700 rounded-lg py-2.5 px-4 text-dark-900 focus:outline-none focus:border-brand-500"
                >
                  <option value="">All Branches</option>
                  {branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <input
                  type="date"
                  value={filters.date}
                  onChange={(e) => setFilters(prev => ({ ...prev, date: e.target.value }))}
                  className="bg-white/70 border border-dark-700 rounded-lg py-2.5 px-4 text-dark-900 focus:outline-none focus:border-brand-500"
                />
              </div>

              {/* Table */}
              <div className="glass rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-dark-700">
                        <th className="text-left p-4 text-dark-400 font-medium">Customer</th>
                        <th className="text-left p-4 text-dark-400 font-medium">Mobile</th>
                        <th className="text-left p-4 text-dark-400 font-medium hidden lg:table-cell">Branch</th>
                        <th className="text-left p-4 text-dark-400 font-medium hidden lg:table-cell">Code</th>
                        <th className="text-left p-4 text-dark-400 font-medium hidden lg:table-cell">Staff</th>
                        <th className="text-left p-4 text-dark-400 font-medium">Status</th>
                        <th className="text-left p-4 text-dark-400 font-medium hidden lg:table-cell">Date</th>
                        <th className="p-4"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {coupons.map(coupon => (
                        <tr key={coupon.id} className="border-b border-dark-800 hover:bg-dark-800/50">
                          <td className="p-4">
                            <div>
                              <p className="font-medium">{coupon.customer_name}</p>
                              <p className="text-sm text-dark-400 lg:hidden">{coupon.branch}</p>
                            </div>
                          </td>
                          <td className="p-4 text-dark-300">{coupon.mobile_number}</td>
                          <td className="p-4 text-dark-300 hidden lg:table-cell">{coupon.branch}</td>
                          <td className="p-4 hidden lg:table-cell">
                            <code className="text-brand-400 text-sm">{coupon.coupon_code}</code>
                          </td>
                          <td className="p-4 text-dark-300 hidden lg:table-cell">{coupon.staff_name}</td>
                          <td className="p-4">
                            {coupon.whatsapp_sent ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-sm">
                                <Check className="w-3 h-3" /> Sent
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-sm">
                                <AlertCircle className="w-3 h-3" /> Pending
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-dark-400 text-sm hidden lg:table-cell">
                            {new Date(coupon.created_at).toLocaleString()}
                          </td>
                          <td className="p-4">
                            {!coupon.whatsapp_sent && (
                              <button
                                onClick={() => handleResend(coupon.id)}
                                className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
                                title="Resend WhatsApp"
                              >
                                <RefreshCw className="w-4 h-4 text-dark-400" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {coupons.length === 0 && (
                        <tr>
                          <td colSpan="8" className="p-8 text-center text-dark-500">
                            No coupons found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Staff Tab */}
          {activeTab === 'staff' && (
            <StaffManagement staff={staff} onRefresh={loadStaff} />
          )}
        </main>
      </div>
    </div>
  );
}

// Staff Management Component
function StaffManagement({ staff, onRefresh }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newStaff, setNewStaff] = useState({ username: '', password: '', name: '', role: 'staff' });
  const [loading, setLoading] = useState(false);

  const handleAddStaff = async (e) => {
    e.preventDefault();
    if (!newStaff.username || !newStaff.password || !newStaff.name) {
      toast.error('Please fill all fields');
      return;
    }
    
    setLoading(true);
    try {
      await api.post('/api/staff', newStaff);
      toast.success('Staff member added!');
      setShowAddModal(false);
      setNewStaff({ username: '', password: '', name: '', role: 'staff' });
      onRefresh();
    } catch (error) {
      toast.error(error.message || 'Failed to add staff');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (id) => {
    try {
      await api.patch(`/api/staff/${id}/toggle`);
      toast.success('Status updated');
      onRefresh();
    } catch (error) {
      toast.error(error.message || 'Failed to update status');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold hidden lg:block">Staff Management</h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Staff
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {staff.map(member => (
          <div key={member.id} className="glass rounded-xl p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  member.role === 'admin' ? 'bg-brand-100' : 'bg-emerald-100'
                }`}>
                  <User className={`w-6 h-6 ${member.role === 'admin' ? 'text-brand-700' : 'text-emerald-700'}`} />
                </div>
                <div>
                  <p className="font-semibold">{member.name}</p>
                  <p className="text-sm text-dark-400">@{member.username}</p>
                </div>
              </div>
              <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                member.role === 'admin' ? 'bg-brand-100 text-brand-700' : 'bg-emerald-100 text-emerald-700'
              }`}>
                {member.role}
              </span>
            </div>
            
            <div className="mt-4 pt-4 border-t border-dark-700 flex items-center justify-between">
              <span className={`text-sm ${member.active ? 'text-emerald-700' : 'text-red-600'}`}>
                {member.active ? 'Active' : 'Inactive'}
              </span>
              <button
                onClick={() => handleToggleStatus(member.id)}
                className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
              >
                {member.active ? (
                  <ToggleRight className="w-6 h-6 text-emerald-600" />
                ) : (
                  <ToggleLeft className="w-6 h-6 text-dark-500" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Staff Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="glass rounded-2xl p-6 w-full max-w-md animate-bounce-in">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display text-xl font-bold">Add Staff Member</h3>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-dark-700 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleAddStaff} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-dark-300">Full Name</label>
                <input
                  type="text"
                  value={newStaff.name}
                  onChange={(e) => setNewStaff(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full mt-1 bg-white/70 border border-dark-700 rounded-xl py-3 px-4 text-dark-900 focus:outline-none focus:border-brand-500"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-dark-300">Username</label>
                <input
                  type="text"
                  value={newStaff.username}
                  onChange={(e) => setNewStaff(prev => ({ ...prev, username: e.target.value.toLowerCase() }))}
                  className="w-full mt-1 bg-white/70 border border-dark-700 rounded-xl py-3 px-4 text-dark-900 focus:outline-none focus:border-brand-500"
                  placeholder="johndoe"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-dark-300">Password</label>
                <input
                  type="text"
                  value={newStaff.password}
                  onChange={(e) => setNewStaff(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full mt-1 bg-white/70 border border-dark-700 rounded-xl py-3 px-4 text-dark-900 focus:outline-none focus:border-brand-500"
                  placeholder="Minimum 4 characters"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-dark-300">Role</label>
                <select
                  value={newStaff.role}
                  onChange={(e) => setNewStaff(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full mt-1 bg-white/70 border border-dark-700 rounded-xl py-3 px-4 text-dark-900 focus:outline-none focus:border-brand-500"
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 rounded-xl border border-dark-600 hover:bg-dark-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Adding...' : 'Add Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Main App Component
function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center pattern-bg">
        <div className="text-center">
          <RefreshCw className="w-10 h-10 text-brand-500 animate-spin mx-auto" />
          <p className="mt-4 text-dark-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return user.role === 'admin' ? <AdminDashboard /> : <EntryForm />;
}

// Wrapped App with Providers
export default function WrappedApp() {
  return (
    <AuthProvider>
      <App />
      <Toaster 
        position="top-center"
        toastOptions={{
          className: 'toast-custom',
          style: {
            background: '#fffaf5',
            color: '#2a241f',
            border: '1px solid rgba(79, 70, 62, 0.18)',
            boxShadow: '0 14px 30px rgba(60, 52, 44, 0.12)'
          }
        }}
      />
    </AuthProvider>
  );
}

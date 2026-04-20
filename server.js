import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.SUPABASE_ANON_KEY) {
  console.error('Hata: SUPABASE_URL, SUPABASE_SERVICE_KEY ve SUPABASE_ANON_KEY .env dosyasında tanımlı olmalıdır.');
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';
const cookieSameSite = (process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax')).toLowerCase();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// FIX: Dinamik origin kontrolü ile güvenli CORS
const allowedOrigins = ['http://localhost:3001'];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);
const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // curl/Postman
    // Local geliştirmede port değişse bile (3001/3002/3003...) erişimi kesme
    if (localOriginPattern.test(origin)) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS blocked: ' + origin));
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.' }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.' }
});

app.use('/login', authLimiter);
app.use(['/personnel', '/companies', '/work_records', '/admin'], apiLimiter);

const loginSchema = z.object({
  email: z.string().email('Geçerli bir e-posta girin'),
  password: z.string().min(6, 'Şifre en az 6 karakter olmalıdır')
});

const personnelSchema = z.object({
  first_name: z.string().trim().min(1, 'Ad zorunludur'),
  last_name: z.string().trim().optional().default(''),
  phone: z.string().trim().optional().default(''),
  iban: z.string().trim().optional().default(''),
  position: z.string().trim().optional().default(''),
  daily_wage: z.coerce.number().min(0).optional(),
  monthly_wage: z.coerce.number().min(0).optional()
});
const personnelPatchSchema = personnelSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Güncellenecek en az bir alan gönderin' }
);

const companySchema = z.object({
  company_name: z.string().trim().min(1, 'Kurum adı zorunludur'),
  contact_person: z.string().trim().optional().default(''),
  phone: z.string().trim().optional().default(''),
  address: z.string().trim().optional().default('')
});
const companyPatchSchema = companySchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Güncellenecek en az bir alan gönderin' }
);

const workRecordSchema = z.object({
  personnel_id: z.union([z.string(), z.number()]).transform(String),
  company_id: z.union([z.string(), z.number()]).transform(String),
  start_day: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  work_days: z.coerce.number().min(0),
  personnel_daily_wage: z.coerce.number().min(0).optional(),
  personnel_monthly_wage: z.coerce.number().min(0).optional(),
  total_personnel_payment: z.coerce.number().min(0).optional(), // <-- BU SATIRI EKLE
  total_company_payment: z.coerce.number().min(0).default(0),
  advance_amount: z.coerce.number().min(0).default(0),
  expenses: z.coerce.number().min(0).default(0),
  personnel_payment_status: z.enum(['bekliyor', 'odendi']).optional(),
  company_payment_status: z.enum(['bekliyor', 'odendi']).optional(),
  note: z.string().max(1000).optional().nullable(),
  archived: z.boolean().optional()
});
const workRecordPatchSchema = workRecordSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Güncellenecek en az bir alan gönderin' }
);

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Geçersiz veri' });
    }
    req.body = parsed.data;
    next();
  };
}

// ==============================================================
// AUTH MIDDLEWARE
// ==============================================================
async function requireAuth(req, res, next) {
  const token = req.cookies.ik_token
    || (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null);

  if (!token) return res.status(401).json({ error: 'Yetkisiz erişim: token bulunamadı' });

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token' });
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Kimlik doğrulama hatası' });
  }
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    if (!req.user?.user_metadata?.admin) {
      return res.status(403).json({ error: 'Bu işlem için admin yetkisi gereklidir' });
    }
    next();
  });
}

async function sbFetch(path, options = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Prefer': 'return=representation',
    ...(options.headers || {})
  };
  if (options.method === 'DELETE') delete headers['Prefer'];
  return fetch(url, { ...options, headers });
}

// Ortak cookie seçenekleri
function cookieOpts(req) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: cookieSameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

// ==============================================================
// LOGIN
// ==============================================================
app.post('/login', validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-posta ve şifre zorunludur' });

  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: { 'apikey': process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      }
    );

    // FIX: HTTP durum kodu önce kontrol ediliyor, data.error'a güvenilmiyor
    if (!response.ok) {
      const data = await response.json();
      return res.status(401).json({ error: data.error_description || 'E-posta veya şifre hatalı' });
    }

    const data = await response.json();

    if (!data?.user?.user_metadata?.admin) {
      return res.status(403).json({ error: 'Bu panele sadece yöneticiler giriş yapabilir.' });
    }

    // FIX: refresh_token artık httpOnly cookie'de tutuluyor, frontend'e gönderilmiyor
    res.cookie('ik_token', data.access_token, cookieOpts(req));
    res.cookie('ik_refresh', data.refresh_token, cookieOpts(req));
    res.json({ message: 'Giriş başarılı', user: data.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ==============================================================
// LOGOUT
// ==============================================================
app.post('/logout', (req, res) => {
  res.clearCookie('ik_token');
  res.clearCookie('ik_refresh');
  res.json({ message: 'Çıkış yapıldı' });
});

// ==============================================================
// TOKEN REFRESH — refresh_token artık body'den değil httpOnly cookie'den
// ==============================================================
app.post('/refresh', async (req, res) => {
  // FIX: refresh_token body'den değil güvenli httpOnly cookie'den alınıyor
  const refresh_token = req.cookies.ik_refresh;

  if (!refresh_token) {
    return res.status(400).json({ error: 'Refresh token bulunamadı, tekrar giriş yapın' });
  }

  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: { 'apikey': process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token })
      }
    );

    const data = await response.json();

    if (data.access_token) {
      // FIX: Rotation — yeni refresh_token da cookie'ye yazılıyor
      res.cookie('ik_token', data.access_token, cookieOpts(req));
      res.cookie('ik_refresh', data.refresh_token, cookieOpts(req));
      res.json({ message: 'Token yenilendi' });
    } else {
      res.clearCookie('ik_token');
      res.clearCookie('ik_refresh');
      res.status(401).json({ error: 'Oturum süresi doldu, tekrar giriş yapın' });
    }
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ==============================================================
// ME
// ==============================================================
app.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ==============================================================
// PERSONNEL
// ==============================================================
app.get('/personnel', requireAdmin, async (req, res) => {
  try {
    const response = await sbFetch('/personnel?select=*&order=created_at.asc');
    res.json(await response.json());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

app.post('/admin/personnel', requireAdmin, validateBody(personnelSchema), async (req, res) => {
  try {
    const { first_name, last_name, phone, iban, position, daily_wage, monthly_wage } = req.body;
    if (!first_name) return res.status(400).json({ error: 'Ad zorunludur' });
    const normalizedMonthlyWage = Number(
      monthly_wage !== undefined && monthly_wage !== null ? monthly_wage : daily_wage
    ) || 0;
    const response = await sbFetch('/personnel', {
      method: 'POST',
      body: JSON.stringify([{
        first_name,
        last_name,
        phone,
        iban,
        position,
        // Backward compatibility: DB kolonu daily_wage, anlamı artık aylık ücret
        daily_wage: normalizedMonthlyWage
      }])
    });
    res.status(201).json(await response.json());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

app.patch('/admin/personnel/:id', requireAdmin, validateBody(personnelPatchSchema), async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload.monthly_wage !== undefined && payload.daily_wage === undefined) {
      payload.daily_wage = payload.monthly_wage;
    }
    delete payload.monthly_wage;
    const response = await sbFetch(`/personnel?id=eq.${req.params.id}`, {
      method: 'PATCH', body: JSON.stringify(payload)
    });
    res.json(await response.json());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

app.delete('/admin/personnel/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const r1 = await sbFetch(`/work_records?personnel_id=eq.${id}`, { method: 'DELETE' });
    if (r1.status !== 204 && !r1.ok) {
      return res.status(500).json({ error: 'Bağlı kayıtlar silinemedi: ' + await r1.text() });
    }
    const r2 = await sbFetch(`/personnel?id=eq.${id}`, { method: 'DELETE' });
    if (r2.status === 204 || r2.ok) {
      res.json({ message: 'Personel ve ilgili kayıtlar silindi' });
    } else {
      res.status(400).json({ error: await r2.text() });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

// ==============================================================
// COMPANIES
// ==============================================================
app.get('/companies', requireAdmin, async (req, res) => {
  try {
    const response = await sbFetch('/companies?select=*&order=created_at.asc');
    res.json(await response.json());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

app.post('/admin/companies', requireAdmin, validateBody(companySchema), async (req, res) => {
  try {
    const { company_name, contact_person, phone, address } = req.body;
    if (!company_name) return res.status(400).json({ error: 'Kurum adı zorunludur' });
    const response = await sbFetch('/companies', {
      method: 'POST',
      body: JSON.stringify([{ company_name, contact_person, phone, address }])
    });
    res.status(201).json(await response.json());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

app.patch('/admin/companies/:id', requireAdmin, validateBody(companyPatchSchema), async (req, res) => {
  try {
    const response = await sbFetch(`/companies?id=eq.${req.params.id}`, {
      method: 'PATCH', body: JSON.stringify(req.body)
    });
    res.json(await response.json());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

app.delete('/admin/companies/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const r1 = await sbFetch(`/work_records?company_id=eq.${id}`, { method: 'DELETE' });
    if (r1.status !== 204 && !r1.ok) {
      return res.status(500).json({ error: 'Bağlı kayıtlar silinemedi: ' + await r1.text() });
    }
    const r2 = await sbFetch(`/companies?id=eq.${id}`, { method: 'DELETE' });
    if (r2.status === 204 || r2.ok) {
      res.json({ message: 'Kurum ve ilgili kayıtlar silindi' });
    } else {
      res.status(400).json({ error: await r2.text() });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

// ==============================================================
// WORK RECORDS
// ==============================================================
app.get('/work_records', requireAdmin, async (req, res) => {
  try {
    const response = await sbFetch('/work_records?select=*&order=created_at.desc');
    res.json(await response.json());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

app.post('/admin/work_records', requireAdmin, validateBody(workRecordSchema), async (req, res) => {
  try {
    const {
      personnel_id, company_id, start_day, end_date, work_days,
      personnel_daily_wage, personnel_monthly_wage, total_personnel_payment, total_company_payment,
      advance_amount, expenses, personnel_payment_status, company_payment_status,
      note, archived
    } = req.body;

    if (!personnel_id || !company_id) return res.status(400).json({ error: 'Personel ve kurum zorunludur' });

    const normalizedWorkDays = Number(work_days) || 0;
    const normalizedMonthlyWage = Number(personnel_monthly_wage) || 0;
    const normalizedDailyWage = normalizedMonthlyWage > 0
      ? (normalizedMonthlyWage / 30)
      : (Number(personnel_daily_wage) || 0);
    const normalizedTotalPersonnelPayment = normalizedDailyWage * normalizedWorkDays;

   const response = await sbFetch('/work_records', {
      method: 'POST',
      body: JSON.stringify([{
        personnel_id,
        company_id,
        start_day,
        end_date,
        work_days: normalizedWorkDays,
        personnel_daily_wage: normalizedDailyWage,
        personnel_monthly_wage: normalizedMonthlyWage, 
        total_personnel_payment: normalizedTotalPersonnelPayment,
        total_company_payment,
        advance_amount: advance_amount || 0,
        expenses: expenses || 0,
        personnel_payment_status: personnel_payment_status || 'bekliyor',
        company_payment_status: company_payment_status || 'bekliyor',
        note: note || null,
        archived: archived || false
      }])
    });
    res.status(201).json(await response.json());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

app.patch('/admin/work_records/:id', requireAdmin, validateBody(workRecordPatchSchema), async (req, res) => {
  try {
    const response = await sbFetch(`/work_records?id=eq.${req.params.id}`, {
      method: 'PATCH', body: JSON.stringify(req.body)
    });
    res.json(await response.json());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

app.delete('/admin/work_records/:id', requireAdmin, async (req, res) => {
  try {
    const response = await sbFetch(`/work_records?id=eq.${req.params.id}`, { method: 'DELETE' });
    if (response.status === 204 || response.ok) {
      res.json({ message: 'Kayıt silindi' });
    } else {
      res.status(400).json({ error: await response.text() });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası' }); }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function startServer(preferredPort, retriesLeft = 10) {
  const server = app.listen(preferredPort, () => {
    console.log(`Backend listening on port ${preferredPort}`);
    console.log(`Arayüz: http://localhost:${preferredPort}`);
  });

  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE' && retriesLeft > 0) {
      const nextPort = preferredPort + 1;
      console.warn(`Port ${preferredPort} kullanımda, ${nextPort} deneniyor...`);
      startServer(nextPort, retriesLeft - 1);
      return;
    }
    console.error('Sunucu başlatılamadı:', err);
    process.exit(1);
  });
}

startServer(PORT);

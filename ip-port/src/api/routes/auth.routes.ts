/**
 * Authentication Routes
 *
 * Simple session-based auth (to be expanded with database users)
 */

import { Router, Request, Response } from 'express';

const router = Router();

// Extend session type
declare module 'express-session' {
  interface SessionData {
    userId: string;
    email: string;
    name: string;
    accessLevel: string;
  }
}

// Demo users (replace with database)
const DEMO_USERS = [
  { id: '1', email: 'admin@example.com', password: 'admin123', name: 'Admin User', accessLevel: 'ADMIN' },
  { id: '2', email: 'manager@example.com', password: 'manager123', name: 'Manager User', accessLevel: 'MANAGER' },
  { id: '3', email: 'analyst@example.com', password: 'analyst123', name: 'Analyst User', accessLevel: 'ANALYST' },
  { id: '4', email: 'demo@example.com', password: 'demo123', name: 'Demo User', accessLevel: 'VIEWER' }
];

/**
 * POST /api/auth/login
 */
router.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = DEMO_USERS.find(u => u.email === email && u.password === password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Set session
  req.session.userId = user.id;
  req.session.email = user.email;
  req.session.name = user.name;
  req.session.accessLevel = user.accessLevel;

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    accessLevel: user.accessLevel
  });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

/**
 * GET /api/auth/me
 * Get current user
 */
router.get('/me', (req: Request, res: Response) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    id: req.session.userId,
    email: req.session.email,
    name: req.session.name,
    accessLevel: req.session.accessLevel
  });
});

/**
 * Middleware: Require authentication
 */
export function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Middleware: Require admin
 */
export function requireAdmin(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.session.accessLevel !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Middleware: Require manager or admin
 */
export function requireManagerOrAdmin(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!['ADMIN', 'MANAGER'].includes(req.session.accessLevel || '')) {
    return res.status(403).json({ error: 'Manager or Admin access required' });
  }
  next();
}

export default router;

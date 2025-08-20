// src/routes/auth.routes.ts

import express, { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// Middleware to check authentication
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// Middleware to check admin access
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId || req.session.accessLevel !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Middleware to check manager or admin access
export const requireManagerOrAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId || (req.session.accessLevel !== 'ADMIN' && req.session.accessLevel !== 'MANAGER')) {
    return res.status(403).json({ error: 'Manager or admin access required' });
  }
  next();
};

// Extend the session interface to include user information
declare module 'express-session' {
  interface SessionData {
    userId: string;
    email: string;
    name: string;
    accessLevel: string;
    role: string;
  }
}

// Login endpoint
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const user = await prisma.teamMember.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        accessLevel: true,
        role: true,
        isActive: true,
        title: true,
        userITActivity: true
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.password) {
      return res.status(401).json({ error: 'Password not set for this user' });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await prisma.teamMember.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // Set session data
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.name = user.name;
    req.session.accessLevel = user.accessLevel;
    req.session.role = user.role;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        accessLevel: user.accessLevel,
        role: user.role,
        title: user.title,
        userITActivity: user.userITActivity
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// Check authentication status
router.get('/me', (req: Request, res: Response) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    user: {
      id: req.session.userId,
      email: req.session.email,
      name: req.session.name,
      accessLevel: req.session.accessLevel,
      role: req.session.role
    }
  });
});

// Reset password endpoint (supports both self-reset and admin reset)
router.post('/reset-password', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, newPassword, currentPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({ error: 'User ID and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Find user with password for validation
    const user = await prisma.teamMember.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, password: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is resetting their own password or if admin is resetting someone else's
    const isOwnPassword = req.session.userId === userId;
    const isAdmin = req.session.accessLevel === 'ADMIN';

    if (isOwnPassword) {
      // Self-reset: validate current password
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }

      if (!user.password) {
        return res.status(400).json({ error: 'No password set for this user' });
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
    } else if (!isAdmin) {
      // Not admin and not own password - not allowed
      return res.status(403).json({ error: 'Access denied' });
    }
    // Admin resetting someone else's password doesn't need current password validation

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.teamMember.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    const resetType = isOwnPassword ? 'self-reset' : 'admin reset';
    console.log(`Password ${resetType} for user: ${user.name} (${user.email})`);
    res.json({ message: 'Password updated successfully' });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
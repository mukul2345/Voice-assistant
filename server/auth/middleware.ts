import type { Request, Response, NextFunction } from "express";
import { authService, AuthError } from "./service";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: { userId: number };
    }
  }
}

/**
 * Authentication middleware — rejects requests without a valid JWT.
 * Attaches `req.user = { userId }` on success.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: { code: "TOKEN_MISSING", message: "Authentication required" },
    });
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  try {
    const payload = authService.verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({
        error: { code: err.code, message: err.message },
      });
    }
    return res.status(401).json({
      error: { code: "TOKEN_MISSING", message: "Authentication required" },
    });
  }
}

/**
 * Optional authentication — continues even if no token is present.
 * If a valid token is provided, attaches `req.user`.
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.slice(7);

  try {
    const payload = authService.verifyAccessToken(token);
    req.user = payload;
  } catch {
    return res.status(401).json({
      error: { code: 'TOKEN_MISSING', message: 'Authentication required' },
    });
  }

  return next();
}

/** Returns the authenticated identity established by authenticate(). */
export function getAuthenticatedUserId(request: Request): number {
  const userId = request.user?.userId;
  if (userId === undefined) {
    throw new AuthError('Authentication required', 'TOKEN_MISSING');
  }
  return userId;
}

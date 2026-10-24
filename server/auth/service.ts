import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { storage } from '../storage';
import { getServerConfig } from '../config/env';

const BCRYPT_ROUNDS = 10;
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: number;
  email: string;
}

export class AuthService {
  private readonly jwtSecret: string;

  public constructor(jwtSecret: string = getServerConfig().jwtSecret) {
    this.jwtSecret = jwtSecret;
  }
  /**
   * Register a new user with email and password.
   * Creates the user, trial_usage row, and issues tokens.
   */
  async register(email: string, password: string): Promise<{ user: AuthUser; tokens: TokenPair }> {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AuthError("Invalid email format", "VALIDATION_ERROR");
    }

    // Validate password strength
    if (!password || password.length < 6) {
      throw new AuthError("Password must be at least 6 characters", "VALIDATION_ERROR");
    }

    // Check for existing user
    const existing = await storage.getUserByEmail(email.toLowerCase().trim());
    if (existing) {
      throw new AuthError("Email already registered", "DUPLICATE_EMAIL");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create user
    const user = await storage.createUser({
      email: email.toLowerCase().trim(),
      passwordHash,
    });

    // Initialize trial usage (1 hour free)
    await storage.createTrialUsage(user.id);

    // Issue tokens
    const tokens = await this.issueTokens(user.id);

    return {
      user: { id: user.id, email: user.email },
      tokens,
    };
  }

  /**
   * Login with email and password.
   * Returns a generic error for both wrong email and wrong password (security).
   */
  async login(email: string, password: string): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const genericError = new AuthError("Invalid email or password", "AUTH_INVALID");

    if (!email || !password) {
      throw genericError;
    }

    const user = await storage.getUserByEmail(email.toLowerCase().trim());
    if (!user) {
      // Timing-safe: still hash to prevent timing attacks
      await bcrypt.hash("dummy", BCRYPT_ROUNDS);
      throw genericError;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw genericError;
    }

    const tokens = await this.issueTokens(user.id);

    return {
      user: { id: user.id, email: user.email },
      tokens,
    };
  }

  /**
   * Refresh an access token using a valid refresh token.
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    const stored = await storage.getRefreshToken(refreshToken);

    if (!stored || stored.revoked) {
      throw new AuthError("Invalid refresh token", "TOKEN_EXPIRED");
    }

    // Check expiry
    const expiresAt = new Date(stored.expiresAt);
    if (expiresAt < new Date()) {
      throw new AuthError("Refresh token expired", "TOKEN_EXPIRED");
    }

    // Issue new access token
    const accessToken = this.signAccessToken(stored.userId);

    return { accessToken };
  }

  /**
   * Logout: revoke the refresh token.
   */
  async logout(userId: number, refreshToken: string): Promise<void> {
    await storage.revokeRefreshToken(userId, refreshToken);
  }

  /**
   * Verify a JWT access token and return the payload.
   */
  verifyAccessToken(token: string): { userId: number } {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as unknown as { sub: number };
      return { userId: payload.sub };
    } catch (error: unknown) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthError("Token expired", "TOKEN_EXPIRED");
      }
      throw new AuthError("Invalid token", "TOKEN_MISSING");
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private signAccessToken(userId: number): string {
    return jwt.sign({ sub: userId }, this.jwtSecret, { expiresIn: ACCESS_TOKEN_EXPIRY });
  }

  private async issueTokens(userId: number): Promise<TokenPair> {
    const accessToken = this.signAccessToken(userId);

    // Generate opaque refresh token
    const refreshToken = crypto.randomBytes(40).toString("hex");
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    await storage.createRefreshToken(userId, refreshToken, expiresAt);

    return { accessToken, refreshToken };
  }
}

/**
 * Custom auth error with error code for consistent API responses.
 */
export class AuthError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "AuthError";
  }
}

export const authService = new AuthService();

import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

import type { Session } from '@shared/schema';
import { InterviewSessionStatus } from '@shared/interview/InterviewSession';

import { storage } from '../storage';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export interface SessionInput {
  companyName?: string;
  jobDescription?: string;
  resumeText?: string;
  skills?: string[];
  notes?: string;
}

export class ContextManager {
  /**
   * Create a new interview session for a user.
   */
  async createSession(userId: number, data: SessionInput): Promise<Session> {
    return storage.createSession({
      userId,
      companyName: data.companyName || "",
      jobDescription: data.jobDescription || "",
      resumeText: data.resumeText || "",
      skillsJson: JSON.stringify(data.skills || []),
      notes: data.notes || "",
      status: InterviewSessionStatus.CREATED,
    });
  }

  /**
   * Update an existing session.
   */
  async updateSession(sessionId: number, userId: number, data: Partial<SessionInput>): Promise<Session | undefined> {
    const updates: Partial<Session> = {};
    if (data.companyName !== undefined) updates.companyName = data.companyName;
    if (data.jobDescription !== undefined) updates.jobDescription = data.jobDescription;
    if (data.resumeText !== undefined) updates.resumeText = data.resumeText;
    if (data.skills !== undefined) updates.skillsJson = JSON.stringify(data.skills);
    if (data.notes !== undefined) updates.notes = data.notes;

    return storage.updateSessionForUser(sessionId, userId, updates);
  }

  /**
   * Get a session with ownership check.
   */
  async getSession(sessionId: number, userId: number): Promise<Session | undefined> {
    return storage.getSessionForUser(sessionId, userId);
  }

  /**
   * List all sessions for a user.
   */
  async listSessions(userId: number): Promise<Session[]> {
    return storage.getSessions(userId);
  }

  /**
   * Parse a resume file (PDF or DOCX) and extract text.
   * Validates file size and MIME type.
   */
  async parseResume(fileBuffer: Buffer, mimeType: string, fileSize: number): Promise<string> {
    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      throw new ContextError(
        "File must be under 5 MB. Supported formats: PDF, DOCX",
        "FILE_TOO_LARGE"
      );
    }

    // Parse based on MIME type
    if (mimeType === "application/pdf") {
      return this.parsePdf(fileBuffer);
    }

    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      return this.parseDocx(fileBuffer);
    }

    // Also accept plain text
    if (mimeType === "text/plain" || mimeType === "text/markdown") {
      return fileBuffer.toString("utf-8").slice(0, 10000);
    }

    throw new ContextError(
      "Unsupported file format. Supported formats: PDF, DOCX, TXT",
      "INVALID_FORMAT"
    );
  }

  /**
   * Build a context string from a session for AI prompting.
   */
  buildContextString(session: Session): string {
    const parts: string[] = [];

    if (session.companyName) {
      parts.push(`Company: ${session.companyName}`);
    }
    if (session.jobDescription) {
      parts.push(`Job Description:\n${session.jobDescription}`);
    }
    if (session.resumeText) {
      parts.push(`Candidate Resume:\n${session.resumeText}`);
    }
    if (session.skillsJson && session.skillsJson !== "[]") {
      try {
        const skills = JSON.parse(session.skillsJson);
        if (Array.isArray(skills) && skills.length > 0) {
          parts.push(`Key Skills: ${skills.join(", ")}`);
        }
      } catch {}
    }
    if (session.notes) {
      parts.push(`Additional Notes:\n${session.notes}`);
    }

    return parts.join("\n\n");
  }

  // ─── Private Parsers ───────────────────────────────────────────────────────

  private async parsePdf(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsedPdf = await parser.getText();
      return parsedPdf.text.trim().slice(0, 10000);
    } catch {
      throw new ContextError('Failed to parse PDF file', 'PARSE_ERROR');
    } finally {
      await parser.destroy();
    }
  }

  private async parseDocx(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return (result.value || "").trim().slice(0, 10000); // Limit to 10k chars
    } catch (err) {
      throw new ContextError("Failed to parse DOCX file", "PARSE_ERROR");
    }
  }
}

export class ContextError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "ContextError";
  }
}

export const contextManager = new ContextManager();

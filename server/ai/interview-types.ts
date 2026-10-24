/**
 * Re-export interview type detection from services.
 * This module exists to match the design doc's module structure.
 * The implementation lives in server/services/interview-types.ts
 */
export {
  detectInterviewType,
  buildInterviewPrompt,
  type InterviewType,
} from "../services/interview-types";

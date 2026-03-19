import { z } from 'zod';
import { insertMessageSchema, messages } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  messages: {
    list: {
      method: 'GET' as const,
      path: '/api/messages' as const,
      responses: {
        200: z.array(z.custom<typeof messages.$inferSelect>()),
      },
    },
    clear: {
      method: 'POST' as const,
      path: '/api/messages/clear' as const,
      responses: {
        200: z.object({ success: z.boolean() })
      }
    }
  },
  audio: {
    process: {
      method: 'POST' as const,
      path: '/api/process-audio' as const,
      responses: {
        200: z.object({
          transcription: z.string(),
          aiResponse: z.string(),
          skipped: z.boolean().optional(),
        }),
        500: errorSchemas.internal
      }
    }
  },
  screen: {
    analyze: {
      method: 'POST' as const,
      path: '/api/analyze-screen' as const,
      responses: {
        200: z.object({
          transcription: z.string(),
          aiResponse: z.string(),
        }),
        500: errorSchemas.internal
      }
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

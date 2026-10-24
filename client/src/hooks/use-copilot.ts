import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type Message } from "@shared/schema";

// Helper to get auth header from localStorage
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("copilot_access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useMessages() {
  return useQuery({
    queryKey: [api.messages.list.path],
    queryFn: async () => {
      const res = await fetch(api.messages.list.path, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();
      return api.messages.list.responses[200].parse(data);
    },
  });
}

export function useClearMessages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.messages.clear.path, {
        method: api.messages.clear.method,
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to clear messages");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.messages.list.path] });
    },
  });
}

export type ProcessAudioPayload = { blob: Blob; context?: string };

export function useProcessAudio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Blob | ProcessAudioPayload) => {
      const blob = typeof payload === "object" && payload && "blob" in payload ? payload.blob : payload;
      const context = typeof payload === "object" && payload && "context" in payload ? payload.context : undefined;

      const formData = new FormData();
      formData.append("audio", blob, "chunk.webm");
      if (context) formData.append("context", context);

      // Retry logic for network failures
      let lastError: Error | null = null;
      const maxRetries = 3;
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const res = await fetch(api.audio.process.path, {
            method: api.audio.process.method,
            body: formData,
            credentials: "include",
            headers: getAuthHeaders(),
          });

          if (!res.ok) {
            let errMessage = "Failed to process audio";
            try {
              const errData = await res.json();
              errMessage = errData.error?.message || errData.message || errMessage;
            } catch (_) {}
            
            // Check for trial expired
            if (res.status === 403) {
              throw new Error(errMessage);
            }
            throw new Error(errMessage);
          }

          const data = await res.json();
          const parsed = api.audio.process.responses[200].parse(data);
          return parsed;
        } catch (err) {
          lastError = err as Error;
          // Only retry on network errors, not API key or auth errors
          if (
            lastError.message.includes("API key") ||
            lastError.message.includes("503") ||
            lastError.message.includes("trial") ||
            lastError.message.includes("Subscribe")
          ) {
            throw lastError;
          }
          // Wait before retry (exponential backoff)
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          }
        }
      }
      
      throw lastError || new Error("Failed to process audio after retries");
    },
    onSuccess: (data) => {
      if (!data.skipped) {
        queryClient.invalidateQueries({ queryKey: [api.messages.list.path] });
      }
    },
  });
}

export function useAnalyzeScreen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { imageBlob: Blob; context?: string }) => {
      const formData = new FormData();
      formData.append("image", payload.imageBlob, "screen.jpg");
      if (payload.context) formData.append("context", payload.context);

      const res = await fetch(api.screen.analyze.path, {
        method: api.screen.analyze.method,
        body: formData,
        credentials: "include",
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        let errMessage = "Failed to analyze screen";
        try {
          const errData = await res.json();
          errMessage = errData.error?.message || errData.message || errMessage;
        } catch (_) {}
        throw new Error(errMessage);
      }

      const data = await res.json();
      return api.screen.analyze.responses[200].parse(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.messages.list.path] });
    },
  });
}

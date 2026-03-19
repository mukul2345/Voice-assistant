import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";

// Log zod parsing errors for easier debugging
function parseWithLogging<T>(schema: any, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Zod] ${label} validation failed:`, result.error.format());
    throw result.error;
  }
  return result.data;
}

export function useMessages() {
  return useQuery({
    queryKey: [api.messages.list.path],
    queryFn: async () => {
      const res = await fetch(api.messages.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();
      return parseWithLogging<any>(api.messages.list.responses[200], data, "messages.list");
    },
    // Poll more frequently if needed, or rely on invalidation from audio processing
  });
}

export function useClearMessages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.messages.clear.path, {
        method: api.messages.clear.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to clear messages");
      const data = await res.json();
      return parseWithLogging<any>(api.messages.clear.responses[200], data, "messages.clear");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.messages.list.path] });
    },
  });
}

export function useProcessAudio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (audioBlob: Blob) => {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'chunk.webm');

      const res = await fetch(api.audio.process.path, {
        method: api.audio.process.method,
        body: formData,
        credentials: "include",
      });
      
      if (!res.ok) throw new Error("Failed to process audio");
      const data = await res.json();
      return parseWithLogging<any>(api.audio.process.responses[200], data, "audio.process");
    },
    onSuccess: () => {
      // Invalidate messages list whenever new audio is processed successfully
      queryClient.invalidateQueries({ queryKey: [api.messages.list.path] });
    },
  });
}

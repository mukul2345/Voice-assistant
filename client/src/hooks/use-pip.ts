import { useState, useCallback, useEffect } from "react";

// Add TypeScript support for the experimental API
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
    };
  }
}

export function usePiP() {
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isPiPOpen, setIsPiPOpen] = useState(false);

  useEffect(() => {
    setIsSupported("documentPictureInPicture" in window);
  }, []);

  const openPiP = useCallback(async () => {
    if (!window.documentPictureInPicture) {
      console.warn("Document Picture-in-Picture API not supported.");
      return;
    }

    try {
      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 400,
        height: 600,
      });

      // Copy all stylesheets from the main document to the PiP document
      // so our Tailwind and custom CSS works inside the floating window
      Array.from(document.styleSheets).forEach((styleSheet) => {
        try {
          const cssRules = Array.from(styleSheet.cssRules)
            .map((rule) => rule.cssText)
            .join("");
          const style = document.createElement("style");
          style.textContent = cssRules;
          pipWindow.document.head.appendChild(style);
        } catch (e) {
          // Fallback for cross-origin stylesheets
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.type = styleSheet.type;
          link.media = (styleSheet as any).media?.mediaText || "all";
          link.href = styleSheet.href || "";
          pipWindow.document.head.appendChild(link);
        }
      });

      // Also copy body classes (like bg-background, dark mode etc)
      pipWindow.document.body.className = document.body.className;
      
      const pipRoot = document.createElement("div");
      pipRoot.id = "pip-root";
      // Ensure the root takes up the full space
      pipRoot.className = "w-full h-full";
      pipWindow.document.body.appendChild(pipRoot);

      setPipContainer(pipRoot);
      setIsPiPOpen(true);

      pipWindow.addEventListener("pagehide", () => {
        setPipContainer(null);
        setIsPiPOpen(false);
      });
    } catch (err) {
      console.error("Failed to open PiP window:", err);
    }
  }, []);

  const closePiP = useCallback(() => {
    // If the window is open, closing it happens via the OS UI or we can trigger it 
    // by removing the elements, but typically the user closes it. 
    // For now, we just rely on pagehide event to reset state.
    if (pipContainer) {
      const win = pipContainer.ownerDocument.defaultView;
      if (win) win.close();
    }
  }, [pipContainer]);

  return {
    isSupported,
    isPiPOpen,
    pipContainer,
    openPiP,
    closePiP,
  };
}

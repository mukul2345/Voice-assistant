import sys
import time
import json
import threading
import queue
import tkinter as tk
from tkinter import scrolledtext
import requests

# NOTE: This script requires 'requests' and 'sounddevice' + 'numpy' + 'scipy' 
# or 'pyaudio' depending on your OS.
# For simplicity, this script acts as the "Stealth UI" that connects to your 
# local Ollama instance and a transcription service.

class StealthUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Interview Copilot")
        self.root.attributes('-topmost', True)
        self.root.attributes('-alpha', 0.8)
        self.root.overrideredirect(True) # Borderless
        
        # Geometry: 400x300 at top right
        screen_width = self.root.winfo_screenwidth()
        self.root.geometry(f"400x300+{screen_width-420}+50")
        
        self.root.configure(bg='#1e1e1e')
        
        # Draggable header
        self.header = tk.Frame(self.root, bg='#333', cursor='fleur')
        self.header.pack(fill='x')
        self.header.bind("<ButtonPress-1>", self.start_move)
        self.header.bind("<B1-Motion>", self.do_move)
        
        self.close_btn = tk.Button(self.header, text="X", bg='#333', fg='white', 
                                   command=self.root.destroy, bd=0, padx=10)
        self.close_btn.pack(side='right')
        
        self.clear_btn = tk.Button(self.header, text="Clear", bg='#333', fg='white', 
                                   command=self.clear_text, bd=0, padx=10)
        self.clear_btn.pack(side='left')

        self.text_area = scrolledtext.ScrolledText(self.root, wrap=tk.WORD, 
                                                  bg='#1e1e1e', fg='#00ff00', 
                                                  font=('Consolas', 12), bd=0)
    def start_move(self, event):
        self.x = event.x
        self.y = event.y

    def do_move(self, event):
        deltax = event.x - self.x
        deltay = event.y - self.y
        x = self.root.winfo_x() + deltax
        y = self.root.winfo_y() + deltay
        self.root.geometry(f"+{x}+{y}")

    def clear_text(self):
        self.text_area.delete('1.0', tk.END)

    def append_response(self, text):
        self.text_area.insert(tk.END, f"\n---\n{text}\n")
        self.text_area.see(tk.END)

def run_gui(q):
    root = tk.Tk()
    ui = StealthUI(root)
    
    def check_queue():
        try:
            while True:
                msg = q.get_nowait()
                ui.append_response(msg)
        except queue.Empty:
            pass
        root.after(100, check_queue)
    
    root.after(100, check_queue)
    root.mainloop()

# MOCK TRANSCRIPTION & OLLAMA LOGIC
# In a real setup, you would use 'faster-whisper' and 'ollama' python library
def mock_backend(q):
    print("Starting Mock Backend...")
    print("In a real scenario, this would listen to your system audio,")
    print("transcribe it with Whisper, and get answers from Llama-3.")
    
    while True:
        # Simulate wait for a question
        time.sleep(10)
        question = "Interviewer: 'Tell me about a difficult technical challenge you faced.'"
        print(f"Detected: {question}")
        
        # Simulate Ollama response
        response = "• Focus on the 'Star' method (Situation, Task, Action, Result).\n• Mention a specific bug or architectural hurdle.\n• Highlight how you collaborated with the team."
        q.put(response)

if __name__ == "__main__":
    msg_queue = queue.Queue()
    
    # Start backend thread
    backend_thread = threading.Thread(target=mock_backend, args=(msg_queue,), daemon=True)
    backend_thread.start()
    
    # Start GUI
    run_gui(msg_queue)

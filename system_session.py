#!/usr/bin/env python3
"""
System-level Interview Session – no browser tab share.

Captures audio from a system audio device (e.g. BlackHole, VB-Cable),
sends it to your local Voice Assistant backend, and shows AI answers
in a floating window. Use this so you never share "localhost" or the
copilot tab in the meeting.

Setup:
  1. Install virtual audio: Mac → BlackHole (https://existential.audio/blackhole/),
     Windows → VB-Cable (https://vb-audio.com/Cable/).
  2. Set your meeting app (or system) to output to that device.
  3. Run: python system_session.py
  4. Select the virtual device as input, set session context, click Start.
  5. Join the meeting in the browser as usual; do NOT share the copilot tab.
     This app runs separately and records from the system device.

Dependencies: pip3 install sounddevice numpy requests
"""

import os
import sys
import time
import wave
import threading
import queue
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox

try:
    import sounddevice as sd
    import numpy as np
    import requests
except ImportError as e:
    print("Install: pip install sounddevice numpy requests")
    sys.exit(1)

# Config
BACKEND_URL = os.environ.get("COPILOT_BACKEND_URL", "http://localhost:5000")
CHUNK_SECONDS = 6
SAMPLE_RATE = 16000
CHANNELS = 1


def list_input_devices():
    devices = sd.query_devices()
    out = []
    for i, d in enumerate(devices):
        if d["max_input_channels"] > 0:
            out.append((i, d["name"]))
    return out


def record_wav_chunk(device_id, duration_sec, sample_rate, channels):
    frames = int(duration_sec * sample_rate)
    rec = sd.rec(
        frames,
        samplerate=sample_rate,
        channels=channels,
        dtype="int16",
        device=device_id,
    )
    sd.wait()
    return rec


def wav_to_bytes(samples, sample_rate, channels):
    import io
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def process_chunk(backend_url, audio_bytes, context):
    url = f"{backend_url.rstrip('/')}/api/process-audio"
    files = {"audio": ("chunk.wav", audio_bytes, "audio/wav")}
    data = {}
    if context:
        data["context"] = context
    r = requests.post(url, files=files, data=data, timeout=60)
    r.raise_for_status()
    return r.json()


class StealthWindow:
    """Small borderless window showing only the latest answer (no tab to share)."""

    def __init__(self, parent_queue):
        self.q = parent_queue
        self.root = tk.Toplevel()
        self.root.title("")
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.92)
        self.root.overrideredirect(True)
        self.root.configure(bg="#1a1a1a")
        sw = self.root.winfo_screenwidth()
        self.root.geometry(f"380x260+{sw - 400}+60")

        self.header = tk.Frame(self.root, bg="#2d2d2d", cursor="fleur")
        self.header.pack(fill="x")
        self.header.bind("<ButtonPress-1>", self._start_move)
        self.header.bind("<B1-Motion>", self._do_move)
        tk.Button(
            self.header, text="×", bg="#2d2d2d", fg="#ccc", command=self.root.destroy, bd=0, padx=8
        ).pack(side="right")
        self.text = tk.Text(
            self.root, wrap=tk.WORD, bg="#1a1a1a", fg="#7fff7f", font=("Consolas", 11), bd=0, padx=8, pady=8
        )
        self.text.pack(fill="both", expand=True)
        self._poll()

    def _start_move(self, e):
        self._dx, self._dy = e.x, e.y

    def _do_move(self, e):
        x = self.root.winfo_x() + e.x - self._dx
        y = self.root.winfo_y() + e.y - self._dy
        self.root.geometry(f"+{x}+{y}")
        self._dx, self._dy = e.x, e.y

    def _poll(self):
        try:
            while True:
                msg = self.q.get_nowait()
                self.text.delete("1.0", tk.END)
                self.text.insert("1.0", msg)
                self.text.see(tk.END)
        except queue.Empty:
            pass
        self.root.after(200, self._poll)


class SessionUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Interview Session (System)")
        self.root.minsize(420, 380)
        self.root.configure(bg="#252525")

        self.response_queue = queue.Queue()
        self.stealth_window = None
        self.recording = False
        self.recording_thread = None

        # Controls
        f = ttk.Frame(self.root, padding=10)
        f.pack(fill="x")
        ttk.Label(f, text="Input device (e.g. BlackHole):").grid(row=0, column=0, sticky="w", pady=2)
        self.device_var = tk.StringVar()
        devices = list_input_devices()
        default_id = sd.default.device[0] if devices else 0
        names = [d[1] for d in devices]
        self.device_var.set(names[0] if names else "")
        self.device_combo = ttk.Combobox(f, textvariable=self.device_var, values=names, width=42, state="readonly")
        self.device_combo.grid(row=1, column=0, sticky="ew", pady=2)
        self.device_ids = {d[1]: d[0] for d in devices}

        ttk.Label(f, text="Session context (optional):").grid(row=2, column=0, sticky="w", pady=(8, 2))
        self.context_var = tk.StringVar()
        self.context_entry = ttk.Entry(f, textvariable=self.context_var, width=44)
        self.context_entry.grid(row=3, column=0, sticky="ew", pady=2)
        self.context_entry.insert(0, "Technical interview")

        ttk.Label(f, text="Backend URL:").grid(row=4, column=0, sticky="w", pady=(8, 2))
        self.url_var = tk.StringVar(value=BACKEND_URL)
        ttk.Entry(f, textvariable=self.url_var, width=44).grid(row=5, column=0, sticky="ew", pady=2)

        btn_f = ttk.Frame(f)
        btn_f.grid(row=6, column=0, sticky="w", pady=10)
        self.start_btn = ttk.Button(btn_f, text="Start session", command=self._start)
        self.start_btn.pack(side="left", padx=(0, 8))
        self.stop_btn = ttk.Button(btn_f, text="Stop session", command=self._stop, state="disabled")
        self.stop_btn.pack(side="left")
        ttk.Button(btn_f, text="Open stealth window", command=self._open_stealth).pack(side="left", padx=(20, 0))

        self.status_var = tk.StringVar(value="Stopped. Start session and join the meeting in the browser (do not share this app).")
        ttk.Label(f, textvariable=self.status_var).grid(row=7, column=0, sticky="w", pady=4)

        ttk.Separator(f, orient="horizontal").grid(row=8, column=0, sticky="ew", pady=8)
        ttk.Label(f, text="Responses:").grid(row=9, column=0, sticky="w")
        self.log = scrolledtext.ScrolledText(self.root, wrap=tk.WORD, height=12, bg="#1e1e1e", fg="#ddd", font=("Consolas", 10), bd=0)
        self.log.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        f.columnconfigure(0, weight=1)
        self._poll_log()

    def _open_stealth(self):
        if self.stealth_window is None or not self.stealth_window.root.winfo_exists():
            self.stealth_window = StealthWindow(self.response_queue)
        self.stealth_window.root.lift()

    def _poll_log(self):
        try:
            while True:
                msg = self.response_queue.get_nowait()
                self.log.insert(tk.END, f"\n---\n{msg}\n")
                self.log.see(tk.END)
        except queue.Empty:
            pass
        self.root.after(300, self._poll_log)

    def _start(self):
        name = self.device_var.get()
        if not name or name not in self.device_ids:
            messagebox.showerror("Error", "Select an input device (e.g. BlackHole).")
            return
        self.recording = True
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.status_var.set("Recording from system audio… Join the meeting; do not share this app.")
        self.recording_thread = threading.Thread(
            target=self._record_loop,
            args=(self.device_ids[name], self.url_var.get().strip(), self.context_var.get().strip()),
            daemon=True,
        )
        self.recording_thread.start()

    def _stop(self):
        self.recording = False
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.status_var.set("Stopped.")

    def _record_loop(self, device_id, backend_url, context):
        latest_response = ""
        while self.recording:
            try:
                samples = record_wav_chunk(device_id, CHUNK_SECONDS, SAMPLE_RATE, CHANNELS)
                audio_bytes = wav_to_bytes(samples, SAMPLE_RATE, CHANNELS)
                result = process_chunk(backend_url, audio_bytes, context)
                ai = (result.get("aiResponse") or "").strip()
                if result.get("skipped"):
                    continue
                if ai:
                    latest_response = ai
                    self.response_queue.put(ai)
            except requests.exceptions.ConnectionError:
                self.root.after(0, lambda: self.status_var.set("Recording… (waiting for backend at " + backend_url + ")"))
                time.sleep(2)
                continue
            except Exception as e:
                self.response_queue.put(f"[Error] {e}")
                time.sleep(1)
        self.root.after(0, lambda: self.status_var.set("Stopped."))

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    SessionUI().run()

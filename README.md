# OmniStream Live: Real-Time Multimodal WebRTC Conversational AI Platform

An ultra-low-latency, full-duplex conversational AI platform leveraging the [Stream Vision-Agents](https://github.com/GetStream/Vision-Agents) framework, [GetStream WebRTC](https://getstream.io/), and [Google Gemini Live](https://ai.google.dev/).

---

## 🌟 Overview

**OmniStream Live** provides a seamless, real-time voice, video, and screen-sharing conversational agent. The platform establishes sub-30ms bidirectional media streaming routed through GetStream's distributed **Selective Forwarding Unit (SFU)** WebRTC mesh directly to Google Gemini's speech-to-speech WebSocket interface (`gemini-3.1-flash-live-preview`).

---

## ✨ Features

- **In-Page Full-Duplex Voice Conversation**: Real-time microphone input and voice synthesis with Gemini Live over WebRTC audio tracks.
- **In-Page Video / Webcam Calling (📹)**: Toggle local webcam streaming directly onto the stage with single-click hardware management.
- **In-Page Screen Sharing (🖥️)**: Stream application windows, browser tabs, or full monitors via the HTML5 `getDisplayMedia` API.
- **Companion Live Text Chat & Transcript**: Instant text message injection into the conversational flow with bidirectional transcript generation.
- **Browser-Based or `.env` Credential Management**: Enter API keys securely via client-side inputs or encapsulate them in `.env`.
- **Stream Video Studio Shortcut**: Dedicated top-right corner launcher leading into Stream's multi-party WebRTC video studio room.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│ Browser Client (Unified In-Page Studio)                │
│ • Bundled @stream-io/video-client (Local esbuild IIFE) │
│ • Web Audio API & Audio Visualizer Waves               │
│ • HTML5 MediaStream API (Camera & Screen Share)        │
│ • Live Transcript & SSE Telemetry Listener             │
└───────────────────────────┬────────────────────────────┘
                            │ WebRTC Audio/Video (<30ms)
                            ▼
┌────────────────────────────────────────────────────────┐
│ GetStream Edge SFU Network                             │
│ • Distributed WebRTC Media Mesh & Track Routing        │
│ • Sub-500ms Session Join Latency                       │
└───────────────────────────┬────────────────────────────┘
                            │ Real-time PCM Audio
                            ▼
┌────────────────────────────────────────────────────────┐
│ Python 3.13 Asynchronous Backend (FastAPI)             │
│ • vision_agents.core.Agent Orchestration               │
│ • vision_agents.plugins.getstream (Edge Transport)     │
│ • vision_agents.plugins.gemini (Realtime Provider)     │
└───────────────────────────┬────────────────────────────┘
                            │ Bidirectional Streaming WebSocket
                            ▼
┌────────────────────────────────────────────────────────┐
│ Google Gemini Live API                                 │
│ • gemini-3.1-flash-live-preview                        │
│ • Real-time Speech-to-Speech Inference                 │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Requirements

- **Python**: 3.10+ (tested on Python 3.13)
- **Node.js**: 18+ (tested on Node v24)
- **Google Gemini API Key**: [Google AI Studio](https://aistudio.google.com/app/apikey)
- **GetStream Credentials**: [GetStream.io Dashboard](https://getstream.io) (Video & Audio app)

### 2. Installation

Clone the repository and install the dependencies:

```bash
# Install Python packages
pip install "vision-agents[gemini,getstream]" fastapi uvicorn python-dotenv google-genai sse-starlette

# Install Node dependencies (optional, bundle is pre-built)
npm install
```

### 3. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in your API credentials:

```env
GEMINI_API_KEY=your_gemini_api_key_here
STREAM_API_KEY=your_stream_api_key_here
STREAM_API_SECRET=your_stream_api_secret_here
PORT=8000
```

*(Note: You can also enter credentials directly in the browser UI!)*

### 4. Run the Application

```bash
python run.py
```
*(Or `python server.py`)*

Open **[http://localhost:8000](http://localhost:8000)** in your browser and click **"Connect Agent"**!

---

## 🛠️ Tech Stack

- **Backend**: FastAPI, Uvicorn, Python 3.13, AsyncIO, SSE (Server-Sent Events)
- **AI / LLM**: Stream Vision-Agents, Google Gemini Live Realtime (`gemini-3.1-flash-live-preview`), Google GenAI SDK
- **WebRTC & Streaming**: GetStream SFU Edge Network, `@stream-io/video-client`, Web Audio API, HTML5 MediaStream API
- **Build & Frontend**: Vanilla ES6+, esbuild, CSS3 Glassmorphism

---

## 📄 License

MIT

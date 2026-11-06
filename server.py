import os
import sys
import uuid
import time
import json
import asyncio
import logging
import webbrowser
import httpx
from typing import Dict, Any, Optional
from urllib.parse import urlencode

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load .env and fallback to .env.example if needed
load_dotenv()
if os.path.exists(".env.example"):
    load_dotenv(".env.example", override=False)

# Clean up any potential accidental whitespace from env vars
for k in ["GEMINI_API_KEY", "GOOGLE_API_KEY", "STREAM_API_KEY", "STREAM_API_SECRET"]:
    val = os.getenv(k)
    if val:
        os.environ[k] = val.strip()

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("vision_agents_app")

# Google GenAI & Vision Agents
import google.genai as genai
from vision_agents.core import Agent, User
from vision_agents.plugins import gemini, getstream
from avatar import GeminiLiveAvatar

app = FastAPI(title="Vision-Agents Gemini Conversational App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Store active agent sessions: call_id -> dict
active_sessions: Dict[str, Dict[str, Any]] = {}


class ConfigResponse(BaseModel):
    has_gemini_key: bool
    gemini_key_masked: Optional[str] = None
    has_stream_key: bool
    has_stream_secret: bool
    stream_api_key_masked: Optional[str] = None
    default_model: str = "gemini-3.8-live"
    default_voice: str = "Puck"


class TestGeminiRequest(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = "gemini-3-flash-preview"


class ConnectRequest(BaseModel):
    gemini_api_key: Optional[str] = None
    stream_api_key: Optional[str] = None
    stream_api_secret: Optional[str] = None
    model: Optional[str] = "gemini-3.8-live"
    voice: Optional[str] = "Puck"
    liveavatar_api_key: Optional[str] = None
    liveavatar_avatar_id: Optional[str] = None
    liveavatar_is_sandbox: Optional[bool] = False
    enable_custom_avatar: Optional[bool] = False


class DisconnectRequest(BaseModel):
    call_id: str


class ChatMessageRequest(BaseModel):
    call_id: Optional[str] = None
    gemini_api_key: Optional[str] = None
    message: str
    model: Optional[str] = "gemini-3-flash-preview"


class LiveAvatarListRequest(BaseModel):
    api_key: Optional[str] = None


@app.post("/api/liveavatar/avatars")
async def list_liveavatars(req: LiveAvatarListRequest):
    key = (req.api_key or os.getenv("LIVEAVATAR_API_KEY") or "").strip()
    if not key:
        return {"status": "error", "message": "LiveAvatar API key is required"}
    try:
        async with httpx.AsyncClient(base_url="https://api.liveavatar.com", timeout=15.0) as client:
            resp = await client.get("/v1/avatars", headers={"X-API-KEY": key})
            if resp.status_code == 200:
                raw = resp.json().get("data", [])
                if isinstance(raw, list):
                    avatars = raw
                elif isinstance(raw, dict):
                    avatars = raw.get("avatars") or raw.get("list") or raw.get("items") or []
                else:
                    avatars = []
                return {"status": "ok", "avatars": avatars}
            else:
                return {"status": "error", "code": resp.status_code, "detail": resp.text}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/config", response_model=ConfigResponse)
async def get_config():
    """Check which API keys are pre-configured in the server environment."""
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    stream_key = os.getenv("STREAM_API_KEY")
    stream_sec = os.getenv("STREAM_API_SECRET")

    masked_gemini = None
    if gemini_key:
        masked_gemini = gemini_key[:4] + "..." + gemini_key[-4:] if len(gemini_key) > 8 else "****"

    masked_stream_key = None
    if stream_key:
        masked_stream_key = stream_key[:4] + "..." + stream_key[-4:] if len(stream_key) > 8 else "****"

    return ConfigResponse(
        has_gemini_key=bool(gemini_key),
        gemini_key_masked=masked_gemini,
        has_stream_key=bool(stream_key),
        has_stream_secret=bool(stream_sec),
        stream_api_key_masked=masked_stream_key,
        default_model="gemini-3.8-live",
        default_voice="Puck",
    )


@app.post("/api/test-gemini")
async def test_gemini(req: TestGeminiRequest):
    """Validate a Gemini API key by generating a brief test response."""
    key = (req.api_key or "").strip()
    if not key or key == "USE_ENV":
        key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

    if not key:
        raise HTTPException(status_code=400, detail="Gemini API Key cannot be empty.")

    try:
        client = genai.Client(api_key=key)
        model = req.model or "gemini-3-flash-preview"
        resp = await client.aio.models.generate_content(
            model=model,
            contents="Say 'Gemini API key is verified and operational!' in under 10 words.",
        )
        return {
            "status": "ok",
            "message": resp.text.strip(),
            "model": model,
        }
    except Exception as e:
        logger.error(f"Gemini API test failed: {e}")
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": f"Gemini API Verification Failed: {str(e)}"}
        )


@app.post("/api/connect")
async def connect_agent(req: ConnectRequest):
    """
    Launch a Vision-Agents Conversational Voice Agent on GetStream edge WebRTC
    powered by Google Gemini.
    """
    gemini_key = (req.gemini_api_key or "").strip()
    if not gemini_key or gemini_key == "USE_ENV":
        gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

    if not gemini_key:
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is required. Please provide it in the browser or .env file."
        )

    stream_key = (req.stream_api_key or os.getenv("STREAM_API_KEY") or "").strip()
    stream_sec = (req.stream_api_secret or os.getenv("STREAM_API_SECRET") or "").strip()

    if not stream_key or not stream_sec:
        raise HTTPException(
            status_code=400,
            detail="GetStream credentials (STREAM_API_KEY and STREAM_API_SECRET) are missing."
        )

    # Set in os.environ for vision_agents plugins
    os.environ["STREAM_API_KEY"] = stream_key
    os.environ["STREAM_API_SECRET"] = stream_sec
    os.environ["GEMINI_API_KEY"] = gemini_key
    os.environ["GOOGLE_API_KEY"] = gemini_key

    # Clean up any lingering active sessions to ensure only ONE agent runs at a time
    for old_id, old_sess in list(active_sessions.items()):
        logger.info(f"Closing previous session {old_id} before starting new one.")
        try:
            old_task = old_sess.get("task")
            if old_task and not old_task.done():
                old_task.cancel()
            old_agent = old_sess.get("agent")
            if old_agent:
                asyncio.create_task(old_agent.close())
            old_avatar = old_sess.get("avatar")
            if old_avatar:
                asyncio.create_task(old_avatar.close())
        except Exception as e:
            logger.warning(f"Error cleaning up old session {old_id}: {e}")
        active_sessions.pop(old_id, None)

    call_id = f"voice-{uuid.uuid4().hex[:8]}"
    user_id = f"user-{uuid.uuid4().hex[:6]}"
    user_name = "User"

    try:
        # 1. Initialize Stream edge transport
        edge = getstream.Edge()

        # 2. Authenticate/create human user & generate browser client token
        await edge.client.create_user(name=user_name, id=user_id)
        user_token = edge.client.create_token(user_id, expiration=3600)

        # 3. Create the GetStream call session
        agent_id = "gemini-assistant"
        call = edge.client.video.call("default", call_id)
        await call.get_or_create(
            data={
                "created_by_id": agent_id,
                "members": [
                    {"user_id": agent_id, "role": "admin"},
                    {"user_id": user_id, "role": "call_member"}
                ]
            }
        )

        # 4. Initialize Gemini Realtime LLM with Voice Configuration (Male voice e.g. Puck by default)
        model_name = req.model or "gemini-3.8-live"
        voice_name = (req.voice or "Puck").strip()
        logger.info(f"Initializing Gemini Realtime: model={model_name}, voice={voice_name}")

        realtime_config = {
            "speech_config": {
                "language_code": "en-US",
                "voice_config": {
                    "prebuilt_voice_config": {
                        "voice_name": voice_name
                    }
                }
            }
        }

        llm = gemini.Realtime(
            api_key=gemini_key,
            model=model_name,
            config=realtime_config
        )

        # 5. Initialize the Conversational Voice Agent (audio-only, NO vision)
        instructions = (
            "You are a friendly, intelligent male voice conversational agent. "
            "You listen carefully and reply conversationally, warmly, and accurately to the user. "
            "Keep your responses natural, spoken, and concise (1-3 sentences) so the conversation flows smoothly like a real telephone call. "
            "Do not use markdown formatting, bullet points, or code blocks unless explicitly requested."
        )

        avatar = None
        liveavatar_notice = None
        liveavatar_key = (req.liveavatar_api_key or os.getenv("LIVEAVATAR_API_KEY") or "").strip()
        liveavatar_id = (req.liveavatar_avatar_id or os.getenv("LIVEAVATAR_AVATAR_ID") or "").strip()

        if liveavatar_key and liveavatar_id:
            try:
                from vision_agents.plugins import liveavatar
                is_sandbox = False
                if req.liveavatar_is_sandbox is True:
                    is_sandbox = True
                elif liveavatar_id == "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a":
                    is_sandbox = True

                # Pre-validate LiveAvatar token before attaching so an avatar error never crashes the voice agent!
                test_client = liveavatar.liveavatar_client.LiveAvatarClient(api_key=liveavatar_key)
                try:
                    tok = await test_client.create_session_token(
                        avatar_id=liveavatar_id,
                        is_sandbox=is_sandbox,
                    )
                    logger.info(f"Verified LiveAvatar token: {tok.session_id} for avatar: {liveavatar_id}")
                    avatar = liveavatar.Avatar(
                        api_key=liveavatar_key,
                        avatar_id=liveavatar_id,
                        is_sandbox=is_sandbox,
                    )
                except Exception as tok_err:
                    err_msg = str(tok_err)
                    logger.warning(f"LiveAvatar validation failed: {err_msg}. Gracefully falling back to zero-lag voice agent.")
                    
                    # Try to inspect account avatars to give user precise diagnosis
                    avail_hint = ""
                    try:
                        resp = await test_client._http.get("/v1/avatars")
                        if resp.status_code == 200:
                            av_list = resp.json().get("data", [])
                            if av_list:
                                ids = [f"{a.get('name', 'Avatar')}: {a.get('avatar_id') or a.get('id')}" for a in av_list[:3]]
                                avail_hint = f" Available on your account: {', '.join(ids)}."
                            else:
                                avail_hint = " No custom avatars found on this LiveAvatar account yet."
                    except Exception:
                        pass

                    if "Avatar not found" in err_msg or "400" in err_msg:
                        liveavatar_notice = (
                            f"LiveAvatar Notice: Avatar ID '{liveavatar_id}' was not found on api.liveavatar.com.{avail_hint} "
                            f"(Tip: Check if training finished on app.liveavatar.com, or test with Wayne: dd73ea75-1218-4ef3-92ce-606d5f7fbc0a). "
                            f"Connected with Gemini in Zero-Lag Voice Mode!"
                        )
                    else:
                        liveavatar_notice = f"LiveAvatar Notice: {err_msg}. Continuing in zero-lag voice mode!"
                    avatar = None
                finally:
                    await test_client.close()
            except Exception as e:
                logger.warning(f"Failed to initialize LiveAvatar: {e}. Running in zero-lag native mode.")
                avatar = None
        elif req.enable_custom_avatar:
            avatar = GeminiLiveAvatar(width=640, height=480, fps=20)
            logger.info("Initialized custom procedural avatar track.")

        agent = Agent(
            edge=edge,
            agent_user=User(name="Gemini Assistant", id=agent_id),
            instructions=instructions,
            llm=llm,
            avatar=avatar,
        )

        # 6. Event queue for frontend updates
        event_queue = asyncio.Queue()

        async def on_realtime_connected(event):
            await event_queue.put({
                "type": "status",
                "text": "Gemini Live WebRTC session established! Agent is listening."
            })

        async def on_llm_response(event):
            text = getattr(event, "text", None) or getattr(event, "content", None)
            if text:
                if avatar and hasattr(avatar, "on_agent_speaking"):
                    avatar.on_agent_speaking(str(text))
                await event_queue.put({
                    "type": "transcript",
                    "speaker": "agent",
                    "text": str(text).strip()
                })

        agent.events.subscribe(on_realtime_connected)
        agent.events.subscribe(on_llm_response)

        # 7. Start Agent background task
        async def run_agent():
            logger.info(f"Starting conversational agent on call {call_id}...")
            try:
                if liveavatar_notice:
                    await event_queue.put({"type": "warning", "text": liveavatar_notice})
                async with agent.join(call, participant_wait_timeout=60.0):
                    await event_queue.put({
                        "type": "status",
                        "text": "Agent connected to call! Preparing initial greeting..."
                    })
                    # Warm initial greeting
                    await agent.simple_response("Hello! I am connected and ready. What questions can I help you with today?")
                    await agent.finish()
            except asyncio.CancelledError:
                logger.info(f"Session {call_id} cancelled.")
            except Exception as e:
                logger.error(f"Error in session {call_id}: {e}")
                await event_queue.put({"type": "error", "text": str(e)})
            finally:
                try:
                    await agent.close()
                except Exception:
                    pass
                if avatar:
                    try:
                        await avatar.close()
                    except Exception:
                        pass
                active_sessions.pop(call_id, None)

        task = asyncio.create_task(run_agent())

        active_sessions[call_id] = {
            "agent": agent,
            "call": call,
            "avatar": avatar,
            "task": task,
            "event_queue": event_queue,
            "start_time": time.time(),
        }

        # 8. Build official GetStream demo URL (available for reference if needed)
        params = {
            "api_key": stream_key,
            "token": user_token,
            "skip_lobby": "true",
            "user_name": "You",
            "name": "You",
            "video_encoder": "h264",
            "bitrate": 12000000,
            "w": 1920,
            "h": 1080,
            "channel_type": "messaging",
        }
        demo_url = f"https://getstream.io/video/demos/join/{call_id}?{urlencode(params)}"

        return {
            "status": "ok",
            "call_id": call_id,
            "stream_api_key": stream_key,
            "token": user_token,
            "user_id": user_id,
            "demo_url": demo_url,
            "model": model_name,
        }

    except Exception as e:
        logger.error(f"Failed to connect agent: {e}", exc_info=True)
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": f"Failed to connect: {str(e)}"}
        )


@app.post("/api/disconnect")
async def disconnect_agent(req: DisconnectRequest):
    """End a call session and clean up the agent."""
    session = active_sessions.pop(req.call_id, None)
    if session:
        try:
            session["task"].cancel()
            await session["agent"].close()
            if "avatar" in session:
                try:
                    await session["avatar"].close()
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Error while closing agent: {e}")
        return {"status": "ok", "message": f"Session {req.call_id} closed."}
    return {"status": "ok", "message": "Session not active."}


@app.get("/api/events/{call_id}")
async def stream_events(call_id: str, request: Request):
    """Server-Sent Events endpoint to stream live status and transcripts to the browser."""
    session = active_sessions.get(call_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    queue = session["event_queue"]

    async def event_generator():
        yield f"data: {json.dumps({'type': 'connected', 'call_id': call_id})}\n\n"
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15.0)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
            except asyncio.CancelledError:
                break

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/chat")
async def chat_message(req: ChatMessageRequest):
    """Send a text question or instruction to the conversational agent."""
    msg = req.message.strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    # 1. If active call session exists, route to agent
    if req.call_id and req.call_id in active_sessions:
        session = active_sessions[req.call_id]
        agent = session["agent"]
        queue = session["event_queue"]
        try:
            await agent.simple_response(msg)
            await queue.put({"type": "transcript", "speaker": "user", "text": msg})
            return {"status": "ok", "mode": "voice_agent_injected"}
        except Exception as e:
            logger.error(f"Error injecting message to agent: {e}")

    # 2. Standalone fallback response via Gemini directly
    api_key = (req.gemini_api_key or "").strip()
    if not api_key or api_key == "USE_ENV":
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

    if not api_key:
        raise HTTPException(status_code=400, detail="Gemini API Key is required for chat.")

    try:
        client = genai.Client(api_key=api_key)
        resp = await client.aio.models.generate_content(
            model=req.model or "gemini-3-flash-preview",
            contents=msg,
        )
        return {
            "status": "ok",
            "mode": "standalone_gemini",
            "reply": resp.text.strip(),
        }
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "message": str(e)})


# Mount static directory for browser UI
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/", response_class=HTMLResponse)
async def get_index():
    """Serve the web app."""
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>Vision-Agents App: static/index.html not found</h1>")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"\n" + "=" * 55)
    print(f"[*] Vision-Agents Conversational App running at:")
    print(f"    http://localhost:{port}")
    print("=" * 55 + "\n")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)

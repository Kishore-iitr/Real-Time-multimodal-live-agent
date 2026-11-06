import asyncio
import logging
import math
import time
from typing import Optional

import aiortc
from aiortc import VideoStreamTrack
import av
import cv2
import numpy as np

from vision_agents.core.avatars.avatar import Avatar
from vision_agents.core.agents.inference import (
    AudioOutputStream,
    AudioOutputChunk,
    AudioOutputFlush,
)

logger = logging.getLogger("gemini_live_avatar")


class AvatarState:
    """Live state shared between audio listener and video renderer."""

    def __init__(self):
        self.is_speaking: bool = False
        self.amplitude: float = 0.0
        self.last_speech_time: float = 0.0
        self.status_text: str = "Ready"
        self.user_speaking: bool = False


class GeminiAvatarVideoTrack(VideoStreamTrack):
    """
    Real-time WebRTC Video Track publishing an animated, audio-reactive
    Gemini Live Avatar to the video call.
    """

    kind = "video"

    def __init__(self, state: AvatarState, width: int = 640, height: int = 480, fps: int = 25):
        super().__init__()
        self.state = state
        self.width = width
        self.height = height
        self.fps = fps
        self._start_time = time.time()
        self._frame_count = 0
        self._last_blink = time.time()
        self._is_blinking = False

    async def recv(self) -> av.VideoFrame:
        pts, time_base = await self.next_timestamp()
        now = time.time()
        t = now - self._start_time

        # Speech decay check
        if self.state.is_speaking and (now - self.state.last_speech_time > 0.4):
            self.state.is_speaking = False
            self.state.amplitude = max(0.0, self.state.amplitude - 0.15)

        # Eye blink logic
        if not self._is_blinking and (now - self._last_blink > 3.8):
            self._is_blinking = True
            self._last_blink = now
        elif self._is_blinking and (now - self._last_blink > 0.15):
            self._is_blinking = False

        # Render frame
        frame_bgr = self._render_frame(t)
        frame = av.VideoFrame.from_ndarray(frame_bgr, format="bgr24")
        frame.pts = pts
        frame.time_base = time_base
        self._frame_count += 1
        return frame

    def _render_frame(self, t: float) -> np.ndarray:
        w, h = self.width, self.height
        img = np.zeros((h, w, 3), dtype=np.uint8)

        # 1. Dark tech background with gradient vignette
        # Deep blue-gray space aesthetic
        cx, cy = w // 2, h // 2 - 25

        # Background ambient gradient
        Y, X = np.ogrid[:h, :w]
        dist_from_center = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
        max_dist = math.sqrt(cx**2 + cy**2)
        vignette = np.clip(1.0 - (dist_from_center / max_dist) * 0.75, 0.25, 1.0)
        
        # Base colors (BGR)
        # Deep space: (20, 14, 10)
        base_color = np.array([24, 16, 12], dtype=np.float32)
        img[:, :] = (base_color * vignette[:, :, np.newaxis]).astype(np.uint8)

        # 2. Particle Stars / Energy motes
        num_particles = 18
        for i in range(num_particles):
            angle = (t * 0.35 + i * (2 * math.pi / num_particles))
            dist = 160 + math.sin(t * 1.5 + i) * 35
            px = int(cx + math.cos(angle) * dist)
            py = int(cy + math.sin(angle) * (dist * 0.55))
            if 0 <= px < w and 0 <= py < h:
                alpha = int(120 + 80 * math.sin(t * 2.0 + i))
                cv2.circle(img, (px, py), 2, (alpha, int(alpha * 0.8), 240), -1, cv2.LINE_AA)

        # 3. Dynamic audio responsiveness
        is_spk = self.state.is_speaking
        amp = self.state.amplitude if is_spk else 0.0

        # Breathing cycle
        breath = math.sin(t * 2.2) * 5.0
        speech_pulse = amp * 28.0
        core_r = int(58 + breath + speech_pulse)

        # 4. Outer Glowing Orbital Rings (Tilted 3D Ellipses)
        ring_color1 = (245, 160, 60) if is_spk else (180, 110, 40)   # Cyan/Blue
        ring_color2 = (220, 80, 200) if is_spk else (140, 60, 120)  # Magenta/Purple
        ring_color3 = (80, 200, 240) if is_spk else (60, 140, 180)  # Electric Blue

        # Ring 1: Clockwise rotation
        angle1 = int((t * 24) % 360)
        cv2.ellipse(img, (cx, cy), (core_r + 48, int((core_r + 48) * 0.42)), angle1, 0, 360, ring_color1, 2, cv2.LINE_AA)

        # Ring 2: Counter-clockwise tilted
        angle2 = int((-t * 18 + 45) % 360)
        cv2.ellipse(img, (cx, cy), (core_r + 34, int((core_r + 34) * 0.48)), angle2, 0, 360, ring_color2, 2, cv2.LINE_AA)

        # Ring 3: Equatorial pulse
        angle3 = int((t * 12 + 90) % 360)
        cv2.ellipse(img, (cx, cy), (core_r + 20, int((core_r + 20) * 0.35)), angle3, 0, 360, ring_color3, 1, cv2.LINE_AA)

        # 5. Core Glow Auroras
        for offset, intensity, thickness in [(28, 60, 4), (16, 120, 3), (6, 200, 2)]:
            glow_col = (
                min(255, int(180 + intensity * 0.3)),
                min(255, int(120 + intensity * 0.4)),
                min(255, int(220 + intensity * 0.15))
            ) if is_spk else (
                min(255, int(120 + intensity * 0.3)),
                min(255, int(80 + intensity * 0.3)),
                min(255, int(160 + intensity * 0.2))
            )
            cv2.circle(img, (cx, cy), core_r + offset, glow_col, thickness, cv2.LINE_AA)

        # 6. Central Avatar Sphere (Gemini Hologram Face)
        core_bgr = (250, 210, 80) if is_spk else (210, 160, 60)
        cv2.circle(img, (cx, cy), core_r, (40, 25, 20), -1, cv2.LINE_AA)
        cv2.circle(img, (cx, cy), core_r, core_bgr, 2, cv2.LINE_AA)

        # 7. Avatar Eyes & Mouth / Speech Aperture
        eye_y = cy - 10
        eye_spacing = 22
        eye_w, eye_h = 7, 10

        if self._is_blinking:
            # Closed eye slit
            cv2.line(img, (cx - eye_spacing - eye_w, eye_y), (cx - eye_spacing + eye_w, eye_y), (255, 255, 255), 2, cv2.LINE_AA)
            cv2.line(img, (cx + eye_spacing - eye_w, eye_y), (cx + eye_spacing + eye_w, eye_y), (255, 255, 255), 2, cv2.LINE_AA)
        else:
            # Glowing eyes
            eye_col = (255, 255, 255)
            pupil_col = (255, 180, 80) if is_spk else (200, 140, 60)
            cv2.ellipse(img, (cx - eye_spacing, eye_y), (eye_w, eye_h), 0, 0, 360, eye_col, -1, cv2.LINE_AA)
            cv2.ellipse(img, (cx + eye_spacing, eye_y), (eye_w, eye_h), 0, 0, 360, eye_col, -1, cv2.LINE_AA)
            cv2.circle(img, (cx - eye_spacing, eye_y), 4, pupil_col, -1, cv2.LINE_AA)
            cv2.circle(img, (cx + eye_spacing, eye_y), 4, pupil_col, -1, cv2.LINE_AA)

        # Mouth / Acoustic vocalizer
        mouth_y = cy + 18
        if is_spk:
            # Dynamic mouth height based on amplitude and phonetic oscillation
            mod = 0.5 + 0.5 * math.sin(t * 22.0)
            mouth_open_h = int(3 + amp * 18.0 * mod)
            mouth_open_w = int(14 + amp * 10.0)
            cv2.ellipse(img, (cx, mouth_y), (mouth_open_w, mouth_open_h), 0, 0, 360, (255, 230, 140), -1, cv2.LINE_AA)
            cv2.ellipse(img, (cx, mouth_y), (mouth_open_w, mouth_open_h), 0, 0, 360, (255, 255, 255), 1, cv2.LINE_AA)
        else:
            # Calm subtle smile / line
            cv2.ellipse(img, (cx, mouth_y - 2), (12, 6), 0, 20, 160, (220, 200, 160), 2, cv2.LINE_AA)

        # 8. Real-Time Audio Frequency Waveform (Dancing Bars at Bottom)
        num_bars = 28
        bar_w = 12
        bar_gap = 4
        total_w = num_bars * (bar_w + bar_gap)
        start_x = (w - total_w) // 2
        base_y = h - 60

        for b in range(num_bars):
            bx = start_x + b * (bar_w + bar_gap)
            if is_spk:
                # Frequency simulation: center bars peak higher
                dist_factor = 1.0 - abs(b - num_bars / 2) / (num_bars / 2)
                bar_h = int(4 + (amp * 42.0 * dist_factor) * (0.6 + 0.4 * math.sin(t * 14.0 + b * 0.8)))
            else:
                # Idle wave
                bar_h = int(3 + 3 * math.sin(t * 3.0 + b * 0.4))

            # Gradient bar colors
            bar_color = (
                int(220 - b * 3),
                int(140 + b * 3),
                int(80 + b * 5)
            )
            cv2.rectangle(img, (bx, base_y - bar_h), (bx + bar_w, base_y), bar_color, -1)
            cv2.rectangle(img, (bx, base_y - bar_h), (bx + bar_w, base_y), (255, 255, 255), 1)

        # 9. Top-Left Status Badge (Glassmorphic pill)
        cv2.rectangle(img, (20, 16), (220, 48), (35, 25, 20), -1)
        cv2.rectangle(img, (20, 16), (220, 48), (80, 60, 45), 1, cv2.LINE_AA)

        # Live dot
        if is_spk:
            dot_color = (60, 60, 255) if int(t * 4) % 2 == 0 else (120, 120, 255)
            status_str = "GEMINI LIVE: SPEAKING"
        else:
            dot_color = (60, 240, 100)
            status_str = "GEMINI LIVE: LISTENING"

        cv2.circle(img, (36, 32), 6, dot_color, -1, cv2.LINE_AA)
        cv2.putText(img, status_str, (50, 37), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (230, 230, 230), 1, cv2.LINE_AA)

        # 10. Bottom branding credit
        cv2.putText(img, "Vision-Agents - GetStream - Google Gemini", (w - 290, h - 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, (120, 110, 100), 1, cv2.LINE_AA)

        return img


class GeminiLiveAvatar(Avatar):
    """
    Vision-Agents Avatar plugin that generates a real-time reactive
    Gemini Live visual avatar published directly to the WebRTC video call.
    """

    provider_name: str = "gemini_live_avatar"

    def __init__(self, width: int = 640, height: int = 480, fps: int = 25):
        super().__init__()
        self.state = AvatarState()
        self.width = width
        self.height = height
        self.fps = fps
        self._out_stream = AudioOutputStream()
        self._video_track = GeminiAvatarVideoTrack(self.state, width=width, height=height, fps=fps)
        self._audio_task: Optional[asyncio.Task] = None
        self._running = False

    def video_output(self) -> aiortc.VideoStreamTrack:
        """Outbound video track published to the WebRTC session."""
        return self._video_track

    def audio_output(self) -> AudioOutputStream:
        """Outbound audio stream consumed by the WebRTC audio producer."""
        return self._out_stream

    async def start(self) -> None:
        """Start consuming the inference flow's audio and driving avatar animations."""
        logger.info("Starting Gemini Live Avatar processor...")
        self._running = True
        self._audio_task = asyncio.create_task(self._process_audio())

    async def _process_audio(self) -> None:
        """Read audio chunks from the agent's LLM output, analyze speech, and forward."""
        try:
            async for item in self.input_audio_stream:
                if not self._running:
                    break

                if isinstance(item, AudioOutputChunk) and item.data is not None:
                    samples = item.data.samples
                    if samples is not None and len(samples) > 0:
                        # Calculate RMS energy for smooth audio reactivity
                        samples_float = samples.astype(np.float32)
                        rms = float(np.sqrt(np.mean(samples_float ** 2))) / 32768.0
                        if rms > 0.015:
                            self.state.is_speaking = True
                            self.state.amplitude = min(1.0, rms * 4.5)
                            self.state.last_speech_time = time.time()
                elif isinstance(item, AudioOutputFlush):
                    self.state.is_speaking = False
                    self.state.amplitude = 0.0

                # Seamlessly forward audio chunk to WebRTC audio track
                await self._out_stream.send(item)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"Avatar audio stream loop closed: {e}")

    def on_agent_speaking(self, text: Optional[str] = None) -> None:
        """Event hook called when LLM response starts."""
        self.state.is_speaking = True
        self.state.amplitude = 0.5
        self.state.last_speech_time = time.time()

    async def close(self) -> None:
        """Clean teardown."""
        self._running = False
        if self._audio_task and not self._audio_task.done():
            self._audio_task.cancel()
        if self._video_track:
            self._video_track.stop()
        logger.info("Gemini Live Avatar closed.")

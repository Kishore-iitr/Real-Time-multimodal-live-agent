// DOM Elements
const geminiKeyInput = document.getElementById('gemini-key');
const toggleGeminiKeyBtn = document.getElementById('toggle-gemini-key');
const streamKeyInput = document.getElementById('stream-key');
const streamSecretInput = document.getElementById('stream-secret');
const toggleStreamSecretBtn = document.getElementById('toggle-stream-secret');
const geminiModelSelect = document.getElementById('gemini-model');

const btnTestGemini = document.getElementById('btn-test-gemini');
const btnConnect = document.getElementById('btn-connect');
const btnConnectAudio = document.getElementById('btn-connect-audio');
const btnConnectVideo = document.getElementById('btn-connect-video');
const statusAlert = document.getElementById('status-alert');

const connectionPill = document.getElementById('connection-pill');
const connectionPillText = document.getElementById('connection-pill-text');
const modeBadge = document.getElementById('mode-badge');
const callIdBadge = document.getElementById('call-id-badge');
const btnOpenStudioIcon = document.getElementById('btn-open-studio-icon');

const avatar = document.getElementById('avatar');
const audioWaves = document.getElementById('audio-waves');
const callStatusLabel = document.getElementById('call-status-label');

const videoModeBanner = document.getElementById('video-mode-banner');
const btnReopenVideo = document.getElementById('btn-reopen-video');
const btnSwitchToAudio = document.getElementById('btn-switch-to-audio');

const avatarVideoContainer = document.getElementById('avatar-video-container');
const agentAvatarVideoEl = document.getElementById('agent-avatar-video');

const screenContainer = document.getElementById('screen-container');
const screenVideoEl = document.getElementById('screen-video');
const cameraContainer = document.getElementById('camera-container');
const localVideoEl = document.getElementById('local-video');

const btnMic = document.getElementById('btn-mic');
const btnCamera = document.getElementById('btn-camera');
const btnScreen = document.getElementById('btn-screen');
const btnDisconnect = document.getElementById('btn-disconnect');
const remoteAudioEl = document.getElementById('remote-agent-audio');

const transcriptFeed = document.getElementById('transcript-feed');
const chatForm = document.getElementById('chat-form');
const userTextInput = document.getElementById('user-text-input');

// Application State
let currentMode = null; // 'audio' | 'video' | null
let streamClient = null;
let currentCall = null;
let activeCallId = null;
let activeDemoUrl = null;
let activeCallData = null;
let sseSource = null;
let isMicMuted = false;
let isCameraOn = false;
let isScreenSharing = false;
let screenStream = null;
let cameraStream = null;
let serverConfig = null;

// Helper: Show Alert
function showAlert(message, type = 'info') {
  if (!statusAlert) return;
  statusAlert.className = `alert alert-${type}`;
  statusAlert.textContent = message;
  statusAlert.classList.remove('hidden');
}

function hideAlert() {
  if (statusAlert) statusAlert.classList.add('hidden');
}

// Helper: Add Transcript Message
function addTranscript(speaker, text) {
  if (!transcriptFeed) return;
  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${speaker}`;

  const metaEl = document.createElement('div');
  metaEl.className = 'message-meta';
  metaEl.textContent = speaker === 'agent' ? 'Gemini Assistant' : (speaker === 'user' ? 'You' : 'System');

  const bubbleEl = document.createElement('div');
  bubbleEl.className = 'message-bubble';
  bubbleEl.textContent = text;

  msgEl.appendChild(metaEl);
  msgEl.appendChild(bubbleEl);
  transcriptFeed.appendChild(msgEl);
  transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}

// Helper: Bind Agent Audio & Avatar Video Element
function bindAgentMedia(call) {
  if (!call) return;
  try {
    call.state.remoteParticipants$.subscribe((participants) => {
      participants.forEach((p) => {
        if (p.userId === 'gemini-assistant' || p.isSpeaking || p.audioStream || p.videoStream) {
          // Bind Audio
          if (remoteAudioEl && (p.audioStream || p.isSpeaking || p.userId === 'gemini-assistant')) {
            try {
              call.bindAudioElement(remoteAudioEl, p.sessionId, 'audioTrack');
              console.log('[InPage] Bound agent audio track for session:', p.sessionId);
            } catch (e) {
              console.warn('[InPage] Audio bind warning:', e);
            }
          }
          // Bind Avatar Video
          if (agentAvatarVideoEl && avatarVideoContainer) {
            try {
              call.bindVideoElement(agentAvatarVideoEl, p.sessionId, 'videoTrack');
              avatarVideoContainer.classList.remove('hidden');
              console.log('[InPage] Bound agent avatar video track for session:', p.sessionId);
            } catch (e) {
              console.warn('[InPage] Video bind warning:', e);
            }
          }
        }
      });
    });
  } catch (err) {
    console.warn('[InPage] Failed to subscribe to remoteParticipants:', err);
  }
}

// 1. Initial Load & Config Check
async function initializeApp() {
  console.log('[App] Initializing Gemini All-In-One Studio (Separate Audio & Video)...');

  // Toggle Mask/Unmask
  if (toggleGeminiKeyBtn && geminiKeyInput) {
    toggleGeminiKeyBtn.addEventListener('click', () => {
      geminiKeyInput.type = geminiKeyInput.type === 'password' ? 'text' : 'password';
    });
  }

  if (toggleStreamSecretBtn && streamSecretInput) {
    toggleStreamSecretBtn.addEventListener('click', () => {
      streamSecretInput.type = streamSecretInput.type === 'password' ? 'text' : 'password';
    });
  }

  // Restore stored credentials
  const savedGemini = localStorage.getItem('gemini_api_key');
  if (savedGemini && geminiKeyInput) geminiKeyInput.value = savedGemini;

  const savedStreamKey = localStorage.getItem('stream_api_key');
  if (savedStreamKey && streamKeyInput) streamKeyInput.value = savedStreamKey;

  const savedStreamSecret = localStorage.getItem('stream_api_secret');
  if (savedStreamSecret && streamSecretInput) streamSecretInput.value = savedStreamSecret;

  const savedModel = localStorage.getItem('gemini_model');
  if (savedModel && geminiModelSelect) geminiModelSelect.value = savedModel;

  // Save inputs on change
  if (geminiKeyInput) {
    geminiKeyInput.addEventListener('change', () => {
      if (geminiKeyInput.value) localStorage.setItem('gemini_api_key', geminiKeyInput.value.trim());
    });
  }
  if (streamKeyInput) {
    streamKeyInput.addEventListener('change', () => {
      if (streamKeyInput.value) localStorage.setItem('stream_api_key', streamKeyInput.value.trim());
    });
  }
  if (streamSecretInput) {
    streamSecretInput.addEventListener('change', () => {
      if (streamSecretInput.value) localStorage.setItem('stream_api_secret', streamSecretInput.value.trim());
    });
  }
  if (geminiModelSelect) {
    geminiModelSelect.addEventListener('change', () => {
      localStorage.setItem('gemini_model', geminiModelSelect.value);
    });
  }

  // Query server environment configuration
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      serverConfig = await res.json();
      console.log('[App] Server config loaded:', serverConfig);

      if (serverConfig.has_gemini_key && geminiKeyInput && !geminiKeyInput.value) {
        geminiKeyInput.placeholder = `✓ Pre-configured in .env (${serverConfig.gemini_key_masked || 'Active'})`;
      }
      if (serverConfig.has_stream_key && streamKeyInput && !streamKeyInput.value) {
        streamKeyInput.placeholder = `✓ Pre-configured in .env (${serverConfig.stream_api_key_masked || 'Active'})`;
      }
      if (serverConfig.has_stream_secret && streamSecretInput && !streamSecretInput.value) {
        streamSecretInput.placeholder = '✓ Pre-configured in .env';
      }

      if (serverConfig.has_gemini_key && serverConfig.has_stream_key) {
        showAlert('✓ Credentials detected in .env file! Choose Audio Agent (In-Page) or Video Call App.', 'success');
      }
    }
  } catch (err) {
    console.warn('[App] Could not fetch server config:', err);
  }
}

// 2. Verify Key Button
if (btnTestGemini) {
  btnTestGemini.addEventListener('click', async () => {
    const key = geminiKeyInput ? geminiKeyInput.value.trim() : '';
    hideAlert();
    btnTestGemini.disabled = true;
    btnTestGemini.innerHTML = '<span class="btn-icon-symbol">⏳</span> Testing...';

    try {
      const res = await fetch('/api/test-gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: key || 'USE_ENV',
          model: 'gemini-2.5-flash',
        }),
      });

      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        showAlert(`✓ Gemini Key Verified! Response: "${data.message}"`, 'success');
        if (key) localStorage.setItem('gemini_api_key', key);
      } else {
        showAlert(`Verification error: ${data.message || data.detail || 'Invalid Key'}`, 'error');
      }
    } catch (err) {
      showAlert(`Network error while verifying: ${err.message}`, 'error');
    } finally {
      btnTestGemini.disabled = false;
      btnTestGemini.innerHTML = '<span class="btn-icon-symbol">⚡</span> Verify Key';
    }
  });
}

// 3. Main Session Connection Handler (Handles Audio Alone vs Video Call Separately)
async function connectSession(requestedMode) {
  hideAlert();

  // If a session is already active, handle clean mode switching without duplicate audio
  if (activeCallId) {
    if (requestedMode === 'video' && currentMode === 'audio') {
      console.log('[App] Switching from Audio Alone to Video Call App...');
      // 1. Mute and detach in-page audio to prevent duplicate agents & echo
      if (currentCall) {
        try { await currentCall.leave(); } catch (e) {}
        currentCall = null;
      }
      if (streamClient) {
        try { await streamClient.disconnectUser(); } catch (e) {}
        streamClient = null;
      }
      if (remoteAudioEl) {
        remoteAudioEl.pause();
        remoteAudioEl.srcObject = null;
      }

      currentMode = 'video';
      if (modeBadge) {
        modeBadge.textContent = 'Mode: Video Call ↗';
        modeBadge.className = 'badge badge-video';
      }
      if (connectionPillText) connectionPillText.textContent = 'Live (Video App ↗)';
      if (videoModeBanner) videoModeBanner.classList.remove('hidden');
      if (callStatusLabel) {
        callStatusLabel.textContent = '📹 Video Call active in separate window. In-page audio is silenced to prevent duplicate agents & echo.';
      }
      btnMic.disabled = true;

      // 2. Open Stream Video App window
      if (activeDemoUrl) {
        window.open(activeDemoUrl, '_blank', 'noopener,noreferrer');
      }
      showAlert('✓ Switched to Video Call App! In-page audio is silenced so only 1 agent speaks in the video window.', 'success');
      return;
    }

    if (requestedMode === 'audio' && currentMode === 'video') {
      console.log('[App] Switching from Video Call to In-Page Audio Alone...');
      // 1. Re-enable in-page WebRTC audio track
      if (window.StreamVideoClient && activeCallData) {
        try {
          if (!currentCall) {
            streamClient = new window.StreamVideoClient({
              apiKey: activeCallData.stream_api_key,
              token: activeCallData.token,
              user: { id: activeCallData.user_id, name: 'User' },
            });
            currentCall = streamClient.call('default', activeCallId);
            bindAgentMedia(currentCall);
            await currentCall.join({ create: false });
          }
          await currentCall.microphone.enable();
          if (remoteAudioEl) remoteAudioEl.play().catch(() => {});
        } catch (e) {
          console.warn('[App] Error re-enabling in-page audio:', e);
        }
      }

      currentMode = 'audio';
      if (modeBadge) {
        modeBadge.textContent = 'Mode: Audio Alone';
        modeBadge.className = 'badge badge-audio';
      }
      if (connectionPillText) connectionPillText.textContent = 'Live (Audio In-Page)';
      if (videoModeBanner) videoModeBanner.classList.add('hidden');
      if (callStatusLabel) {
        callStatusLabel.textContent = '🟢 Audio Agent Active! Speak into your microphone to converse directly in this tab.';
      }
      btnMic.disabled = false;
      showAlert('✓ Switched back to In-Page Audio Alone. You can now talk directly in this tab.', 'success');
      return;
    }

    // If already in requested mode and user clicks video, simply re-focus/re-open the window
    if (requestedMode === 'video' && activeDemoUrl) {
      window.open(activeDemoUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    return;
  }

  // No active session: Start fresh session from backend
  setConnectingState(true, requestedMode);

  const geminiKey = geminiKeyInput ? geminiKeyInput.value.trim() : '';
  const streamKey = streamKeyInput ? streamKeyInput.value.trim() : '';
  const streamSecret = streamSecretInput ? streamSecretInput.value.trim() : '';
  const model = geminiModelSelect ? geminiModelSelect.value : 'gemini-3.1-flash-live-preview';

  try {
    if (callStatusLabel) {
      callStatusLabel.textContent = requestedMode === 'audio'
        ? 'Launching in-page Audio Agent session...'
        : 'Spinning up Video Call session...';
    }

    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gemini_api_key: geminiKey || 'USE_ENV',
        stream_api_key: streamKey || null,
        stream_api_secret: streamSecret || null,
        model: model,
      }),
    });

    const data = await res.json();
    if (!res.ok || data.status !== 'ok') {
      throw new Error(data.detail || data.message || 'Failed to start call session');
    }

    activeCallId = data.call_id;
    activeDemoUrl = data.demo_url;
    activeCallData = data;

    if (callIdBadge) {
      callIdBadge.textContent = `Call: ${activeCallId}`;
      callIdBadge.className = 'badge badge-active';
    }

    if (btnOpenStudioIcon) {
      btnOpenStudioIcon.classList.add('active');
      btnOpenStudioIcon.title = 'Click to open active Stream Video calling room in a separate window';
    }

    // ==========================================
    // MODE A: Pure Audio Agent (In-Page Alone)
    // ==========================================
    if (requestedMode === 'audio') {
      currentMode = 'audio';
      if (modeBadge) {
        modeBadge.textContent = 'Mode: Audio Alone';
        modeBadge.className = 'badge badge-audio';
      }
      if (videoModeBanner) videoModeBanner.classList.add('hidden');

      if (callStatusLabel) {
        callStatusLabel.textContent = 'Connecting WebRTC audio directly inside this page...';
      }

      // Connect in-page WebRTC
      if (window.StreamVideoClient) {
        streamClient = new window.StreamVideoClient({
          apiKey: data.stream_api_key,
          token: data.token,
          user: { id: data.user_id, name: 'User' },
        });

        currentCall = streamClient.call('default', activeCallId);
        bindAgentMedia(currentCall);

        await currentCall.join({ create: false });
        await currentCall.microphone.enable();
        await currentCall.camera.disable();

        if (remoteAudioEl) {
          remoteAudioEl.play().catch(() => {});
        }
      } else {
        console.warn('[InPage] StreamVideoClient not loaded on window.');
      }

      // Start SSE for transcripts
      startEventStream(activeCallId);

      // Update UI
      setConnectedState(true, 'audio');
      if (callStatusLabel) {
        callStatusLabel.textContent = '🟢 Connected in-page (Audio Alone)! Speak into your microphone to talk with Gemini.';
      }
      addTranscript('system', 'Connected (Audio Alone)! Gemini Agent is listening and ready to speak in this tab.');
      showAlert('✓ In-page Audio Agent connected! Speak into your microphone.', 'success');
    }

    // ==========================================
    // MODE B: Separate Video Call App (Streamer)
    // ==========================================
    else if (requestedMode === 'video') {
      currentMode = 'video';
      if (modeBadge) {
        modeBadge.textContent = 'Mode: Video Call ↗';
        modeBadge.className = 'badge badge-video';
      }
      if (videoModeBanner) videoModeBanner.classList.remove('hidden');

      // CRUCIAL: Do NOT join WebRTC audio in-page!
      // This prevents the in-page client from speaking at the same time as the video window.
      streamClient = null;
      currentCall = null;
      if (remoteAudioEl) {
        remoteAudioEl.pause();
        remoteAudioEl.srcObject = null;
      }

      // Open Video Calling Room in separate window
      window.open(activeDemoUrl, '_blank', 'noopener,noreferrer');

      // Connect SSE for live transcript feed on the local dashboard
      startEventStream(activeCallId);

      // Update UI
      setConnectedState(true, 'video');
      if (callStatusLabel) {
        callStatusLabel.textContent = '📹 Video Call active in separate window. In-page audio is silenced to prevent duplicate agents & echo.';
      }
      addTranscript('system', 'Connected (Video Call App)! Video and conversation are active in the separate window.');
      showAlert('✓ Video Call App launched in new window! In-page audio silenced so only 1 agent speaks.', 'success');
    }

  } catch (err) {
    console.error('[App] Connection failed:', err);
    showAlert(`Connection failed: ${err.message}`, 'error');
    setConnectingState(false, requestedMode);
    setConnectedState(false);
    if (callStatusLabel) callStatusLabel.textContent = 'Connection failed. Check credentials and retry.';
  }
}

// 4. Server-Sent Events Listener
function startEventStream(callId) {
  if (sseSource) {
    sseSource.close();
  }

  sseSource = new EventSource(`/api/events/${callId}`);

  sseSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'status') {
        if (callStatusLabel && currentMode === 'audio') {
          callStatusLabel.textContent = data.text;
        }
      } else if (data.type === 'transcript') {
        addTranscript(data.speaker, data.text);
        triggerSpeakingVisual(data.speaker === 'agent');
      } else if (data.type === 'error') {
        showAlert(`Agent Error: ${data.text}`, 'error');
      }
    } catch (err) {
      console.warn('SSE parse error:', err);
    }
  };

  sseSource.onerror = () => {
    console.log('[App] SSE stream closed.');
  };
}

// Visual wave indicator when agent speaks
let speakingTimeout = null;
function triggerSpeakingVisual(isSpeaking) {
  if (isSpeaking && audioWaves && avatar) {
    audioWaves.classList.add('speaking');
    avatar.classList.add('active');
    clearTimeout(speakingTimeout);
    speakingTimeout = setTimeout(() => {
      audioWaves.classList.remove('speaking');
      avatar.classList.remove('active');
    }, 4000);
  }
}

// 5. In-Page Microphone Toggle (Audio Alone Mode)
if (btnMic) {
  btnMic.addEventListener('click', async () => {
    if (!currentCall) return;

    try {
      if (isMicMuted) {
        await currentCall.microphone.enable();
        isMicMuted = false;
        btnMic.classList.remove('muted');
        btnMic.querySelector('.label').textContent = 'Mute Mic';
        btnMic.querySelector('.icon').textContent = '🎙️';
      } else {
        await currentCall.microphone.disable();
        isMicMuted = true;
        btnMic.classList.add('muted');
        btnMic.querySelector('.label').textContent = 'Unmute Mic';
        btnMic.querySelector('.icon').textContent = '🔇';
      }
    } catch (err) {
      console.error('Failed to toggle mic:', err);
    }
  });
}

// 6. In-Page Camera Toggle
if (btnCamera) {
  btnCamera.addEventListener('click', async () => {
    if (isCameraOn) {
      // Turn camera OFF
      if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
      }
      if (localVideoEl) localVideoEl.srcObject = null;
      if (cameraContainer) cameraContainer.classList.add('hidden');
      isCameraOn = false;
      btnCamera.classList.remove('active');
      btnCamera.querySelector('.label').textContent = 'Camera On';
      btnCamera.querySelector('.icon').textContent = '📹';

      if (currentCall) {
        try { await currentCall.camera.disable(); } catch (e) {}
      }
    } else {
      // Turn camera ON
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (localVideoEl) localVideoEl.srcObject = cameraStream;
        if (cameraContainer) cameraContainer.classList.remove('hidden');
        isCameraOn = true;
        btnCamera.classList.add('active');
        btnCamera.querySelector('.label').textContent = 'Camera Off';
        btnCamera.querySelector('.icon').textContent = '🛑';

        if (currentCall) {
          try { await currentCall.camera.enable(); } catch (e) {}
        }
      } catch (err) {
        console.error('Failed to access camera:', err);
        showAlert(`Could not access camera: ${err.message}`, 'error');
      }
    }
  });
}

// 7. In-Page Screen Sharing
if (btnScreen) {
  btnScreen.addEventListener('click', async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        if (screenVideoEl) screenVideoEl.srcObject = screenStream;
        if (screenContainer) screenContainer.classList.remove('hidden');
        isScreenSharing = true;
        btnScreen.classList.add('active');
        btnScreen.querySelector('.label').textContent = 'Stop Sharing';
        btnScreen.querySelector('.icon').textContent = '🛑';

        screenStream.getVideoTracks()[0].onended = () => {
          stopScreenShare();
        };

        if (currentCall) {
          try { await currentCall.screenShare.enable(); } catch (e) {}
        }
      } catch (err) {
        if (err.name !== 'NotAllowedError') {
          console.error('Failed to start screen share:', err);
          showAlert(`Screen share error: ${err.message}`, 'error');
        }
      }
    }
  });
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  if (screenVideoEl) screenVideoEl.srcObject = null;
  if (screenContainer) screenContainer.classList.add('hidden');
  isScreenSharing = false;
  if (btnScreen) {
    btnScreen.classList.remove('active');
    btnScreen.querySelector('.label').textContent = 'Share Screen';
    btnScreen.querySelector('.icon').textContent = '🖥️';
  }

  if (currentCall) {
    try { currentCall.screenShare.disable(); } catch (e) {}
  }
}

// 8. Disconnect / End Call
if (btnDisconnect) {
  btnDisconnect.addEventListener('click', async () => {
    await disconnectCall();
  });
}

async function disconnectCall() {
  stopScreenShare();

  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  if (localVideoEl) localVideoEl.srcObject = null;
  if (cameraContainer) cameraContainer.classList.add('hidden');
  isCameraOn = false;
  if (btnCamera) {
    btnCamera.classList.remove('active');
    btnCamera.querySelector('.label').textContent = 'Camera On';
  }

  if (remoteAudioEl) {
    remoteAudioEl.pause();
    remoteAudioEl.srcObject = null;
  }

  if (agentAvatarVideoEl) {
    agentAvatarVideoEl.srcObject = null;
  }
  if (avatarVideoContainer) {
    avatarVideoContainer.classList.add('hidden');
  }

  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }

  if (currentCall) {
    try { await currentCall.leave(); } catch (e) {}
    currentCall = null;
  }

  if (streamClient) {
    try { await streamClient.disconnectUser(); } catch (e) {}
    streamClient = null;
  }

  if (activeCallId) {
    try {
      await fetch('/api/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: activeCallId }),
      });
    } catch (e) {}
    activeCallId = null;
  }

  activeDemoUrl = null;
  activeCallData = null;
  currentMode = null;

  if (btnOpenStudioIcon) {
    btnOpenStudioIcon.classList.remove('active');
    btnOpenStudioIcon.title = 'Open Stream Video Calling App in separate window';
  }

  if (videoModeBanner) videoModeBanner.classList.add('hidden');

  setConnectedState(false);
  setConnectingState(false);
  if (callStatusLabel) {
    callStatusLabel.textContent = 'Session ended. Choose "Audio Agent (In-Page)" or "Video Call App" to connect.';
  }
  addTranscript('system', 'Call ended.');
}

// 9. Buttons Event Listeners
if (btnConnectAudio) {
  btnConnectAudio.addEventListener('click', () => connectSession('audio'));
}

if (btnConnectVideo) {
  btnConnectVideo.addEventListener('click', () => connectSession('video'));
}

if (btnConnect) {
  btnConnect.addEventListener('click', () => connectSession('audio'));
}

if (btnOpenStudioIcon) {
  btnOpenStudioIcon.addEventListener('click', () => connectSession('video'));
}

if (btnReopenVideo) {
  btnReopenVideo.addEventListener('click', () => {
    if (activeDemoUrl) {
      window.open(activeDemoUrl, '_blank', 'noopener,noreferrer');
    }
  });
}

if (btnSwitchToAudio) {
  btnSwitchToAudio.addEventListener('click', () => connectSession('audio'));
}

// 10. In-Page Companion Text Question Input
if (chatForm) {
  chatForm.addEventListener('submit', async () => {
    const text = userTextInput ? userTextInput.value.trim() : '';
    if (!text) return;

    if (userTextInput) userTextInput.value = '';
    addTranscript('user', text);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_id: activeCallId,
          gemini_api_key: geminiKeyInput ? geminiKeyInput.value.trim() : 'USE_ENV',
          message: text,
          model: geminiModelSelect ? geminiModelSelect.value : 'gemini-3.1-flash-live-preview',
        }),
      });

      const data = await res.json();
      if (data.status === 'ok' && data.reply) {
        addTranscript('agent', data.reply);
        triggerSpeakingVisual(true);
      }
    } catch (err) {
      console.error('[App] Chat error:', err);
      addTranscript('system', `Error sending message: ${err.message}`);
    }
  });
}

// UI State Helpers
function setConnectingState(connecting, mode = 'audio') {
  if (btnConnectAudio) btnConnectAudio.disabled = connecting;
  if (btnConnectVideo) btnConnectVideo.disabled = connecting;
  if (btnConnect) btnConnect.disabled = connecting;
  if (btnTestGemini) btnTestGemini.disabled = connecting;

  if (connecting) {
    if (mode === 'audio' && btnConnectAudio) {
      btnConnectAudio.innerHTML = '<span class="btn-icon-symbol">⏳</span> Connecting Audio...';
    } else if (mode === 'video' && btnConnectVideo) {
      btnConnectVideo.innerHTML = '<span class="btn-icon-symbol">⏳</span> Launching Video...';
    }
    if (connectionPill) connectionPill.className = 'status-pill status-connecting';
    if (connectionPillText) connectionPillText.textContent = 'Connecting...';
  } else {
    if (btnConnectAudio) {
      btnConnectAudio.innerHTML = '<span class="btn-icon-symbol">🎙️</span> Audio Agent (In-Page)';
    }
    if (btnConnectVideo) {
      btnConnectVideo.innerHTML = '<span class="btn-icon-symbol">📹</span> Video Call App ↗';
    }
    if (btnConnect) {
      btnConnect.innerHTML = '<span class="btn-icon-symbol">📞</span> Connect Agent';
    }
  }
}

function setConnectedState(connected, mode = 'audio') {
  if (btnConnectAudio) btnConnectAudio.disabled = connected;
  if (btnConnectVideo) btnConnectVideo.disabled = false; // Allow switching to video
  if (btnConnect) btnConnect.disabled = connected;
  if (btnTestGemini) btnTestGemini.disabled = connected;

  if (btnMic) btnMic.disabled = !connected || mode === 'video';
  if (btnCamera) btnCamera.disabled = !connected;
  if (btnScreen) btnScreen.disabled = !connected;
  if (btnDisconnect) btnDisconnect.disabled = !connected;

  if (connected) {
    if (connectionPill) connectionPill.className = 'status-pill status-connected';
    if (connectionPillText) {
      connectionPillText.textContent = mode === 'audio' ? 'Live (Audio In-Page)' : 'Live (Video App ↗)';
    }
    if (avatar) avatar.classList.add('active');
  } else {
    if (connectionPill) connectionPill.className = 'status-pill status-disconnected';
    if (connectionPillText) connectionPillText.textContent = 'Disconnected';
    if (modeBadge) {
      modeBadge.textContent = 'Mode: Idle';
      modeBadge.className = 'badge badge-muted';
    }
    if (callIdBadge) {
      callIdBadge.textContent = 'No Active Session';
      callIdBadge.className = 'badge badge-muted';
    }
    if (avatar) avatar.classList.remove('active');
    if (audioWaves) audioWaves.classList.remove('speaking');
    isMicMuted = false;
    if (btnMic) {
      btnMic.classList.remove('muted');
      btnMic.querySelector('.label').textContent = 'Mute Mic';
      btnMic.querySelector('.icon').textContent = '🎙️';
    }
  }
}

// Run app init
initializeApp();

// DOM Elements
const geminiKeyInput = document.getElementById('gemini-key');
const toggleGeminiKeyBtn = document.getElementById('toggle-gemini-key');
const streamKeyInput = document.getElementById('stream-key');
const streamSecretInput = document.getElementById('stream-secret');
const toggleStreamSecretBtn = document.getElementById('toggle-stream-secret');
const geminiModelSelect = document.getElementById('gemini-model');

const btnTestGemini = document.getElementById('btn-test-gemini');
const btnConnect = document.getElementById('btn-connect');
const statusAlert = document.getElementById('status-alert');

const connectionPill = document.getElementById('connection-pill');
const connectionPillText = document.getElementById('connection-pill-text');
const callIdBadge = document.getElementById('call-id-badge');
const btnOpenStudioIcon = document.getElementById('btn-open-studio-icon');

const avatar = document.getElementById('avatar');
const audioWaves = document.getElementById('audio-waves');
const callStatusLabel = document.getElementById('call-status-label');

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
let streamClient = null;
let currentCall = null;
let activeCallId = null;
let activeDemoUrl = null;
let shouldAutoOpenStudio = false;
let sseSource = null;
let isMicMuted = false;
let isCameraOn = false;
let isScreenSharing = false;
let screenStream = null;
let cameraStream = null;
let serverConfig = null;

// Helper: Show Alert
function showAlert(message, type = 'info') {
  statusAlert.className = `alert alert-${type}`;
  statusAlert.textContent = message;
  statusAlert.classList.remove('hidden');
}

function hideAlert() {
  statusAlert.classList.add('hidden');
}

// Helper: Add Transcript Message
function addTranscript(speaker, text) {
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

// 1. Initial Load & Config Check
async function initializeApp() {
  console.log('[App] Initializing Gemini All-In-One Studio...');

  // Toggle Mask/Unmask
  toggleGeminiKeyBtn.addEventListener('click', () => {
    geminiKeyInput.type = geminiKeyInput.type === 'password' ? 'text' : 'password';
  });

  toggleStreamSecretBtn.addEventListener('click', () => {
    streamSecretInput.type = streamSecretInput.type === 'password' ? 'text' : 'password';
  });

  // Restore stored credentials
  const savedGemini = localStorage.getItem('gemini_api_key');
  if (savedGemini) geminiKeyInput.value = savedGemini;

  const savedStreamKey = localStorage.getItem('stream_api_key');
  if (savedStreamKey) streamKeyInput.value = savedStreamKey;

  const savedStreamSecret = localStorage.getItem('stream_api_secret');
  if (savedStreamSecret) streamSecretInput.value = savedStreamSecret;

  const savedModel = localStorage.getItem('gemini_model');
  if (savedModel) geminiModelSelect.value = savedModel;

  // Save inputs on change
  geminiKeyInput.addEventListener('change', () => {
    if (geminiKeyInput.value) localStorage.setItem('gemini_api_key', geminiKeyInput.value.trim());
  });
  streamKeyInput.addEventListener('change', () => {
    if (streamKeyInput.value) localStorage.setItem('stream_api_key', streamKeyInput.value.trim());
  });
  streamSecretInput.addEventListener('change', () => {
    if (streamSecretInput.value) localStorage.setItem('stream_api_secret', streamSecretInput.value.trim());
  });
  geminiModelSelect.addEventListener('change', () => {
    localStorage.setItem('gemini_model', geminiModelSelect.value);
  });

  // Query server environment configuration
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      serverConfig = await res.json();
      console.log('[App] Server config loaded:', serverConfig);

      if (serverConfig.has_gemini_key && !geminiKeyInput.value) {
        geminiKeyInput.placeholder = `✓ Pre-configured in .env (${serverConfig.gemini_key_masked || 'Active'})`;
      }
      if (serverConfig.has_stream_key && !streamKeyInput.value) {
        streamKeyInput.placeholder = `✓ Pre-configured in .env (${serverConfig.stream_api_key_masked || 'Active'})`;
      }
      if (serverConfig.has_stream_secret && !streamSecretInput.value) {
        streamSecretInput.placeholder = '✓ Pre-configured in .env';
      }

      if (serverConfig.has_gemini_key && serverConfig.has_stream_key) {
        showAlert('✓ Credentials detected in .env file! Ready to connect in-page.', 'success');
      }
    }
  } catch (err) {
    console.warn('[App] Could not fetch server config:', err);
  }
}

// 2. Verify Key Button
btnTestGemini.addEventListener('click', async () => {
  const key = geminiKeyInput.value.trim();
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

// 3. Connect to Agent In-Page
btnConnect.addEventListener('click', async () => {
  hideAlert();
  setConnectingState(true);

  const geminiKey = geminiKeyInput.value.trim();
  const streamKey = streamKeyInput.value.trim();
  const streamSecret = streamSecretInput.value.trim();
  const model = geminiModelSelect.value;

  try {
    callStatusLabel.textContent = 'Launching Vision-Agents Gemini session...';

    // 1. Request backend to spawn agent session & WebRTC call
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
    callIdBadge.textContent = `Call: ${activeCallId}`;
    callIdBadge.className = 'badge badge-active';

    if (btnOpenStudioIcon) {
      btnOpenStudioIcon.classList.add('active');
      btnOpenStudioIcon.title = 'Click to open active Stream Video calling room in a separate window';
    }

    if (shouldAutoOpenStudio && activeDemoUrl) {
      window.open(activeDemoUrl, '_blank', 'noopener,noreferrer');
      shouldAutoOpenStudio = false;
    }

    callStatusLabel.textContent = 'Connecting WebRTC audio directly inside this page...';

    // 2. Initialize in-page Stream Video Client (using bundled library)
    if (window.StreamVideoClient) {
      streamClient = new window.StreamVideoClient({
        apiKey: data.stream_api_key,
        token: data.token,
        user: { id: data.user_id, name: 'User' },
      });

      currentCall = streamClient.call('default', activeCallId);

      // Listen for remote participants (the Gemini Agent) and bind audio
      currentCall.state.remoteParticipants$.subscribe((participants) => {
        participants.forEach((p) => {
          if (p.userId === 'gemini-assistant' || p.isSpeaking || p.audioStream) {
            try {
              currentCall.bindAudioElement(remoteAudioEl, p.sessionId, 'audioTrack');
              console.log('[InPage] Bound agent audio track for session:', p.sessionId);
            } catch (e) {
              console.warn('[InPage] Audio bind warning:', e);
            }
          }
        });
      });

      // Join the call in-page and enable microphone
      await currentCall.join({ create: false });
      await currentCall.microphone.enable();
      await currentCall.camera.disable();

      // Trigger audio element playback
      remoteAudioEl.play().catch(() => {});
    } else {
      console.warn('[InPage] StreamVideoClient not loaded on window.');
    }

    // 3. Connect Server-Sent Events for transcripts & status updates
    startEventStream(activeCallId);

    // 4. Update UI to Connected State
    setConnectedState(true);
    callStatusLabel.textContent = '🟢 Connected in-page! Speak into your microphone to talk with Gemini.';
    addTranscript('system', 'Connected in-page! Gemini Agent is listening and ready to speak.');

  } catch (err) {
    console.error('[App] Connection failed:', err);
    showAlert(`Connection failed: ${err.message}`, 'error');
    setConnectingState(false);
    setConnectedState(false);
    callStatusLabel.textContent = 'Connection failed. Check credentials and retry.';
  }
});

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
        callStatusLabel.textContent = data.text;
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
  if (isSpeaking) {
    audioWaves.classList.add('speaking');
    avatar.classList.add('active');
    clearTimeout(speakingTimeout);
    speakingTimeout = setTimeout(() => {
      audioWaves.classList.remove('speaking');
      avatar.classList.remove('active');
    }, 4000);
  }
}

// 5. In-Page Microphone Toggle
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

// 6. In-Page Camera Toggle
btnCamera.addEventListener('click', async () => {
  if (isCameraOn) {
    // Turn camera OFF
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    localVideoEl.srcObject = null;
    cameraContainer.classList.add('hidden');
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
      localVideoEl.srcObject = cameraStream;
      cameraContainer.classList.remove('hidden');
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

// 7. In-Page Screen Sharing
btnScreen.addEventListener('click', async () => {
  if (isScreenSharing) {
    stopScreenShare();
  } else {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenVideoEl.srcObject = screenStream;
      screenContainer.classList.remove('hidden');
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

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  screenVideoEl.srcObject = null;
  screenContainer.classList.add('hidden');
  isScreenSharing = false;
  btnScreen.classList.remove('active');
  btnScreen.querySelector('.label').textContent = 'Share Screen';
  btnScreen.querySelector('.icon').textContent = '🖥️';

  if (currentCall) {
    try { currentCall.screenShare.disable(); } catch (e) {}
  }
}

// 8. Disconnect / End Call
btnDisconnect.addEventListener('click', async () => {
  await disconnectCall();
});

async function disconnectCall() {
  stopScreenShare();

  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  localVideoEl.srcObject = null;
  cameraContainer.classList.add('hidden');
  isCameraOn = false;
  btnCamera.classList.remove('active');
  btnCamera.querySelector('.label').textContent = 'Camera On';

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
  if (btnOpenStudioIcon) {
    btnOpenStudioIcon.classList.remove('active');
    btnOpenStudioIcon.title = 'Open Stream Video Calling App in separate window';
  }

  setConnectedState(false);
  setConnectingState(false);
  callStatusLabel.textContent = 'Session ended. Click "Connect Agent" to start a new conversation.';
  addTranscript('system', 'Call ended.');
}

// 8b. Top-Right Video Room Icon Button Handler
if (btnOpenStudioIcon) {
  btnOpenStudioIcon.addEventListener('click', () => {
    if (activeDemoUrl) {
      window.open(activeDemoUrl, '_blank', 'noopener,noreferrer');
    } else {
      shouldAutoOpenStudio = true;
      showAlert('Starting agent session and opening Stream Video calling app in a new window...', 'info');
      btnConnect.click();
    }
  });
}

// 9. In-Page Companion Text Question Input
chatForm.addEventListener('submit', async () => {
  const text = userTextInput.value.trim();
  if (!text) return;

  userTextInput.value = '';
  addTranscript('user', text);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call_id: activeCallId,
        gemini_api_key: geminiKeyInput.value.trim() || 'USE_ENV',
        message: text,
        model: geminiModelSelect.value,
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

// UI State Helpers
function setConnectingState(connecting) {
  btnConnect.disabled = connecting;
  btnTestGemini.disabled = connecting;

  if (connecting) {
    btnConnect.innerHTML = '<span class="btn-icon-symbol">⏳</span> Connecting...';
    connectionPill.className = 'status-pill status-connecting';
    connectionPillText.textContent = 'Connecting...';
  } else {
    btnConnect.innerHTML = '<span class="btn-icon-symbol">📞</span> Connect Agent';
  }
}

function setConnectedState(connected) {
  btnConnect.disabled = connected;
  btnTestGemini.disabled = connected;
  btnMic.disabled = !connected;
  btnCamera.disabled = !connected;
  btnScreen.disabled = !connected;
  btnDisconnect.disabled = !connected;

  if (connected) {
    connectionPill.className = 'status-pill status-connected';
    connectionPillText.textContent = 'Connected (Live)';
    avatar.classList.add('active');
  } else {
    connectionPill.className = 'status-pill status-disconnected';
    connectionPillText.textContent = 'Disconnected';
    callIdBadge.textContent = 'No Active Session';
    callIdBadge.className = 'badge badge-muted';
    avatar.classList.remove('active');
    audioWaves.classList.remove('speaking');
    isMicMuted = false;
    btnMic.classList.remove('muted');
    btnMic.querySelector('.label').textContent = 'Mute Mic';
    btnMic.querySelector('.icon').textContent = '🎙️';
  }
}

// Run app init
initializeApp();

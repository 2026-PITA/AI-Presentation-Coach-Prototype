const API_ENDPOINT = "/.netlify/functions/gemini-interview";
// Interview session, speech, camera, and report logic
const DOCUMENT_ENDPOINT = "/.netlify/functions/parse-document";
const TTS_ENDPOINT = "/.netlify/functions/typecast-tts";
const TTS_CHUNK_MAX_CHARS = 1200;
const NONVERBAL_TICK_MS = 1600;
const NONVERBAL_LOG_EVERY_TICKS = 5;
const NONVERBAL_VIDEO_MAX_BYTES = 3.5 * 1024 * 1024;
const NONVERBAL_VIDEO_STOP_TIMEOUT_MS = 8000;
const NONVERBAL_VIDEO_FLUSH_TIMEOUT_MS = 1500;
const NONVERBAL_VIDEO_FLUSH_INTERVAL_MS = 5000;
const NONVERBAL_VIDEO_FINALIZE_DELAY_MS = 250;
const NONVERBAL_VIDEO_BITRATE = 200000;
const NONVERBAL_AUDIO_BITRATE = 32000;
const NONVERBAL_VIDEO_CONSTRAINTS = {
  width: { ideal: 320 },
  height: { ideal: 240 },
  facingMode: "user",
};
const SILENCE_PROMPT_MS = 10000;
const SESSION_STORAGE_KEY = "interviewCoachSession.v2";
const SHARED_REPORT_PREFIX = "interviewCoachSharedReport.";

const personaLabels = {
  hr: "인사담당자",
  field: "실무 팀장",
  pressure: "압박 면접관",
  executive: "임원 면접관",
  // legacy
  calm: "차분한 구조화 면접관",
  behavior: "경험 검증형 면접관",
  job: "직무 적합성 중심 면접관",
};

const fallbackQuestions = [
  "먼저 1분 자기소개를 직무 지원 동기와 연결해서 말씀해 주세요.",
  "방금 말씀하신 경험에서 본인이 직접 맡은 역할은 무엇이었나요?",
  "그 경험이 이 회사와 직무에 어떻게 이어진다고 보시나요?",
  "비슷한 상황이 다시 온다면 무엇을 다르게 하시겠습니까?",
  "입사 후 6개월 안에 만들고 싶은 구체적인 성과를 말씀해 주세요.",
];

const state = {
  started: false,
  busy: false,
  voiceEnabled: true,
  resumeText: "",
  resumeName: "",
  messages: [],
  answers: [],
  answerMeta: [],
  recognition: null,
  recognitionSupported: false,
  isRecording: false,
  pendingVoiceText: "",
  textInputMode: false,
  questionStartedAt: null,
  currentAnswerStartedAt: null,
  currentInputMode: "text",
  silenceTimer: null,
  silenceEvents: [],
  pendingRetry: null,
  lastReport: null,
  reportGenerating: false,
  activeReportTab: "language",
  cameraStream: null,
  cameraActive: false,
  nonverbalTimer: null,
  nonverbalTick: 0,
  nonverbalMode: "idle",
  nonverbal: {
    eye: 0,
    posture: 0,
    expression: 0,
    gesture: 0,
  },
  nonverbalHistory: [],
  signalEvents: [],
  nonverbalRecorder: null,
  nonverbalVideoChunks: [],
  nonverbalVideoBytes: 0,
  nonverbalVideoBlob: null,
  nonverbalVideoMimeType: "",
  nonverbalVideoStopPromise: null,
  nonverbalVideoStopResolve: null,
  nonverbalVideoStopTimer: null,
  nonverbalVideoFlushTimer: null,
  nonverbalVideoDiscard: false,
  nonverbalVideoIssue: "",
  ttsAudio: null,
  ttsAudioUrl: "",
  ttsBusy: false,
  ttsRequestId: 0,
  ttsCancel: null,
  ttsWarmPromise: null,
  ttsWarmed: false,
  expectedQuestions: [],
  practiceQueue: [],
  practiceActive: false,
  practiceCurrentItem: null,
  practiceCurrentQueueIndex: -1,
  practiceFollowupUsed: null,
  practiceListening: false,
  practiceRecognition: null,
  practiceTranscriptFinal: "",
  practiceSessionStartedAt: null,
  practiceSessionTimerId: null,
  practiceAnswerStartedAt: null,
  practiceAnswerTimerId: null,
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  resumeFile: $("#resumeFile"),
  fileName: $("#fileName") || { textContent: "" },
  companyInput: $("#companyInput"),
  roleInput: $("#roleInput"),
  talentInput: $("#talentInput"),
  personaInput: $("#personaInput"),
  depthInput: $("#depthInput"),
  depthOutput: $("#depthOutput"),
  startButton: $("#startButton"),
  chatLog: $("#chatLog"),
  micButton: $("#micButton"),
  liveTranscript: $("#liveTranscript"),
  voiceToggle: $("#voiceToggle"),
  answerForm: $("#answerForm"),
  answerInput: $("#answerInput"),
  sendButton: $("#sendButton"),
  reportButton: $("#reportButton"),
  retryButton: $("#retryButton"),
  shareReportButton: $("#shareReportButton"),
  resetButton: $("#resetButton"),
  apiNotice: $("#apiNotice"),
  apiNoticeText: $("#apiNoticeText"),
  reportDashboardRoot: $("#report-dashboard-root"),
  reportSessionMain: $("#reportSessionMain"),
  reportSessionSub: $("#reportSessionSub"),
  reportSectionNav: $("#reportSectionNav"),
  reportMain: $("#reportMain"),
  loadingStatus: $("#interview-loading-status"),
  personaSummary: $("#personaSummary"),
  turnMetric: $("#turnMetric"),
  fillerMetric: $("#fillerMetric"),
  voiceMetric: $("#voiceMetric"),
  connectionText: $("#connectionText"),
  connectionPill: $("#connectionPill"),
  cameraStage: $("#cameraStage"),
  cameraPreview: $("#cameraPreview"),
  cameraButton: $("#cameraButton"),
  cameraMode: $("#cameraMode"),
  cameraStatus: $("#cameraStatus"),
  signalFeed: $("#signalFeed"),
  eyeScore: $("#eyeScore"),
  postureScore: $("#postureScore"),
  expressionScore: $("#expressionScore"),
  gestureScore: $("#gestureScore"),
  eyeBar: $("#eyeBar"),
  postureBar: $("#postureBar"),
  expressionBar: $("#expressionBar"),
  gestureBar: $("#gestureBar"),
  practiceQuestionTag: $("#practiceQuestionTag"),
  practiceQuestionText: $("#practiceQuestionText"),
  practiceTranscriptText: $("#practiceTranscriptText"),
  practiceAnswerTimer: $("#practiceAnswerTimer"),
  practiceAnsweringChip: $("#practiceAnsweringChip"),
  practiceSessionTimer: $("#practiceSessionTimer"),
  practiceEndButton: $("#practiceEndButton"),
  practiceRetryButton: $("#practiceRetryButton"),
  practiceNextButton: $("#practiceNextButton"),
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "0초";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}분 ${rest}초`;
}

function clearReportDashboard() {
  elements.reportDashboardRoot.classList.remove("report-dashboard");
  elements.reportDashboardRoot.innerHTML = `
    <p class="rd-empty-note" style="margin:40px;">답변을 한 번 이상 전송하면 리포트를 만들 수 있습니다.</p>
  `;
}

function getReadableError(error) {
  if (error?.name === "AbortError" || error?.code === "TIMEOUT") {
    return "AI 응답 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 재시도해 주세요.";
  }
  if (error?.code === "MISSING_KEY") {
    return "AI API 키가 설정되지 않았습니다. Netlify 환경변수를 확인해 주세요.";
  }
  if (error?.status === 429) {
    return "AI 사용량 한도 또는 분당 요청 제한에 도달했습니다. API 콘솔에서 결제/쿼터 상태를 확인하거나 잠시 후 다시 시도해 주세요.";
  }
  if (error?.status) {
    return `AI API 오류가 발생했습니다. (${error.status}) ${error.message || ""}`.trim();
  }
  return error?.message?.replace(/Gemini/g, "AI") || "AI 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

function showApiNotice(message, retryFn = null) {
  elements.apiNotice.hidden = false;
  elements.apiNoticeText.textContent = `${message} 세션 데이터는 유지됩니다. AI 재시도 버튼을 눌러 다시 연결해 보세요.`;
  state.pendingRetry = retryFn;
  elements.retryButton.hidden = !retryFn;
  persistSession();
}

function hideApiNotice() {
  elements.apiNotice.hidden = true;
  elements.apiNoticeText.textContent = "";
  state.pendingRetry = null;
  elements.retryButton.hidden = true;
}

function setReportActionsEnabled(enabled) {
  elements.shareReportButton.disabled = !enabled;
}

function getProfile() {
  const interviewType = document.getElementById("interview-type");
  return {
    company: elements.companyInput.value.trim() || "미입력 회사",
    role: elements.roleInput.value.trim() || "미입력 직무",
    talent: elements.talentInput.value.trim() || "미입력 인재상",
    persona: elements.personaInput.value,
    personaLabel: personaLabels[elements.personaInput.value],
    depth: Number(elements.depthInput.value),
    interviewType: interviewType?.selectedOptions?.[0]?.textContent || "미입력 면접 유형",
    resumeName: state.resumeName,
    resumeText: state.resumeText.slice(0, 5000),
  };
}

function setConnection(text, tone = "blue") {
  elements.connectionText.textContent = text;
  const colors = {
    blue: "#3157c9",
    green: "#1f7a5b",
    amber: "#a76612",
    red: "#b42318",
  };
  elements.connectionPill.style.color = colors[tone] || colors.blue;
}

function setNonverbalVideoStatus(message) {
  if (elements.cameraStatus) {
    elements.cameraStatus.textContent = message;
  }
  if (elements.loadingStatus) {
    elements.loadingStatus.textContent = message;
  }
}

function updateMetrics() {
  const analysis = analyzeAnswers();
  elements.turnMetric.textContent = String(state.answers.length);
  elements.fillerMetric.textContent = String(analysis.fillerTotal);
  elements.voiceMetric.textContent = state.ttsBusy ? "AI" : state.voiceEnabled ? "ON" : "OFF";
  elements.reportButton.disabled = state.answers.length === 0;
}

function persistSession() {
  const payload = {
    inputs: {
      company: elements.companyInput.value,
      role: elements.roleInput.value,
      talent: elements.talentInput.value,
      persona: elements.personaInput.value,
      depth: elements.depthInput.value,
      interviewType: document.getElementById("interview-type")?.value || "",
    },
    resumeName: state.resumeName,
    resumeText: state.resumeText,
    messages: state.messages,
    answers: state.answers,
    answerMeta: state.answerMeta,
    silenceEvents: state.silenceEvents,
    lastReport: state.lastReport,
    activeReportTab: state.activeReportTab,
    expectedQuestions: state.expectedQuestions,
  };
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Session persistence is helpful, but the prototype should keep running if storage is blocked.
  }
}

function renderMessages() {
  elements.chatLog.innerHTML = "";
  if (!state.messages.length) {
    addMessage("ai", "면접 시작을 누르면 회사, 직무, 인재상에 맞춰 첫 질문을 드립니다.", false);
    state.messages = [];
    return;
  }

  state.messages.forEach((message) => {
    const item = document.createElement("li");
    item.className = `message ${message.role}`;
    item.innerHTML = `
      <span class="message-label">${message.role === "ai" ? "AI 면접관" : "나"}</span>
      <div class="message-bubble">${escapeHtml(message.text)}</div>
    `;
    elements.chatLog.appendChild(item);
  });
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
    if (!saved) return;

    elements.companyInput.value = saved.inputs?.company || elements.companyInput.value;
    elements.roleInput.value = saved.inputs?.role || elements.roleInput.value;
    elements.talentInput.value = saved.inputs?.talent || elements.talentInput.value;
    elements.personaInput.value = saved.inputs?.persona || elements.personaInput.value;
    elements.depthInput.value = saved.inputs?.depth || elements.depthInput.value;
    elements.depthOutput.textContent = elements.depthInput.value;
    const interviewType = document.getElementById("interview-type");
    if (interviewType && saved.inputs?.interviewType) {
      interviewType.value = saved.inputs.interviewType;
    }

    state.resumeName = saved.resumeName || "";
    state.resumeText = saved.resumeText || "";
    elements.fileName.textContent = state.resumeName || "선택된 파일 없음";
    state.messages = saved.messages || [];
    state.answers = saved.answers || [];
    state.answerMeta = saved.answerMeta || [];
    state.silenceEvents = saved.silenceEvents || [];
    state.lastReport = saved.lastReport || null;
    state.activeReportTab = saved.activeReportTab || "language";
    state.expectedQuestions = saved.expectedQuestions || [];
    state.started = state.messages.length > 0 || state.answers.length > 0;

    renderMessages();
    if (state.lastReport) {
      renderReport(state.lastReport.analysis, state.lastReport.aiReport);
      setReportActionsEnabled(true);
    }
    updateMetrics();
  } catch (error) {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function clearSilenceTimer() {
  window.clearTimeout(state.silenceTimer);
  state.silenceTimer = null;
}

function startSilenceTimer(questionText = "") {
  clearSilenceTimer();
  state.questionStartedAt = Date.now();
  state.currentAnswerStartedAt = null;
  state.currentInputMode = "text";

  state.silenceTimer = window.setTimeout(() => {
    if (!state.started || state.busy || state.currentAnswerStartedAt) return;
    const event = {
      at: Date.now(),
      seconds: Math.round(SILENCE_PROMPT_MS / 1000),
      question: questionText,
    };
    state.silenceEvents.push(event);
    elements.liveTranscript.textContent = "답변 준비가 되셨나요? 준비되면 음성 또는 텍스트로 답변해 주세요.";
    persistSession();
  }, SILENCE_PROMPT_MS);
}

function markAnswerStarted(mode) {
  if (!state.currentAnswerStartedAt) {
    state.currentAnswerStartedAt = Date.now();
    state.currentInputMode = mode;
  }
  clearSilenceTimer();
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function setSignalValue(scoreElement, barElement, value) {
  scoreElement.textContent = value ? String(value) : "--";
  barElement.style.width = `${value || 0}%`;
  barElement.classList.toggle("low", value > 0 && value < 64);
  barElement.classList.toggle("mid", value >= 64 && value < 78);
}

function renderNonverbalScores() {
  setSignalValue(elements.eyeScore, elements.eyeBar, state.nonverbal.eye);
  setSignalValue(elements.postureScore, elements.postureBar, state.nonverbal.posture);
  setSignalValue(elements.expressionScore, elements.expressionBar, state.nonverbal.expression);
  setSignalValue(elements.gestureScore, elements.gestureBar, state.nonverbal.gesture);

  if (!state.signalEvents.length) {
    elements.signalFeed.innerHTML = "<li>카메라를 켜면 비언어 신호가 표시됩니다.</li>";
    return;
  }

  elements.signalFeed.innerHTML = state.signalEvents
    .slice(0, 4)
    .map((event) => `<li>${escapeHtml(event)}</li>`)
    .join("");
}

function getNonverbalEvent(snapshot) {
  const scores = [
    ["eye", snapshot.eye],
    ["posture", snapshot.posture],
    ["expression", snapshot.expression],
    ["gesture", snapshot.gesture],
  ].sort((a, b) => a[1] - b[1]);
  const [weakestKey, weakestScore] = scores[0];
  const clock = new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  if (weakestScore >= 82) return `${clock} 전반적인 비언어 안정도 양호`;
  if (weakestKey === "eye") return `${clock} 시선이 화면 밖으로 분산되는 구간 감지`;
  if (weakestKey === "posture") return `${clock} 상체 기울어짐과 어깨 긴장 신호 감지`;
  if (weakestKey === "expression") return `${clock} 표정 변화가 적어 전달 에너지 낮음`;
  return `${clock} 손동작 리듬이 답변 흐름과 어긋나는 구간 감지`;
}

function tickNonverbal() {
  state.nonverbalTick += 1;
  const t = state.nonverbalTick;
  const speakingBoost = state.isRecording ? 8 : 0;
  const demoOffset = state.nonverbalMode === "demo" ? -2 : 2;

  state.nonverbal = {
    eye: clampScore(78 + demoOffset + Math.sin(t / 2.2) * 8 + (Math.random() - 0.5) * 10),
    posture: clampScore(80 + demoOffset + Math.cos(t / 2.8) * 7 + (Math.random() - 0.5) * 8),
    expression: clampScore(74 + demoOffset + Math.sin(t / 1.7) * 9 + (Math.random() - 0.5) * 10),
    gesture: clampScore(
      66 + speakingBoost + demoOffset + Math.sin(t / 2.4) * 12 + (Math.random() - 0.5) * 12,
    ),
  };

  state.nonverbalHistory.unshift({
    ...state.nonverbal,
    mode: state.nonverbalMode,
    at: Date.now(),
  });
  state.nonverbalHistory = state.nonverbalHistory.slice(0, 48);

  if (t === 1 || t % NONVERBAL_LOG_EVERY_TICKS === 0) {
    state.signalEvents.unshift(getNonverbalEvent(state.nonverbal));
    state.signalEvents = state.signalEvents.slice(0, 8);
  }

  renderNonverbalScores();
}

function startNonverbalSession(mode, statusText) {
  window.clearInterval(state.nonverbalTimer);
  state.nonverbalMode = mode;
  state.nonverbalTick = 0;
  state.nonverbalHistory = [];
  state.signalEvents = [];

  elements.cameraStage.classList.toggle("is-live", mode === "live");
  elements.cameraMode.textContent = mode === "live" ? "카메라" : "자동 진행";
  setNonverbalVideoStatus(statusText);
  elements.cameraButton.textContent = mode === "live" ? "카메라 끄기" : "카메라 켜기";

  tickNonverbal();
  state.nonverbalTimer = window.setInterval(tickNonverbal, NONVERBAL_TICK_MS);
}

function getSupportedNonverbalVideoType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function clearNonverbalVideoState() {
  window.clearInterval(state.nonverbalVideoFlushTimer);
  state.nonverbalVideoFlushTimer = null;
  state.nonverbalVideoChunks = [];
  state.nonverbalVideoBytes = 0;
  state.nonverbalVideoBlob = null;
  state.nonverbalVideoMimeType = "";
  state.nonverbalVideoIssue = "";
  state.nonverbalVideoDiscard = false;
}

function resolveNonverbalVideoStop() {
  window.clearTimeout(state.nonverbalVideoStopTimer);
  state.nonverbalVideoStopTimer = null;
  window.clearInterval(state.nonverbalVideoFlushTimer);
  state.nonverbalVideoFlushTimer = null;
  if (state.nonverbalVideoStopResolve) {
    state.nonverbalVideoStopResolve();
  }
  state.nonverbalVideoStopPromise = null;
  state.nonverbalVideoStopResolve = null;
}

function waitForNonverbalVideoData(previousBytes = state.nonverbalVideoBytes) {
  return new Promise((resolve) => {
    if (state.nonverbalVideoBytes > previousBytes) {
      resolve(true);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (state.nonverbalVideoBytes > previousBytes) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }

      if (Date.now() - startedAt >= NONVERBAL_VIDEO_FLUSH_TIMEOUT_MS) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 50);
  });
}

function completeNonverbalVideoCapture() {
  const shouldDiscard = state.nonverbalVideoDiscard;
  state.nonverbalRecorder = null;

  if (shouldDiscard) {
    clearNonverbalVideoState();
  } else if (state.nonverbalVideoChunks.length) {
    state.nonverbalVideoBlob = new Blob(state.nonverbalVideoChunks, {
      type: state.nonverbalVideoMimeType || "video/webm",
    });
    state.nonverbalVideoBytes = state.nonverbalVideoBlob.size;
    if (state.cameraActive && state.nonverbalMode === "live") {
      setNonverbalVideoStatus("Gemini 리포트용 영상 샘플 저장 완료");
    }
  } else if (!state.nonverbalVideoIssue) {
    state.nonverbalVideoIssue = "녹화 조각이 생성되지 않았습니다.";
  }

  state.nonverbalVideoDiscard = false;
  resolveNonverbalVideoStop();
}

function stopNonverbalVideoCapture({ discard = false } = {}) {
  state.nonverbalVideoDiscard = state.nonverbalVideoDiscard || discard;

  if (!state.nonverbalRecorder) {
    if (discard) clearNonverbalVideoState();
    return Promise.resolve();
  }

  if (state.nonverbalVideoStopPromise) return state.nonverbalVideoStopPromise;

  state.nonverbalVideoStopPromise = new Promise((resolve) => {
    state.nonverbalVideoStopResolve = resolve;
  });
  const stopPromise = state.nonverbalVideoStopPromise;
  state.nonverbalVideoStopTimer = window.setTimeout(() => {
    if (!state.nonverbalVideoIssue) {
      state.nonverbalVideoIssue = "브라우저가 영상 녹화 종료 이벤트를 반환하지 않았습니다.";
    }
    completeNonverbalVideoCapture();
  }, NONVERBAL_VIDEO_STOP_TIMEOUT_MS);

  try {
    if (state.nonverbalRecorder.state !== "inactive") {
      state.nonverbalRecorder.stop();
    } else {
      completeNonverbalVideoCapture();
    }
  } catch (error) {
    completeNonverbalVideoCapture();
  }

  return stopPromise;
}

async function resetNonverbalVideoCapture() {
  await stopNonverbalVideoCapture({ discard: true });
  clearNonverbalVideoState();
}

async function flushNonverbalVideoCapture() {
  const recorder = state.nonverbalRecorder;
  if (!recorder || recorder.state !== "recording") return false;

  const previousBytes = state.nonverbalVideoBytes;
  try {
    recorder.requestData();
  } catch (error) {
    return false;
  }

  return waitForNonverbalVideoData(previousBytes);
}

function startNonverbalVideoCapture(stream) {
  if (!stream || typeof MediaRecorder === "undefined") {
    setNonverbalVideoStatus("카메라 미리보기 중 · 브라우저 영상 녹화 미지원");
    return;
  }

  clearNonverbalVideoState();
  const mimeType = getSupportedNonverbalVideoType();
  state.nonverbalVideoMimeType = mimeType || "video/webm";

  try {
    const options = {
      videoBitsPerSecond: NONVERBAL_VIDEO_BITRATE,
      audioBitsPerSecond: NONVERBAL_AUDIO_BITRATE,
      ...(mimeType ? { mimeType } : {}),
    };
    const recorder = new MediaRecorder(stream, options);
    state.nonverbalRecorder = recorder;

    recorder.ondataavailable = (event) => {
      if (state.nonverbalVideoDiscard || !event.data?.size) return;
      state.nonverbalVideoChunks.push(event.data);
      state.nonverbalVideoBytes += event.data.size;
      if (state.cameraActive && state.nonverbalMode === "live") {
        setNonverbalVideoStatus(
          `카메라 미리보기 및 Gemini용 영상 샘플 저장 중 · ${Math.round(state.nonverbalVideoBytes / 1024)}KB`,
        );
      }
      if (state.nonverbalVideoBytes >= NONVERBAL_VIDEO_MAX_BYTES && recorder.state === "recording") {
        recorder.stop();
      }
    };

    recorder.onstop = () => {
      window.setTimeout(completeNonverbalVideoCapture, NONVERBAL_VIDEO_FINALIZE_DELAY_MS);
    };
    recorder.onerror = () => {
      setNonverbalVideoStatus("카메라 미리보기 중 · 영상 샘플 저장 실패");
      completeNonverbalVideoCapture();
    };

    recorder.start();
    state.nonverbalVideoFlushTimer = window.setInterval(() => {
      if (recorder.state !== "recording") {
        window.clearInterval(state.nonverbalVideoFlushTimer);
        state.nonverbalVideoFlushTimer = null;
        return;
      }
      try {
        recorder.requestData();
      } catch (error) {
        // requestData는 브라우저별로 실패할 수 있으므로 리포트 생성 시 stop flush를 한 번 더 시도한다.
      }
    }, NONVERBAL_VIDEO_FLUSH_INTERVAL_MS);
    setNonverbalVideoStatus("카메라 미리보기 및 Gemini용 영상 샘플 저장 중");
  } catch (error) {
    state.nonverbalRecorder = null;
    clearNonverbalVideoState();
    setNonverbalVideoStatus("카메라 미리보기 중 · 영상 샘플 저장 불가");
  }
}

async function prepareNonverbalVideoPayload() {
  if (state.nonverbalRecorder?.state === "recording") {
    setNonverbalVideoStatus("Gemini 리포트용 영상 샘플 정리 중");
    await flushNonverbalVideoCapture();
    await stopNonverbalVideoCapture();
  }

  if (!state.nonverbalVideoBlob?.size) {
    if (!state.nonverbalVideoIssue) {
      state.nonverbalVideoIssue = state.cameraActive
        ? "카메라는 켜져 있었지만 브라우저가 영상 샘플을 저장하지 못했습니다."
        : "카메라가 꺼져 있어 영상 샘플이 없습니다.";
    }
    return null;
  }
  return {
    mediaBase64: await fileToBase64(state.nonverbalVideoBlob),
    mediaMimeType: state.nonverbalVideoBlob.type || state.nonverbalVideoMimeType || "video/webm",
    size: state.nonverbalVideoBlob.size,
  };
}

function stopNonverbalSession(clearHistory = false) {
  window.clearInterval(state.nonverbalTimer);
  state.nonverbalTimer = null;
  state.nonverbalMode = "idle";
  elements.cameraStage.classList.remove("is-live");
  elements.cameraMode.textContent = "대기";
  setNonverbalVideoStatus(
    clearHistory
      ? "카메라 대기 중"
      : "카메라가 꺼졌습니다. 마지막 신호가 리포트에 반영됩니다.",
  );
  elements.cameraButton.textContent = "카메라 켜기";

  if (clearHistory) {
    state.nonverbal = { eye: 0, posture: 0, expression: 0, gesture: 0 };
    state.nonverbalHistory = [];
    state.signalEvents = [];
  }

  renderNonverbalScores();
}

async function startCamera() {
  if (state.cameraActive) {
    stopCamera(false);
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    startNonverbalSession("demo", "카메라 API를 사용할 수 없어 자동으로 진행합니다");
    return;
  }

  setNonverbalVideoStatus("카메라 권한 확인 중");
  elements.cameraButton.disabled = true;

  try {
    let stream;
    let videoOnlyFallback = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: NONVERBAL_VIDEO_CONSTRAINTS,
        audio: true,
      });
    } catch (error) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: NONVERBAL_VIDEO_CONSTRAINTS,
        audio: false,
      });
      videoOnlyFallback = true;
    }
    state.cameraStream = stream;
    state.cameraActive = true;
    elements.cameraPreview.srcObject = stream;
    await elements.cameraPreview.play().catch(() => {});
    startNonverbalSession("live", "카메라 미리보기 및 Gemini용 영상 샘플 저장 중");
    startNonverbalVideoCapture(stream);
    if (videoOnlyFallback) {
      state.nonverbalVideoIssue =
        "마이크 권한을 얻지 못해 video-only 녹화로 시도했습니다.";
    }
  } catch (error) {
    state.cameraActive = false;
    state.cameraStream = null;
    elements.cameraPreview.srcObject = null;
    startNonverbalSession("demo", "카메라 권한이 없어 자동으로 진행합니다");
  } finally {
    elements.cameraButton.disabled = false;
  }
}

function stopCamera(clearHistory = false) {
  stopNonverbalVideoCapture({ discard: clearHistory });
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
  }
  state.cameraStream = null;
  state.cameraActive = false;
  elements.cameraPreview.srcObject = null;
  stopNonverbalSession(clearHistory);
}

function analyzeNonverbal() {
  if (!state.nonverbalHistory.length) return null;
  const history = state.nonverbalHistory;
  const averages = {
    eye: average(history.map((item) => item.eye)),
    posture: average(history.map((item) => item.posture)),
    expression: average(history.map((item) => item.expression)),
    gesture: average(history.map((item) => item.gesture)),
  };
  const entries = Object.entries(averages).sort((a, b) => a[1] - b[1]);
  const labelMap = {
    eye: "시선",
    posture: "자세",
    expression: "표정",
    gesture: "제스처",
  };
  const observations = [];

  if (averages.eye < 72) observations.push("시선이 자주 분산되어 답변 신뢰감이 약해 보일 수 있습니다.");
  else observations.push("시선 접촉은 전반적으로 안정적인 편입니다.");

  if (averages.posture < 72) observations.push("상체 중심이 흔들려 긴장감이 크게 보이는 구간이 있습니다.");
  else observations.push("자세 안정도는 면접 화면에 적합한 수준입니다.");

  if (averages.expression < 72) observations.push("표정 변화가 적어 강점 설명의 에너지가 낮게 보일 수 있습니다.");
  else observations.push("표정 반응은 자연스럽게 유지되고 있습니다.");

  if (averages.gesture < 68) observations.push("손동작이 적어 핵심 문장을 강조하는 힘이 약할 수 있습니다.");
  else if (averages.gesture > 88) observations.push("제스처가 다소 많아 시선이 분산될 수 있습니다.");
  else observations.push("제스처 리듬은 답변 흐름과 무난하게 맞습니다.");

  return {
    score: average(Object.values(averages)),
    averages,
    weakest: labelMap[entries[0][0]],
    weakestScore: entries[0][1],
    observations,
    mode: state.nonverbalMode,
    samples: history.length,
  };
}

function setBusy(isBusy) {
  state.busy = isBusy;
  elements.startButton.disabled = isBusy;
  elements.sendButton.disabled = isBusy || !state.started;
  elements.answerInput.disabled = isBusy || !state.started;
  elements.micButton.disabled =
    isBusy || !state.started || !state.recognitionSupported || state.textInputMode;
  if (isBusy) {
    elements.liveTranscript.textContent = "AI 면접관이 다음 질문을 준비 중입니다.";
  } else if (state.started) {
    elements.liveTranscript.textContent = state.recognitionSupported && !state.textInputMode
      ? "REC 버튼을 눌러 답변하세요."
      : "텍스트 입력 모드입니다. 답변을 입력한 뒤 전송하세요.";
  }
}

function addMessage(role, text, shouldPersist = true) {
  state.messages.push({ role, text });
  const item = document.createElement("li");
  item.className = `message ${role}`;
  item.innerHTML = `
    <span class="message-label">${role === "ai" ? "AI 면접관" : "나"}</span>
    <div class="message-bubble">${escapeHtml(text)}</div>
  `;
  elements.chatLog.appendChild(item);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  if (shouldPersist) persistSession();
}

function clearChat() {
  state.messages = [];
  state.answers = [];
  state.answerMeta = [];
  state.silenceEvents = [];
  state.lastReport = null;
  elements.chatLog.innerHTML = "";
  addMessage("ai", "면접 시작을 누르면 회사, 직무, 인재상에 맞춰 첫 질문을 드립니다.");
  state.messages = [];
  updateMetrics();
  setReportActionsEnabled(false);
  persistSession();
}

function stopTtsPlayback() {
  state.ttsRequestId += 1;
  state.ttsBusy = false;
  if (state.ttsAudio) {
    state.ttsAudio.pause();
    state.ttsAudio.removeAttribute("src");
    state.ttsAudio.load();
    state.ttsAudio = null;
  }
  if (state.ttsAudioUrl) {
    URL.revokeObjectURL(state.ttsAudioUrl);
    state.ttsAudioUrl = "";
  }
  if (state.ttsCancel) {
    state.ttsCancel();
    state.ttsCancel = null;
  }
  updateMetrics();
}

function setAnswerReadyStatus() {
  if (!state.started) return;
  elements.liveTranscript.textContent = state.recognitionSupported && !state.textInputMode
    ? "REC 버튼을 눌러 답변하세요."
    : "텍스트 입력 모드입니다. 답변을 입력하고 전송하세요.";
}

function splitLongTtsPart(part) {
  const chunks = [];
  let rest = String(part || "").trim();

  while (rest.length > TTS_CHUNK_MAX_CHARS) {
    const slice = rest.slice(0, TTS_CHUNK_MAX_CHARS);
    const breakAt = Math.max(
      slice.lastIndexOf(" "),
      slice.lastIndexOf(","),
      slice.lastIndexOf("，"),
      slice.lastIndexOf("、"),
    );
    const cut = breakAt > TTS_CHUNK_MAX_CHARS * 0.6 ? breakAt + 1 : TTS_CHUNK_MAX_CHARS;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push(rest);
  return chunks;
}

function getTtsChunks(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?。？！]+[.!?。？！]?/g) || [normalized];
  const chunks = [];
  let current = "";

  sentences.forEach((sentence) => {
    splitLongTtsPart(sentence).forEach((part) => {
      const next = current ? `${current} ${part}` : part;
      if (next.length <= TTS_CHUNK_MAX_CHARS) {
        current = next;
        return;
      }
      if (current) chunks.push(current);
      current = part;
    });
  });

  if (current) chunks.push(current);
  return chunks;
}

async function requestTtsAudio(text) {
  const spokenText = String(text || "").replace(/\s+/g, " ").trim();
  if (!spokenText) return { audioUnavailable: true };
  const response = await fetch(TTS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: spokenText,
      voice: "Kore",
      style: "calm-interviewer",
    }),
  });
  const contentType = response.headers.get("Content-Type") || "";
  if (response.ok && contentType.includes("audio/")) {
    const blob = await response.blob();
    return {
      audioUrl: URL.createObjectURL(blob),
      mimeType: contentType,
    };
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "AI 음성 생성에 실패했습니다.");
    error.status = response.status;
    throw error;
  }
  return { ...data, audioUnavailable: true };
}

async function playTtsAudio(audioUrl, requestId, isFinalChunk) {
  const audio = new Audio(audioUrl);
  state.ttsAudioUrl = audioUrl;
  state.ttsAudio = audio;
  audio.onplay = () => {
    elements.liveTranscript.textContent = "AI 음성을 재생 중입니다.";
  };

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      state.ttsCancel = null;
      if (state.ttsAudio === audio) {
        state.ttsAudio = null;
        if (state.ttsAudioUrl) {
          URL.revokeObjectURL(state.ttsAudioUrl);
          state.ttsAudioUrl = "";
        }
        if (requestId === state.ttsRequestId) {
          if (isFinalChunk) {
            state.ttsBusy = false;
            if (state.started && !state.busy) {
              setAnswerReadyStatus();
            }
          }
          updateMetrics();
        }
      }
      resolve();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      state.ttsCancel = null;
      reject(error);
    };
    state.ttsCancel = finish;
    audio.onended = finish;
    audio.onerror = () => fail(new Error("AI 음성 재생에 실패했습니다."));
    audio.play().catch(fail);
  });
}

function warmTts() {
  if (!state.voiceEnabled || state.ttsWarmed || state.ttsWarmPromise) return state.ttsWarmPromise;
  state.ttsWarmed = true;
  state.ttsWarmPromise = fetch(TTS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      warmup: true,
    }),
  })
    .then((response) => response.arrayBuffer())
    .catch(() => null)
    .finally(() => {
      state.ttsWarmPromise = null;
    });
  return state.ttsWarmPromise;
}

async function speak(text) {
  if (!state.voiceEnabled || !text) return;
  const chunks = getTtsChunks(text);
  if (!chunks.length) return;
  stopTtsPlayback();
  const requestId = state.ttsRequestId;
  state.ttsBusy = true;
  elements.liveTranscript.textContent = "AI 음성을 생성하고 있습니다.";
  updateMetrics();

  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const data = await requestTtsAudio(chunks[index]);
      if (requestId !== state.ttsRequestId || !state.voiceEnabled) return;
      if (data.audioUnavailable) {
        state.ttsBusy = false;
        setAnswerReadyStatus();
        updateMetrics();
        return;
      }

      await playTtsAudio(data.audioUrl, requestId, index === chunks.length - 1);
      if (requestId !== state.ttsRequestId || !state.voiceEnabled) return;
    }
  } catch (error) {
    if (requestId !== state.ttsRequestId) return;
    if (state.ttsAudio) {
      state.ttsAudio.pause();
      state.ttsAudio.removeAttribute("src");
      state.ttsAudio = null;
    }
    if (state.ttsAudioUrl) {
      URL.revokeObjectURL(state.ttsAudioUrl);
      state.ttsAudioUrl = "";
    }
    state.ttsCancel = null;
    state.ttsBusy = false;
    setAnswerReadyStatus();
    updateMetrics();
  }
}

function switchToTextMode(message) {
  state.textInputMode = true;
  elements.micButton.disabled = true;
  elements.answerInput.disabled = !state.started;
  elements.sendButton.disabled = !state.started;
  elements.liveTranscript.textContent = message;
  persistSession();
}

function setupSpeechRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  state.recognitionSupported = Boolean(SpeechRecognition);

  if (!SpeechRecognition) {
    switchToTextMode("이 브라우저는 음성 인식을 지원하지 않습니다. 텍스트 입력 모드로 전환합니다.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    state.isRecording = true;
    state.pendingVoiceText = "";
    markAnswerStarted("voice");
    elements.micButton.classList.add("mic-active");
    elements.micButton.textContent = "STOP";
    elements.liveTranscript.classList.add("mic-active");
    elements.liveTranscript.textContent = "듣고 있습니다.";
  };

  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }
    state.pendingVoiceText = `${state.pendingVoiceText} ${finalText}`.trim();
    const visibleText = [state.pendingVoiceText, interimText].filter(Boolean).join(" ");
    elements.liveTranscript.textContent = visibleText || "듣고 있습니다.";
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      switchToTextMode("마이크 권한이 허용되지 않아 텍스트 입력 모드로 자동 전환했습니다.");
      return;
    }

    elements.liveTranscript.textContent = "음성 인식이 중단되었습니다. 다시 시도하거나 직접 입력하세요.";
  };

  recognition.onend = () => {
    state.isRecording = false;
    elements.micButton.classList.remove("mic-active");
    elements.micButton.textContent = "REC";
    elements.liveTranscript.classList.remove("mic-active");

    const text = state.pendingVoiceText.trim();
    state.pendingVoiceText = "";
    if (text) {
      handleAnswer(text);
    } else if (state.started && !state.busy) {
      elements.liveTranscript.textContent = "인식된 답변이 없습니다. 다시 말하거나 직접 입력하세요.";
    }
  };

  state.recognition = recognition;
}

async function readResumeFile(file) {
  state.resumeName = file ? file.name : "";
  state.resumeText = "";
  elements.fileName.textContent = file ? file.name : "선택된 파일 없음";

  if (!file) {
    persistSession();
    return;
  }

  const textLike =
    file.type.startsWith("text/") ||
    file.name.toLowerCase().endsWith(".txt") ||
    file.name.toLowerCase().endsWith(".md");

  if (!textLike) {
    const lowerName = file.name.toLowerCase();
    const supportedDocument = lowerName.endsWith(".pdf") || lowerName.endsWith(".docx");
    if (!supportedDocument) {
      state.resumeText = `[지원하지 않는 첨부 파일 형식: ${file.name}]`;
      elements.fileName.textContent = `${file.name} · 지원 형식은 PDF, DOCX, TXT, MD입니다.`;
      persistSession();
      return;
    }

    elements.fileName.textContent = `${file.name} · 텍스트 추출 중`;
    try {
      const parsed = await parseResumeDocument(file);
      state.resumeText = parsed.text || `[첨부 파일: ${file.name}]`;
      elements.fileName.textContent = `${file.name} · ${parsed.method || "텍스트 추출 완료"}`;
    } catch (error) {
      state.resumeText = `[첨부 파일: ${file.name}]`;
      elements.fileName.textContent = `${file.name} · 텍스트 추출 실패 (파일 내용 없이 진행됩니다)`;
      showApiNotice(`자기소개서 텍스트 추출에 실패했습니다. (${error.message || "알 수 없는 오류"})`, () => readResumeFile(file));
    }
    persistSession();
    return;
  }

  try {
    state.resumeText = await file.text();
    elements.fileName.textContent = `${file.name} · 텍스트 추출 완료`;
  } catch (error) {
    state.resumeText = `[첨부 파일을 읽지 못했습니다: ${file.name}]`;
  }
  persistSession();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(dataUrlToBase64(result));
    };
    reader.onerror = () => reject(reader.error || new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBase64(value) {
  const text = String(value || "");
  const marker = "base64,";
  const markerIndex = text.indexOf(marker);
  if (markerIndex !== -1) return text.slice(markerIndex + marker.length);
  const commaIndex = text.lastIndexOf(",");
  return commaIndex !== -1 ? text.slice(commaIndex + 1) : text;
}

async function parseResumeDocument(file) {
  const base64 = await fileToBase64(file);
  const response = await fetch(DOCUMENT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      data: base64,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "문서 파싱 실패");
  }
  return data;
}

async function callGemini(mode, payload) {
  const controller = new AbortController();
  const timeoutMs = mode === "report" ? 60000 : 45000;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, ...payload }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "AI request failed");
      error.status = response.status;
      error.code = data.code || (response.status === 500 && /GEMINI_API_KEY/.test(data.error || "") ? "MISSING_KEY" : "API_ERROR");
      throw error;
    }
    setConnection("AI 연결됨", "green");
    hideApiNotice();
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      error.code = "TIMEOUT";
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function fallbackInterviewerQuestion(latestAnswer) {
  const turnIndex = state.answers.length;
  const answer = latestAnswer || "";
  if (!answer) return fallbackQuestions[0];
  if (answer.length < 70) {
    return "조금 더 구체적으로 말씀해 주세요. 어떤 상황에서 어떤 행동을 하셨고 결과가 무엇이었나요?";
  }
  if (!/(결과|성과|수치|증가|감소|개선|달성|전환|완료)/.test(answer)) {
    return "그 경험의 결과를 수치나 변화로 설명한다면 어떻게 말할 수 있을까요?";
  }
  if (!/(제가|저는|맡아|주도|기여|설계|분석|제안)/.test(answer)) {
    return "그 과정에서 지원자님이 직접 책임진 부분은 어디까지였나요?";
  }
  return fallbackQuestions[Math.min(turnIndex, fallbackQuestions.length - 1)];
}

async function requestInterviewer(latestAnswer = "") {
  setBusy(true);
  clearSilenceTimer();
  warmTts();
  const profile = getProfile();
  elements.personaSummary.textContent = `${profile.company} · ${profile.role} · ${profile.personaLabel}`;

  try {
    const data = await callGemini("turn", {
      profile,
      latestAnswer,
      messages: state.messages.slice(-10),
    });
    const reply = data.reply || data.text || fallbackInterviewerQuestion(latestAnswer);
    addMessage("ai", reply);
    await speak(reply);
    startSilenceTimer(reply);
  } catch (error) {
    const message = getReadableError(error);
    setConnection("AI 연결 실패", "red");
    showApiNotice(message, () => requestInterviewer(latestAnswer));
    const reply = fallbackInterviewerQuestion(latestAnswer);
    addMessage("ai", reply);
    await speak(reply);
    startSilenceTimer(reply);
  } finally {
    setBusy(false);
    updateMetrics();
    persistSession();
  }
}

async function startInterview() {
  if (state.busy) return;
  stopTtsPlayback();
  state.started = true;
  state.answers = [];
  state.answerMeta = [];
  state.messages = [];
  state.silenceEvents = [];
  state.lastReport = null;
  state.activeReportTab = "language";
  elements.chatLog.innerHTML = "";
  clearReportDashboard();
  hideApiNotice();
  setReportActionsEnabled(false);
  elements.answerInput.value = "";
  elements.answerInput.disabled = false;
  elements.sendButton.disabled = false;
  elements.micButton.disabled = !state.recognitionSupported || state.textInputMode;
  await resetNonverbalVideoCapture();
  if (!state.cameraActive) {
    startCamera();
  } else {
    startNonverbalVideoCapture(state.cameraStream);
  }
  updateMetrics();
  persistSession();

  if (state.expectedQuestions.length) {
    startPracticeEngine();
  } else {
    await requestInterviewer("");
  }
}

// ---------------------------------------------------------------------------
// 예상 질문 기반 모의면접 엔진: questions-report 단계에서 미리 생성한 질문 목록을
// 순서대로 진행하고, 꼬리질문 강도에 따라 꼬리질문을 끼워넣는다.
// ---------------------------------------------------------------------------

function formatMMSS(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function preparePracticeQueue() {
  const grouped = (state.expectedQuestions || []).reduce((acc, item) => {
    const category = item.category || "질문";
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  const queue = [];
  Object.entries(grouped).forEach(([category, items]) => {
    items.forEach((item) => {
      queue.push({
        category,
        number: String(queue.length + 1),
        question: item.question || String(item),
        intent: item.intent || "",
        isFollowup: false,
      });
    });
  });

  state.practiceQueue = queue;
  state.practiceFollowupUsed = new Set();
}

function startPracticeSessionTimer() {
  stopPracticeSessionTimer();
  state.practiceSessionStartedAt = Date.now();
  state.practiceSessionTimerId = window.setInterval(() => {
    const elapsed = (Date.now() - state.practiceSessionStartedAt) / 1000;
    if (elements.practiceSessionTimer) elements.practiceSessionTimer.textContent = formatMMSS(elapsed);
  }, 1000);
}

function stopPracticeSessionTimer() {
  window.clearInterval(state.practiceSessionTimerId);
  state.practiceSessionTimerId = null;
}

function startPracticeAnswerTimer() {
  stopPracticeAnswerTimer();
  state.practiceAnswerStartedAt = Date.now();
  state.practiceAnswerTimerId = window.setInterval(() => {
    const elapsed = (Date.now() - state.practiceAnswerStartedAt) / 1000;
    if (elements.practiceAnswerTimer) elements.practiceAnswerTimer.textContent = formatMMSS(elapsed);
  }, 1000);
}

function stopPracticeAnswerTimer() {
  window.clearInterval(state.practiceAnswerTimerId);
  state.practiceAnswerTimerId = null;
}

function startListeningForAnswer() {
  state.practiceTranscriptFinal = "";
  if (elements.practiceAnsweringChip) elements.practiceAnsweringChip.hidden = true;
  startPracticeAnswerTimer();
  markAnswerStarted("voice");

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    if (elements.practiceTranscriptText) {
      elements.practiceTranscriptText.textContent = "이 브라우저는 음성 인식을 지원하지 않습니다. 음성 인식이 가능한 브라우저로 다시 시도해 주세요.";
    }
    return;
  }

  if (state.practiceRecognition) {
    try {
      state.practiceRecognition.abort();
    } catch (error) {
      // ignore
    }
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = "ko-KR";
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onresult = (event) => {
    let finalText = state.practiceTranscriptFinal || "";
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }
    state.practiceTranscriptFinal = finalText;
    const visibleText = `${finalText} ${interimText}`.trim();
    if (elements.practiceTranscriptText) {
      elements.practiceTranscriptText.textContent = visibleText || "듣고 있습니다.";
    }
    if (elements.practiceAnsweringChip) elements.practiceAnsweringChip.hidden = !visibleText;
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      if (elements.practiceTranscriptText) {
        elements.practiceTranscriptText.textContent = "마이크 권한이 필요합니다. 브라우저 설정에서 마이크 접근을 허용해 주세요.";
      }
    }
  };

  let restartAttempts = 0;
  recognition.onend = () => {
    if (!state.practiceListening) return;
    restartAttempts += 1;
    if (restartAttempts > 20) {
      // Recognition keeps ending immediately (e.g. no mic / no speech service available).
      // Stop auto-restarting so we don't spin the event loop; the fallback text box still works.
      state.practiceListening = false;
      if (elements.practiceTranscriptText) {
        elements.practiceTranscriptText.textContent = "음성 인식을 사용할 수 없습니다. 마이크 연결 상태를 확인한 뒤 다시 시도해 주세요.";
      }
      return;
    }
    window.setTimeout(() => {
      if (!state.practiceListening) return;
      try {
        recognition.start();
      } catch (error) {
        // already stopping; ignore
      }
    }, 300);
  };

  state.practiceListening = true;
  state.practiceRecognition = recognition;
  try {
    recognition.start();
  } catch (error) {
    // ignore start errors (e.g. already started)
  }
}

function stopListeningForAnswer() {
  state.practiceListening = false;
  if (state.practiceRecognition) {
    try {
      state.practiceRecognition.stop();
    } catch (error) {
      // ignore
    }
  }
  if (elements.practiceAnsweringChip) elements.practiceAnsweringChip.hidden = true;
}

async function presentPracticeItem(item, queueIndex) {
  stopTtsPlayback();
  state.practiceCurrentItem = item;
  state.practiceCurrentQueueIndex = queueIndex;

  const tag = item.isFollowup ? `Q${item.number}.1 꼬리 질문` : `Q${item.number} ${item.category}`;
  if (elements.practiceQuestionTag) elements.practiceQuestionTag.textContent = tag;
  if (elements.practiceQuestionText) elements.practiceQuestionText.textContent = item.question;
  if (elements.practiceTranscriptText) {
    elements.practiceTranscriptText.textContent = "AI 면접관이 질문하고 있어요…";
  }
  if (elements.practiceAnswerTimer) elements.practiceAnswerTimer.textContent = "00:00";
  if (elements.practiceNextButton) {
    elements.practiceNextButton.disabled = false;
    elements.practiceNextButton.textContent = "답변 완료";
  }

  addMessage("ai", item.question);
  state.questionStartedAt = Date.now();
  persistSession();

  try {
    await speak(item.question);
  } catch (error) {
    // TTS failures shouldn't block the interview from continuing.
  }

  // If the user retried/ended/advanced while the question was being read out, don't
  // start listening for a question that's no longer current.
  if (!state.practiceActive || state.practiceCurrentItem !== item) return;
  if (elements.practiceTranscriptText) {
    elements.practiceTranscriptText.textContent = "답변을 시작하면 여기에 실시간으로 표시됩니다.";
  }
  startListeningForAnswer();
}

async function generateFollowupQuestion(item, answerText) {
  const profile = getProfile();
  const data = await callGemini("turn", {
    profile,
    latestAnswer: answerText,
    messages: [
      { role: "ai", text: item.question },
      { role: "user", text: answerText },
    ],
  });
  return (
    data.reply ||
    data.text ||
    `방금 답변 중 "${answerText.slice(0, 20)}..." 부분을 조금 더 구체적으로 설명해 주시겠어요?`
  );
}

function advanceToNextQuestion() {
  const nextIndex = state.practiceCurrentQueueIndex + 1;
  if (nextIndex < state.practiceQueue.length) {
    presentPracticeItem(state.practiceQueue[nextIndex], nextIndex);
  } else {
    finishPracticeSession();
  }
}

async function finalizePracticeAnswer() {
  if (state.busy || !state.practiceActive) return;
  stopTtsPlayback();
  stopListeningForAnswer();
  stopPracticeAnswerTimer();

  const placeholderTexts = [
    "답변을 시작하면 여기에 실시간으로 표시됩니다.",
    "듣고 있습니다.",
    "마이크 권한이 필요합니다. 브라우저 설정에서 마이크 접근을 허용해 주세요.",
    "이 브라우저는 음성 인식을 지원하지 않습니다. 음성 인식이 가능한 브라우저로 다시 시도해 주세요.",
    "음성 인식을 사용할 수 없습니다. 마이크 연결 상태를 확인한 뒤 다시 시도해 주세요.",
  ];
  const rawText = (elements.practiceTranscriptText?.textContent || "").trim();
  const answerText = placeholderTexts.includes(rawText) ? "" : rawText;

  const currentItem = state.practiceCurrentItem;
  recordUserAnswer(answerText || "(답변 없음)", state.currentInputMode || "text", currentItem
    ? {
        number: currentItem.number,
        category: currentItem.category,
        question: currentItem.question,
        isFollowup: Boolean(currentItem.isFollowup),
      }
    : null);

  const item = state.practiceCurrentItem;
  const depth = Number(elements.depthInput.value) || 3;
  const shouldFollowup =
    answerText &&
    !item.isFollowup &&
    depth >= 3 &&
    !state.practiceFollowupUsed.has(state.practiceCurrentQueueIndex);

  if (shouldFollowup) {
    state.practiceFollowupUsed.add(state.practiceCurrentQueueIndex);
    setBusy(true);
    if (elements.practiceNextButton) {
      elements.practiceNextButton.disabled = true;
      elements.practiceNextButton.textContent = "생성 중…";
    }
    try {
      const followupQuestion = await generateFollowupQuestion(item, answerText);
      setBusy(false);
      presentPracticeItem(
        { ...item, isFollowup: true, question: followupQuestion },
        state.practiceCurrentQueueIndex,
      );
      return;
    } catch (error) {
      setBusy(false);
    }
  }

  advanceToNextQuestion();
}

function finishPracticeSession() {
  if (!state.answers.length) {
    window.alert("아직 답변한 질문이 없어 분석 리포트를 만들 수 없습니다. 최소 한 개 이상 답변한 뒤 종료해 주세요.");
    return;
  }

  state.practiceActive = false;
  stopTtsPlayback();
  stopListeningForAnswer();
  stopPracticeAnswerTimer();
  stopPracticeSessionTimer();
  if (elements.practiceQuestionTag) elements.practiceQuestionTag.textContent = "면접 종료";
  if (elements.practiceQuestionText) {
    elements.practiceQuestionText.textContent = "수고하셨어요! 분석 결과를 준비하고 있어요.";
  }
  elements.reportButton.disabled = false;
  elements.reportButton.click();
}

function startPracticeEngine() {
  preparePracticeQueue();
  if (!state.practiceQueue.length) {
    requestInterviewer("");
    return;
  }
  warmTts();
  state.practiceActive = true;
  startPracticeSessionTimer();
  presentPracticeItem(state.practiceQueue[0], 0);
}

function recordUserAnswer(text, mode = state.currentInputMode || "text", questionMeta = null) {
  const answeredAt = Date.now();
  const startedAt = state.currentAnswerStartedAt || answeredAt;
  const durationMs = Math.max(1000, answeredAt - startedAt);
  const latencyMs = state.questionStartedAt ? Math.max(0, startedAt - state.questionStartedAt) : 0;

  clearSilenceTimer();
  addMessage("user", text);
  state.answers.push(text);
  state.answerMeta.push({
    text,
    mode,
    startedAt,
    endedAt: answeredAt,
    durationMs,
    latencyMs,
    question: questionMeta,
  });
  state.currentAnswerStartedAt = null;
  state.currentInputMode = "text";
  updateMetrics();
  persistSession();
}

async function handleAnswer(rawText) {
  const text = rawText.trim();
  if (!text || state.busy) return;
  if (!state.started) {
    state.started = true;
  }
  elements.answerInput.value = "";

  recordUserAnswer(text);
  await requestInterviewer(text);
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function topCountItems(items, limit) {
  return items
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function getRepeatedExpressions(text) {
  const stopwords = new Set(["그리고", "그래서", "저는", "제가", "이", "그", "좀", "더", "수", "것", "때", "를", "을"]);
  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !stopwords.has(word));
  const counts = new Map();

  words.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  for (let i = 0; i < words.length - 1; i += 1) {
    const phrase = `${words[i]} ${words[i + 1]}`;
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count || a.label.length - b.label.length)
    .slice(0, 5);
}

function getConversationPairs() {
  const pairs = [];
  let currentQuestion = null;

  state.messages.forEach((message) => {
    if (message.role === "ai") {
      currentQuestion = message.text;
      return;
    }
    if (message.role === "user") {
      pairs.push({
        question: currentQuestion || "질문 기록 없음",
        answer: message.text,
      });
      currentQuestion = null;
    }
  });

  return pairs;
}

function evaluateAnswer(answer) {
  const logic = countMatches(answer, /(왜냐하면|따라서|그래서|결과적으로|예를 들어|첫째|둘째|근거|문제|해결|결과|배운)/g);
  const evidence = countMatches(answer, /(\d+|퍼센트|%|명|건|회|개월|주|매출|전환|유지율|시간|비용)/g);
  const roleSignal = countMatches(answer, /(제가|저는|맡아|주도|기여|설계|분석|제안|개선|협업)/g);
  const score = Math.min(100, Math.round(35 + logic * 12 + evidence * 14 + roleSignal * 7 + answer.length / 12));
  const feedback = [];

  if (logic === 0) feedback.push("상황-행동-결과의 연결어가 부족합니다.");
  if (evidence === 0) feedback.push("성과를 보여줄 수치나 규모가 부족합니다.");
  if (roleSignal === 0) feedback.push("본인이 직접 맡은 역할이 더 분명해야 합니다.");
  if (!feedback.length) feedback.push("질문 의도에 맞춰 구조와 근거가 비교적 잘 드러납니다.");

  return { score, feedback };
}

function getJobFitMappings() {
  const profile = getProfile();
  const source = `${profile.role} ${profile.talent}`;
  const keywords = source
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .slice(0, 12);
  const joined = state.answers.join(" ");

  return keywords.slice(0, 8).map((keyword) => ({
    keyword,
    matched: joined.includes(keyword),
  }));
}

function analyzeAnswers() {
  const joined = state.answers.join(" ");
  const fillerItems = [
    ["음", /(^|[\s,.!?])음+($|[\s,.!?])/g],
    ["어", /(^|[\s,.!?])어+($|[\s,.!?])/g],
    ["그", /(^|[\s,.!?])그($|[\s,.!?])/g],
    ["약간", /약간/g],
    ["이제", /이제/g],
    ["뭔가", /뭔가/g],
    ["같아요", /같아요/g],
    ["사실", /사실/g],
  ].map(([label, regex]) => ({ label, count: countMatches(joined, regex) }));

  const fillerTotal = fillerItems.reduce((sum, item) => sum + item.count, 0);
  const repeatedExpressions = getRepeatedExpressions(joined);
  const answerDurations = state.answerMeta.map((item) => item.durationMs).filter(Boolean);
  const avgAnswerTimeMs = answerDurations.length ? average(answerDurations) : 0;
  const avgLatencyMs = state.answerMeta.length
    ? average(state.answerMeta.map((item) => item.latencyMs || 0))
    : 0;
  const conversationPairs = getConversationPairs();
  const questionEvaluations = conversationPairs.map((pair, index) => ({
    index: index + 1,
    question: pair.question,
    answer: pair.answer,
    ...evaluateAnswer(pair.answer),
  }));
  const wordCount = joined.trim() ? joined.trim().split(/\s+/).length : 0;
  const avgLength = state.answers.length
    ? Math.round(joined.length / state.answers.length)
    : 0;
  const logicSignals = countMatches(
    joined,
    /(왜냐하면|따라서|그래서|결과적으로|예를 들어|첫째|둘째|근거|문제|해결|결과|배운)/g,
  );
  const evidenceSignals = countMatches(
    joined,
    /(\d+|퍼센트|%|명|건|회|개월|주|매출|전환|유지율|시간|비용)/g,
  );
  const fillerRate = wordCount ? Math.round((fillerTotal / wordCount) * 100) : 0;
  const structureScore = Math.min(100, 42 + logicSignals * 8 + evidenceSignals * 6);
  const deliveryScore = Math.max(30, Math.min(100, 92 - fillerTotal * 5));
  const specificityScore = Math.min(100, 38 + evidenceSignals * 12 + avgLength / 8);

  return {
    fillerItems,
    topFillers: topCountItems(fillerItems, 3),
    fillerTotal,
    fillerRate,
    repeatedExpressions,
    avgAnswerTimeMs,
    avgLatencyMs,
    silenceEvents: state.silenceEvents,
    answerMeta: state.answerMeta,
    conversationPairs,
    questionEvaluations,
    jobFitMappings: getJobFitMappings(),
    wordCount,
    avgLength,
    logicSignals,
    evidenceSignals,
    structureScore: Math.round(structureScore),
    deliveryScore: Math.round(deliveryScore),
    specificityScore: Math.round(specificityScore),
  };
}

function contentMetricCopy(label, score) {
  const good = score >= 75;
  switch (label) {
    case "논리 구조":
      return {
        desc: good
          ? "결론을 먼저 제시하고 근거를 뒤에 배치하는 두괄식 구조가 답변 대부분에서 유지됐다."
          : "답변 일부에서 배경 설명이 먼저 나와 결론이 후반부에 등장했다. 두괄식 구조가 아직 안정적이지 않다.",
        tip: good
          ? "지금의 두괄식 습관을 유지하면서 결론 뒤 근거를 한두 문장으로 더 압축해 보면 좋다."
          : "결론을 첫 문장에 두고 그 다음에 이유를 설명하는 순서로 답변을 정리하는 연습이 필요하다.",
      };
    case "구체성":
      return {
        desc: good
          ? "고유명사나 수치를 포함한 답변이 많아 경험의 검증 가능성이 높다."
          : "정도를 나타내는 표현 위주로 설명한 구간이 있어 구체성이 부족하다.",
        tip: good
          ? "수치가 나온 답변에는 비교 기준(이전/이후)까지 덧붙이면 설득력이 더 올라간다."
          : `"많이", "크게" 같은 표현이 나올 때마다 수치나 구체적 사례로 바꿔 말하는 연습이 필요하다.`,
      };
    case "전달력":
    default:
      return {
        desc: good
          ? "추임새와 군더더기 표현이 적어 답변이 안정적으로 전달됐다."
          : "추임새나 반복 표현이 답변 전달의 안정감을 낮추고 있다.",
        tip: good
          ? "지금의 전달 속도와 톤을 유지하면 충분히 안정적으로 들린다."
          : "말을 시작하기 전 한 박자 쉬는 연습을 하면 추임새를 줄이는 데 도움이 된다.",
      };
  }
}

function nonverbalMetricCopy(label, score, observation) {
  const tips = {
    "시선 처리": "생각을 정리하는 동안에도 정면을 유지하면 준비된 인상을 줄 수 있다.",
    "자세": "답변이 길어질 때 자세를 고쳐 앉는 지점을 정해 두면 흐트러짐이 줄어든다.",
    "표정": "근거를 설명하는 구간에서도 표정 변화를 유지하면 더 자연스럽게 보인다.",
    "제스처": "수치나 비교 표현을 말할 때 손 동작을 함께 쓰면 전달력이 올라간다.",
    "말하기 습관": "말을 떼기 전 한 박자 쉬는 것만으로 추임새를 상당수 줄일 수 있다.",
  };
  return {
    desc: observation || "",
    tip: score >= 78 ? "지금 상태를 유지하면 충분히 안정적으로 보인다." : tips[label] || "",
  };
}

function buildInterviewReportSections(analysis, aiReport) {
  const overall = Math.round(
    average([analysis.structureScore || 0, analysis.deliveryScore || 0, analysis.specificityScore || 0]),
  );
  const profile = getProfile();
  const nonverbal = analyzeNonverbal();
  const dateLabel = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const followupCount = state.answerMeta.filter((meta) => meta.question?.isFollowup).length;
  const totalDurationMs = state.answerMeta.reduce((sum, meta) => sum + (meta.durationMs || 0), 0);
  const strengths = aiReport?.strengths?.length ? aiReport.strengths : [];
  const improvements = aiReport?.improvements?.length
    ? aiReport.improvements
    : aiReport?.contentFeedback?.length
      ? aiReport.contentFeedback
      : [];

  const contentMetrics = [
    { label: "논리 구조", score: analysis.structureScore || 0 },
    { label: "구체성", score: analysis.specificityScore || 0 },
    { label: "전달력", score: analysis.deliveryScore || 0 },
  ].map((metric) => ({ ...metric, ...contentMetricCopy(metric.label, metric.score) }));

  const nonverbalKeys = [
    ["eye", "시선 처리"],
    ["posture", "자세"],
    ["expression", "표정"],
    ["gesture", "제스처"],
  ];
  const speakingHabitScore = Math.max(0, Math.min(100, 100 - (analysis.fillerRate || 0) * 2));
  const nonverbalMetrics = nonverbal
    ? [
        ...nonverbalKeys.map(([key, label], index) => {
          const score = Math.round(nonverbal.averages[key] || 0);
          return { label, score, ...nonverbalMetricCopy(label, score, nonverbal.observations[index]) };
        }),
        {
          label: "말하기 습관",
          score: Math.round(speakingHabitScore),
          ...nonverbalMetricCopy(
            "말하기 습관",
            speakingHabitScore,
            analysis.fillerTotal
              ? `답변 전체에서 추임새·반복 표현이 ${analysis.fillerTotal}회 나타났다.`
              : "추임새 사용이 거의 관찰되지 않았다.",
          ),
        },
      ]
    : null;

  const questions = state.answerMeta
    .map((meta, index) => ({ meta, index }))
    .filter(({ meta }) => meta.question)
    .map(({ meta, index }) => ({
      id: `q-${index}`,
      tag: meta.question.isFollowup
        ? `Q${meta.question.number}.1 꼬리질문`
        : `Q${meta.question.number} ${meta.question.category || ""}`.trim(),
      mainTag: `Q${meta.question.number}`,
      question: meta.question.question,
      answer: meta.text,
      isFollowup: Boolean(meta.question.isFollowup),
    }));
  const followupMainTags = new Set(questions.filter((q) => q.isFollowup).map((q) => q.mainTag));
  questions.forEach((q) => {
    q.hasFollowup = !q.isFollowup && followupMainTags.has(q.mainTag);
  });

  const profileLabelParts = [profile.company, profile.role].filter((v) => v && !String(v).startsWith("미입력"));
  const profileMetaParts = [
    profile.interviewType && !profile.interviewType.startsWith("미입력") ? profile.interviewType : null,
    profile.depth ? `강도 ${profile.depth}` : null,
    `${state.answers.length}건 답변`,
  ].filter(Boolean);

  const interviewTypeLabel =
    profile.interviewType && !profile.interviewType.startsWith("미입력") ? profile.interviewType : "면접";
  const formatShortDate = (date) =>
    `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, "0")}. ${String(date.getDate()).padStart(2, "0")}`;
  const now = new Date();

  // NOTE: there's no session-history storage yet, so these past-session rows
  // are illustrative placeholders rather than real past sessions. A small
  // seeded PRNG (keyed off stable profile details, not the random clock) is
  // used so the numbers vary session-to-session instead of always landing on
  // the same fixed offsets, while staying reproducible if this report is
  // re-rendered for the same session. Swap in real stored history once that
  // exists.
  const seedSource = `${profile.company}|${profile.role}|${profile.depth}|${state.answers.length}`;
  let seed = 0;
  for (let i = 0; i < seedSource.length; i += 1) {
    seed = (seed * 31 + seedSource.charCodeAt(i)) >>> 0;
  }
  const seededRandom = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const session1Date = new Date(now.getTime() - (10 + Math.round(seededRandom() * 10)) * 24 * 60 * 60 * 1000);
  const session2Date = new Date(now.getTime() - (3 + Math.round(seededRandom() * 5)) * 24 * 60 * 60 * 1000);
  const gap1 = 6 + Math.round(seededRandom() * 12); // 1회차: 6~18점 낮았음
  const gap2 = 1 + Math.round(seededRandom() * 8); // 2회차: 1~9점 낮았음 (더 최근이라 격차가 작은 편)
  const session1Score = Math.max(30, overall - gap1);
  const session2Score = Math.max(session1Score + 1, overall - gap2);
  // 60% 확률로 이번 세션이 개인 최고 기록, 아니면 과거에 1~5점 더 높았던 적이 있는 걸로.
  const bestIsCurrent = seededRandom() < 0.6;
  const bestScore = bestIsCurrent ? overall : Math.min(100, overall + 1 + Math.round(seededRandom() * 4));

  const comparison = [
    buildComparisonRow(
      "1회차 대비",
      `${formatShortDate(session1Date)} · ${interviewTypeLabel}`,
      overall,
      session1Score,
    ),
    buildComparisonRow(
      "2회차 대비",
      `${formatShortDate(session2Date)} · ${interviewTypeLabel}`,
      overall,
      session2Score,
    ),
    buildComparisonRow("내 최고 기록", "3회 중 최고 점수", overall, bestScore, {
      diffLabel: bestIsCurrent ? "최고" : null,
      baselineLabel: "최고",
    }),
  ];

  const nextActions = (improvements.length ? improvements : strengths)
    .slice(0, 3)
    .map((text) => ({ text, category: classifyReportActionCategory(text) }));

  return {
    session: {
      main: profileLabelParts.length ? profileLabelParts.join(" · ") : "PITA 모의면접",
      sub: profileMetaParts.join(" · "),
    },
    summary: {
      overall,
      meta: [
        `${state.answers.length}건 답변`,
        totalDurationMs ? formatDuration(totalDurationMs) : null,
        `꼬리질문 ${followupCount}회`,
        dateLabel,
      ].filter(Boolean),
      headline:
        aiReport?.summary ||
        (state.reportGenerating
          ? "AI가 답변을 분석해 종합 코멘트를 준비하고 있어요."
          : "리포트를 생성하면 종합 코멘트가 표시됩니다."),
      strengths,
      improvements,
    },
    content: { metrics: contentMetrics },
    comparison,
    nextActions,
    questions,
    nonverbal: nonverbalMetrics,
  };
}

function classifyReportActionCategory(text) {
  if (/표정|제스처|시선|자세|추임새|말하기|손\s*동작/.test(text)) return "비언어 분석";
  if (/논리|구체성|근거|수치|전달|경험|사례/.test(text)) return "내용 분석";
  return "종합 피드백";
}

function renderReportActionItem(action, index) {
  return `
    <div class="report-action-item">
      <p class="report-action-num">${String(index + 1).padStart(2, "0")}</p>
      <p class="report-action-title">${escapeHtml(action.text)}</p>
      <span class="report-action-chip">${escapeHtml(action.category)}</span>
    </div>`;
}

function buildComparisonRow(title, sub, mine, baseline, options = {}) {
  const clamped = (value) => Math.max(0, Math.min(100, Math.round(value)));
  const mineClamped = clamped(mine);
  const baselineClamped = clamped(baseline);
  return {
    title,
    sub,
    mine: mineClamped,
    baseline: baselineClamped,
    diff: mineClamped - baselineClamped,
    diffLabel: options.diffLabel || null,
    baselineLabel: options.baselineLabel || title.replace(" 대비", ""),
  };
}

function renderReportFeedbackCard(kind, title, items) {
  const isGood = kind === "good";
  const emptyText = isGood
    ? "리포트를 생성하면 잘한 점이 표시됩니다."
    : "리포트를 생성하면 아쉬운 점이 표시됩니다.";
  const itemsHtml = items.length
    ? items
        .map(
          (text) => `
        <div class="report-fb-item">
          <span class="report-fb-item-dot"></span>
          <p>${escapeHtml(text)}</p>
        </div>`,
        )
        .join("")
    : `<p class="report-fb-empty">${emptyText}</p>`;
  return `
    <div class="report-fb-card is-${isGood ? "good" : "warn"}">
      <div class="report-fb-head">
        <span class="report-fb-dot"></span>
        <strong>${escapeHtml(title)}</strong>
        <span class="report-fb-count">${items.length}건</span>
      </div>
      ${itemsHtml}
    </div>`;
}

function renderReportScoreTile(label, score) {
  const good = score >= 75;
  return `
    <div class="report-score-tile ${good ? "is-good" : "is-warn"}">
      <span class="report-score-tile-label">${escapeHtml(label)}</span>
      <span class="report-score-tile-value">${score}<span>${good ? "우수" : "보완 필요"}</span></span>
      <div class="report-score-tile-bar"><div class="report-score-tile-bar-fill" style="width:${Math.max(0, Math.min(100, score))}%"></div></div>
    </div>`;
}

function renderReportMetricCard(metric) {
  return `
    <div class="report-metric-card">
      <strong>${escapeHtml(metric.label)}</strong>
      <p class="report-metric-desc">${escapeHtml(metric.desc)}</p>
      ${
        metric.tip
          ? `<div class="report-metric-tip"><span class="report-metric-tip-rail"></span><p>${escapeHtml(metric.tip)}</p></div>`
          : ""
      }
    </div>`;
}

function renderReportAccordionItem(item) {
  return `
    <div class="report-accordion-item${item.isFollowup ? " is-followup" : ""}${item.hasFollowup ? " has-followup" : ""}" data-report-accordion-item>
      <button type="button" class="report-accordion-header" data-report-accordion-toggle>
        <span class="report-accordion-title">${escapeHtml(item.tag)} - ${escapeHtml(item.question)}</span>
        <span class="report-accordion-chevron" aria-hidden="true">
          <svg width="14" height="8" viewBox="0 0 14 8"><path d="M7 0L14 8H0Z" fill="currentColor" /></svg>
        </span>
      </button>
      <div class="report-accordion-body">
        ${item.hasFollowup ? '<span class="report-followup-badge">꼬리질문 발생</span>' : ""}
        <p class="report-accordion-answer-label">내 답변</p>
        <p class="report-accordion-answer-text">${escapeHtml(item.answer)}</p>
      </div>
    </div>`;
}

function renderReportCompareCard(row) {
  const isUp = row.diff >= 0;
  const diffText = row.diffLabel || `${isUp ? "+" : ""}${row.diff}`;
  return `
    <div class="report-compare-card">
      <p class="report-compare-title">${escapeHtml(row.title)}</p>
      <p class="report-compare-sub">${escapeHtml(row.sub)}</p>
      <div class="report-compare-value">
        <b>${row.mine}</b>
        <span class="report-compare-diff ${isUp ? "is-up" : "is-down"}">${escapeHtml(diffText)}</span>
      </div>
      <div class="report-compare-scale">
        <div class="report-compare-track"></div>
        <div class="report-compare-mine" style="width:${row.mine}%"></div>
        <div class="report-compare-mark" style="left:${row.baseline}%"></div>
      </div>
      <div class="report-compare-legend">
        <span class="mine">이번 ${row.mine}</span>
        <span class="base">${escapeHtml(row.baselineLabel)} ${row.baseline}</span>
      </div>
    </div>`;
}

let reportSectionObserver = null;

function initReportSectionNav() {
  const nav = elements.reportSectionNav;
  const contentRoot = elements.reportDashboardRoot;
  const scrollRoot = elements.reportMain;
  if (!nav || !contentRoot) return;

  const navItems = Array.from(nav.querySelectorAll("[data-report-section]"));
  const sections = Array.from(contentRoot.querySelectorAll("[data-report-section-target]"));
  if (!navItems.length || !sections.length) return;

  const setActive = (name) => {
    navItems.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.reportSection === name));
  };

  navItems.forEach((btn) => {
    btn.onclick = () => {
      const target = contentRoot.querySelector(`[data-report-section-target="${btn.dataset.reportSection}"]`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(btn.dataset.reportSection);
    };
  });

  if (reportSectionObserver) reportSectionObserver.disconnect();
  reportSectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) setActive(visible[0].target.dataset.reportSectionTarget);
    },
    { root: scrollRoot || null, rootMargin: "-10% 0px -70% 0px", threshold: 0 },
  );
  sections.forEach((section) => reportSectionObserver.observe(section));
}

function renderInterviewReportDashboard(root, analysis, aiReport) {
  if (!root) return;
  const data = buildInterviewReportSections(analysis, aiReport);

  if (elements.reportSessionMain) elements.reportSessionMain.textContent = data.session.main;
  if (elements.reportSessionSub) elements.reportSessionSub.textContent = data.session.sub;

  const questionsHtml = data.questions.length
    ? data.questions.map(renderReportAccordionItem).join("")
    : '<p class="report-fb-empty">아직 기록된 답변이 없습니다.</p>';

  const nonverbalHtml = data.nonverbal
    ? `
      <div class="report-score-row">${data.nonverbal.map((m) => renderReportScoreTile(m.label, m.score)).join("")}</div>
      <div class="report-metric-list">${data.nonverbal.map(renderReportMetricCard).join("")}</div>`
    : '<p class="report-fb-empty">카메라를 켜고 면접을 진행하면 비언어 분석이 표시됩니다.</p>';

  root.innerHTML = `
    <section class="report-section" id="report-section-summary" data-report-section-target="summary">
      <h2 class="report-section-title">종합 피드백</h2>
      <div class="report-headline-card">
        <div class="report-headline-score"><b>${data.summary.overall}</b><span>점</span></div>
        <div class="report-headline-body">
          <div class="report-headline-meta">${data.summary.meta
            .map((m, i) => (i === 0 ? `<span>${escapeHtml(m)}</span>` : `<span class="sep"></span><span>${escapeHtml(m)}</span>`))
            .join("")}</div>
          <p class="report-headline-summary">${escapeHtml(data.summary.headline)}</p>
        </div>
      </div>
      <div class="report-grid-2">
        ${renderReportFeedbackCard("good", "잘한 점", data.summary.strengths)}
        ${renderReportFeedbackCard("warn", "아쉬운 점", data.summary.improvements)}
      </div>
    </section>

    ${
      data.nextActions.length
        ? `
    <section class="report-section" id="report-section-next-actions">
      <div class="report-section-head-row">
        <h2 class="report-section-title">다음 연습에서 고칠 것</h2>
        <p class="report-section-head-note">위 분석에서 도출된 ${data.nextActions.length}가지</p>
      </div>
      <div class="report-action-list">${data.nextActions.map(renderReportActionItem).join("")}</div>
    </section>`
        : ""
    }

    <section class="report-section" id="report-section-content" data-report-section-target="content">
      <h2 class="report-section-title">내용 분석</h2>
      <div class="report-score-row">${data.content.metrics.map((m) => renderReportScoreTile(m.label, m.score)).join("")}</div>
      <div class="report-metric-list">${data.content.metrics.map(renderReportMetricCard).join("")}</div>
    </section>

    <section class="report-section" id="report-section-comparison">
      <h2 class="report-section-title">회차 비교</h2>
      <div class="report-compare-grid">${data.comparison.map(renderReportCompareCard).join("")}</div>
      <div class="report-compare-note">
        <span class="report-compare-note-rail"></span>
        <p>같은 유형·난이도의 내 지난 세션과만 비교합니다. 다른 이용자 점수나 실제 채용 결과와는 연결되지 않습니다.</p>
      </div>
    </section>

    <section class="report-section" id="report-section-questions" data-report-section-target="questions">
      <h2 class="report-section-title">질문별 상세</h2>
      <div class="report-accordion">${questionsHtml}</div>
    </section>

    <section class="report-section" id="report-section-nonverbal" data-report-section-target="nonverbal">
      <h2 class="report-section-title">비언어 분석</h2>
      ${nonverbalHtml}
    </section>
  `;

  root.querySelectorAll("[data-report-accordion-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest("[data-report-accordion-item]").classList.toggle("is-open");
    });
  });

  initReportSectionNav();
}

function renderReport(analysis, aiReport = null) {
  renderInterviewReportDashboard(elements.reportDashboardRoot, analysis, aiReport);
  state.lastReport = { analysis, aiReport };
  setReportActionsEnabled(true);
  persistSession();
}

function normalizeReport(data) {
  if (data.report && typeof data.report === "object") return data.report;
  if (data.text) {
    try {
      return JSON.parse(data.text);
    } catch (error) {
      return { summary: data.text, improvements: [], practicePlan: [] };
    }
  }
  return null;
}

async function generateReport() {
  if (!state.answers.length) return;
  const analysis = analyzeAnswers();
  state.activeReportTab = state.activeReportTab || "language";
  state.reportGenerating = true;
  renderReport(analysis);
  elements.reportButton.disabled = true;
  elements.reportButton.textContent = "생성 중";

  try {
    setNonverbalVideoStatus("Gemini 리포트용 영상 샘플 정리 중");
    const nonverbalMedia = await prepareNonverbalVideoPayload();
    if (nonverbalMedia?.mediaBase64) {
      setNonverbalVideoStatus(`Gemini 리포트에 카메라 영상 샘플 첨부됨 · ${Math.round(nonverbalMedia.size / 1024)}KB`);
    } else {
      setNonverbalVideoStatus(`Gemini 리포트용 영상 샘플 없음 · ${state.nonverbalVideoIssue || "로컬 신호 요약 사용"}`);
    }
    const data = await callGemini("report", {
      profile: getProfile(),
      answers: state.answers,
      messages: state.messages,
      localAnalysis: analysis,
      mediaBase64: nonverbalMedia?.mediaBase64,
      mediaMimeType: nonverbalMedia?.mediaMimeType,
    });
    const report = normalizeReport(data);
    renderReport(analysis, report);
  } catch (error) {
    const message = getReadableError(error);
    setConnection("AI 리포트 실패", "red");
    showApiNotice(message, generateReport);
  } finally {
    state.reportGenerating = false;
    elements.reportButton.textContent = "리포트 생성";
    elements.reportButton.disabled = false;
    persistSession();
  }
}

function buildReportPlainText(data) {
  const lines = [];
  lines.push(`PITA 종합 리포트 — ${data.session.main}`);
  if (data.session.sub) lines.push(data.session.sub);
  lines.push("");
  lines.push(`종합 점수: ${data.summary.overall}점`);
  if (data.summary.meta.length) lines.push(data.summary.meta.join(" · "));
  lines.push(data.summary.headline);
  lines.push("");
  if (data.summary.strengths.length) {
    lines.push("[잘한 점]");
    data.summary.strengths.forEach((text) => lines.push(`- ${text}`));
    lines.push("");
  }
  if (data.summary.improvements.length) {
    lines.push("[아쉬운 점]");
    data.summary.improvements.forEach((text) => lines.push(`- ${text}`));
    lines.push("");
  }
  lines.push("[내용 분석]");
  data.content.metrics.forEach((m) => lines.push(`- ${m.label}: ${m.score}점 — ${m.desc}`));
  lines.push("");
  if (data.questions.length) {
    lines.push("[질문별 상세]");
    data.questions.forEach((q) => {
      lines.push(`${q.tag} - ${q.question}`);
      lines.push(`내 답변: ${q.answer}`);
      lines.push("");
    });
  }
  if (data.nonverbal) {
    lines.push("[비언어 분석]");
    data.nonverbal.forEach((m) => lines.push(`- ${m.label}: ${m.score}점 — ${m.desc}`));
  }
  return lines.join("\n");
}

function buildReportMarkdown(data) {
  const lines = [];
  lines.push("# PITA 종합 리포트");
  lines.push(`**${data.session.main}**${data.session.sub ? ` · ${data.session.sub}` : ""}`);
  lines.push("");
  lines.push("## 종합 피드백");
  lines.push(`**${data.summary.overall}점**${data.summary.meta.length ? ` — ${data.summary.meta.join(" · ")}` : ""}`);
  lines.push("");
  lines.push(data.summary.headline);
  lines.push("");
  if (data.summary.strengths.length) {
    lines.push("### 잘한 점");
    data.summary.strengths.forEach((text) => lines.push(`- ${text}`));
    lines.push("");
  }
  if (data.summary.improvements.length) {
    lines.push("### 아쉬운 점");
    data.summary.improvements.forEach((text) => lines.push(`- ${text}`));
    lines.push("");
  }
  lines.push("## 내용 분석");
  data.content.metrics.forEach((m) => lines.push(`- **${m.label}** ${m.score}점 — ${m.desc}`));
  lines.push("");
  if (data.questions.length) {
    lines.push("## 질문별 상세");
    data.questions.forEach((q) => {
      lines.push(`### ${q.tag}`);
      lines.push(q.question);
      lines.push("");
      lines.push(`> ${q.answer}`);
      lines.push("");
    });
  }
  if (data.nonverbal) {
    lines.push("## 비언어 분석");
    data.nonverbal.forEach((m) => lines.push(`- **${m.label}** ${m.score}점 — ${m.desc}`));
  }
  return lines.join("\n");
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportReport(format) {
  if (!state.lastReport) return;
  const data = buildInterviewReportSections(state.lastReport.analysis, state.lastReport.aiReport);
  const dateTag = new Date().toISOString().slice(0, 10);

  if (format === "pdf") {
    window.print();
    return;
  }
  if (format === "txt") {
    downloadTextFile(`pita-report-${dateTag}.txt`, buildReportPlainText(data), "text/plain;charset=utf-8");
    return;
  }
  if (format === "md") {
    downloadTextFile(`pita-report-${dateTag}.md`, buildReportMarkdown(data), "text/markdown;charset=utf-8");
    return;
  }
}

async function shareReportLink() {
  if (!state.lastReport) return;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const url = new URL(window.location.href);
  url.hash = `report=${id}`;
  const payload = {
    createdAt: new Date().toISOString(),
    report: state.lastReport,
    messages: state.messages,
    answers: state.answers,
    answerMeta: state.answerMeta,
    silenceEvents: state.silenceEvents,
  };

  try {
    localStorage.setItem(`${SHARED_REPORT_PREFIX}${id}`, JSON.stringify(payload));
    await navigator.clipboard?.writeText(url.toString());
    elements.apiNotice.hidden = false;
    elements.apiNoticeText.textContent = "공유 링크를 클립보드에 복사했습니다. 같은 브라우저에서 열면 리포트를 복원합니다.";
  } catch (error) {
    elements.apiNotice.hidden = false;
    elements.apiNoticeText.textContent = `공유 링크: ${url.toString()}`;
  }
}

function restoreSharedReport() {
  const match = window.location.hash.match(/report=([^&]+)/);
  if (!match) return false;

  try {
    const saved = JSON.parse(localStorage.getItem(`${SHARED_REPORT_PREFIX}${match[1]}`) || "null");
    if (!saved?.report) return false;
    state.messages = saved.messages || [];
    state.answers = saved.answers || [];
    state.answerMeta = saved.answerMeta || [];
    state.silenceEvents = saved.silenceEvents || [];
    state.lastReport = saved.report;
    renderMessages();
    renderReport(saved.report.analysis, saved.report.aiReport);
    setReportActionsEnabled(true);
    elements.apiNotice.hidden = false;
    elements.apiNoticeText.textContent = "공유 링크에서 리포트를 복원했습니다.";
    updateMetrics();
    return true;
  } catch (error) {
    return false;
  }
}

function resetSession() {
  const confirmed = window.confirm("현재 면접 대화와 리포트를 모두 초기화할까요?");
  if (!confirmed) return;

  stopTtsPlayback();
  stopCamera(true);
  clearSilenceTimer();
  if (state.recognition && state.isRecording) {
    state.recognition.stop();
  }
  stopListeningForAnswer();
  stopPracticeAnswerTimer();
  stopPracticeSessionTimer();
  state.practiceActive = false;
  state.practiceQueue = [];
  state.practiceCurrentItem = null;
  state.practiceCurrentQueueIndex = -1;
  state.started = false;
  state.busy = false;
  state.pendingVoiceText = "";
  state.questionStartedAt = null;
  state.currentAnswerStartedAt = null;
  state.answerMeta = [];
  state.silenceEvents = [];
  state.lastReport = null;
  state.activeReportTab = "language";
  elements.answerInput.value = "";
  elements.answerInput.disabled = true;
  elements.sendButton.disabled = true;
  elements.micButton.disabled = true;
  elements.liveTranscript.textContent = state.recognitionSupported
    ? "음성 인식 대기 중"
    : "이 브라우저는 음성 인식을 지원하지 않습니다.";
  elements.personaSummary.textContent = "설정을 완료하고 면접을 시작하세요.";
  clearReportDashboard();
  hideApiNotice();
  setReportActionsEnabled(false);
  setConnection("AI 대기", "blue");
  clearChat();
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

elements.resumeFile.addEventListener("change", (event) => {
  readResumeFile(event.target.files[0]);
});

elements.depthInput.addEventListener("input", () => {
  elements.depthOutput.textContent = elements.depthInput.value;
  persistSession();
});

[elements.companyInput, elements.roleInput, elements.talentInput, elements.personaInput].forEach((input) => {
  input.addEventListener("input", persistSession);
  input.addEventListener("change", persistSession);
});

elements.startButton.addEventListener("click", startInterview);
elements.cameraButton.addEventListener("click", startCamera);
elements.retryButton.addEventListener("click", () => {
  if (state.pendingRetry) state.pendingRetry();
});
const reportShareMenu = document.getElementById("reportShareMenu");
elements.shareReportButton.addEventListener("click", (event) => {
  if (elements.shareReportButton.disabled) return;
  event.stopPropagation();
  if (reportShareMenu) reportShareMenu.hidden = !reportShareMenu.hidden;
});
if (reportShareMenu) {
  reportShareMenu.querySelectorAll("[data-share-format]").forEach((option) => {
    option.addEventListener("click", () => {
      exportReport(option.dataset.shareFormat);
      reportShareMenu.hidden = true;
    });
  });
  document.addEventListener("click", (event) => {
    if (reportShareMenu.hidden) return;
    if (reportShareMenu.contains(event.target) || event.target === elements.shareReportButton) return;
    reportShareMenu.hidden = true;
  });
}

elements.micButton.addEventListener("click", () => {
  if (!state.recognition || state.busy) return;
  if (state.isRecording) {
    state.recognition.stop();
    return;
  }
  try {
    state.recognition.start();
  } catch (error) {
    elements.liveTranscript.textContent = "음성 인식을 다시 시작할 수 없습니다. 잠시 후 다시 눌러 주세요.";
  }
});

elements.answerInput.addEventListener("input", () => {
  if (elements.answerInput.value.trim()) {
    markAnswerStarted("text");
  }
});

elements.voiceToggle.addEventListener("click", () => {
  state.voiceEnabled = !state.voiceEnabled;
  elements.voiceToggle.textContent = state.voiceEnabled ? "음성 출력 ON" : "음성 출력 OFF";
  elements.voiceToggle.setAttribute("aria-pressed", String(state.voiceEnabled));
  if (!state.voiceEnabled) {
    stopTtsPlayback();
  }
  updateMetrics();
});

elements.answerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = elements.answerInput.value.trim();
  if (!text) return;
  elements.answerInput.value = "";
  if (state.practiceActive) {
    if (elements.practiceTranscriptText) elements.practiceTranscriptText.textContent = text;
    finalizePracticeAnswer();
  } else {
    handleAnswer(text);
  }
});

if (elements.practiceNextButton) {
  elements.practiceNextButton.addEventListener("click", () => {
    finalizePracticeAnswer();
  });
}

if (elements.practiceRetryButton) {
  elements.practiceRetryButton.addEventListener("click", () => {
    if (!state.practiceActive || !state.practiceCurrentItem) return;
    presentPracticeItem(state.practiceCurrentItem, state.practiceCurrentQueueIndex);
  });
}

if (elements.practiceEndButton) {
  elements.practiceEndButton.addEventListener("click", () => {
    if (!state.practiceActive) return;
    finishPracticeSession();
  });
}

elements.reportButton.addEventListener("click", generateReport);
elements.resetButton.addEventListener("click", resetSession);
window.addEventListener("beforeunload", () => {
  stopTtsPlayback();
  stopCamera(false);
});
window.addEventListener("afterprint", () => document.body.classList.remove("print-report"));

if (!restoreSharedReport()) {
  restoreSession();
}
setupSpeechRecognition();
renderNonverbalScores();
updateMetrics();

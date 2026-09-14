const interviewScreens = [...document.querySelectorAll("[data-screen]")];
const interviewTypeSelect = document.getElementById("interview-type");
const interviewSetupNext = document.getElementById("interview-setup-next");
const interviewBranchButtons = [...document.querySelectorAll("[data-interview-branch]")];
const interviewPersonaSelect = document.getElementById("personaInput");
const interviewReportButton = document.getElementById("reportButton");
const interviewResumeFile = document.getElementById("resumeFile");
const interviewUploadBox = document.getElementById("interview-upload-dropzone");
const interviewDropZone = document.getElementById("interview-drop-zone");
const interviewUploadTrigger = document.getElementById("interview-upload-trigger");
const interviewFileList = document.getElementById("interview-file-list");
const interviewJobNext = document.getElementById("interview-job-next");
const interviewTypeCards = [...document.querySelectorAll("[data-interview-type-value]")];
const depthInput = document.getElementById("depthInput");
const depthTrackFill = document.getElementById("depth-track-fill");
const depthTicks = [...document.querySelectorAll("[data-depth-value]")];

const MAX_FILES = 3;
let fileTransfer = new DataTransfer();
let interviewBranch = "questions";

const TOPBAR_STEP_MAP = {
  "interview-upload": 1,
  "interview-job": 1,
  "interview-setup": 2,
  "interview-ready": 3,
  "questions-loading": 3,
  "questions-report": 3,
  "interview-practice": 4,
  "interview-loading": 5,
  "interview-report": 5,
};

function updateTopbarSteps(name) {
  const currentStep = TOPBAR_STEP_MAP[name];
  if (!currentStep) return;
  document.querySelectorAll(".app-topbar-step").forEach((el) => {
    const step = Number(el.dataset.topbarStep);
    el.classList.toggle("is-done", step < currentStep);
    el.classList.toggle("is-current", step === currentStep);
  });
  document.querySelectorAll(".app-topbar-sep").forEach((el) => {
    const sep = Number(el.dataset.topbarSep);
    el.classList.toggle("is-done", sep < currentStep);
  });
}

function showInterviewScreen(name) {
  interviewScreens.forEach((screen) => {
    screen.classList.toggle("is-active", screen.dataset.screen === name);
  });

  updateTopbarSteps(name);
  document.body.classList.toggle("report-dashboard-active", name === "interview-report");

  if (name === "interview-ready") {
    renderInterviewReadySummary();
  }

  window.scrollTo({ top: 0, behavior: "instant" });
}

updateTopbarSteps("interview-upload");

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showInterviewScreen(button.dataset.go));
});

function renderInterviewFiles() {
  const count = fileTransfer.files.length;
  const hasFiles = count > 0;

  interviewUploadBox.hidden = hasFiles;
  interviewFileList.hidden = !hasFiles;

  const rowsContainer = document.getElementById("interview-file-rows");
  const addLabel = document.getElementById("interview-file-add");

  rowsContainer.innerHTML = Array.from(fileTransfer.files)
    .map(
      (file, i) => `
      <div class="uploaded-file-row">
        <span>
          <img src="./assets/images/icon-article.svg" alt="" />
          <span>${escapeFlowHtml(file.name)}</span>
        </span>
        <button type="button" data-remove-index="${i}" aria-label="첨부 파일 삭제">
          <img src="./assets/images/icon-folder.svg" alt="" />
        </button>
      </div>
    `,
    )
    .join("");

  if (addLabel) addLabel.hidden = count >= MAX_FILES;

  rowsContainer.querySelectorAll("[data-remove-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeIndex);
      const newTransfer = new DataTransfer();
      Array.from(fileTransfer.files).forEach((f, i) => {
        if (i !== idx) newTransfer.items.add(f);
      });
      fileTransfer = newTransfer;
      interviewResumeFile.files = fileTransfer.files;
      renderInterviewFiles();
    });
  });

  renderInterviewJobFilePreview();
}

function renderInterviewJobFilePreview() {
  const preview = document.getElementById("interview-job-file-preview");
  const rows = document.getElementById("interview-job-file-rows");
  if (!preview || !rows) return;

  const hasFiles = fileTransfer.files.length > 0;
  preview.hidden = !hasFiles;

  rows.innerHTML = Array.from(fileTransfer.files)
    .map(
      (file) => `
      <div class="uploaded-file-row">
        <span>
          <img src="./assets/images/icon-article.svg" alt="" />
          <span>${escapeFlowHtml(file.name)}</span>
        </span>
        <button type="button" tabindex="-1" aria-hidden="true">
          <img src="./assets/images/icon-folder.svg" alt="" />
        </button>
      </div>
    `,
    )
    .join("");
}

function addInterviewFiles(files) {
  Array.from(files).forEach((file) => {
    if (fileTransfer.files.length < MAX_FILES) {
      fileTransfer.items.add(file);
    }
  });
  interviewResumeFile.files = fileTransfer.files;
  renderInterviewFiles();
}

interviewResumeFile.addEventListener("change", () => {
  addInterviewFiles(interviewResumeFile.files);
});

interviewUploadTrigger.addEventListener("click", () => interviewResumeFile.click());
interviewDropZone.addEventListener("click", () => interviewResumeFile.click());

["dragenter", "dragover"].forEach((eventName) => {
  interviewDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    interviewDropZone.classList.add("is-dragover");
  });
});

["dragleave", "dragend"].forEach((eventName) => {
  interviewDropZone.addEventListener(eventName, () => {
    interviewDropZone.classList.remove("is-dragover");
  });
});

interviewDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  interviewDropZone.classList.remove("is-dragover");
  if (event.dataTransfer?.files?.length) {
    addInterviewFiles(event.dataTransfer.files);
  }
});

renderInterviewFiles();

function updateInterviewJobNext() {
  const company = document.getElementById("companyInput")?.value.trim();
  const role = document.getElementById("roleInput")?.value.trim();
  if (interviewJobNext) interviewJobNext.disabled = !(company && role);
}

function createAutocompleteField({ root, categoryIconSrc, search, onChange }) {
  const input = root.querySelector(".autocomplete-input");
  const wrap = root.querySelector(".autocomplete-input-wrap");
  const dropdown = root.querySelector(".autocomplete-dropdown");
  const leftSearch = root.querySelector(".ac-icon-left-search");
  const leftCategory = root.querySelector(".ac-icon-left-category");
  const clearBtn = root.querySelector(".ac-clear");
  const rightSearch = root.querySelector(".ac-icon-right-search");
  const chipRow = root.querySelector(".chip-row");

  leftCategory.src = categoryIconSrc;

  let activeIndex = -1;
  let currentResults = [];
  let debounceTimer = null;

  function renderState() {
    const typing = document.activeElement === input;
    const hasValue = input.value.trim().length > 0;

    leftSearch.hidden = !typing;
    leftCategory.hidden = !(hasValue && !typing);
    clearBtn.hidden = !typing;
    rightSearch.hidden = typing;
    wrap.classList.toggle("is-typing", typing);
    wrap.classList.toggle("has-left-icon", typing || hasValue);
    if (chipRow) chipRow.hidden = typing || hasValue;
  }

  function closeDropdown() {
    dropdown.hidden = true;
    dropdown.innerHTML = "";
    activeIndex = -1;
    currentResults = [];
  }

  function highlightMatch(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeFlowHtml(text);
    return (
      escapeFlowHtml(text.slice(0, idx)) +
      "<mark>" + escapeFlowHtml(text.slice(idx, idx + query.length)) + "</mark>" +
      escapeFlowHtml(text.slice(idx + query.length))
    );
  }

  function updateActiveItem() {
    dropdown.querySelectorAll("li").forEach((li, i) => {
      li.classList.toggle("is-active", i === activeIndex);
    });
  }

  function renderDropdown(results, query) {
    currentResults = results;
    activeIndex = results.length ? 0 : -1;
    if (!results.length) {
      closeDropdown();
      return;
    }
    dropdown.innerHTML = results
      .map((item, i) => `<li data-index="${i}" class="${i === 0 ? "is-active" : ""}">${highlightMatch(item, query)}</li>`)
      .join("");
    dropdown.hidden = false;
    dropdown.querySelectorAll("li").forEach((li) => {
      li.addEventListener("mousedown", (event) => {
        event.preventDefault();
        commit(results[Number(li.dataset.index)]);
      });
    });
  }

  function commit(value) {
    input.value = value;
    closeDropdown();
    input.blur();
    renderState();
    onChange(value);
  }

  input.addEventListener("input", () => {
    onChange(input.value.trim());
    renderState();
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (!query) {
      closeDropdown();
      return;
    }
    debounceTimer = setTimeout(async () => {
      const results = await search(query);
      renderDropdown(results, query);
    }, 120);
  });

  input.addEventListener("focus", renderState);
  input.addEventListener("blur", () => {
    setTimeout(() => {
      closeDropdown();
      renderState();
    }, 120);
  });

  input.addEventListener("keydown", (event) => {
    if (dropdown.hidden) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentResults.length - 1);
      updateActiveItem();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveItem();
    } else if (event.key === "Enter") {
      if (activeIndex >= 0) {
        event.preventDefault();
        commit(currentResults[activeIndex]);
      }
    } else if (event.key === "Escape") {
      closeDropdown();
    }
  });

  clearBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    input.value = "";
    closeDropdown();
    onChange("");
    input.focus();
    renderState();
  });

  root.querySelectorAll("[data-chip-value]").forEach((chip) => {
    chip.addEventListener("click", () => commit(chip.dataset.chipValue));
  });

  renderState();
}

createAutocompleteField({
  root: document.querySelector('.autocomplete-field[data-field="company"]'),
  categoryIconSrc: "./assets/images/icon-location-city.svg",
  search: (query) => window.PitaSearch.companies(query),
  onChange: updateInterviewJobNext,
});

createAutocompleteField({
  root: document.querySelector('.autocomplete-field[data-field="role"]'),
  categoryIconSrc: "./assets/images/icon-business-center.svg",
  search: (query) => window.PitaSearch.roles(query),
  onChange: updateInterviewJobNext,
});

updateInterviewJobNext();

interviewTypeSelect.addEventListener("change", () => {
  interviewSetupNext.disabled = !interviewTypeSelect.value;
  persistSession();
});

function syncInterviewTypeCards() {
  const value = interviewTypeSelect.value;
  interviewTypeCards.forEach((card) => {
    const selected = card.dataset.interviewTypeValue === value;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
}

interviewTypeCards.forEach((card) => {
  card.addEventListener("click", () => {
    interviewTypeSelect.value = card.dataset.interviewTypeValue;
    syncInterviewTypeCards();
    interviewTypeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
});

syncInterviewTypeCards();

function syncDepthTicks() {
  const value = Number(depthInput.value);
  depthTicks.forEach((tick) => {
    const tickValue = Number(tick.dataset.depthValue);
    tick.classList.toggle("is-active", tickValue === value);
    tick.classList.toggle("is-passed", tickValue < value);
  });
  if (depthTrackFill) depthTrackFill.style.width = `${((value - 1) / 4) * 100}%`;
}

depthTicks.forEach((tick) => {
  tick.addEventListener("click", () => {
    depthInput.value = tick.dataset.depthValue;
    syncDepthTicks();
    depthInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
});

syncDepthTicks();

interviewBranchButtons.forEach((button) => {
  button.addEventListener("click", () => {
    interviewBranch = button.dataset.interviewBranch;
    interviewBranchButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
  });
});

const DEPTH_LABELS = { 1: "편안하게", 2: "가볍게", 3: "실전처럼", 4: "깐깐하게", 5: "압박감 있게" };

function renderInterviewReadySummary() {
  const profile = getProfile();
  const depthValue = Number(depthInput.value);
  document.getElementById("ready-summary-company").textContent = profile.company;
  document.getElementById("ready-summary-role").textContent = profile.role;
  document.getElementById("ready-summary-type").textContent = profile.interviewType;
  document.getElementById("ready-summary-depth").textContent =
    `${depthValue}단계 ${DEPTH_LABELS[depthValue] || ""}`;
}

interviewSetupNext.addEventListener("click", async () => {
  if (!interviewTypeSelect.value) return;

  showInterviewScreen("questions-loading");
  await loadExpectedQuestions();
  showInterviewScreen(interviewBranch === "practice" ? "interview-ready" : "questions-report");
});

const QUESTIONS_LOADING_TOTAL_STEPS = 4;
const QUESTIONS_LOADING_MIN_DURATION_MS = 3200;
let questionsLoadingTimer = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setQuestionsLoadingStep(step) {
  document.querySelectorAll('[data-screen="questions-loading"] .loading-checklist-step').forEach((el) => {
    const stepNumber = Number(el.dataset.step);
    const isDone = stepNumber < step;
    const isCurrent = stepNumber === step;
    el.classList.toggle("is-done", isDone);
    el.classList.toggle("is-current", isCurrent);
    const status = el.querySelector(".loading-checklist-status");
    if (status) status.textContent = isDone ? "완료" : isCurrent ? "진행 중" : "대기";
  });
  const fill = document.getElementById("questions-loading-rail-fill");
  if (fill) {
    const progress = ((step - 1) / (QUESTIONS_LOADING_TOTAL_STEPS - 1)) * 100;
    fill.style.width = `${Math.min(Math.max(progress, 0), 100)}%`;
  }
}

function startQuestionsLoadingSteps() {
  clearInterval(questionsLoadingTimer);
  let step = 1;
  setQuestionsLoadingStep(step);
  questionsLoadingTimer = setInterval(() => {
    if (step >= QUESTIONS_LOADING_TOTAL_STEPS - 1) {
      clearInterval(questionsLoadingTimer);
      return;
    }
    step += 1;
    setQuestionsLoadingStep(step);
  }, 900);
}

function stopQuestionsLoadingSteps() {
  clearInterval(questionsLoadingTimer);
  questionsLoadingTimer = null;
}

async function loadExpectedQuestions() {
  startQuestionsLoadingSteps();
  const minDuration = wait(QUESTIONS_LOADING_MIN_DURATION_MS);

  try {
    const response = await fetch("/.netlify/functions/gemini-interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "questions",
        profile: getProfile(),
        interviewType: interviewTypeSelect.selectedOptions[0]?.textContent || "",
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "예상 질문 생성에 실패했습니다.");
    const questions = Array.isArray(data.questions) ? data.questions : [];
    renderExpectedQuestions(questions.length ? questions : fallbackExpectedQuestions());
  } catch (error) {
    renderExpectedQuestions(fallbackExpectedQuestions());
  }

  await minDuration;
  stopQuestionsLoadingSteps();
  setQuestionsLoadingStep(QUESTIONS_LOADING_TOTAL_STEPS);
}

function renderExpectedQuestions(questions) {
  const grouped = questions.reduce((result, item) => {
    const category = item.category || "직무 경험 (적합성)";
    if (!result[category]) result[category] = [];
    result[category].push(item);
    return result;
  }, {});
  const categories = Object.entries(grouped);
  const profile = getProfile();

  state.expectedQuestions = questions;
  persistSession();

  document.getElementById("questions-report-title").textContent = `예상 질문을 ${questions.length}개 준비했어요`;
  document.getElementById("questions-report-subtitle").textContent =
    `${profile.company} | ${profile.role} | ${profile.interviewType}`;

  document.getElementById("questions-report-chips").innerHTML = categories
    .map(
      ([category, items]) => `
        <div class="report-chip">
          <span>${escapeFlowHtml(category)}</span>
          <b>${items.length}</b>
        </div>
      `,
    )
    .join("");

  document.getElementById("expected-questions-content").innerHTML = categories
    .map(
      ([category, items], index) => `
        <div class="accordion-section${index === 0 ? " is-open" : ""}">
          <button type="button" class="accordion-header">
            <span class="accordion-title">
              <span>${escapeFlowHtml(category)}</span>
              <b>${items.length}</b>
            </span>
            <span class="accordion-chevron" aria-hidden="true">
              <svg width="14" height="8" viewBox="0 0 14 8"><path d="M7 0L14 8H0Z" fill="currentColor" /></svg>
            </span>
          </button>
          <div class="accordion-body">
            ${items
              .map(
                (item, itemIndex) => `
                  <div class="question-card">
                    <strong>Q${itemIndex + 1}. ${escapeFlowHtml(item.question || String(item))}</strong>
                    ${
                      item.intent
                        ? `<div class="question-intent"><span class="question-intent-bar"></span><p>${escapeFlowHtml(item.intent)}</p></div>`
                        : ""
                    }
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
      `,
    )
    .join("");

  document.querySelectorAll('[data-screen="questions-report"] .accordion-header').forEach((header) => {
    header.addEventListener("click", () => {
      header.closest(".accordion-section").classList.toggle("is-open");
    });
  });
}

function fallbackExpectedQuestions() {
  const role = document.getElementById("roleInput").value.trim() || "지원 직무";
  return [
    {
      category: "직무 경험 (적합성)",
      question: `${role} 직무와 가장 밀접한 경험에서 본인이 직접 맡은 역할을 설명해주세요.`,
      intent: "직무 연관성과 실제 기여 범위를 확인합니다.",
    },
    {
      category: "직무 경험 (적합성)",
      question: "그 경험의 결과를 수치나 구체적인 변화로 설명해주세요.",
      intent: "성과를 객관적인 근거로 설명하는 능력을 확인합니다.",
    },
    {
      category: "위기 및 갈등 관리",
      question: "팀 내 의견 충돌을 해결했던 경험과 본인의 판단 기준을 말씀해주세요.",
      intent: "협업 방식과 갈등 해결 역량을 확인합니다.",
    },
    {
      category: "위기 및 갈등 관리",
      question: "실패했던 경험에서 다시 같은 상황이 온다면 무엇을 다르게 하시겠습니까?",
      intent: "회고 능력과 재발 방지 사고를 확인합니다.",
    },
  ];
}

function escapeFlowHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setInterviewReportPersona() {
  const personaLabel = document.getElementById("interview-report-persona");
  if (personaLabel) {
    personaLabel.textContent = interviewPersonaSelect.selectedOptions[0]?.textContent || "가상 면접관";
  }
}

interviewReportButton.addEventListener("click", () => {
  if (interviewReportButton.disabled) return;
  setInterviewReportPersona();
  showInterviewScreen("interview-loading");
}, { capture: true });

const interviewReportObserver = new MutationObserver(() => {
  const loading = document
    .querySelector('[data-screen="interview-loading"]')
    .classList.contains("is-active");
  if (loading && state.lastReport && !state.reportGenerating) {
    setInterviewReportPersona();
    showInterviewScreen("interview-report");
  }
});

interviewReportObserver.observe(interviewReportButton, {
  attributes: true,
  childList: true,
  subtree: true,
});

document.getElementById("interview-restart").addEventListener("click", () => {
  fileTransfer = new DataTransfer();
  interviewResumeFile.files = fileTransfer.files;
  renderInterviewFiles();
  document.getElementById("resetButton").click();
  showInterviewScreen("interview-upload");
});

if (interviewTypeSelect.value) {
  interviewSetupNext.disabled = false;
}

if (state.lastReport) {
  showInterviewScreen("interview-report");
} else if (state.started) {
  showInterviewScreen("interview-practice");
}

const ALL_AGENTS = "全部";
const API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "/api"
  : "/.netlify/functions/dashboard";

const state = {
  data: null,
  selectedAgent: ALL_AGENTS,
  search: "",
  expandedAgents: new Set()
};

const els = {
  subtitle: document.querySelector("#subtitle"),
  refreshButton: document.querySelector("#refreshButton"),
  fileSelect: document.querySelector("#fileSelect"),
  monthInput: document.querySelector("#monthInput"),
  agentFilter: document.querySelector("#agentFilter"),
  anchorSearch: document.querySelector("#anchorSearch"),
  uploadForm: document.querySelector("#uploadForm"),
  uploadStatus: document.querySelector("#uploadStatus"),
  errorPanel: document.querySelector("#errorPanel"),
  targetAmount: document.querySelector("#targetAmount"),
  completedAmount: document.querySelector("#completedAmount"),
  completionRate: document.querySelector("#completionRate"),
  remainingAmount: document.querySelector("#remainingAmount"),
  requiredDailyAmount: document.querySelector("#requiredDailyAmount"),
  anchorCount: document.querySelector("#anchorCount"),
  agentRows: document.querySelector("#agentRows"),
  agentAnchorGroups: document.querySelector("#agentAnchorGroups"),
  agentHint: document.querySelector("#agentHint"),
  anchorHint: document.querySelector("#anchorHint"),
  anchorDetailModal: document.querySelector("#anchorDetailModal"),
  anchorDetailTitle: document.querySelector("#anchorDetailTitle"),
  anchorDetailSubtitle: document.querySelector("#anchorDetailSubtitle"),
  anchorDetailBody: document.querySelector("#anchorDetailBody")
};

function formatNumber(value) {
  return Math.round(Number(value || 0)).toLocaleString("zh-CN");
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatFileOutputTime(file) {
  const name = String(file?.name || "");
  const match = name.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2})_(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
  }

  return file?.date || "-";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function riskClass(risk) {
  return ["低于时间进度", "有目标无日报", "无有效天", "无开播记录", "超过2天未开播"].includes(risk)
    ? "risk high"
    : "risk";
}

function renderRisks(risks) {
  if (!risks || risks.length === 0) {
    return '<span class="pill">正常</span>';
  }

  return risks.map((risk) => `<span class="${riskClass(risk)}">${escapeHtml(risk)}</span>`).join("");
}

function setError(message) {
  if (!message) {
    els.errorPanel.classList.add("hidden");
    els.errorPanel.textContent = "";
    return;
  }

  els.errorPanel.classList.remove("hidden");
  els.errorPanel.textContent = message;
}

function option(value, text, selected) {
  return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(text)}</option>`;
}

async function loadData() {
  setError("");
  els.subtitle.textContent = "读取数据中...";

  const params = new URLSearchParams();
  if (els.fileSelect.value) {
    params.set("file", els.fileSelect.value);
  }
  if (els.monthInput.value) {
    params.set("month", els.monthInput.value);
  }

  params.set("action", "data");
  const response = await fetch(`${API_BASE}?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "读取数据失败");
  }

  state.data = payload;
  if (!els.monthInput.value) {
    els.monthInput.value = payload.month;
  }
  render();
}

async function uploadFiles(event) {
  event.preventDefault();
  setError("");
  els.uploadStatus.textContent = "上传中...";

  const formData = new FormData(els.uploadForm);
  formData.set("action", "upload");
  const response = await fetch(`${API_BASE}?action=upload`, {
    method: "POST",
    body: formData
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "上传失败");
  }

  els.uploadStatus.textContent = payload.message || "上传成功";
  els.uploadForm.reset();
  els.monthInput.value = "";
  state.expandedAgents.clear();
  await loadData();
}

function renderFileSelect() {
  const selectedId = state.data.selectedFile.id;
  els.fileSelect.innerHTML = state.data.files
    .map((file) => option(file.id, `${file.date}  ${file.name}`, file.id === selectedId))
    .join("");
}

function renderAgentFilter() {
  const agents = state.data.agents.map((agent) => agent.agent);
  const current = agents.includes(state.selectedAgent) ? state.selectedAgent : ALL_AGENTS;
  state.selectedAgent = current;
  els.agentFilter.innerHTML = [
    option(ALL_AGENTS, "全部经纪人", current === ALL_AGENTS),
    ...agents.map((agent) => option(agent, agent, agent === current))
  ].join("");
}

function renderSummary() {
  const summary = state.data.summary;
  els.targetAmount.textContent = formatNumber(summary.targetAmount);
  els.completedAmount.textContent = formatNumber(summary.completedAmount);
  els.completionRate.textContent = formatPercent(summary.completionRate);
  els.remainingAmount.textContent = formatNumber(summary.remainingAmount);
  els.requiredDailyAmount.textContent = formatNumber(summary.requiredDailyAmount);
  els.anchorCount.textContent = `${formatNumber(summary.activeAnchorCount)} / ${formatNumber(summary.anchorCount)}`;
  els.subtitle.textContent = `已更新至 ${formatFileOutputTime(state.data.selectedFile)} | 本月时间进度 ${formatPercent(summary.timeProgress)}`;
}

function renderAgents() {
  els.agentHint.textContent = `共 ${state.data.agents.length} 个经纪人，点击某一行可筛选主播明细。`;
  els.agentRows.innerHTML = state.data.agents
    .map((agent) => {
      const width = Math.min(Math.max(agent.completionRate * 100, 0), 100);
      return `
        <tr data-agent="${escapeHtml(agent.agent)}">
          <td><strong>${escapeHtml(agent.agent)}</strong></td>
          <td>${escapeHtml(agent.dailyAgentNames.join("、") || "-")}</td>
          <td class="num">${formatNumber(agent.targetAmount)}</td>
          <td class="num">${formatNumber(agent.completedAmount)}</td>
          <td class="num progress">
            ${formatPercent(agent.completionRate)}
            <div class="progress-bar"><span style="width:${width}%"></span></div>
          </td>
          <td class="num">${formatNumber(agent.remainingAmount)}</td>
          <td class="num">${formatNumber(agent.requiredDailyAmount)}</td>
          <td class="num">${formatNumber(agent.activeAnchorCount)} / ${formatNumber(agent.anchorCount)}</td>
        </tr>
      `;
    })
    .join("");
}

function matchesSearch(anchor) {
  const keyword = state.search.trim().toLowerCase();
  if (!keyword) {
    return true;
  }

  return [
    anchor.anchorName,
    anchor.douyinId,
    anchor.dailyAgent,
    anchor.taskAgent,
    anchor.tasks?.process?.status,
    anchor.tasks?.process?.currentLabel,
    anchor.tasks?.newAnchor?.status,
    anchor.tasks?.newAnchor?.currentLabel
  ].some((value) =>
    String(value || "").toLowerCase().includes(keyword)
  );
}

function getAnchorsByAgent(agentName) {
  return state.data.anchors
    .filter((anchor) => anchor.taskAgent === agentName)
    .filter(matchesSearch)
    .sort((left, right) => right.totalAmount - left.totalAmount);
}

function getVisibleAgents() {
  return state.data.agents
    .filter((agent) => state.selectedAgent === ALL_AGENTS || agent.agent === state.selectedAgent)
    .map((agent) => ({
      ...agent,
      anchors: getAnchorsByAgent(agent.agent)
    }))
    .filter((agent) => agent.anchors.length > 0 || !state.search.trim())
    .sort((left, right) => right.completedAmount - left.completedAmount);
}

function shouldExpandAgent(agentName) {
  return state.expandedAgents.has(agentName);
}

function renderAnchorTaskInfo(anchor) {
  const process = anchor.tasks?.process;
  const newAnchor = anchor.tasks?.newAnchor;
  const parts = [];

  if (process) {
    parts.push(`
      <span class="anchor-task-line ${process.focus ? "task-danger-text" : ""}">
        <b>过程</b>${escapeHtml(process.currentLabel || "-")} · 差${formatNumber(process.gapDays)}天/${formatTaskHours(process.gapHours)}小时
      </span>
    `);
  }

  if (newAnchor) {
    parts.push(`
      <span class="anchor-task-line ${newAnchor.focus ? "task-danger-text" : ""}">
        <b>拉新</b>${escapeHtml(newAnchor.status || "-")} · 差${formatNumber(newAnchor.gapDays)}天/${formatTaskHours(newAnchor.gapHours)}小时
      </span>
    `);
  }

  return parts.length ? parts.join("") : '<span class="muted">无任务</span>';
}

function renderAnchorScanfaceInfo(anchor) {
  const taskItems = [anchor.tasks?.process, anchor.tasks?.newAnchor].filter((task) => task?.scanface);
  if (!taskItems.length) {
    return '<span class="muted">-</span>';
  }

  return taskItems
    .map((task) => {
      const scanface = task.scanface;
      return `
        <span class="${scanface.incomplete ? "task-danger-text" : ""}">
          ${escapeHtml(task.taskType)} ${formatNumber(scanface.issued)}/${formatNumber(scanface.passed)}
        </span>
      `;
    })
    .join("");
}

function renderTrackingReasons(anchor) {
  const reasons = anchor.trackingReasons || [];
  if (!reasons.length) {
    return '<span class="muted">-</span>';
  }

  return reasons
    .map(
      (reason) => `
        <span class="tracking-reason">
          <b>${escapeHtml(reason.label)}</b>
          <span>${escapeHtml(reason.detail || "")}</span>
        </span>
      `
    )
    .join("");
}

function renderFieldGrid(fields) {
  const visibleFields = fields.filter(([, value]) => String(value ?? "").trim() !== "");
  if (!visibleFields.length) {
    return '<div class="empty compact">暂无数据</div>';
  }

  return `
    <div class="detail-grid">
      ${visibleFields
        .map(
          ([label, value]) => `
            <div class="detail-field">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRawDetail(detail) {
  return renderFieldGrid(Object.entries(detail || {}));
}

function renderTaskDetail(title, task) {
  if (!task) {
    return `
      <section class="detail-section">
        <h3>${escapeHtml(title)}</h3>
        <div class="empty compact">没有匹配到该任务</div>
      </section>
    `;
  }

  const summaryFields = [
    ["任务状态", task.status],
    ["当前档位/周期", task.currentLabel],
    ["目标", task.targetLabel],
    ["有效天", task.days],
    ["有效小时", formatTaskHours(task.hours)],
    ["差距", `${formatNumber(task.gapDays)}天 / ${formatTaskHours(task.gapHours)}小时`],
    ["开始时间", task.startDate],
    ["周期开始", task.cycleStartDate],
    ["周期结束", task.cycleEndDate],
    ["当前第几天", task.currentDay],
    ["剩余天数", task.remainingDays],
    ["剩余每日需播", task.dailyNeededHours == null ? "" : `${formatTaskHours(task.dailyNeededHours)}小时`]
  ];

  const scanface = task.scanface || {};
  const scanfaceFields = [
    ["弹窗下发次数", scanface.issued],
    ["扫脸通过次数", scanface.passed],
    ["扫脸差额", scanface.gap],
    ["是否未拉满", scanface.incomplete ? "是" : "否"]
  ];

  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      ${renderFieldGrid(summaryFields)}
      <h4>扫脸情况</h4>
      ${renderFieldGrid(scanfaceFields)}
      <h4>全部任务字段</h4>
      ${renderRawDetail(task.detail)}
    </section>
  `;
}

function findAnchorByDouyinId(douyinId) {
  const key = String(douyinId || "").trim().toLowerCase();
  return state.data?.anchors.find((anchor) => String(anchor.douyinId || "").trim().toLowerCase() === key);
}

function openAnchorDetail(anchor) {
  els.anchorDetailTitle.textContent = anchor.anchorName || "主播详情";
  els.anchorDetailSubtitle.textContent = `${anchor.douyinId || "-"} | ${anchor.taskAgent || "-"} | ${anchor.dailyAgent || "-"}`;
  els.anchorDetailBody.innerHTML = `
    <section class="detail-section">
      <h3>基础信息</h3>
      ${renderFieldGrid([
        ["主播昵称", anchor.anchorName],
        ["抖音号", anchor.douyinId],
        ["主播ID", anchor.anchorId],
        ["经纪人", anchor.taskAgent],
        ["日报经纪人", anchor.dailyAgent],
        ["本月流水", formatNumber(anchor.totalAmount)],
        ["语音有效天", formatNumber(anchor.effectiveDays)],
        ["直播有效总时长", anchor.liveDuration],
        ["首播时间", anchor.firstLiveAt],
        ["上次开播时间", anchor.lastLiveText],
        ["需要追踪", (anchor.trackingReasons || []).map((reason) => `${reason.label}: ${reason.detail}`).join("；")]
      ])}
    </section>
    ${renderTaskDetail("过程任务详情", anchor.tasks?.process)}
    ${renderTaskDetail("拉新周期任务详情", anchor.tasks?.newAnchor)}
    <section class="detail-section">
      <h3>日报全部字段</h3>
      ${renderRawDetail(anchor.dailyDetail)}
    </section>
  `;
  els.anchorDetailModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeAnchorDetail() {
  els.anchorDetailModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function renderAnchorItem(anchor) {
  return `
    <button class="anchor-item ${(anchor.trackingReasons || []).length ? "anchor-needs-tracking" : ""}" type="button" data-anchor-id="${escapeHtml(anchor.douyinId || "")}">
      <span class="anchor-main">
        <strong>${escapeHtml(anchor.anchorName || "-")}</strong>
        <span>${escapeHtml(anchor.douyinId || "-")}</span>
      </span>
      <span class="anchor-stat">
        <span>流水</span>
        <strong>${formatNumber(anchor.totalAmount)}</strong>
      </span>
      <span class="anchor-stat">
        <span>语音有效天</span>
        <strong>${formatNumber(anchor.effectiveDays)}</strong>
      </span>
      <span class="anchor-stat">
        <span>首播时间</span>
        <strong>${escapeHtml(anchor.firstLiveAt || "-")}</strong>
      </span>
      <span class="anchor-stat anchor-wide">
        <span>直播有效总时长</span>
        <strong>${escapeHtml(anchor.liveDuration || "-")}</strong>
      </span>
      <span class="anchor-stat anchor-last-live ${anchor.lastLiveOverdue ? "danger-text" : ""}">
        <span>上次开播时间</span>
        <strong>${escapeHtml(anchor.lastLiveText || "-")}</strong>
      </span>
      <span class="anchor-stat anchor-task">
        <span>任务进度</span>
        <strong>${renderAnchorTaskInfo(anchor)}</strong>
      </span>
      <span class="anchor-stat anchor-scanface ${anchor.scanfaceIncomplete ? "task-danger-text" : ""}">
        <span>扫脸</span>
        <strong>${renderAnchorScanfaceInfo(anchor)}</strong>
      </span>
      <span class="anchor-stat anchor-tracking">
        <span>需要追踪</span>
        <strong>${renderTrackingReasons(anchor)}</strong>
      </span>
    </button>
  `;
}

function renderAgentAnchorGroups() {
  const agents = getVisibleAgents();
  const anchorTotal = agents.reduce((total, agent) => total + agent.anchors.length, 0);
  els.anchorHint.textContent = `当前显示 ${agents.length} 个经纪人专栏、${anchorTotal} 条主播记录。`;

  if (agents.length === 0) {
    els.agentAnchorGroups.innerHTML = '<div class="empty">没有匹配的主播</div>';
    return;
  }

  els.agentAnchorGroups.innerHTML = agents
    .map((agent) => {
      const expanded = shouldExpandAgent(agent.agent);
      const overdueCount = agent.anchors.filter((anchor) => anchor.lastLiveOverdue).length;
      const taskCount = agent.anchors.filter((anchor) => anchor.tasks?.process || anchor.tasks?.newAnchor).length;
      const trackingCount = agent.anchors.filter((anchor) => (anchor.trackingReasons || []).length > 0).length;
      return `
        <article class="agent-card ${expanded ? "expanded" : ""}" data-agent-card="${escapeHtml(agent.agent)}">
          <button class="agent-card-header" type="button" data-agent-toggle="${escapeHtml(agent.agent)}">
            <span>
              <strong>${escapeHtml(agent.agent)}</strong>
              <small>${escapeHtml(agent.dailyAgentNames.join("、") || "-")}</small>
            </span>
            <span class="agent-card-metrics">
              <span>完成 ${formatNumber(agent.completedAmount)}</span>
              <span>主播 ${formatNumber(agent.activeAnchorCount)} / ${formatNumber(agent.anchorCount)}</span>
              <span>任务 ${formatNumber(taskCount)}</span>
              ${trackingCount > 0 ? `<span class="overdue-pill">需要追踪 ${formatNumber(trackingCount)}</span>` : ""}
              ${overdueCount > 0 ? `<span class="overdue-pill">${overdueCount} 个超时</span>` : '<span class="pill">开播正常</span>'}
              <span class="toggle-mark">${expanded ? "收起" : "展开"}</span>
            </span>
          </button>
          <div class="anchor-list ${expanded ? "" : "hidden"}">
            ${agent.anchors.map(renderAnchorItem).join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function formatTaskHours(value) {
  const number = Number(value || 0);
  return number % 1 === 0 ? String(number) : number.toFixed(1);
}

function render() {
  renderFileSelect();
  renderAgentFilter();
  renderSummary();
  renderAgents();
  renderAgentAnchorGroups();
}

els.refreshButton.addEventListener("click", () => {
  loadData().catch((error) => setError(error.message));
});

els.fileSelect.addEventListener("change", () => {
  els.monthInput.value = "";
  state.expandedAgents.clear();
  loadData().catch((error) => setError(error.message));
});

els.monthInput.addEventListener("change", () => {
  state.expandedAgents.clear();
  loadData().catch((error) => setError(error.message));
});

els.agentFilter.addEventListener("change", () => {
  state.selectedAgent = els.agentFilter.value;
  if (state.selectedAgent !== ALL_AGENTS) {
    state.expandedAgents.add(state.selectedAgent);
  }
  renderAgentAnchorGroups();
});

els.anchorSearch.addEventListener("input", () => {
  state.search = els.anchorSearch.value;
  if (state.search.trim()) {
    for (const agent of getVisibleAgents()) {
      state.expandedAgents.add(agent.agent);
    }
  }
  renderAgentAnchorGroups();
});

els.uploadForm.addEventListener("submit", (event) => {
  uploadFiles(event).catch((error) => {
    els.uploadStatus.textContent = "";
    setError(error.message);
  });
});

els.agentRows.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-agent]");
  if (!row) {
    return;
  }

  state.selectedAgent = row.dataset.agent;
  state.expandedAgents.add(state.selectedAgent);
  renderAgentFilter();
  renderAgentAnchorGroups();
});

els.agentAnchorGroups.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-agent-toggle]");
  if (toggle) {
    const agent = toggle.dataset.agentToggle;
    if (state.expandedAgents.has(agent)) {
      state.expandedAgents.delete(agent);
    } else {
      state.expandedAgents.add(agent);
    }
    renderAgentAnchorGroups();
    return;
  }

  const anchorButton = event.target.closest("[data-anchor-id]");
  if (anchorButton) {
    const anchor = findAnchorByDouyinId(anchorButton.dataset.anchorId);
    if (anchor) {
      openAnchorDetail(anchor);
    }
  }
});

els.anchorDetailModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-detail-close]")) {
    closeAnchorDetail();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.anchorDetailModal.classList.contains("hidden")) {
    closeAnchorDetail();
  }
});

loadData().catch((error) => {
  setError(error.message);
  els.subtitle.textContent = "数据读取失败";
});

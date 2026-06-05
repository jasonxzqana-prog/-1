const fs = require("fs");
const path = require("path");

const DAILY_FILE_PATTERN = /^主播概览列表_.*\.csv$/i;
const TASK_FILE = "月任务.csv";
const OWNER_FIELD = "运营经纪人";
const EXCLUDED_AGENT_NAMES = new Set(["念卿", "曹政", "经年", "金鑫"]);
const INVALID_ANCHOR_DAYS_THRESHOLD = 7;
const PROCESS_TASK_FILE_PATTERN = /过程全量主播任务_进行中.*\.csv$/;
const NEW_ANCHOR_TASK_FILE_PATTERN = /拉新任务_进行中.*\.csv$/;
const PROCESS_TIERS = [
  { label: "15天50小时", days: 15, hours: 50 },
  { label: "17天60小时", days: 17, hours: 60 },
  { label: "19天90小时", days: 19, hours: 90 },
  { label: "23天110小时", days: 23, hours: 110 }
];
const NEW_ANCHOR_TARGET = { label: "18天60小时", days: 18, hours: 60 };
const BUILT_IN_AGENT_ALIASES = [
  ["潘亚文", "潘潘"],
  ["陈柯欣", "木可可"],
  ["张筱雅", "阿雅"],
  ["戎蓉", "年糕"],
  ["张可", "可可"],
  ["滕梦涵", "滕梦涵"],
  ["顾琛", "十七"],
  ["徐雪", "徐雪"],
  ["杨睿", "杨睿"],
  ["曾雨欣", "曾雨欣"],
  ["张雨婷", "张雨婷"],
  ["张子静", "张子静"]
];

function stripBom(value) {
  return String(value || "").replace(/^\uFEFF/, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((cell) => String(cell).trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => String(cell).trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function readCsvObjects(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const text = fs.readFileSync(filePath, "utf8");
  return readCsvObjectsFromText(text);
}

function findNewestMatchingFile(rootDir, pattern) {
  const sourceDirs = [
    rootDir,
    path.join(rootDir, "tasks"),
    path.join(path.dirname(rootDir), "过程任务拉新任务")
  ];
  const matches = [];

  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    for (const name of fs.readdirSync(dir)) {
      if (!pattern.test(name)) {
        continue;
      }

      const filePath = path.join(dir, name);
      const stat = fs.statSync(filePath);
      matches.push({ filePath, name, timestamp: stat.mtime.getTime() });
    }
  }

  matches.sort((left, right) => right.timestamp - left.timestamp);
  return matches[0] || null;
}

function readNewestMatchingCsv(rootDir, pattern) {
  const match = findNewestMatchingFile(rootDir, pattern);
  return match ? readCsvObjects(match.filePath) : [];
}

function readCsvObjectsFromText(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((name) => stripBom(name).trim());
  return rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] == null ? "" : String(row[index]).trim();
    });
    return item;
  });
}

function parseNumber(value) {
  const normalized = String(value || "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();
  if (!normalized) {
    return 0;
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function isZeroDuration(value) {
  const text = String(value || "").trim();
  return !text || /^0小时0分钟0秒$/.test(text) || /^0+[:：]0+[:：]0+$/.test(text);
}

function pickLiveDuration(row) {
  const voiceDuration = row["语音开播时长"] || "";
  const totalDuration = row["开播总时长"] || "";
  return isZeroDuration(voiceDuration) && !isZeroDuration(totalDuration) ? totalDuration : voiceDuration || totalDuration;
}

function parseMonth(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const iso = text.match(/^(\d{4})[-/年.](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}`;
  }

  return text;
}

function parseFileDate(fileName, stat) {
  const match = fileName.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2})_(\d{2})/);
  if (!match) {
    return stat ? stat.mtime : new Date();
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function monthFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

function dayOfMonth(date) {
  return date.getDate();
}

function listDailyFiles(rootDir) {
  const searchDirs = [
    { dir: rootDir, prefix: "" },
    { dir: path.join(rootDir, "daily"), prefix: "daily/" }
  ];
  const files = [];

  for (const source of searchDirs) {
    if (!fs.existsSync(source.dir)) {
      continue;
    }

    for (const name of fs.readdirSync(source.dir)) {
      if (!DAILY_FILE_PATTERN.test(name)) {
        continue;
      }

      const filePath = path.join(source.dir, name);
      const stat = fs.statSync(filePath);
      const fileDate = parseFileDate(name, stat);
      files.push({
        id: `${source.prefix}${name}`,
        name,
        date: formatDate(fileDate),
        month: monthFromDate(fileDate),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        timestamp: fileDate.getTime()
      });
    }
  }

  return files.sort((left, right) => right.timestamp - left.timestamp || right.updatedAt.localeCompare(left.updatedAt));
}

function resolveDailyFile(rootDir, fileId) {
  const files = listDailyFiles(rootDir);
  const selected = fileId ? files.find((file) => file.id === fileId) : files[0];

  if (!selected) {
    throw new Error("没有找到 主播概览列表_*.csv 日报文件");
  }

  const filePath = selected.id.startsWith("daily/")
    ? path.join(rootDir, "daily", selected.name)
    : path.join(rootDir, selected.name);

  return { selected, filePath, files };
}

function buildNameMapsFromRows() {
  const dailyToTask = new Map();
  const taskToDaily = new Map();
  const rows = BUILT_IN_AGENT_ALIASES.map(([taskName, dailyName]) => ({
    taskName,
    dailyName
  }));

  for (const row of rows) {
    const taskName = String(row.taskName || "").trim();
    const dailyName = String(row.dailyName || "").trim();
    if (!taskName || !dailyName) {
      continue;
    }
    if (EXCLUDED_AGENT_NAMES.has(taskName) || EXCLUDED_AGENT_NAMES.has(dailyName)) {
      continue;
    }

    dailyToTask.set(dailyName, taskName);
    if (!taskToDaily.has(taskName)) {
      taskToDaily.set(taskName, []);
    }
    taskToDaily.get(taskName).push(dailyName);
  }

  return { rows, dailyToTask, taskToDaily };
}

function buildTasks(rootDir, month) {
  const rows = readCsvObjects(path.join(rootDir, TASK_FILE));
  return buildTasksFromRows(rows, month);
}

function buildTasksFromRows(rows, month) {
  const tasks = new Map();
  const selectedRows = rows.filter((row) => {
    const agent = String(row["经纪人"] || "").trim();
    return parseMonth(row["月份"]) === month && agent && !EXCLUDED_AGENT_NAMES.has(agent);
  });

  for (const row of selectedRows) {
    const agent = String(row["经纪人"] || "").trim();
    if (!agent) {
      continue;
    }

    tasks.set(agent, {
      month: parseMonth(row["月份"]),
      agent,
      joinedAt: row["入职时间"] || "",
      joinedMonths: row["入职月数"] || "",
      lastMonthAmount: parseNumber(row["上月流水"]),
      targetAmount: parseNumber(row["目标总流水"])
    });
  }

  return { rows, selectedRows, tasks };
}

function aggregateDaily(rows, dailyToTask) {
  const agents = new Map();
  const anchors = [];
  const rawAgentNames = new Set();
  const invalidRows = [];

  rows.forEach((row, index) => {
    const dailyAgentRaw = String(row[OWNER_FIELD] || "").trim();
    if (!dailyAgentRaw || EXCLUDED_AGENT_NAMES.has(dailyAgentRaw)) {
      return;
    }

    const dailyAgent = dailyAgentRaw;
    const taskAgent = dailyToTask.get(dailyAgent) || dailyAgent;
    if (EXCLUDED_AGENT_NAMES.has(taskAgent)) {
      return;
    }

    const amountText = row["总音浪"];
    const amount = parseNumber(amountText);
    const effectiveDays = parseNumber(row["语音有效天"]);
    const liveDuration = pickLiveDuration(row);
    const lastLiveText = row["上次开播时间"] || "";
    const lastLiveStatus = parseLastLiveStatus(lastLiveText);

    rawAgentNames.add(dailyAgent);

    if (amountText && amount === 0 && !/^0+(\.0+)?$/.test(String(amountText).trim())) {
      invalidRows.push({
        rowNumber: index + 2,
        anchorName: row["主播昵称"] || "",
        value: amountText
      });
    }

    if (!agents.has(taskAgent)) {
      agents.set(taskAgent, {
        agent: taskAgent,
        dailyAgentNames: new Set(),
        anchorCount: 0,
        activeAnchorCount: 0,
        completedAmount: 0
      });
    }

    const aggregate = agents.get(taskAgent);
    aggregate.dailyAgentNames.add(dailyAgent);
    aggregate.anchorCount += 1;
    aggregate.activeAnchorCount += effectiveDays > 0 ? 1 : 0;
    aggregate.completedAmount += amount;

    anchors.push({
      rowNumber: index + 2,
      taskAgent,
      dailyAgent,
      anchorId: row["主播ID"] || "",
      anchorName: row["主播昵称"] || "",
      douyinId: row["抖音号"] || "",
      fans: parseNumber(row["粉丝数"]),
      firstLiveAt: row["首播时间"] || "",
      lastLiveText,
      totalAmount: amount,
      effectiveDays,
      liveDuration,
      validDuration: row["语音开播有效时长"] || "",
      lastLiveOverdue: lastLiveStatus.overdue,
      lastLiveDaysLevel: lastLiveStatus.daysLevel,
      lastLiveNever: lastLiveStatus.never,
      dailyDetail: row,
      risks: buildAnchorRisks(amount, effectiveDays, lastLiveText)
    });
  });

  for (const aggregate of agents.values()) {
    aggregate.dailyAgentNames = Array.from(aggregate.dailyAgentNames);
  }

  return {
    agents,
    anchors,
    rawAgentNames: Array.from(rawAgentNames).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    invalidRows
  };
}

function buildAnchorRisks(amount, effectiveDays, lastLiveText) {
  const risks = [];
  const lastLiveStatus = parseLastLiveStatus(lastLiveText);

  if (effectiveDays === 0) {
    risks.push("无有效天");
  }
  if (amount < 1000) {
    risks.push("低流水");
  }
  if (lastLiveStatus.never) {
    risks.push("无开播记录");
  } else if (lastLiveStatus.overdue) {
    risks.push("超过2天未开播");
  }

  return risks;
}

function parseLastLiveStatus(lastLiveText) {
  const text = String(lastLiveText || "").trim();
  if (!text || text === "-" || text.includes("从未开播")) {
    return { overdue: true, daysLevel: null, never: true };
  }

  const hours = text.match(/(\d+)\s*小时前/);
  if (hours) {
    return { overdue: false, daysLevel: 0, never: false };
  }

  const days = text.match(/(\d+)\s*(?:日|天)前/);
  if (days) {
    const value = Number(days[1]);
    return { overdue: value >= 2, daysLevel: value, never: false };
  }

  const weeks = text.match(/(\d+)\s*周前/);
  if (weeks) {
    const value = Number(weeks[1]) * 7;
    return { overdue: true, daysLevel: value, never: false };
  }

  const months = text.match(/(\d+)\s*月前/);
  if (months) {
    const value = Number(months[1]) * 30;
    return { overdue: true, daysLevel: value, never: false };
  }

  const years = text.match(/(\d+)\s*年前/);
  if (years) {
    const value = Number(years[1]) * 365;
    return { overdue: true, daysLevel: value, never: false };
  }

  return { overdue: false, daysLevel: null, never: false };
}

function isInvalidAnchor(anchor) {
  const hasTask = Boolean(anchor.tasks?.process || anchor.tasks?.newAnchor);
  const oldOrNever = anchor.lastLiveNever || Number(anchor.lastLiveDaysLevel || 0) >= INVALID_ANCHOR_DAYS_THRESHOLD;
  return !hasTask && Number(anchor.totalAmount || 0) === 0 && oldOrNever;
}

function rebuildDailyAggregates(anchors) {
  const agents = new Map();
  const rawAgentNames = new Set();

  for (const anchor of anchors) {
    rawAgentNames.add(anchor.dailyAgent);

    if (!agents.has(anchor.taskAgent)) {
      agents.set(anchor.taskAgent, {
        agent: anchor.taskAgent,
        dailyAgentNames: new Set(),
        anchorCount: 0,
        activeAnchorCount: 0,
        completedAmount: 0
      });
    }

    const aggregate = agents.get(anchor.taskAgent);
    aggregate.dailyAgentNames.add(anchor.dailyAgent);
    aggregate.anchorCount += 1;
    aggregate.activeAnchorCount += anchor.effectiveDays > 0 ? 1 : 0;
    aggregate.completedAmount += anchor.totalAmount;
  }

  for (const aggregate of agents.values()) {
    aggregate.dailyAgentNames = Array.from(aggregate.dailyAgentNames);
  }

  return {
    agents,
    rawAgentNames: Array.from(rawAgentNames).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
  };
}

function buildAgentRows({ tasks, aggregates, rawAgentNames, day, totalDays }) {
  const allAgents = new Set([...tasks.keys(), ...aggregates.keys()]);
  const timeProgress = totalDays > 0 ? day / totalDays : 0;
  const warnings = [];

  const rows = Array.from(allAgents).map((agent) => {
    const task = tasks.get(agent);
    const aggregate = aggregates.get(agent);
    const targetAmount = task ? task.targetAmount : 0;
    const completedAmount = aggregate ? aggregate.completedAmount : 0;
    const remainingAmount = Math.max(targetAmount - completedAmount, 0);
    const completionRate = targetAmount > 0 ? completedAmount / targetAmount : 0;
    const remainingDays = Math.max(totalDays - day + 1, 1);
    const requiredDailyAmount = targetAmount > 0 ? Math.ceil(remainingAmount / remainingDays) : 0;
    const risks = [];

    if (task && !aggregate) {
      risks.push("有目标无日报");
      warnings.push({
        type: "目标无日报",
        level: "high",
        agent,
        message: `${agent} 有月目标，但今天日报没有匹配到主播数据`
      });
    }

    if (!task && aggregate) {
      risks.push("缺少目标");
      warnings.push({
        type: "缺少目标",
        level: "medium",
        agent,
        message: `${agent} 在日报中有数据，但月任务表没有配置目标`
      });
    }

    if (targetAmount > 0 && completionRate < timeProgress) {
      risks.push("低于时间进度");
      warnings.push({
        type: "低于时间进度",
        level: "high",
        agent,
        message: `${agent} 完成率 ${formatPercent(completionRate)}，低于本月时间进度 ${formatPercent(timeProgress)}`
      });
    }

    return {
      agent,
      dailyAgentNames: aggregate ? aggregate.dailyAgentNames : [],
      joinedAt: task ? task.joinedAt : "",
      joinedMonths: task ? task.joinedMonths : "",
      lastMonthAmount: task ? task.lastMonthAmount : 0,
      targetAmount,
      completedAmount,
      remainingAmount,
      requiredDailyAmount,
      completionRate,
      anchorCount: aggregate ? aggregate.anchorCount : 0,
      activeAnchorCount: aggregate ? aggregate.activeAnchorCount : 0,
      risks
    };
  });

  rows.sort((left, right) => {
    const riskDiff = right.risks.length - left.risks.length;
    if (riskDiff !== 0) {
      return riskDiff;
    }
    return right.targetAmount - left.targetAmount || left.agent.localeCompare(right.agent, "zh-Hans-CN");
  });

  return { rows, warnings, timeProgress };
}

function getMappedAgent(row, dailyToTask) {
  const rawAgent = String(row["运营经纪人"] || row["招募经纪人"] || row["经纪人"] || "").trim();
  const agent = dailyToTask.get(rawAgent) || rawAgent;
  return agent && !EXCLUDED_AGENT_NAMES.has(agent) ? agent : "";
}

function taskKey(taskType, douyinId) {
  return `${taskType}|${String(douyinId || "").trim().toLowerCase()}`;
}

function anchorKey(douyinId) {
  return String(douyinId || "").trim().toLowerCase();
}

function buildValidAnchorMap(anchors) {
  const map = new Map();

  for (const anchor of anchors) {
    const key = anchorKey(anchor.douyinId);
    if (key) {
      map.set(key, anchor);
    }
  }

  return map;
}

function getScanfaceInfo(scanfaceMap, taskType, row) {
  const douyinId = row["抖音号"] || "";
  const matched = scanfaceMap ? scanfaceMap.get(taskKey(taskType, douyinId)) : null;
  if (matched) {
    return matched;
  }

  const issued = parseNumber(row["主播本周期弹窗下发次数"]);
  const passed = parseNumber(row["主播本周期扫脸通过次数"]);
  return {
    taskType,
    anchorName: row["主播昵称"] || "",
    douyinId,
    issued,
    passed,
    gap: Math.max(issued - passed, 0),
    incomplete: issued > passed
  };
}

function getProcessTier(days, hours) {
  let achieved = null;
  for (const tier of PROCESS_TIERS) {
    if (days >= tier.days && hours >= tier.hours) {
      achieved = tier;
    }
  }

  const next = PROCESS_TIERS.find((tier) => days < tier.days || hours < tier.hours) || null;
  return {
    achieved,
    next,
    status: achieved ? `已达${achieved.label}` : "未达最低档",
    targetLabel: next ? next.label : "已满最高档",
    gapDays: next ? Math.max(next.days - days, 0) : 0,
    gapHours: next ? Math.max(next.hours - hours, 0) : 0
  };
}

function parseCycleEnd(cycleText) {
  const match = String(cycleText || "").match(/第\d+-(\d+)天/);
  return match ? Number(match[1]) : 30;
}

function parseCycleRange(cycleText) {
  const match = String(cycleText || "").match(/第(\d+)-(\d+)天/);
  return match ? { startDay: Number(match[1]), endDay: Number(match[2]) } : { startDay: 1, endDay: 30 };
}

function addDaysToDateText(dateText, daysToAdd) {
  const text = String(dateText || "").trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) {
    return "";
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + daysToAdd);
  return formatDate(date);
}

function buildTaskGroups(items) {
  const agents = new Map();

  for (const item of items) {
    if (!agents.has(item.agent)) {
      agents.set(item.agent, {
        agent: item.agent,
        total: 0,
        scanfaceIncompleteCount: 0,
        focusCount: 0,
        items: []
      });
    }

    const group = agents.get(item.agent);
    group.total += 1;
    group.scanfaceIncompleteCount += item.scanface.incomplete ? 1 : 0;
    group.focusCount += item.focus ? 1 : 0;
    group.items.push(item);
  }

  const groups = Array.from(agents.values()).map((group) => ({
    ...group,
    items: group.items.sort((left, right) => right.riskScore - left.riskScore || right.scanface.gap - left.scanface.gap)
  }));

  groups.sort((left, right) => right.focusCount - left.focusCount || right.scanfaceIncompleteCount - left.scanfaceIncompleteCount || right.total - left.total);
  return groups;
}

function buildProcessTaskMonitor(rows, scanfaceMap, dailyToTask, validAnchorMap) {
  const items = [];

  for (const row of rows) {
    const agent = getMappedAgent(row, dailyToTask);
    if (!agent) {
      continue;
    }
    const douyinId = row["抖音号"] || "";
    const matchedAnchor = validAnchorMap ? validAnchorMap.get(anchorKey(douyinId)) : null;
    if (validAnchorMap && !matchedAnchor) {
      continue;
    }

    const days = parseNumber(row["本月有效天数(天)"]);
    const hours = parseNumber(row["本月有效时长(小时)"]);
    const tier = getProcessTier(days, hours);
    const scanface = getScanfaceInfo(scanfaceMap, "过程任务", row);
    const belowMinimum = !tier.achieved;
    const focus = belowMinimum || scanface.incomplete;

    items.push({
      taskType: "过程任务",
      agent: matchedAnchor ? matchedAnchor.taskAgent : agent,
      anchorName: row["主播昵称"] || "",
      douyinId,
      days,
      hours,
      stage: row["任务阶段"] || "",
      currentLabel: tier.status,
      targetLabel: tier.targetLabel,
      gapDays: tier.gapDays,
      gapHours: tier.gapHours,
      scanface,
      detail: row,
      status: focus ? (belowMinimum ? "未达最低档" : "扫脸未拉满") : "正常",
      focus,
      riskScore: (scanface.incomplete ? 1000 : 0) + (belowMinimum ? 500 : 0) + tier.gapDays * 10 + tier.gapHours
    });
  }

  const groups = buildTaskGroups(items);
  return {
    total: items.length,
    focusCount: items.filter((item) => item.focus).length,
    scanfaceIncompleteCount: items.filter((item) => item.scanface.incomplete).length,
    groups
  };
}

function buildNewAnchorTaskMonitor(rows, scanfaceMap, dailyToTask, validAnchorMap) {
  const items = [];

  for (const row of rows) {
    const agent = getMappedAgent(row, dailyToTask);
    if (!agent) {
      continue;
    }
    const douyinId = row["抖音号"] || "";
    const matchedAnchor = validAnchorMap ? validAnchorMap.get(anchorKey(douyinId)) : null;
    if (validAnchorMap && !matchedAnchor) {
      continue;
    }

    const days = parseNumber(row["当前周期有效天数(天)"]);
    const hours = parseNumber(row["当前周期有效时长(小时)"]);
    const currentDay = parseNumber(row["当前天数"]);
    const cycle = row["当前周期"] || "";
    const cycleRange = parseCycleRange(cycle);
    const startDate = row["开始时间"] || "";
    const cycleStartDate = addDaysToDateText(startDate, cycleRange.startDay - 1);
    const cycleEndDate = addDaysToDateText(startDate, cycleRange.endDay - 1);
    const cycleEnd = parseCycleEnd(cycle);
    const remainingDays = Math.max(cycleEnd - currentDay + 1, 0);
    const gapDays = Math.max(NEW_ANCHOR_TARGET.days - days, 0);
    const gapHours = Math.max(NEW_ANCHOR_TARGET.hours - hours, 0);
    const achieved = gapDays === 0 && gapHours === 0;
    const impossibleByDays = !achieved && gapDays > remainingDays;
    const scanface = getScanfaceInfo(scanfaceMap, "拉新任务", row);
    const focus = impossibleByDays || scanface.incomplete;

    items.push({
      taskType: "拉新任务",
      agent: matchedAnchor ? matchedAnchor.taskAgent : agent,
      anchorName: row["主播昵称"] || "",
      douyinId,
      days,
      hours,
      startDate,
      cycle,
      cycleStartDate,
      cycleEndDate,
      currentDay,
      remainingDays,
      currentLabel: achieved ? "已达18天60小时" : cycle,
      targetLabel: NEW_ANCHOR_TARGET.label,
      gapDays,
      gapHours,
      dailyNeededHours: remainingDays > 0 ? gapHours / remainingDays : gapHours,
      scanface,
      detail: row,
      status: achieved ? "已达标" : impossibleByDays ? "天数无法完成" : scanface.incomplete ? "扫脸未拉满" : "可追赶",
      focus,
      riskScore: (scanface.incomplete ? 1000 : 0) + (impossibleByDays ? 700 : 0) + gapDays * 10 + gapHours
    });
  }

  const groups = buildTaskGroups(items);
  return {
    total: items.length,
    focusCount: items.filter((item) => item.focus).length,
    scanfaceIncompleteCount: items.filter((item) => item.scanface.incomplete).length,
    groups
  };
}

function buildTaskMonitor({ processTaskRows, newAnchorTaskRows, dailyToTask, validAnchorMap }) {
  const scanfaceMap = null;
  const process = buildProcessTaskMonitor(processTaskRows, scanfaceMap, dailyToTask, validAnchorMap);
  const newAnchor = buildNewAnchorTaskMonitor(newAnchorTaskRows, scanfaceMap, dailyToTask, validAnchorMap);

  return {
    process,
    newAnchor,
    summary: {
      processTotal: process.total,
      newAnchorTotal: newAnchor.total,
      scanfaceIncompleteCount: process.scanfaceIncompleteCount + newAnchor.scanfaceIncompleteCount,
      focusCount: process.focusCount + newAnchor.focusCount
    }
  };
}

function buildTrackingReasons(anchor, tasks) {
  const reasons = [];

  if (anchor.totalAmount > 0 && anchor.lastLiveOverdue) {
    reasons.push({
      id: "stopped-live",
      label: "有流水断播",
      detail: anchor.lastLiveText || "2日以上未开播"
    });
  }

  if (tasks.process?.currentLabel === "未达最低档") {
    reasons.push({
      id: "process-task",
      label: "过程任务",
      detail: `未达最低档，差${tasks.process.gapDays}天/${tasks.process.gapHours.toFixed(1)}小时`
    });
  }

  if (tasks.newAnchor?.status === "天数无法完成") {
    reasons.push({
      id: "new-anchor-task",
      label: "拉新周期",
      detail: `天数无法完成，差${tasks.newAnchor.gapDays}天/${tasks.newAnchor.gapHours.toFixed(1)}小时`
    });
  }

  if (tasks.process?.scanface?.incomplete) {
    reasons.push({
      id: "process-scanface",
      label: "过程扫脸",
      detail: `${tasks.process.scanface.passed}/${tasks.process.scanface.issued}`
    });
  }

  if (tasks.newAnchor?.scanface?.incomplete) {
    reasons.push({
      id: "new-anchor-scanface",
      label: "拉新扫脸",
      detail: `${tasks.newAnchor.scanface.passed}/${tasks.newAnchor.scanface.issued}`
    });
  }

  return reasons;
}

function attachTaskMonitorToAnchors(anchors, taskMonitor) {
  const taskByAnchor = new Map();

  for (const item of taskMonitor.process.groups.flatMap((group) => group.items)) {
    const key = anchorKey(item.douyinId);
    if (!taskByAnchor.has(key)) {
      taskByAnchor.set(key, {});
    }
    taskByAnchor.get(key).process = item;
  }

  for (const item of taskMonitor.newAnchor.groups.flatMap((group) => group.items)) {
    const key = anchorKey(item.douyinId);
    if (!taskByAnchor.has(key)) {
      taskByAnchor.set(key, {});
    }
    taskByAnchor.get(key).newAnchor = item;
  }

  for (const anchor of anchors) {
    const tasks = taskByAnchor.get(anchorKey(anchor.douyinId)) || {};
    anchor.tasks = tasks;
    anchor.taskFocusCount = Number(Boolean(tasks.process?.focus)) + Number(Boolean(tasks.newAnchor?.focus));
    anchor.scanfaceIncomplete = Boolean(tasks.process?.scanface?.incomplete || tasks.newAnchor?.scanface?.incomplete);
    anchor.trackingReasons = buildTrackingReasons(anchor, tasks);
  }
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function buildDashboardData(rootDir, options = {}) {
  const { selected, filePath, files } = resolveDailyFile(rootDir, options.fileId);
  const dailyRows = readCsvObjects(filePath);
  const taskRows = readCsvObjects(path.join(rootDir, TASK_FILE));
  const processTaskRows = readNewestMatchingCsv(rootDir, PROCESS_TASK_FILE_PATTERN);
  const newAnchorTaskRows = readNewestMatchingCsv(rootDir, NEW_ANCHOR_TASK_FILE_PATTERN);

  return buildDashboardDataFromRows({
    dailyRows,
    taskRows,
    processTaskRows,
    newAnchorTaskRows,
    selected,
    files,
    month: options.month
  });
}

function buildDashboardDataFromRows({
  dailyRows,
  taskRows,
  processTaskRows = [],
  newAnchorTaskRows = [],
  selected,
  files,
  month
}) {
  const dailyDate = new Date(selected.timestamp);
  const selectedMonth = month || selected.month;
  const totalDays = daysInMonth(selectedMonth);
  const day = selected.month === selectedMonth ? dayOfMonth(dailyDate) : 1;

  const nameMaps = buildNameMapsFromRows();
  const daily = aggregateDaily(dailyRows, nameMaps.dailyToTask);
  const taskMonitor = buildTaskMonitor({
    processTaskRows,
    newAnchorTaskRows,
    dailyToTask: nameMaps.dailyToTask,
    validAnchorMap: buildValidAnchorMap(daily.anchors)
  });
  const taskData = buildTasksFromRows(taskRows, selectedMonth);
  attachTaskMonitorToAnchors(daily.anchors, taskMonitor);
  daily.anchors = daily.anchors.filter((anchor) => !isInvalidAnchor(anchor));
  const filteredDaily = rebuildDailyAggregates(daily.anchors);
  daily.agents = filteredDaily.agents;
  daily.rawAgentNames = filteredDaily.rawAgentNames;
  const filteredTaskMonitor = buildTaskMonitor({
    processTaskRows,
    newAnchorTaskRows,
    dailyToTask: nameMaps.dailyToTask,
    validAnchorMap: buildValidAnchorMap(daily.anchors)
  });
  attachTaskMonitorToAnchors(daily.anchors, filteredTaskMonitor);
  const agentData = buildAgentRows({
    tasks: taskData.tasks,
    aggregates: daily.agents,
    rawAgentNames: daily.rawAgentNames,
    day,
    totalDays
  });

  const targetAmount = sum(agentData.rows, "targetAmount");
  const completedAmount = sum(agentData.rows, "completedAmount");
  const remainingAmount = Math.max(targetAmount - completedAmount, 0);
  const remainingDays = Math.max(totalDays - day + 1, 1);
  const warnings = [...agentData.warnings];

  if (taskData.selectedRows.length === 0) {
    warnings.unshift({
      type: "任务表未配置",
      level: "high",
      agent: "",
      message: `${TASK_FILE} 中没有 ${selectedMonth} 的任务，请补充后刷新`
    });
  }

  if (daily.invalidRows.length > 0) {
    warnings.push({
      type: "非数字流水",
      level: "medium",
      agent: "",
      message: `日报中有 ${daily.invalidRows.length} 行总音浪不是标准数字，已按 0 处理`
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    selectedFile: selected,
    files,
    month: selectedMonth,
    day,
    totalDays,
    summary: {
      targetAmount,
      completedAmount,
      remainingAmount,
      completionRate: targetAmount > 0 ? completedAmount / targetAmount : 0,
      requiredDailyAmount: targetAmount > 0 ? Math.ceil(remainingAmount / remainingDays) : 0,
      anchorCount: daily.anchors.length,
      activeAnchorCount: daily.anchors.filter((anchor) => anchor.effectiveDays > 0).length,
      agentCount: agentData.rows.length,
      timeProgress: agentData.timeProgress
    },
    agents: agentData.rows,
    anchors: daily.anchors,
    taskMonitor: filteredTaskMonitor,
    warnings,
    config: {
      taskFile: TASK_FILE,
      taskRows: taskData.selectedRows.length,
      nameMapSource: "built-in",
      nameMapRows: nameMaps.rows.length,
      processTaskRows: processTaskRows.length,
      newAnchorTaskRows: newAnchorTaskRows.length,
      ownerField: OWNER_FIELD,
      invalidAnchorDaysThreshold: INVALID_ANCHOR_DAYS_THRESHOLD
    }
  };
}

module.exports = {
  buildDashboardData,
  buildDashboardDataFromRows,
  buildTaskMonitor,
  isInvalidAnchor,
  listDailyFiles,
  parseLastLiveStatus,
  parseCsv,
  readCsvObjects,
  readCsvObjectsFromText
};

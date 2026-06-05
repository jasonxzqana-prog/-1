const assert = require("assert");
const path = require("path");
const { buildDashboardData, parseLastLiveStatus } = require("../src/data");

const rootDir = path.resolve(__dirname, "..");
const data = buildDashboardData(rootDir, {
  fileId: "主播概览列表_2026-06-04 14_02.csv"
});
const agentCompletedSum = data.agents.reduce((total, agent) => total + agent.completedAmount, 0);
const anchorCompletedSum = data.anchors.reduce((total, anchor) => total + anchor.totalAmount, 0);
const anchorCountByAgent = new Map();
const amountByAgent = new Map();
const excludedAgents = ["念卿", "曹政", "经年", "金鑫"];

for (const anchor of data.anchors) {
  anchorCountByAgent.set(anchor.taskAgent, (anchorCountByAgent.get(anchor.taskAgent) || 0) + 1);
  amountByAgent.set(anchor.taskAgent, (amountByAgent.get(anchor.taskAgent) || 0) + anchor.totalAmount);
}

assert.strictEqual(data.summary.anchorCount, data.anchors.length, "部门总览主播数必须等于主播明细条数");
assert.deepStrictEqual(
  excludedAgents.filter((name) => data.agents.some((agent) => agent.agent === name)),
  [],
  "排除经纪人不应进入经纪人汇总"
);
assert.deepStrictEqual(
  excludedAgents.filter((name) => data.anchors.some((anchor) => anchor.dailyAgent === name || anchor.taskAgent === name)),
  [],
  "排除经纪人的主播不应进入主播明细"
);
assert.ok(!data.agents.some((agent) => agent.agent === "念卿"), "念卿不应进入经纪人汇总");
assert.ok(!data.anchors.some((anchor) => anchor.dailyAgent === "念卿"), "念卿的主播不应进入主播明细");
assert.ok(!data.anchors.some((anchor) => !anchor.dailyAgent), "没有经纪人名字的主播不应进入主播明细");
assert.ok(
  !data.anchors.some(
    (anchor) =>
      !anchor.tasks?.process &&
      !anchor.tasks?.newAnchor &&
      anchor.totalAmount === 0 &&
      (anchor.lastLiveNever || Number(anchor.lastLiveDaysLevel || 0) >= data.config.invalidAnchorDaysThreshold)
  ),
  "无过程/拉新任务、本月流水为0、且最近开播一周前或从未开播的主播不应进入看板数据"
);
assert.strictEqual(agentCompletedSum, anchorCompletedSum, "经纪人汇总流水必须等于主播明细流水加总");
assert.ok(data.files.length >= 1, "应至少发现一份日报文件");

for (const agent of data.agents) {
  assert.strictEqual(agent.anchorCount, anchorCountByAgent.get(agent.agent) || 0, `${agent.agent} 主播数必须等于分组明细条数`);
  assert.strictEqual(agent.completedAmount, amountByAgent.get(agent.agent) || 0, `${agent.agent} 流水必须等于分组明细加总`);
}

assert.strictEqual(parseLastLiveStatus("2日前").overdue, true, "2日前应标红");
assert.strictEqual(parseLastLiveStatus("3日前").overdue, true, "3日前应标红");
assert.strictEqual(parseLastLiveStatus("1周前").overdue, true, "1周前应标红");
assert.strictEqual(parseLastLiveStatus("从未开播").overdue, true, "从未开播应标红");
assert.strictEqual(parseLastLiveStatus("1日前").overdue, false, "1日前不应标红");
assert.strictEqual(parseLastLiveStatus("5小时前").overdue, false, "几小时前不应标红");
assert.strictEqual(
  data.anchors.find((anchor) => anchor.anchorName === "驯服")?.liveDuration,
  "11小时17分钟40秒",
  "语音开播时长为0时，应显示开播总时长"
);
assert.strictEqual(
  data.anchors.find((anchor) => anchor.anchorName === "驯服")?.firstLiveAt,
  "2026-04-26",
  "主播明细应包含首播时间"
);

assert.strictEqual(data.config.processTaskRows, 1136, "过程任务源文件应读取1136条");
assert.strictEqual(data.config.newAnchorTaskRows, 956, "拉新任务源文件应读取956条");
assert.ok(data.taskMonitor.process.total > 0, "过程任务应生成经纪人监测数据");
assert.ok(data.taskMonitor.newAnchor.total > 0, "拉新任务应生成经纪人监测数据");
assert.strictEqual(data.taskMonitor.process.scanfaceIncompleteCount, 14, "过程任务扫脸未拉满应匹配14条");
assert.strictEqual(data.taskMonitor.newAnchor.scanfaceIncompleteCount, 101, "剔除无效主播后，拉新任务扫脸未拉满应匹配101条");
assert.ok(!data.taskMonitor.process.groups.some((group) => !group.agent || group.agent === "念卿"), "过程任务不应包含空经纪人或念卿");
assert.ok(!data.taskMonitor.newAnchor.groups.some((group) => !group.agent || group.agent === "念卿"), "拉新任务不应包含空经纪人或念卿");
assert.deepStrictEqual(
  excludedAgents.filter((name) => data.taskMonitor.process.groups.some((group) => group.agent === name)),
  [],
  "过程任务不应包含排除经纪人"
);
assert.deepStrictEqual(
  excludedAgents.filter((name) => data.taskMonitor.newAnchor.groups.some((group) => group.agent === name)),
  [],
  "拉新任务不应包含排除经纪人"
);

const processItems = data.taskMonitor.process.groups.flatMap((group) => group.items);
const newAnchorItems = data.taskMonitor.newAnchor.groups.flatMap((group) => group.items);
const validAnchorKeys = new Set(data.anchors.map((anchor) => String(anchor.douyinId || "").trim().toLowerCase()));
assert.strictEqual(processItems.filter((item) => !validAnchorKeys.has(String(item.douyinId || "").trim().toLowerCase())).length, 0, "过程任务必须全部匹配到有效主播明细");
assert.strictEqual(newAnchorItems.filter((item) => !validAnchorKeys.has(String(item.douyinId || "").trim().toLowerCase())).length, 0, "拉新任务必须全部匹配到有效主播明细");
assert.strictEqual(data.anchors.filter((anchor) => anchor.tasks?.process || anchor.tasks?.newAnchor).length, 1075, "主播明细中应合并1075个有任务的有效主播");
assert.ok(processItems.some((item) => item.currentLabel === "未达最低档" && item.gapDays >= 0 && item.gapHours >= 0), "过程任务应识别未达最低档和差距");
assert.ok(processItems.some((item) => item.currentLabel.includes("15天50小时") || item.targetLabel.includes("15天50小时")), "过程任务应包含15天50小时档位");
assert.ok(newAnchorItems.some((item) => item.status === "天数无法完成"), "拉新任务应识别天数无法完成");
assert.ok(newAnchorItems.some((item) => Number(item.dailyNeededHours) >= 0), "拉新任务应计算剩余每日需播小时");
assert.ok(data.anchors.some((anchor) => anchor.dailyDetail && anchor.dailyDetail["主播昵称"]), "主播详情应包含日报全部字段");
assert.ok(processItems.some((item) => item.detail && item.detail["任务阶段"]), "主播详情应包含过程任务全部字段");
assert.ok(newAnchorItems.some((item) => item.detail && item.detail["开始时间"] && item.cycleStartDate && item.cycleEndDate), "主播详情应包含拉新开始时间和周期起止时间");
assert.ok(processItems.some((item) => item.scanface && item.scanface.issued >= item.scanface.passed), "过程任务详情应包含扫脸情况");
assert.ok(newAnchorItems.some((item) => item.scanface && item.scanface.issued >= item.scanface.passed), "拉新任务详情应包含扫脸情况");

const trackingCount = (id) => data.anchors.filter((anchor) => (anchor.trackingReasons || []).some((reason) => reason.id === id)).length;
assert.strictEqual(trackingCount("stopped-live"), 28, "有流水且断播两日及以上应进入需要追踪");
assert.strictEqual(trackingCount("process-task"), 1075, "过程任务未达最低档应进入需要追踪");
assert.strictEqual(trackingCount("new-anchor-task"), 497, "周期任务天数无法完成应进入需要追踪");
assert.strictEqual(trackingCount("process-scanface"), 14, "过程任务扫脸未拉满应进入需要追踪");
assert.strictEqual(trackingCount("new-anchor-scanface"), 101, "拉新任务扫脸未拉满应进入需要追踪");
assert.ok(data.anchors.some((anchor) => (anchor.trackingReasons || []).length > 1), "同一主播可以同时出现多个追踪原因");
assert.ok(
  !data.anchors.some((anchor) => anchor.totalAmount === 0 && (anchor.trackingReasons || []).some((reason) => reason.id === "stopped-live")),
  "无流水主播不应因断播进入需要追踪"
);

console.log("校验通过");
console.log(`日报文件: ${data.selectedFile.name}`);
console.log(`主播记录: ${data.summary.anchorCount}`);
console.log(`经纪人数: ${data.summary.agentCount}`);
console.log(`主播明细流水合计: ${anchorCompletedSum}`);
console.log(`经纪人汇总流水合计: ${agentCompletedSum}`);
console.log(`2日前及更久未开播主播: ${data.anchors.filter((anchor) => anchor.lastLiveOverdue).length}`);
console.log(`已排除无效主播口径: 无任务、0流水、${data.config.invalidAnchorDaysThreshold}天及以上或从未开播`);

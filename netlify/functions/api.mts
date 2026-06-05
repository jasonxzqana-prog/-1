import { getStore } from "@netlify/blobs";
import dataModule from "../../src/data.js";

const { buildDashboardDataFromRows, parseCsv, readCsvObjectsFromText } = dataModule;

const STORE_NAME = "anchor-dashboard";
const DAILY_INDEX_KEY = "daily/index.json";
const TASKS_KEY = "config/tasks.csv";
const PROCESS_TASK_KEY = "config/process-task.csv";
const NEW_ANCHOR_TASK_KEY = "config/new-anchor-task.csv";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function getDashboardStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function getAdminPassword() {
  return Netlify.env.get("ADMIN_PASSWORD") || process.env.ADMIN_PASSWORD || "";
}

function slugFileName(name: string) {
  return name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

function parseFileDate(fileName: string) {
  const match = fileName.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2})_(\d{2})/);
  if (!match) {
    return new Date();
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
}

function buildDailyDisplayName(fileName: string) {
  const match = fileName.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2})_(\d{2})/);
  if (!match || fileName.includes("主播概览列表")) {
    return fileName;
  }

  return `主播概览列表_${match[1]}-${match[2]}-${match[3]} ${match[4]}_${match[5]}.csv`;
}

function formatDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function monthFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function readDailyIndex() {
  const store = getDashboardStore();
  const index = await store.get(DAILY_INDEX_KEY, { type: "json" });
  return Array.isArray(index) ? index : [];
}

async function writeDailyIndex(files: any[]) {
  const store = getDashboardStore();
  await store.setJSON(DAILY_INDEX_KEY, files);
}

async function handleFiles() {
  return jsonResponse({ files: await readDailyIndex() });
}

async function handleData(req: Request) {
  const url = new URL(req.url);
  const store = getDashboardStore();
  const files = await readDailyIndex();
  const fileId = url.searchParams.get("file") || "";
  const selected = fileId ? files.find((file: any) => file.id === fileId) : files[0];

  if (!selected) {
    return jsonResponse({
      error: "还没有线上日报数据，请先上传 主播概览列表_*.csv"
    }, 404);
  }

  const dailyText = await store.get(`daily/${selected.id}.csv`);
  if (!dailyText) {
    return jsonResponse({ error: "选中的日报文件不存在，请重新上传" }, 404);
  }

  const taskText = (await store.get(TASKS_KEY)) || "";
  const processTaskText = (await store.get(PROCESS_TASK_KEY)) || "";
  const newAnchorTaskText = (await store.get(NEW_ANCHOR_TASK_KEY)) || "";
  const data = buildDashboardDataFromRows({
    dailyRows: readCsvObjectsFromText(dailyText),
    taskRows: readCsvObjectsFromText(taskText),
    processTaskRows: readCsvObjectsFromText(processTaskText),
    newAnchorTaskRows: readCsvObjectsFromText(newAnchorTaskText),
    selected,
    files,
    month: url.searchParams.get("month") || undefined
  });

  return jsonResponse(data);
}

function requireAdmin(formData: FormData) {
  const configuredPassword = getAdminPassword();
  if (!configuredPassword) {
    return "线上还没有设置 ADMIN_PASSWORD 环境变量，暂时不能上传";
  }

  const providedPassword = String(formData.get("password") || "");
  if (providedPassword !== configuredPassword) {
    return "上传密码不正确";
  }

  return "";
}

async function readUploadText(file: FormDataEntryValue | null) {
  if (!file || typeof file === "string") {
    return null;
  }

  return await file.text();
}

async function handleUpload(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "只支持 POST 上传" }, 405);
  }

  const formData = await req.formData();
  const adminError = requireAdmin(formData);
  if (adminError) {
    return jsonResponse({ error: adminError }, 401);
  }

  const store = getDashboardStore();
  const uploaded: string[] = [];
  const dailyFile = formData.get("dailyFile");
  const taskText = await readUploadText(formData.get("taskFile"));
  const processTaskText = await readUploadText(formData.get("processTaskFile"));
  const newAnchorTaskText = await readUploadText(formData.get("newAnchorTaskFile"));

  if (taskText) {
    await store.set(TASKS_KEY, taskText);
    uploaded.push("月任务");
  }

  if (processTaskText) {
    await store.set(PROCESS_TASK_KEY, processTaskText);
    uploaded.push("过程任务");
  }

  if (newAnchorTaskText) {
    await store.set(NEW_ANCHOR_TASK_KEY, newAnchorTaskText);
    uploaded.push("拉新任务");
  }

  if (dailyFile && typeof dailyFile !== "string") {
    const dailyText = await dailyFile.text();
    const rows = parseCsv(dailyText);
    if (rows.length < 2) {
      return jsonResponse({ error: "日报文件为空或不是有效 CSV" }, 400);
    }

    const originalName = dailyFile.name || `daily-${Date.now()}.csv`;
    const displayName = buildDailyDisplayName(originalName);
    const fileDate = parseFileDate(originalName);
    const id = `${formatDate(fileDate)}-${Date.now()}-${slugFileName(displayName)}`;
    const dailyMeta = {
      id,
      name: displayName,
      date: formatDate(fileDate),
      month: monthFromDate(fileDate),
      size: dailyFile.size,
      updatedAt: new Date().toISOString(),
      timestamp: fileDate.getTime()
    };
    const files = await readDailyIndex();
    const nextFiles = [dailyMeta, ...files]
      .sort((left, right) => right.timestamp - left.timestamp || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 120);

    await store.set(`daily/${id}.csv`, dailyText);
    await writeDailyIndex(nextFiles);
    uploaded.push("日报");
  }

  if (uploaded.length === 0) {
    return jsonResponse({ error: "请选择至少一个 CSV 文件上传" }, 400);
  }

  return jsonResponse({
    ok: true,
    message: `已上传：${uploaded.join("、")}`,
    files: await readDailyIndex()
  });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const actionFromQuery = url.searchParams.get("action") || "";
  const actionFromApiPath = url.pathname.replace(/^\/api\/?/, "");
  const actionFromFunctionPath = url.pathname
    .replace(/^\/\.netlify\/functions\/api\/?/, "")
    .replace(/^\/\.netlify\/functions\/dashboard\/?/, "");
  const action = actionFromQuery || actionFromApiPath || actionFromFunctionPath;

  try {
    if (action === "files") {
      return await handleFiles();
    }
    if (action === "data") {
      return await handleData(req);
    }
    if (action === "upload") {
      return await handleUpload(req);
    }

    return jsonResponse({ error: "接口不存在" }, 404);
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "服务器处理失败"
    }, 500);
  }
};

export const config = {
  path: [
    "/api/:action",
    "/.netlify/functions/api/:action?",
    "/.netlify/functions/dashboard/:action?"
  ]
};

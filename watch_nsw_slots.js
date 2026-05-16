const { chromium } = require("playwright");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SERVICE_URL =
  "https://www.service.nsw.gov.au/transaction/view-change-or-cancel-a-driver-or-rider-licence-test";
const DEFAULT_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const args = new Set(process.argv.slice(2));
const bookingNumber = process.env.BOOKING_NUMBER || "";
const familyName = process.env.FAMILY_NAME || "";
const fixedIntervalMinutes = process.env.INTERVAL_MINUTES
  ? Number(process.env.INTERVAL_MINUTES)
  : null;
const minIntervalMinutes = Number(process.env.INTERVAL_MINUTES_MIN || 25);
const maxIntervalMinutes = Number(process.env.INTERVAL_MINUTES_MAX || 35);
const headful = process.env.HEADFUL === "1" || args.has("--headful");
const once = process.env.ONCE === "1" || args.has("--once");
const heartbeatNotify = process.env.HEARTBEAT_NOTIFY !== "0";
const testNotify = args.has("--test-notify");
const testHeartbeat = args.has("--test-heartbeat");
const publicBroadcast = process.env.PUBLIC_BROADCAST === "1";
const targetLocation = process.env.TARGET_LOCATION || "Botany";
const statusJsonPath = process.env.STATUS_JSON_PATH || "docs/status.json";
const statePath = process.env.STATE_PATH || "state/public_broadcast_state.json";
const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME_PATH;

function parseCurrentBookingDate(text) {
  const match = text.match(/Date of test:\s*([A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
  if (!match) return null;
  const date = new Date(`${match[1]} 12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseSlotDate(dateText, weekText) {
  const dateMatch = dateText.match(/[A-Za-z]{3}\s+(\d{1,2})\/(\d{1,2})/);
  const yearMatch = weekText.match(/(\d{4})/);
  if (!dateMatch || !yearMatch) return null;
  return new Date(Number(yearMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[1]), 12, 0, 0);
}

function formatDate(date) {
  return date.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function randomIntervalMinutes() {
  if (fixedIntervalMinutes !== null) return fixedIntervalMinutes;
  return minIntervalMinutes + Math.random() * (maxIntervalMinutes - minIntervalMinutes);
}

function ntfyPublishUrl() {
  const raw = process.env.NTFY_TOPIC;
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^ntfy\.sh\//i.test(raw)) return `https://${raw}`;

  const server = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  return `${server}/${encodeURIComponent(raw)}`;
}

async function notifyExternal(title, message, options = {}) {
  const priority = options.priority || "urgent";
  const tags = options.tags || "warning";
  const channels = options.channels || ["ntfy", "pushover", "telegram"];
  const jobs = [];

  const ntfyUrl = ntfyPublishUrl();
  if (ntfyUrl && channels.includes("ntfy")) {
    jobs.push(
      fetch(ntfyUrl, {
        method: "POST",
        headers: {
          Title: title,
          Priority: priority,
          Tags: tags,
        },
        body: message,
      })
    );
  }

  if (
    process.env.PUSHOVER_TOKEN &&
    process.env.PUSHOVER_USER &&
    channels.includes("pushover")
  ) {
    const pushoverPriority = {
      min: "-2",
      low: "-1",
      default: "0",
      high: "1",
      urgent: "1",
      max: "1",
    }[priority] || "1";
    jobs.push(
      fetch("https://api.pushover.net/1/messages.json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: process.env.PUSHOVER_TOKEN,
          user: process.env.PUSHOVER_USER,
          title,
          message,
          priority: pushoverPriority,
        }),
      })
    );
  }

  if (
    process.env.TELEGRAM_BOT_TOKEN &&
    process.env.TELEGRAM_CHAT_ID &&
    channels.includes("telegram")
  ) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `${title}\n${message}`,
          disable_web_page_preview: true,
        }),
      })
    );
  }

  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`Notification failed: ${result.reason}`);
    } else if (!result.value.ok) {
      console.error(`Notification failed: HTTP ${result.value.status}`);
    }
  }
}

async function notify(title, message, options = {}) {
  console.log(`${title}: ${message}`);
  if (process.platform === "darwin") {
    const esc = (value) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    spawnSync("/usr/bin/osascript", [
      "-e",
      `display notification "${esc(message)}" with title "${esc(title)}"`,
    ]);
  }
  await notifyExternal(title, message, options);
}

async function waitForDojo(page) {
  await page.waitForFunction(
    () =>
      window.dijit &&
      dijit.byId("widget_input_bookingId") &&
      dijit.byId("widget_input_familyName") &&
      dijit.byId("submitNoLogin"),
    null,
    { timeout: 30000 }
  );
}

async function setBookingFields(page) {
  await page.evaluate(
    ({ bookingNumber, familyName }) => {
      dijit.byId("widget_input_bookingId").set("value", bookingNumber);
      dijit.byId("widget_input_familyName").set("value", familyName);
      dijit.byId("widget_input_bookingId").validate();
      dijit.byId("widget_input_familyName").validate();
      dijit.byId("searchBookingCriteria").validate?.();
    },
    { bookingNumber, familyName }
  );
  await page.waitForFunction(() => !dijit.byId("submitNoLogin").get("disabled"), null, {
    timeout: 10000,
  });
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to read ${filePath}: ${error.message}`);
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

function earliestKey(earliest) {
  if (!earliest) return null;
  return `${earliest.date}|${earliest.time}`;
}

function loadPreviousEarliest() {
  const state = readJsonIfExists(statePath);
  if (state && state.earliest !== undefined) return state.earliest;
  const status = readJsonIfExists(statusJsonPath);
  if (status && status.earliest !== undefined) return status.earliest;
  return undefined;
}

async function checkOnce() {
  const browser = await chromium.launch({
    headless: !headful,
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  });

  try {
    const page = await browser.newPage({
      locale: "en-US",
      userAgent: USER_AGENT,
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(30000);

    await page.goto(SERVICE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    const manageHref = await page.locator("a", { hasText: "Manage booking" }).getAttribute("href");
    if (!manageHref) throw new Error("Could not find Manage booking link");

    await page.goto(manageHref, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForDojo(page);
    await setBookingFields(page);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.locator("#submitNoLogin").click({ force: true }),
    ]);
    await page.waitForLoadState("load", { timeout: 60000 }).catch(() => {});

    const detailsText = await page.locator("body").innerText();
    if (/details you have entered are incorrect/i.test(detailsText)) {
      throw new Error("Booking number/family name were rejected by myRTA");
    }
    const currentDate = parseCurrentBookingDate(detailsText);
    if (!currentDate) throw new Error("Could not parse current booking date");

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.locator("#changeTimeButton").click({ force: true }),
    ]);
    await page.waitForLoadState("load", { timeout: 60000 }).catch(() => {});

    const earliestLinks = page.locator('a[href="javascript:getEarliestAvailableDate();"]');
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {}),
      earliestLinks.nth(0).click(),
    ]);
    await page.waitForLoadState("load", { timeout: 90000 }).catch(() => {});

    const result = await page.evaluate(() => {
      const slotTable = Array.from(document.querySelectorAll("table")).find((table) =>
        table.querySelector("td a.available")
      );
      const weekText =
        document.body.innerText.match(/Week starting\s+\d{1,2}\/\d{1,2}\/\d{4}/)?.[0] || "";
      if (!slotTable) return { weekText, slots: [] };
      const headers = Array.from(slotTable.rows[0].cells).map((cell) =>
        cell.innerText.trim().replace(/\s+/g, " ")
      );
      const slots = Array.from(slotTable.querySelectorAll("td a.available")).map((link) => {
        const td = link.closest("td");
        const cells = Array.from(td.parentElement.cells);
        return {
          dateText: headers[cells.indexOf(td)],
          time: link.textContent.trim(),
          id: td.id,
        };
      });
      return { weekText, slots };
    });

    const slots = result.slots
      .map((slot) => ({ ...slot, date: parseSlotDate(slot.dateText, result.weekText) }))
      .filter((slot) => slot.date)
      .sort((a, b) => a.date - b.date || a.time.localeCompare(b.time));

    const earliest = slots[0] || null;
    const checkedAt = new Date().toLocaleString("en-AU");
    const checkedAtIso = new Date().toISOString();
    const earliestPayload = earliest
      ? { date: formatDate(earliest.date), time: earliest.time }
      : null;
    const currentBookingDateText = formatDate(currentDate);

    if (publicBroadcast) {
      const previousEarliest = loadPreviousEarliest();
      const firstRun = previousEarliest === undefined;
      const changed = !firstRun && earliestKey(previousEarliest) !== earliestKey(earliestPayload);

      const broadcastMessage = earliestPayload
        ? `${targetLocation} earliest slot: ${earliestPayload.date} ${earliestPayload.time}`
        : `${targetLocation} earliest slot: none currently available`;

      const statusDoc = {
        location: targetLocation,
        checkedAt: checkedAtIso,
        currentBookingDate: currentBookingDateText,
        earliest: earliestPayload,
        changed,
        firstRun,
        message: broadcastMessage,
      };

      writeJsonAtomic(statusJsonPath, statusDoc);
      writeJsonAtomic(statePath, {
        location: targetLocation,
        checkedAt: checkedAtIso,
        earliest: earliestPayload,
      });

      if (changed) {
        await notifyExternal(
          `${targetLocation} driving test slot update`,
          broadcastMessage,
          { priority: "high", tags: "calendar", channels: ["ntfy", "telegram"] }
        );
      }

      return {
        mode: "public",
        checkedAt,
        current: currentBookingDateText,
        earliest: earliestPayload
          ? `${earliestPayload.date} ${earliestPayload.time}`
          : null,
        shouldAlert: changed,
        firstRun,
        message: broadcastMessage,
      };
    }

    if (!earliest) {
      return {
        mode: "personal",
        checkedAt,
        current: currentBookingDateText,
        earliest: null,
        shouldAlert: false,
        message: `Current: ${currentBookingDateText}. No available ${targetLocation} slots found after earliest search.`,
      };
    }

    const shouldAlert = earliest.date < currentDate;
    const message = `Current: ${currentBookingDateText}. Earliest ${targetLocation} slot: ${formatDate(
      earliest.date
    )} ${earliest.time}.`;

    if (shouldAlert) {
      await notify(`Earlier NSW driving test slot found`, message, {
        priority: "urgent",
        tags: "warning",
      });
    }

    return {
      mode: "personal",
      checkedAt,
      current: currentBookingDateText,
      earliest: `${formatDate(earliest.date)} ${earliest.time}`,
      shouldAlert,
      message,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  if (testNotify) {
    await notify(
      "NSW driving test watcher test",
      "URGENT test notification from the watcher.",
      { priority: "urgent", tags: "warning" }
    );
    return;
  }
  if (testHeartbeat) {
    await notifyExternal(
      "NSW driving test watcher heartbeat",
      "LOW priority heartbeat test: watcher is running, no earlier slot found.",
      { priority: "low", tags: "hourglass", channels: ["ntfy"] }
    );
    return;
  }
  if (!bookingNumber || !familyName) {
    throw new Error(
      "Set BOOKING_NUMBER and FAMILY_NAME environment variables before running."
    );
  }
  if (
    (fixedIntervalMinutes !== null &&
      (!Number.isFinite(fixedIntervalMinutes) || fixedIntervalMinutes < 5)) ||
    !Number.isFinite(minIntervalMinutes) ||
    !Number.isFinite(maxIntervalMinutes) ||
    minIntervalMinutes < 5 ||
    maxIntervalMinutes < minIntervalMinutes
  ) {
    throw new Error(
      "INTERVAL_MINUTES or INTERVAL_MINUTES_MIN/MAX must be valid and at least 5"
    );
  }

  do {
    const result = await checkOnce();
    console.log(`[${result.checkedAt}] ${result.message}`);
    if (result.mode === "personal" && result.shouldAlert) break;
    const delayMinutes = once ? null : randomIntervalMinutes();
    const nextCheck = delayMinutes
      ? new Date(Date.now() + delayMinutes * 60 * 1000).toLocaleString("en-AU")
      : null;
    if (heartbeatNotify && result.mode === "personal") {
      const heartbeatMessage = nextCheck
        ? `${result.message} Next check around ${nextCheck}.`
        : result.message;
      await notifyExternal("NSW driving test watcher heartbeat", heartbeatMessage, {
        priority: "low",
        tags: "hourglass",
        channels: ["ntfy"],
      });
    }
    if (once) break;
    console.log(`Next check in ${delayMinutes.toFixed(1)} minutes, around ${nextCheck}.`);
    await new Promise((resolve) => setTimeout(resolve, delayMinutes * 60 * 1000));
  } while (true);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

import { getStore } from "@netlify/blobs";

const APP_ID = process.env.ONESIGNAL_APP_ID;
const REST_KEY = process.env.ONESIGNAL_REST_API_KEY;

function localClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute)
  };
}

function previousDate(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d) - 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dueInfo(record, now) {
  const { wake, sleep, interval } = record.settings;
  const [wh, wm] = wake.split(":").map(Number);
  const [sh, sm] = sleep.split(":").map(Number);
  const start = wh * 60 + wm;
  const end = sh * 60 + sm;
  const { date, minute } = localClock(now, record.timezone || "America/Sao_Paulo");
  const overnight = end < start;
  const inWindow = overnight ? (minute >= start || minute <= end) : (minute >= start && minute <= end);
  if (!inWindow || start === end) return null;
  const elapsed = minute >= start ? minute - start : 1440 - start + minute;
  const slot = Math.floor(elapsed / Number(interval));
  if (slot < 1) return null;
  const serviceDate = overnight && minute < start ? previousDate(date) : date;
  if (record.lastSentDate === serviceDate && slot <= Number(record.lastSentSlot || 0)) return null;
  if (record.consumedDate === date && Number(record.consumedToday || 0) >= Number(record.settings.goal)) return null;
  return { serviceDate, slot };
}

async function sendPush(subscriptionId) {
  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Authorization": `Key ${REST_KEY}`
    },
    body: JSON.stringify({
      app_id: APP_ID,
      include_subscription_ids: [subscriptionId],
      headings: { pt: "Hora de beber água 💧" },
      contents: { pt: "Faça uma pausa e beba um copo de água. Seu corpo agradece!" }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OneSignal ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

export default async () => {
  if (!APP_ID || !REST_KEY) {
    console.error("Configure ONESIGNAL_APP_ID e ONESIGNAL_REST_API_KEY nas variáveis de ambiente do Netlify.");
    return;
  }

  const store = getStore("water-reminder-users");
  const { blobs = [] } = await store.list({ prefix: "subscription-" });
  const now = new Date();
  let sent = 0;

  for (const blob of blobs) {
    const record = await store.get(blob.key, { type: "json", consistency: "strong" });
    if (!record?.settings?.reminders || !record.subscriptionId) continue;
    const due = dueInfo(record, now);
    if (!due) continue;

    try {
      await sendPush(record.subscriptionId);
      record.lastSentDate = due.serviceDate;
      record.lastSentSlot = due.slot;
      record.lastSentAt = now.toISOString();
      await store.setJSON(blob.key, record);
      sent += 1;
    } catch (error) {
      console.error(`Falha ao enviar para ${blob.key}:`, error);
    }
  }
  console.log(`Rotina concluída. Notificações enviadas: ${sent}.`);
};

export const config = { schedule: "* * * * *" };

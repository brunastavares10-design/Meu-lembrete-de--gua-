import { getStore } from "@netlify/blobs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

const validTime = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Envie os dados em JSON." }, 400); }

  const { subscriptionId, settings, timezone, consumedToday = 0, consumedDate } = input || {};
  if (typeof subscriptionId !== "string" || !/^[a-f0-9-]{20,60}$/i.test(subscriptionId)) {
    return json({ error: "ID de assinatura inválido. Verifique a inscrição no OneSignal." }, 400);
  }
  if (!settings || typeof settings !== "object" || typeof settings.reminders !== "boolean" ||
      !validTime(settings.wake) || !validTime(settings.sleep) ||
      ![15, 20, 30, 45, 60, 90, 120].includes(Number(settings.interval)) ||
      !Number.isFinite(Number(settings.goal)) || Number(settings.goal) < 100 || Number(settings.goal) > 10000) {
    return json({ error: "Configurações de lembrete inválidas." }, 400);
  }

  let safeTimezone = "America/Sao_Paulo";
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format(); safeTimezone = timezone; } catch {}

  const store = getStore("water-reminder-users");
  const key = `subscription-${subscriptionId}`;
  const old = await store.get(key, { type: "json", consistency: "strong" });
  const record = {
    subscriptionId,
    settings: {
      goal: Number(settings.goal),
      wake: settings.wake,
      sleep: settings.sleep,
      interval: Number(settings.interval),
      reminders: settings.reminders
    },
    timezone: safeTimezone,
    consumedToday: Math.max(0, Number(consumedToday) || 0),
    consumedDate: typeof consumedDate === "string" ? consumedDate : null,
    lastSentDate: old?.lastSentDate || null,
    lastSentSlot: Number.isInteger(old?.lastSentSlot) ? old.lastSentSlot : 0,
    updatedAt: new Date().toISOString()
  };
  await store.setJSON(key, record);
  return json({ ok: true, enabled: record.settings.reminders, message: "Preferências sincronizadas." });
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ukrfnapkypperwvmgiie.supabase.co";
const SUPABASE_KEY = Deno.env.get("SERVICE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
  });
}

Deno.serve(async () => {
  const today = new Date().toISOString().split("T")[0];

  const { data: tasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("due_date", today)
    .neq("status", "posted");

  const { data: burning } = await supabase
    .from("tasks")
    .select("*")
    .lt("due_date", today)
    .neq("status", "posted")
    .neq("status", "missed");

  let message = `🗓 <b>Taskona.AI — Daily Brief</b>\n📅 ${today}\n\n`;

  if (tasks && tasks.length > 0) {
    message += `<b>📋 Due Today (${tasks.length}):</b>\n`;
    tasks.forEach(t => {
      message += `• ${t.title} — <i>${t.role}</i> [${t.post_title}]\n`;
    });
  } else {
    message += `✅ Nothing due today\n`;
  }

  if (burning && burning.length > 0) {
    message += `\n<b>🔥 Burning (${burning.length}):</b>\n`;
    burning.forEach(t => {
      message += `• ${t.title} — <i>${t.role}</i> [${t.post_title}]\n`;
    });
  }

  message += `\n👉 taskona-app.vercel.app`;

  await sendTelegram(message);

  return new Response(
    JSON.stringify({ ok: true, today, tasks_today: tasks?.length ?? 0, burning: burning?.length ?? 0 }),
    { headers: { "Content-Type": "application/json" } }
  );
});

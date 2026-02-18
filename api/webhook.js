import axios from "axios";
import * as cheerio from "cheerio";

const BOT_TOKEN = process.env.BOT_TOKEN; // WAJIB
const BOT_USERNAME = process.env.BOT_USERNAME || "your_bot"; // opsional (tanpa @)
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export default async function handler(req, res) {
  // Healthcheck
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  if (!BOT_TOKEN) {
    return res.status(500).send("Missing env BOT_TOKEN");
  }

  // Vercel bisa kirim body sebagai string/object
  const update = typeof req.body === "string" ? safeJson(req.body) : req.body;

  // Telegram update: message / edited_message
  const msg = update?.message || update?.edited_message;
  if (!msg?.text) return res.status(200).send("OK");

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Validasi: harus link tiktok
  if (!text.includes("tiktok.com")) {
    await sendMessage(chatId, "Kirim link TikTok ya kak 😊\nContoh: https://vt.tiktok.com/xxxxx/");
    return res.status(200).send("OK");
  }

  try {
    await sendChatAction(chatId, "upload_video");

    const { title, videoUrl, mp3Url } = await fetchFromTikDownloader(text);

    if (!videoUrl && !mp3Url) {
      await sendMessage(chatId, "Maaf kak, link download tidak ditemukan 😢");
      return res.status(200).send("OK");
    }

    const caption = `${title || "TikTok Download"}\n\nDownloaded via @${BOT_USERNAME}`;

    // ✅ Kirim video langsung (preview + tombol download)
    if (videoUrl) {
      await sendVideo(chatId, videoUrl, caption);
    }

    // ✅ Kirim MP3 juga (kalau ada)
    if (mp3Url) {
      await sendChatAction(chatId, "upload_audio");
      await sendAudio(chatId, mp3Url, "🎵 MP3 siap diunduh");
    }

    return res.status(200).send("OK");
  } catch (err) {
    await sendMessage(chatId, "Terjadi kesalahan 😢\nCoba kirim link lagi ya.");
    return res.status(200).send("OK");
  }
}

function safeJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

async function fetchFromTikDownloader(tiktokUrl) {
  const resp = await axios.post(
    "https://tikdownloader.io/api/ajaxSearch",
    `q=${encodeURIComponent(tiktokUrl)}&lang=id`,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": "https://tikdownloader.io/id"
      },
      timeout: 15000
    }
  );

  const html = resp?.data?.data;
  if (!html) return { title: null, videoUrl: null, mp3Url: null };

  const $ = cheerio.load(html);

  const title = $("h3").first().text().trim() || null;

  let videoUrl = null;
  let mp3Url = null;

  // Cari tombol download berdasarkan label
  $("a.tik-button-dl").each((_, el) => {
    const label = ($(el).text() || "").replace(/\s+/g, " ").trim();
    const href = $(el).attr("href");
    if (!href) return;

    // prioritas
    if (label.includes("MP4 HD")) videoUrl = href;
    if (label.includes("MP3")) mp3Url = href;
  });

  // fallback video pertama kalau tidak ada HD
  if (!videoUrl) {
    const first = $("a.tik-button-dl").first().attr("href");
    if (first) videoUrl = first;
  }

  return { title, videoUrl, mp3Url };
}

/* =================== TELEGRAM HELPERS =================== */

async function tg(method, payload) {
  return axios.post(`${TELEGRAM_API}/${method}`, payload, { timeout: 15000 });
}

async function sendMessage(chatId, text) {
  await tg("sendMessage", { chat_id: chatId, text });
}

async function sendChatAction(chatId, action) {
  await tg("sendChatAction", { chat_id: chatId, action });
}

async function sendVideo(chatId, videoUrl, caption) {
  // supports_streaming biar tampil preview seperti bot downloader
  await tg("sendVideo", {
    chat_id: chatId,
    video: videoUrl,
    caption,
    supports_streaming: true
  });
}

async function sendAudio(chatId, audioUrl, caption) {
  await tg("sendAudio", {
    chat_id: chatId,
    audio: audioUrl,
    caption
  });
}

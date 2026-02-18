import axios from "axios";
import cheerio from "cheerio";

const BOT_TOKEN = process.env.BOT_TOKEN; // wajib
const BOT_USERNAME = process.env.BOT_USERNAME || "your_bot"; // opsional (tanpa @)
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

function mustHaveEnv() {
  if (!BOT_TOKEN) throw new Error("Missing env BOT_TOKEN");
}

export default async function handler(req, res) {
  try {
    mustHaveEnv();
  } catch (e) {
    return res.status(500).send(String(e.message || e));
  }

  // Vercel kadang mengirim body sebagai object / string
  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;

  // GET ping
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  // Telegram update bisa message / edited_message
  const msg = body?.message || body?.edited_message;
  if (!msg?.text) return res.status(200).send("OK");

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Basic filter
  if (!text.includes("tiktok.com")) {
    await sendMessage(chatId, "Kirim link TikTok ya kak 😊\nContoh: https://vt.tiktok.com/xxxxx/");
    return res.status(200).send("OK");
  }

  // optional: beri status "typing" / "uploading"
  await sendChatAction(chatId, "upload_video");

  try {
    const { title, videoUrl, mp3Url, thumbnailUrl } = await fetchFromTikDownloader(text);

    if (!videoUrl && !mp3Url) {
      await sendMessage(chatId, "Maaf kak, link download tidak ditemukan 😢");
      return res.status(200).send("OK");
    }

    const caption = `${title || "TikTok Video"}\n\nDownloaded via @${BOT_USERNAME}`;

    // 1) Kirim VIDEO langsung (hasilnya seperti di foto: ada preview & tombol download)
    if (videoUrl) {
      // Kalau link kadang berat, sendVideo adalah opsi paling mirip preview seperti bot2 downloader
      await sendVideo(chatId, videoUrl, caption);
    }

    // 2) Kirim MP3 juga (kalau ada)
    if (mp3Url) {
      await sendChatAction(chatId, "upload_audio");
      await sendAudio(chatId, mp3Url, "🎵 MP3 siap diunduh");
    }

    // (Opsional) kirim thumbnail sebagai photo dulu:
    // kalau mau tampil seperti "cover", uncomment:
    // if (thumbnailUrl) await sendPhoto(chatId, thumbnailUrl, title || "");

    return res.status(200).send("OK");
  } catch (e) {
    // fallback error message
    await sendMessage(chatId, "Terjadi kesalahan saat memproses link 😢\nCoba kirim lagi ya.");
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
  if (!html) return { title: null, videoUrl: null, mp3Url: null, thumbnailUrl: null };

  const $ = cheerio.load(html);

  // Judul (dari <h3> di HTML contoh kamu)
  const title = $("h3").first().text().trim() || null;

  // Thumbnail (dari img src pada .image-tik)
  const thumbnailUrl = $(".image-tik img").attr("src") || null;

  let videoUrl = null;
  let mp3Url = null;

  // Cari tombol download berdasarkan label
  $("a.tik-button-dl").each((_, el) => {
    const label = ($(el).text() || "").replace(/\s+/g, " ").trim();
    const href = $(el).attr("href");
    if (!href) return;

    if (label.includes("MP4 HD")) videoUrl = href;
    if (label.includes("MP3")) mp3Url = href;
  });

  // fallback video pertama kalau tidak ketemu HD
  if (!videoUrl) {
    const first = $("a.tik-button-dl").first().attr("href");
    if (first) videoUrl = first;
  }

  return { title, videoUrl, mp3Url, thumbnailUrl };
}

/** ============ TELEGRAM HELPERS ============ */

async function tg(method, payload) {
  const url = `${TELEGRAM_API}/${method}`;
  return axios.post(url, payload, { timeout: 15000 });
}

async function sendMessage(chatId, text) {
  await tg("sendMessage", { chat_id: chatId, text });
}

async function sendChatAction(chatId, action) {
  // action: typing, upload_video, upload_audio, upload_document, etc.
  await tg("sendChatAction", { chat_id: chatId, action });
}

async function sendVideo(chatId, videoUrl, caption) {
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

// optional
async function sendPhoto(chatId, photoUrl, caption) {
  await tg("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption
  });
}

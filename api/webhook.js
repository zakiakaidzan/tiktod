import axios from "axios";
import * as cheerio from "cheerio";

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || "your_bot";
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");

  console.log("INCOMING UPDATE:", JSON.stringify(req.body));

  if (!BOT_TOKEN) {
    console.error("Missing env BOT_TOKEN");
    return res.status(500).send("Missing env BOT_TOKEN");
  }

  const update = typeof req.body === "string" ? safeJson(req.body) : req.body;
  const msg = update?.message || update?.edited_message;
  if (!msg?.text) return res.status(200).send("OK");

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text === "/start") {
    await sendMessage(
      chatId,
      "✅ Bot aktif!\n\nKirim link TikTok ya kak.\nContoh:\nhttps://vt.tiktok.com/xxxxx/"
    );
    return res.status(200).send("OK");
  }

  if (!text.includes("tiktok.com")) {
    await sendMessage(chatId, "Kirim link TikTok ya kak 😊");
    return res.status(200).send("OK");
  }

  try {
    await sendChatAction(chatId, "typing");

    // ✅ Resolve shortlink vt.tiktok.com -> url panjang
    const resolvedUrl = await resolveTikTokUrl(text);
    console.log("RESOLVED URL:", resolvedUrl);

    await sendChatAction(chatId, "upload_video");

    const { title, videoUrl, mp3Url } = await fetchFromTikDownloader(resolvedUrl);
    console.log("PARSED:", { title, videoUrl, mp3Url });

    if (!videoUrl && !mp3Url) {
      await sendMessage(chatId, "Maaf kak, link download tidak ditemukan 😢");
      return res.status(200).send("OK");
    }

    const caption = `${title || "TikTok Download"}\n\nDownloaded via @${BOT_USERNAME}`;

    // Kirim video langsung (preview + tombol download)
    if (videoUrl) await sendVideo(chatId, videoUrl, caption);

    // Kirim MP3 juga
    if (mp3Url) {
      await sendChatAction(chatId, "upload_audio");
      await sendAudio(chatId, mp3Url, "🎵 MP3 siap diunduh");
    }

    return res.status(200).send("OK");
  } catch (err) {
    // tampilkan error detail di logs
    console.error("ERROR:", err?.response?.status, err?.response?.data || err?.message || err);
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

// ✅ Resolve vt.tiktok shortlink
async function resolveTikTokUrl(url) {
  try {
    // pakai GET dengan redirect follow
    const r = await axios.get(url, {
      maxRedirects: 5,
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
      },
      // jangan error kalau status 3xx/4xx, kita ambil final url jika ada
      validateStatus: () => true,
    });

    // axios menyimpan final url di request.res.responseUrl (Node)
    const finalUrl = r?.request?.res?.responseUrl;
    return finalUrl || url;
  } catch {
    return url;
  }
}

async function fetchFromTikDownloader(tiktokUrl) {
  const body = `q=${encodeURIComponent(tiktokUrl)}&lang=id`;

  const resp = await axios.post("https://tikdownloader.io/api/ajaxSearch", body, {
    timeout: 20000,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://tikdownloader.io",
      "Referer": "https://tikdownloader.io/id",
      "Accept": "*/*",
      "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
    validateStatus: () => true,
  });

  if (!resp?.data) {
    throw new Error("No response body from tikdownloader");
  }

  // kalau diblok / error
  if (resp.status >= 400) {
    throw new Error(`tikdownloader HTTP ${resp.status}`);
  }

  const html = resp?.data?.data;
  if (!html) {
    // kadang resp.data.status bukan ok
    throw new Error(`tikdownloader invalid data: ${JSON.stringify(resp.data).slice(0, 300)}`);
  }

  const $ = cheerio.load(html);

  const title = $("h3").first().text().trim() || null;

  let videoUrl = null;
  let mp3Url = null;

  $("a.tik-button-dl").each((_, el) => {
    const label = ($(el).text() || "").replace(/\s+/g, " ").trim();
    const href = $(el).attr("href");
    if (!href) return;

    if (label.includes("MP4 HD")) videoUrl = href;
    if (label.includes("MP3")) mp3Url = href;
  });

  if (!videoUrl) {
    const first = $("a.tik-button-dl").first().attr("href");
    if (first) videoUrl = first;
  }

  return { title, videoUrl, mp3Url };
}

/* ============ TELEGRAM HELPERS ============ */

async function tg(method, payload) {
  return axios.post(`${TELEGRAM_API}/${method}`, payload, { timeout: 20000 });
}

async function sendMessage(chatId, text) {
  await tg("sendMessage", { chat_id: chatId, text });
}

async function sendChatAction(chatId, action) {
  await tg("sendChatAction", { chat_id: chatId, action });
}

async function sendVideo(chatId, videoUrl, caption) {
  await tg("sendVideo", {
    chat_id: chatId,
    video: videoUrl,
    caption,
    supports_streaming: true,
  });
}

async function sendAudio(chatId, audioUrl, caption) {
  await tg("sendAudio", {
    chat_id: chatId,
    audio: audioUrl,
    caption,
  });
}

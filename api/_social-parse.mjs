// Parsers for the public social feeds read by api/social.mjs. Pure functions (no network), so
// they are unit tested against small fixtures in test/social.test.mjs.
//
// Every parser returns posts of one shape:
//   { id, source: 'telegram'|'reddit'|'mastodon', channel, author, date (ms), text, url }

const MAX_TEXT = 1200;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export const decodeEntities = s => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);

/** HTML fragment -> plain text: <br> and paragraph ends become newlines, other tags vanish. */
export function htmlToText(html) {
  const text = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const clip = s => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1).trimEnd()}…` : s);
const httpOnly = u => (/^https?:\/\//i.test(u || '') ? u : '');

/**
 * Telegram public channel preview (https://t.me/s/<channel>). Posts without text (photo-only,
 * "channel created" service messages) are skipped.
 */
export function parseTelegram(html, channel) {
  const posts = [];
  for (const block of String(html || '').split('tgme_widget_message_wrap').slice(1)) {
    const post = /data-post="([A-Za-z0-9_]+\/\d+)"/.exec(block);
    if (!post) continue;
    const body = /<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/.exec(block);
    const time = /<time datetime="([^"]+)"/.exec(block);
    const date = time ? Date.parse(time[1]) : NaN;
    const text = body ? htmlToText(body[1]) : '';
    if (!text || Number.isNaN(date)) continue;
    const author = /tgme_widget_message_owner_name[^>]*><span[^>]*>([\s\S]*?)<\/span>/.exec(block);
    posts.push({
      id: `tg:${post[1]}`,
      source: 'telegram',
      channel: `@${channel}`,
      author: author ? htmlToText(author[1]) : `@${channel}`,
      date,
      text: clip(text),
      url: `https://t.me/${post[1]}`
    });
  }
  return posts;
}

/** Reddit subreddit Atom feed (https://www.reddit.com/r/<sub>/new/.rss). */
export function parseRedditAtom(xml, sub) {
  const posts = [];
  for (const m of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const pick = re => (re.exec(e) || [])[1] || '';
    const url = httpOnly(decodeEntities(pick(/<link href="([^"]+)"/)));
    const date = Date.parse(pick(/<published>([^<]+)<\/published>/) || pick(/<updated>([^<]+)<\/updated>/));
    const title = htmlToText(pick(/<title>([\s\S]*?)<\/title>/));
    // <content> is escaped HTML; Reddit appends "submitted by /u/x [link] [comments]" to every post
    const body = htmlToText(decodeEntities(pick(/<content[^>]*>([\s\S]*?)<\/content>/)))
      .replace(/\s*submitted by[\s\S]*$/, '').trim();
    if (!url || !title || Number.isNaN(date)) continue;
    posts.push({
      id: `rd:${pick(/<id>([^<]+)<\/id>/) || url}`,
      source: 'reddit',
      channel: `r/${sub}`,
      author: decodeEntities(pick(/<name>([^<]+)<\/name>/)).replace(/^\/u\//, 'u/'),
      date,
      text: clip(body ? `${title}\n\n${body}` : title),
      url
    });
  }
  return posts;
}

/** Mastodon hashtag timeline (GET /api/v1/timelines/tag/<tag>), already parsed JSON. */
export function parseMastodon(statuses, tag) {
  if (!Array.isArray(statuses)) return [];
  const posts = [];
  for (const s of statuses) {
    const status = s && s.reblog ? s.reblog : s;
    if (!status) continue;
    const url = httpOnly(status.url || status.uri);
    const date = Date.parse(status.created_at);
    const text = htmlToText(status.content);
    if (!url || !text || Number.isNaN(date)) continue;
    posts.push({
      id: `md:${status.id}`,
      source: 'mastodon',
      channel: `#${tag}`,
      author: status.account && status.account.acct ? `@${status.account.acct}` : '',
      date,
      text: clip(text),
      url
    });
  }
  return posts;
}

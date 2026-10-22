// Unit tests for the social feed parsers (api/_social-parse.mjs) and ticker tags
// (assets/js/social-tags.js).
//
//   npm test
//
// Fixtures are small hand-written copies of each source's markup, not real posts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decodeEntities, htmlToText, parseMastodon, parseRedditAtom, parseTelegram } from '../api/_social-parse.mjs';

const require = createRequire(import.meta.url);
const { extractTickers, topMentions } = require('../assets/js/social-tags.js');

const tgPost = (id, datetime, text) => `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="ornekkanal/${id}" data-view="x">
  <div class="tgme_widget_message_author accent_color"><a class="tgme_widget_message_owner_name" href="https://t.me/ornekkanal"><span dir="auto">Örnek &amp; Kanal</span></a></div>
  ${text === null ? '' : `<div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div>`}
  <div class="tgme_widget_message_info"><a class="tgme_widget_message_date" href="https://t.me/ornekkanal/${id}"><time datetime="${datetime}" class="time">12:00</time></a></div>
</div></div>`;

test('entities and html to text', () => {
  assert.equal(decodeEntities('a &amp; b &#39;c&#39; &#036;5 &#x1F680;'), "a & b 'c' $5 🚀");
  assert.equal(htmlToText('Satır 1<br/><br/><b>Satır</b> 2 &lt;tag&gt;'), 'Satır 1\n\nSatır 2 <tag>');
  assert.equal(htmlToText('<p>a</p><!-- x --><p>b</p>'), 'a\nb');
});

test('telegram channel preview', () => {
  const html = '<html>' +
    tgPost(1, '2026-10-22T10:00:00+00:00', '#ASELS hedef fiyat <a href="https://t.me/x">link</a><br/>ikinci satır') +
    tgPost(2, '2026-10-22T11:00:00+00:00', null) +                                  // photo only
    tgPost(3, 'not-a-date', 'tarihsiz') +
    tgPost(4, '2026-10-22T12:00:00+00:00', '<script>alert(1)</script>Merhaba') + '</html>';
  const posts = parseTelegram(html, 'ornekkanal');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], {
    id: 'tg:ornekkanal/1', source: 'telegram', channel: '@ornekkanal', author: 'Örnek & Kanal',
    date: Date.parse('2026-10-22T10:00:00Z'), text: '#ASELS hedef fiyat link\nikinci satır', url: 'https://t.me/ornekkanal/1'
  });
  assert.equal(posts[1].text, 'alert(1)Merhaba');   // tags stripped; the UI escapes the rest
  assert.deepEqual(parseTelegram('', 'x'), []);
});

test('telegram long posts are clipped', () => {
  const [p] = parseTelegram(tgPost(9, '2026-10-22T10:00:00Z', 'a'.repeat(5000)), 'k');
  assert.equal(p.text.length, 1200);
  assert.ok(p.text.endsWith('…'));
});

test('reddit atom feed', () => {
  const xml = `<?xml version="1.0"?><feed>
    <entry><author><name>/u/ornek_kullanici</name></author>
      <content type="html">&lt;div class=&quot;md&quot;&gt;&lt;p&gt;THYAO ne olur?&lt;/p&gt;&lt;/div&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/x&quot;&gt; /u/x &lt;/a&gt;</content>
      <id>t3_abc</id><link href="https://www.reddit.com/r/Borsa/comments/abc/baslik/" />
      <updated>2026-10-22T21:30:41+00:00</updated><published>2026-10-22T21:00:00+00:00</published><title>Başlık &amp; soru</title></entry>
    <entry><content type="html">&amp;#32; submitted by x</content><id>t3_def</id><link href="javascript:alert(1)" />
      <published>2026-10-22T21:00:00+00:00</published><title>Kötü link</title></entry>
    <entry><content type="html">&amp;#32; submitted by x</content><id>t3_ghi</id><link href="https://www.reddit.com/r/Borsa/comments/ghi/" />
      <published>2026-10-22T20:00:00+00:00</published><title>Yalnız başlık</title></entry>
  </feed>`;
  const posts = parseRedditAtom(xml, 'Borsa');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], {
    id: 'rd:t3_abc', source: 'reddit', channel: 'r/Borsa', author: 'u/ornek_kullanici',
    date: Date.parse('2026-10-22T21:00:00Z'), text: 'Başlık & soru\n\nTHYAO ne olur?', url: 'https://www.reddit.com/r/Borsa/comments/abc/baslik/'
  });
  assert.equal(posts[1].text, 'Yalnız başlık');
});

test('mastodon hashtag timeline', () => {
  const posts = parseMastodon([
    { id: '1', created_at: '2026-10-22T07:51:24.478Z', url: 'https://mastodon.social/@a/1', content: '<p>BIST 100 <a href="#">#bist100</a></p>', account: { acct: 'a' } },
    { id: '2', created_at: '2026-10-22T07:00:00Z', url: 'data:text/html,x', content: '<p>x</p>', account: { acct: 'b' } },
    { id: '3', created_at: '2026-10-22T06:00:00Z', reblog: { id: '30', created_at: '2026-10-21T06:00:00Z', url: 'https://m.example/@c/30', content: '<p>paylaşım</p>', account: { acct: 'c@m.example' } } }
  ], 'bist100');
  assert.deepEqual(posts.map(p => [p.id, p.author, p.text]), [['md:1', '@a', 'BIST 100 #bist100'], ['md:30', '@c@m.example', 'paylaşım']]);
  assert.deepEqual(parseMastodon({ error: 'x' }, 't'), []);
});

const CODES = new Set(['ASELS', 'THYAO', 'SASA', 'ARTI', 'EKIM', 'HEDEF', 'KTLEV', 'TUPRS']);

test('ticker extraction', () => {
  assert.deepEqual(extractTickers('#ASELS ve THYAO yükseldi, $sasa da', CODES), ['ASELS', 'THYAO', 'SASA']);
  assert.deepEqual(extractTickers('THYAO.IS ile THYAO aynı', CODES), ['THYAO']);
  // Codes that are ordinary words only count when tagged
  assert.deepEqual(extractTickers('EKIM AYINDA ARTI YÖNLÜ HEDEF', CODES), []);
  assert.deepEqual(extractTickers('#HEDEF #ekim', CODES), ['HEDEF', 'EKIM']);
  // Not inside longer words, not lowercase bare words, not unknown codes
  assert.deepEqual(extractTickers('ASELSAN thyao XYZQW KTLEVİ TUPRS\'ta', CODES), ['TUPRS']);
  assert.deepEqual(extractTickers('', CODES), []);
});

test('top mentions over the last 24 hours', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const posts = [
    { date: now - 1000, tickers: ['ASELS', 'SASA'] },
    { date: now - 2000, tickers: ['SASA'] },
    { date: now - 3000, tickers: ['THYAO'] },
    { date: now - 30 * 3600 * 1000, tickers: ['THYAO', 'THYAO'] }   // older than a day
  ];
  assert.deepEqual(topMentions(posts, now - 24 * 3600 * 1000), [
    { code: 'SASA', count: 2 }, { code: 'ASELS', count: 1 }, { code: 'THYAO', count: 1 }
  ]);
  assert.equal(topMentions(posts, 0, 1).length, 1);
});

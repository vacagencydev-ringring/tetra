const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ids = ['361','249','458','521','655','803','1249','695','1069','1159'];
const out = [];

for (const id of ids) {
  const p = path.join(process.cwd(), `inven_${id}.html`);
  const html = fs.readFileSync(p, 'utf8');
  const $ = cheerio.load(html, { decodeEntities: false });

  const title = ($('.articleTitle').first().text() || $('title').text()).trim();
  const content = $('#powerbbsContent').first();
  const text = content
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const imgs = [
    ...new Set(
      content
        .find('img')
        .map((_, el) => $(el).attr('src') || $(el).attr('data-src') || '')
        .get()
        .map((s) => (s.startsWith('//') ? `https:${s}` : s))
        .filter(Boolean)
    )
  ];

  out.push({
    id,
    url: `https://www.inven.co.kr/board/aion2/6444/${id}`,
    title,
    text,
    images: imgs
  });
}

fs.writeFileSync('inven_articles_parsed.json', JSON.stringify(out, null, 2), 'utf8');
console.log('wrote inven_articles_parsed.json');

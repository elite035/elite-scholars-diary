// Self-contained so both document adapters can embed exactly the same fitting code.
export function fitConsolidatedPage(page) {
  const presets = [
    {
      font: 15.5,
      urdu: 17,
      subject: 17,
      pad: 7,
      min: 30,
      brand: 116,
      crest: 96,
      title: 44,
      meta: 52,
      columns: 34,
      quote: 16,
      notice: 14,
      gap: 10,
    },
    {
      font: 14.5,
      urdu: 16,
      subject: 15,
      pad: 5,
      min: 27,
      brand: 88,
      crest: 88,
      title: 34,
      meta: 46,
      columns: 30,
      quote: 15,
      notice: 13,
      gap: 8,
    },
    {
      font: 13.5,
      urdu: 15,
      subject: 14,
      pad: 4,
      min: 25,
      brand: 82,
      crest: 82,
      title: 32,
      meta: 42,
      columns: 28,
      quote: 14,
      notice: 12,
      gap: 6,
    },
    {
      font: 12.5,
      urdu: 14,
      subject: 13,
      pad: 3,
      min: 23,
      brand: 78,
      crest: 78,
      title: 30,
      meta: 38,
      columns: 26,
      quote: 13,
      notice: 11.5,
      gap: 5,
    },
    {
      font: 11.5,
      urdu: 13,
      subject: 12,
      pad: 2,
      min: 22,
      brand: 74,
      crest: 74,
      title: 28,
      meta: 36,
      columns: 25,
      quote: 12.5,
      notice: 10.5,
      gap: 4,
    },
  ];
  const body = page.querySelector('.page-body'),
    header = page.querySelector('.page-header'),
    footer = page.querySelector('.homework-footer');
  if (!body || !header || !footer) throw Error('The consolidated diary template is incomplete.');
  function fits() {
    if (
      body.clientHeight < 1 ||
      body.scrollHeight > body.clientHeight + 1 ||
      body.scrollWidth > body.clientWidth + 1
    )
      return false;
    const bounds = page.getBoundingClientRect(),
      h = header.getBoundingClientRect(),
      b = body.getBoundingClientRect(),
      f = footer.getBoundingClientRect();
    if (h.bottom > b.top + 1 || b.bottom > f.top + 1 || f.bottom > bounds.bottom - 10) return false;
    for (const node of page.querySelectorAll(
      '.homework-brand,.homework-meta,.homework-columns,.homework-row,.homework-row>*,.homework-quotes,.homework-folio',
    )) {
      if (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
        return false;
    }
    return true;
  }
  page.dataset.fitStatus = 'fitting';
  for (let i = 0; i < presets.length; i++) {
    for (const [name, value] of Object.entries(presets[i]))
      page.style.setProperty('--diary-' + name, value + 'px');
    if (fits()) {
      page.dataset.fitStatus = 'complete';
      page.dataset.fitLevel = String(i);
      page.dataset.minimumHomeworkFont = '11.5px';
      return { level: i, fontSize: presets[i].font, pages: 1 };
    }
  }
  page.dataset.fitStatus = 'error';
  throw Error(
    'This complete consolidated diary cannot fit readably on one A4 page at the minimum font size. No content has been clipped or removed. Shorten the homework through the existing authorized correction and approval workflow, then export again.',
  );
}
export const consolidatedCss = `
.consolidated-diary{padding:16px 24px;break-inside:avoid;--diary-font:15.5px;--diary-urdu:17px;--diary-subject:17px;--diary-pad:7px;--diary-min:30px;--diary-brand:96px;--diary-crest:96px;--diary-title:36px;--diary-meta:52px;--diary-columns:34px;--diary-quote:16px;--diary-notice:14px;--diary-gap:10px}
.consolidated-diary .homework-brand{display:grid;grid-template-columns:148px minmax(0,1fr) 148px;gap:10px;height:auto;min-height:var(--diary-brand);padding:0 0 4px;align-items:center}
.consolidated-diary .homework-crest{width:var(--diary-crest);height:var(--diary-crest);justify-self:start}
.consolidated-diary .homework-identity{text-align:center;min-width:0}
.consolidated-diary .homework-brand h1{font-size:var(--diary-title);font-weight:700;line-height:1.1;text-align:center;letter-spacing:-.5px;overflow-wrap:anywhere}
.consolidated-diary .homework-tagline{font-size:18px;margin-top:4px;line-height:1.1}
.consolidated-diary .homework-motto{margin:0;padding:6px 4px;min-width:0;width:100%;font-size:14px;line-height:1.2}
.consolidated-diary .homework-contact{font-size:10px;overflow-wrap:anywhere}
.consolidated-diary .homework-meta{height:auto;min-height:var(--diary-meta);margin:var(--diary-gap) 0}
.consolidated-diary .homework-meta>div{min-width:0;gap:8px;padding:4px 10px;font-size:13px;overflow-wrap:anywhere}
.consolidated-diary .homework-meta span{min-width:0}.consolidated-diary .homework-meta b{font-size:12px}.consolidated-diary .homework-meta svg{width:24px;height:24px}
.consolidated-diary .homework-columns{height:var(--diary-columns);font-size:14px;flex:none}
.consolidated-diary .homework-row.block,.consolidated-diary .homework-row.block:last-child{flex:0 0 auto;min-height:var(--diary-min);overflow:visible}
.consolidated-diary .homework-row>h2{min-width:0;font-size:var(--diary-subject);line-height:1.15;padding:var(--diary-pad) 8px}
.consolidated-diary .homework-row>.text{min-width:0;font-size:var(--diary-font);line-height:1.18;padding:var(--diary-pad) 9px;overflow-wrap:anywhere}
.consolidated-diary .homework-row>.text[dir=rtl]{font-size:var(--diary-urdu);line-height:1.3}
.consolidated-diary .homework-mark{font-size:20px;min-width:0}
.consolidated-diary .page-body{flex:0 1 auto}.consolidated-diary .homework-footer{padding-top:var(--diary-gap);margin-top:auto}
.consolidated-diary .homework-quotes{padding-top:0;overflow-wrap:anywhere}.consolidated-diary .homework-quote-card{padding:calc(var(--diary-gap)*.5) 42px calc(var(--diary-gap)*.8)}.consolidated-diary .homework-notice{margin-bottom:var(--diary-gap)}.consolidated-diary .homework-notice-head{padding-block:3px}.consolidated-diary .homework-notice-body{padding-block:calc(var(--diary-gap)*.6)}
.consolidated-diary .homework-closing{height:auto;min-height:27px;font-size:var(--diary-quote);padding-top:4px;align-items:center}
.consolidated-diary .homework-folio{position:static;font-size:9px;line-height:1.2;margin-top:6px;gap:10px;overflow-wrap:anywhere}.consolidated-diary .homework-folio>span:first-child{min-width:0;flex:1}.consolidated-diary .page-number{white-space:nowrap}
@media print{.consolidated-diary{break-inside:avoid;page:homework;zoom:1!important}}
`;

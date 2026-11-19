import { fitConsolidatedPage } from './consolidated-layout.mjs';
// Shrinks the notice and quote text step by step so the footer never starves the homework table.
// Returns false only when even the smallest readable footer leaves no room for the table.
export function fitFooterBlocks(page, wanted = 260) {
  // The table body is still empty here, so measure the free space between header and footer instead.
  const header = page.querySelector('.page-header'),
    footer = page.querySelector('.homework-footer'),
    room = () => footer.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
  let quote = 16,
    notice = 14;
  const apply = () => {
    page.style.setProperty('--diary-quote', quote + 'px');
    page.style.setProperty('--diary-notice', notice + 'px');
  };
  apply();
  while (room() < wanted && (quote > 10 || notice > 10)) {
    quote = Math.max(10, quote - 0.5);
    notice = Math.max(10, notice - 0.5);
    apply();
  }
  return room() >= 140;
}
export const paginationScript = `const fitConsolidatedPage=${fitConsolidatedPage.toString()};const fitFooterBlocks=${fitFooterBlocks.toString()};
(async()=>{await document.fonts.load('16px "School Arabic"','اردو العربية');await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode().catch(()=>{throw Error('A diary image could not load. Check the school logo and connection before exporting.');})));const target=document.getElementById('pages');
for(const [sourceIndex,source] of [...document.querySelectorAll('.document-source')].entries()){let page,body;const pages=[];function newPage(){page=document.createElement('section');page.dataset.sourceIndex=String(sourceIndex);for(const key of ['className','sectionName','diaryDate','reference'])if(source.dataset[key]!==undefined)page.dataset[key]=source.dataset[key];page.className='page'+(source.dataset.layout==='homework_grid'?' homework-page':'')+(source.dataset.consolidated==='true'?' consolidated-diary':'');if(source.dataset.consolidated==='true')page.dataset.consolidated='true';page.append(source.querySelector('.header').content.cloneNode(true));body=document.createElement('div');body.className='page-body';page.append(body);page.append(source.querySelector('.footer').content.cloneNode(true));target.append(page);pages.push(page);for(const value of page.querySelectorAll('.homework-meta-value')){let size=parseFloat(getComputedStyle(value).fontSize);while(value.scrollWidth>value.clientWidth+1&&size>8){size=Math.max(8,size-.25);value.style.fontSize=size+'px';}if(value.scrollWidth>value.clientWidth+1)throw Error('The class or section name is too long to fit readably on one line. Shorten its display name before exporting.');}if(source.dataset.consolidated!=='true'&&!fitFooterBlocks(page))throw Error('The notice and quote are too long to leave room for the homework table on an A4 page. Shorten the published notice or the scheduled quote.');}
newPage();if(source.dataset.consolidated==='true'){for(const original of source.querySelector('.blocks').children)body.append(original.cloneNode(true));fitConsolidatedPage(page);const num=page.querySelector('.page-number');if(num)num.textContent='Page 1 of 1';continue;}for(const original of source.querySelector('.blocks').children){let block=original.cloneNode(true);body.append(block);if(body.scrollHeight<=body.clientHeight+1)continue;block.remove();if(body.children.length)newPage();body.append(block);if(body.scrollHeight<=body.clientHeight+1)continue;block.remove();const text=original.querySelector('.text');if(!text)throw Error('A document block cannot fit on A4.');let rest=text.textContent;let continuing=false;while(rest.length){const segment=original.cloneNode(true),content=segment.querySelector('.text');if(continuing)segment.querySelector('h2').textContent+=' (continued)';content.textContent='';body.append(segment);let low=0,high=rest.length;while(low<high){const mid=Math.ceil((low+high)/2);content.textContent=rest.slice(0,mid);if(body.scrollHeight<=body.clientHeight+1)low=mid;else high=mid-1;}if(!low){segment.remove();if(!body.children.length)throw Error('Content cannot fit on A4.');newPage();continue;}let take=low;if(low<rest.length){const space=rest.lastIndexOf(' ',low);if(space>low*.6)take=space+1;}content.textContent=rest.slice(0,take);rest=rest.slice(take);continuing=true;if(rest.length)newPage();}}
pages.forEach((p,i)=>{const n=p.querySelector('.page-number');if(n)n.textContent='Page '+(i+1)+' of '+pages.length;});}
await Promise.all([...target.querySelectorAll('img')].map(img=>img.decode().catch(()=>{throw Error('A diary image could not load. Check the school logo and connection before exporting.');})));
if(!document.body.dataset.exportFormat){const fit=()=>document.querySelectorAll('.homework-page').forEach(p=>p.style.zoom=String(Math.max(.15,Math.min(1,(innerWidth-20)/p.offsetWidth))));fit();window.addEventListener('resize',fit);}
window.documentReady=true;window.dispatchEvent(new Event('documentready'));})().catch(e=>{document.getElementById('pages').textContent=e.message;window.documentError=e.message;window.dispatchEvent(new Event('documentready'));});`;

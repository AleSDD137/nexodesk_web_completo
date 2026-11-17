/* Independent, debounced search: never remount the application or write data. */
(()=>{'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function init(ctx){
 const input=document.querySelector('#searchInput'),host=input.closest('.search-box');
 host.insertAdjacentHTML('beforeend','<section id="globalSearchResults" aria-label="Resultados de búsqueda" hidden><p role="status" aria-live="polite"></p><div data-search-items></div><div data-search-pages></div></section>');
 const panel=host.querySelector('section');let timer,version=0,offset=0;
 const source=()=>`${window.NexoAuth.source}:${window.NexoAuth.user?.id??'demo'}`;
 const canUsers=()=>window.NexoAuth.source!=='api'||['Administrador','Coordinador'].includes(window.NexoAuth.user?.role);
 const valid=(v,s,q)=>v===version&&s===source()&&q===input.value.trim()&&!window.NexoAuth.isSelfService();
 const close=()=>{++version;clearTimeout(timer);panel.hidden=true;};
 async function query(){
  const q=input.value.trim(),v=++version,s=source();if(!q||window.NexoAuth.isSelfService()){close();return;}
  panel.hidden=false;panel.querySelector('[role=status]').textContent='Buscando…';panel.querySelector('[data-search-items]').replaceChildren();panel.querySelector('[data-search-pages]').replaceChildren();
  try{
   const types=canUsers()?['tickets','users']:['tickets'];
   const results=await Promise.all(types.map(async type=>{
    if(window.NexoAuth.source==='api')return {type,...await window.NexoAuth.api('/search?'+new URLSearchParams({q,type,limit:10,offset}))};
    const items=(type==='users'?ctx.users():ctx.tickets()).filter(x=>`${x.id} ${x.title??x.name} ${type==='users'?x.email:''}`.toLowerCase().includes(q.toLowerCase()));return {type,data:items.slice(offset,offset+10),total:items.length};
   }));
   if(!valid(v,s,q))return;
   panel.querySelector('[role=status]').textContent=results.some(r=>r.total)?results.map(r=>`${r.type==='users'?'Usuarios':'Tickets'}: ${r.total}`).join(' · '):'Sin resultados.';
   panel.querySelector('[data-search-items]').innerHTML=results.map(r=>r.data.map(x=>`<button type="button" data-search-type="${r.type}" data-search-id="${Number(x.id)}">${r.type==='users'?'Usuario':'Ticket'} #${esc(x.id)} · ${esc(x.title??x.name)}</button>`).join('')).join('');
   panel.querySelectorAll('[data-search-id]').forEach(b=>b.onclick=()=>{close();(b.dataset.searchType==='users'?ctx.openUser:ctx.openTicket)(b.dataset.searchId);});
   panel.querySelector('[data-search-pages]').innerHTML=`<button type="button" data-prev ${offset===0?'disabled':''}>Anteriores</button><button type="button" data-next ${results.every(r=>offset+10>=r.total)?'disabled':''}>Siguientes</button>`;
   panel.querySelector('[data-prev]').onclick=()=>{offset=Math.max(0,offset-10);void query();};panel.querySelector('[data-next]').onclick=()=>{offset+=10;void query();};
  }catch(e){if(valid(v,s,q))panel.querySelector('[role=status]').textContent='No se pudo buscar: '+e.message;}
 }
 input.maxLength=120;input.placeholder='Buscar tickets por ID o asunto';input.setAttribute('aria-controls',panel.id);
 input.addEventListener('input',()=>{++version;clearTimeout(timer);offset=0;if(!input.value.trim()){close();return;}panel.hidden=false;panel.querySelector('[role=status]').textContent='Esperando búsqueda…';panel.querySelector('[data-search-items]').replaceChildren();panel.querySelector('[data-search-pages]').replaceChildren();timer=setTimeout(query,300);});
 input.addEventListener('focus',()=>{if(input.value.trim()&&panel.hidden)void query();input.placeholder=canUsers()?'Buscar tickets y usuarios':'Buscar tickets por ID o asunto';});
 input.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='ArrowDown'){panel.querySelector('button')?.focus();e.preventDefault();}});
 document.addEventListener('click',e=>{if(!host.contains(e.target))close();});
 new MutationObserver(()=>{if(panel.hidden)return;if(window.NexoAuth.isSelfService()||host.hidden)close();}).observe(document.body,{attributes:true,attributeFilter:['class','hidden'],subtree:true});
 document.querySelector('#nxDataMode')?.addEventListener('change',close);
 window.addEventListener('nexodesk:tickets-changed',close);
}
window.NexoSearch={init};})();

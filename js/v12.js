/* NEXODESK: datos demo compartidos, Pulse y entrada a las vistas unificadas. */
(() => {
  'use strict';
  const ASSETS_KEY = 'nexodesk-demo-assets-v12';
  const ACTIVITY_KEY = 'nexodesk-demo-activity-v12';
  const seedAssets = [
    {id:'NX-A001',kind:'Notebook',brand:'HP ProBook 450',serial:'HP-45-DEMO',owner:'María López',location:'Oficina central',state:'Asignado',ticketId:10301},
    {id:'NX-A002',kind:'Tablet',brand:'Samsung Tab A9',serial:'SM-A9-DEMO',owner:'Juan Pérez',location:'Campo Norte',state:'Asignado',ticketId:null},
    {id:'NX-A003',kind:'Notebook',brand:'Dell Latitude 5420',serial:'DL-54-DEMO',owner:'Sin asignar',location:'Depósito IT',state:'Disponible',ticketId:null},
    {id:'NX-A004',kind:'Teléfono',brand:'Samsung Galaxy A55',serial:'SM-55-DEMO',owner:'Lucía Torres',location:'Oficina central',state:'En reparación',ticketId:10294},
    {id:'NX-A005',kind:'Monitor',brand:'HP E233',serial:'HP-E233-DEMO',owner:'Sofía Díaz',location:'Campo Sur',state:'Asignado',ticketId:null},
    {id:'NX-A006',kind:'Tablet',brand:'Apple iPad 9',serial:'AP-IP9-DEMO',owner:'Sin asignar',location:'Depósito IT',state:'Disponible',ticketId:null}
  ];
  const clone = v => JSON.parse(JSON.stringify(v));
  const read = (key, fallback) => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : clone(fallback); } catch { return clone(fallback); } };
  const assets = () => read(ASSETS_KEY, seedAssets);
  const activity = () => read(ACTIVITY_KEY, []);
  // Una vista por módulo; cada adaptador decide Demo o API.
  const render=(view, ctx)=>{
    const el=document.querySelector('#alternateView');if(!el)return;
    el.onclick=null;el.oninput=null;
    if(view==='assets'){window.NexoAssets.render(ctx,el);return;}
    if(view==='portal'){window.NexoPortal.render(ctx,el);return;}
    if(view==='pulse')window.NexoPulse.render(ctx,el);
  };
  function initPublicPortal() {
    const root=document.querySelector('#publicPortalRoot');if(!root)return;
    window.NexoPortal.render({tickets:[],showToast:null},root,{publicMode:true});
  }
  window.NexoV12={render,initPublicPortal,assets,activity};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPublicPortal);else initPublicPortal();
})();

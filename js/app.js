// El acceso lo valida v22-auth.js; en modo API el servidor comprueba la sesión.
let demoSession = null;
try { demoSession = JSON.parse(sessionStorage.getItem('nexodesk-demo-session') || 'null'); } catch {}

const STORAGE_KEY = "nexodesk-demo-tickets-v1";
const USERS_KEY = "nexodesk-demo-users-v1";
const SETTINGS_KEY = "nexodesk-demo-settings-v1";
const defaultUsers = [
 {id:1,name:"A. Sebastián Díaz",email:"sebastian@nexodesk.demo",role:"Técnico",active:true},
 {id:2,name:"C. Vargas",email:"vargas@nexodesk.demo",role:"Técnico",active:true},
 {id:3,name:"M. Fernández",email:"fernandez@nexodesk.demo",role:"Coordinador",active:true}
];
function readLocal(key,fallback) { try { const raw=localStorage.getItem(key);return raw?JSON.parse(raw):structuredClone(fallback); }catch{return JSON.parse(JSON.stringify(fallback));} }
let users = readLocal(USERS_KEY,defaultUsers);
let settings = readLocal(SETTINGS_KEY,{compact:false,notifications:true});
function persist(key,data) {try{localStorage.setItem(key,JSON.stringify(data));}catch{showToast("No se pudo guardar en este navegador.");}}

const columns = [
  { key: "Registrado", label: "REGISTRADO", color: "#ff8c69" },
  { key: "En revisión", label: "EN REVISIÓN", color: "#f4c451" },
  { key: "En atención", label: "EN ATENCIÓN", color: "#28c5d5" },
  { key: "Validación", label: "VALIDACIÓN", color: "#35c99a" },
  { key: "Cerrado", label: "CERRADO", color: "#478df5" }
];
const initialTickets = [
  {id:10301,title:"Falla de acceso al sistema ERP",type:"Incidente",priority:"Alta",assignee:"A. Sebastián Díaz",requester:"María López",status:"Registrado",description:"El usuario no puede iniciar sesión en el sistema ERP."},
  {id:10292,title:"Instalación de software de diseño",type:"Requerimiento",priority:"Media",assignee:"C. Vargas",requester:"Juan Pérez",status:"En revisión",description:"Instalar y validar el software solicitado."},
  {id:10294,title:"Instalación de software de diseño",type:"Incidente",priority:"Alta",assignee:"C. Vargas",requester:"Lucía Torres",status:"En atención",description:"La aplicación presenta errores al iniciar."},
  {id:10305,title:"Instalación de software de diseño",type:"Requerimiento",priority:"Media",assignee:"C. Vargas",requester:"Pedro Gómez",status:"Validación",description:"Pendiente de confirmación por parte del usuario."},
  {id:10396,title:"Instalación de software",type:"Requerimiento",priority:"Baja",assignee:"A. Sebastián Díaz",requester:"Sofía Díaz",status:"Cerrado",description:"Instalación completada y validada."},
  {id:10329,title:"Instalación de software de diseño",type:"Incidente",priority:"Baja",assignee:"A. Sebastián Díaz",requester:"Carlos Ruiz",status:"Registrado",description:"Solicitud registrada para evaluación."},
  {id:10293,title:"Instalación de software de diseño",type:"Requerimiento",priority:"Media",assignee:"C. Vargas",requester:"Ana Silva",status:"En revisión",description:"Verificar compatibilidad y licencia."},
  {id:10381,title:"Instalación al sistema ERP",type:"Incidente",priority:"Media",assignee:"C. Vargas",requester:"Pablo Díaz",status:"En atención",description:"Revisar acceso al módulo de reportes."},
  {id:10308,title:"Instalación de acceso a sistema ERP",type:"Requerimiento",priority:"Baja",assignee:"C. Vargas",requester:"Valentina Cruz",status:"Validación",description:"Usuario debe validar el acceso."},
  {id:10309,title:"Instalación de software de diseño",type:"Requerimiento",priority:"Media",assignee:"C. Vargas",requester:"Mateo Ríos",status:"Cerrado",description:"Ticket resuelto."},
  {id:10331,title:"Configuración de equipo",type:"Incidente",priority:"Baja",assignee:"C. Vargas",requester:"Julia Méndez",status:"Registrado",description:"Ajustar la configuración del equipo."},
  {id:10282,title:"Instalación de software de diseño",type:"Requerimiento",priority:"Media",assignee:"Sin asignar",requester:"Nicolás Vera",status:"En revisión",description:"Revisar disponibilidad del técnico."},
  {id:10393,title:"Problema de acceso a sistema ERP",type:"Incidente",priority:"Baja",assignee:"C. Vargas",requester:"Martín León",status:"En atención",description:"Analizar permisos de acceso."}
];
let tickets = loadTickets();
let currentView = "dashboard";
const board = document.querySelector("#kanbanBoard");
const searchInput = document.querySelector("#searchInput");
const priorityFilter = document.querySelector("#priorityFilter");
const dialog = document.querySelector("#ticketDialog");
const form = document.querySelector("#ticketForm");

const profileName = document.querySelector("#profileName");
const profileAvatar = document.querySelector("#profileAvatar");
if (demoSession) {
  const displayName = (demoSession.name || demoSession.email || "Usuario demo").replace(/[._-]+/g, " ").trim();
  const formattedName = displayName.split(/\s+/).map(part => part ? part[0].toUpperCase() + part.slice(1) : "").join(" ");
  if (profileName) profileName.textContent = formattedName || "Usuario demo";
  if (profileAvatar) profileAvatar.textContent = (formattedName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("") || "UD").toUpperCase();
}
const logoutButton = document.querySelector("#logoutButton");
if (logoutButton) logoutButton.addEventListener('click', event => {
  event.preventDefault(); void window.NexoAuth.logout();
});
let toastTimeout;

function loadTickets() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : initialTickets.map(ticket => ({...ticket}));
  } catch (error) {
    console.warn("No se pudo leer el almacenamiento local.", error);
    return initialTickets.map(ticket => ({...ticket}));
  }
}
function saveTickets() {
  if (window.NexoBridge?.isServer()) { window.NexoBridge.save(tickets); window.dispatchEvent(new CustomEvent("nexodesk:tickets-changed")); return; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets)); window.dispatchEvent(new CustomEvent("nexodesk:tickets-changed")); }
  catch (error) { showToast("No se pudieron guardar los cambios en este navegador."); }
}
function initials(name) {
  if (!name || name === "Sin asignar") return "?";
  return name.split(/[\s.]+/).filter(Boolean).slice(0,2).map(part => part[0].toUpperCase()).join("");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function matchesFilters(ticket) {
  const query = searchInput.value.trim().toLocaleLowerCase("es");
  const priority = priorityFilter.value;
  const searchable = `${ticket.id} ${ticket.title} ${ticket.type} ${ticket.assignee} ${ticket.requester} ${ticket.status}`.toLocaleLowerCase("es");
  return (!query || searchable.includes(query)) && (priority === "all" || ticket.priority === priority);
}
function renderBoard() {
  board.innerHTML = columns.map(column => {
    const items = tickets.filter(ticket => ticket.status === column.key && matchesFilters(ticket));
    return `<section class="kanban-column" data-status="${escapeHtml(column.key)}" style="--column-color:${column.color}">
      <div class="column-heading"><span class="column-title">${column.label}</span><span class="column-count">${items.length}</span><button class="column-menu" aria-label="Opciones de ${column.label}">···</button></div>
      <div class="ticket-list">${items.length ? items.map(renderTicket).join("") : '<div class="empty-column">No hay tickets en esta etapa</div>'}</div>
    </section>`;
  }).join("");
  document.querySelector("#activeCount").textContent = tickets.filter(t => t.status !== "Cerrado").length;
  document.querySelector("#unassignedCount").textContent = tickets.filter(t => t.assignee === "Sin asignar" && t.status !== "Cerrado").length;
}
function renderTicket(ticket) {
  const priorityColor = ticket.priority === "Alta" ? "#ff806e" : ticket.priority === "Media" ? "#f4c451" : "#2ac58b";
  return `<article class="ticket-card" draggable="${window.NexoBridge?.isServer() && window.NexoAuth.isRequester()?"false":"true"}" tabindex="0" role="button" aria-label="Ver ticket ${ticket.id}" data-ticket-id="${ticket.id}" style="--priority-color:${priorityColor}">
    <div class="ticket-meta"><span>ID: ${ticket.id}</span><span class="ticket-type">${ticket.type === "Incidente" ? '<span class="warning">▲</span>' : "♙"} ${ticket.type}</span></div>
    <h3>${escapeHtml(ticket.title)}</h3><span class="priority ${ticket.priority}">${ticket.priority.toUpperCase()}</span>
    <div class="ticket-footer"><span class="mini-avatar">${escapeHtml(initials(ticket.assignee))}</span><span class="assignee">${escapeHtml(ticket.assignee)}</span><button class="ticket-open" title="Ver detalles" aria-label="Ver detalles">···</button></div>
  </article>`;
}
function renderTable() {
  const visible = tickets.filter(matchesFilters);
  return `<h2>Todos los tickets</h2><p class="muted" style="margin-bottom:18px">Consulta y seguimiento de las solicitudes registradas.</p><div class="table-wrap"><table class="ticket-table"><thead><tr><th>ID</th><th>Asunto</th><th>Tipo</th><th>Prioridad</th><th>Responsable</th><th>Estado</th></tr></thead><tbody>${visible.map(t => `<tr><td>#${t.id}</td><td><button class="link-button" data-open-id="${t.id}">${escapeHtml(t.title)}</button></td><td>${escapeHtml(t.type)}</td><td><span class="priority ${t.priority}">${t.priority}</span></td><td>${escapeHtml(t.assignee)}</td><td><select data-status-id="${t.id}" aria-label="Estado del ticket ${t.id}" ${window.NexoBridge?.isServer() && window.NexoAuth.isRequester()?"disabled":""}>${columns.map(c => `<option ${c.key===t.status?"selected":""}>${c.key}</option>`).join("")}</select></td></tr>`).join("") || '<tr><td colspan="6">No se encontraron tickets.</td></tr>'}</tbody></table></div>`;
}
function renderAlternate() {
 const view=document.querySelector("#alternateView");
 if(currentView==="relaciones"){window.NexoV13.render({tickets,users,openTicket,showToast,render});return;}
 if(currentView==="intelligence"){window.NexoV14.render({tickets,openTicket,showToast});return;}
 if(currentView==="triage"){window.NexoV15.render({tickets,users,openTicket,showToast,saveTickets,render});return;}
 if(["pulse","assets","portal"].includes(currentView)){window.NexoV12.render(currentView,{tickets,users,escapeHtml,showToast,openTicket,saveTickets,render});return;}
 if(currentView==="tickets"){view.innerHTML=renderTable();return;}
 if(currentView==="usuarios" && window.NexoBridge?.isServer()){
   window.NexoAuth.renderUsers(view); return;
 }
 if(currentView==="usuarios"){
 view.innerHTML=`<div class="section-heading"><div><h2>Usuarios y técnicos</h2><p class="muted">Directorio local de demostración, sin cuentas reales.</p></div></div>
 <div class="table-wrap"><table class="ticket-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${users.map(u=>`<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(u.role)}</td><td>${u.active?"Activo":"Inactivo"}</td><td><button class="link-button" data-toggle-user="${u.id}">${u.active?"Desactivar":"Activar"}</button></td></tr>`).join("")}</tbody></table></div>
 <form id="userForm" class="inline-form"><h3>Agregar usuario de demostración</h3><div class="detail-grid"><label>Nombre<input name="name" required maxlength="80"></label><label>Correo<input name="email" type="email" required maxlength="120"></label><label>Rol<select name="role"><option>Solicitante</option><option>Técnico</option><option>Coordinador</option><option>Administrador</option></select></label></div><button class="primary-button">Agregar usuario</button></form>`;return;
 }
 if(currentView==="configuracion"){
 view.innerHTML=`<h2>Configuración</h2><p class="muted">Preferencias guardadas solo en este navegador.</p>
 <div class="settings-row"><div><strong>Vista compacta</strong><small>Reduce el espacio entre tarjetas.</small></div><label class="switch-label"><input type="checkbox" data-setting="compact" ${settings.compact?"checked":""}> Activar</label></div>
 <div class="settings-row"><div><strong>Avisos visuales</strong><small>Habilita mensajes de confirmación en pantalla.</small></div><label class="switch-label"><input type="checkbox" data-setting="notifications" ${settings.notifications?"checked":""}> Activar</label></div>
 <div class="settings-row"><div><strong>Almacenamiento</strong><small>localStorage: datos locales, no compartidos ni seguros para producción.</small></div><span class="settings-pill">Demo</span></div>
 <button class="secondary-button" id="exportTickets">Exportar tickets JSON</button>`;if(window.NexoBridge?.isServer())window.NexoAuth.renderPasswordPanel(view);return;
 }
 if(currentView==="procesos"){
 view.innerHTML=`<h2>Proceso de atención</h2><p class="muted">Etapas del ciclo de vida de los tickets.</p><div class="process-steps">${columns.map((c,i)=>`<div class="process-step"><span style="color:${c.color}">0${i+1}</span><strong>${c.key}</strong><small>${["Registro de la solicitud","Clasificación y asignación","Diagnóstico y resolución","Validación del solicitante","Cierre y documentación"][i]}</small></div>`).join("")}</div>`;return;
 }
 const byPriority=["Alta","Media","Baja"].map(priority=>({priority,count:tickets.filter(t=>t.priority===priority).length}));
 view.innerHTML=`<h2>Reportes y métricas</h2><p class="muted">Calculados con los tickets locales de esta demostración.</p><div class="report-grid"><div><small>Total</small><strong>${tickets.length}</strong></div><div><small>Abiertos</small><strong>${tickets.filter(t=>t.status!=="Cerrado").length}</strong></div><div><small>Alta prioridad</small><strong>${byPriority[0].count}</strong></div><div><small>Cerrados</small><strong>${tickets.filter(t=>t.status==="Cerrado").length}</strong></div></div><h3>Tickets por prioridad</h3><div class="bar-report">${byPriority.map(x=>`<div class="bar-row"><span>${x.priority}</span><div class="bar-track"><div class="bar-fill" style="width:${tickets.length?100*x.count/tickets.length:0}%"></div></div><strong>${x.count}</strong></div>`).join("")}</div>`;
}
function updateMetrics(){
 const cards=document.querySelectorAll(".stat-card strong");
 if(cards[1]){cards[1].textContent=String(tickets.filter(t=>t.status==="Cerrado").length);cards[1].parentElement.querySelector(".stat-top span:first-child").textContent="Tickets cerrados";cards[1].parentElement.querySelector("small").textContent="Total cerrado en esta demo";}
 if(cards[2]){cards[2].textContent=String(tickets.filter(t=>t.priority==="Alta"&&t.status!=="Cerrado").length);cards[2].parentElement.querySelector(".stat-top span:first-child").textContent="Prioridad alta abierta";cards[2].parentElement.querySelector("small").textContent="Tickets que requieren atención";}
 document.querySelector("#activeCount").textContent=tickets.filter(t=>t.status!=="Cerrado").length;
 document.querySelector("#unassignedCount").textContent=tickets.filter(t=>t.assignee==="Sin asignar"&&t.status!=="Cerrado").length;
}
function render() {
  const isDashboard = currentView === "dashboard";
  document.body.classList.toggle("compact-mode",!!settings.compact);
  document.querySelector("#boardSection").classList.toggle("hidden", !isDashboard);
  document.querySelector(".stats-grid").classList.toggle("hidden", !isDashboard);
  document.querySelector("#alternateView").classList.toggle("hidden", isDashboard);
  document.querySelector("#pageTitle").textContent = ({dashboard:"Panel de tickets",tickets:"Gestión de tickets",procesos:"Procesos de atención",reportes:"Reportes y métricas",configuracion:"Configuración",usuarios:"Usuarios y técnicos",pulse:"Pulse · Centro de operaciones",assets:"Assets · Inventario IT",portal:"Portal · Autoservicio",relaciones:"Relaciones · Mapa IT",intelligence:"Intelligence · Análisis de tickets",triage:"Triage · Clasificación y escalamiento"})[currentView];
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === currentView));
  if (isDashboard) renderBoard(); else renderAlternate();
  updateMetrics();
}
function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message; toast.classList.add("show");
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
}
function openTicket(id) {
  const ticket=tickets.find(item=>item.id===Number(id)); if(!ticket)return;
  const readOnly=window.NexoBridge?.isServer() && window.NexoAuth.isRequester();
  const detail=document.querySelector("#detailContent");
  detail.innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">TICKET #${ticket.id}</p><h2>${escapeHtml(ticket.title)}</h2></div></div>
    <div class="detail-grid"><label>Estado<select id="detailStatus">${columns.map(c=>`<option ${c.key===ticket.status?"selected":""}>${escapeHtml(c.key)}</option>`).join("")}</select></label>
    <label>Prioridad<select id="detailPriority">${["Alta","Media","Baja"].map(x=>`<option ${x===ticket.priority?"selected":""}>${x}</option>`).join("")}</select></label>
    <label>Responsable<select id="detailAssignee">${["Sin asignar",...users.filter(u=>u.active).map(u=>u.name),ticket.assignee].filter((x,i,a)=>a.indexOf(x)===i).map(x=>`<option ${x===ticket.assignee?"selected":""}>${escapeHtml(x)}</option>`).join("")}</select></label>
    <label>Tipo<select id="detailType">${["Incidente","Requerimiento","Consulta"].map(x=>`<option ${x===ticket.type?"selected":""}>${x}</option>`).join("")}</select></label></div>
    <label>Solicitante<input id="detailRequester" maxlength="100" value="${escapeHtml(ticket.requester)}"></label>
    <label>Descripción<textarea id="detailDescription" rows="3">${escapeHtml(ticket.description)}</textarea></label>
    <h3>Comentarios</h3><div class="comment-list">${(ticket.comments||[]).map(c=>`<div class="comment"><strong>${escapeHtml(c.author)}</strong><small>${escapeHtml(c.date)}</small><p>${escapeHtml(c.text)}</p></div>`).join("")||'<p class="muted">Sin comentarios todavía.</p>'}</div>
    <form id="commentForm"><label>Agregar comentario<textarea name="comment" rows="2" required maxlength="2000" placeholder="Escribí una actualización..."></textarea></label><button class="secondary-button" type="submit">Publicar comentario</button></form>
    <div class="dialog-actions"><button class="primary-button" type="button" id="saveDetail">Guardar cambios</button></div>`;
  if(readOnly){
    detail.querySelectorAll("select, input, textarea:not([name=comment])").forEach(el=>el.disabled=true);
    detail.querySelector("#saveDetail").hidden=true;
  }
  detail.querySelector("#saveDetail").addEventListener("click",()=>{
    if(window.NexoBridge?.isServer()&&!window.NexoBridge.isReady()){showToast("Sin conexión: no se pueden guardar cambios.");return;}
    const description=detail.querySelector("#detailDescription").value.trim();const requester=detail.querySelector("#detailRequester").value.trim();
    if(!description||!requester){showToast("Completá solicitante y descripción.");return;}
    Object.assign(ticket,{status:detail.querySelector("#detailStatus").value,priority:detail.querySelector("#detailPriority").value,assignee:detail.querySelector("#detailAssignee").value,type:detail.querySelector("#detailType").value,description,requester});
    saveTickets();document.querySelector("#detailDialog").close();render();showToast("Ticket actualizado.");
  });
  detail.querySelector("#commentForm").addEventListener("submit",async event=>{
    event.preventDefault();const message=String(new FormData(event.target).get("comment")).trim();if(!message)return;
    if(window.NexoBridge?.isServer() && window.NexoAuth.isRequester()){
      try {await window.NexoBridge.addComment(ticket.id,message);openTicket(ticket.id);showToast("Comentario guardado en PostgreSQL.");}
      catch(err){showToast(`No se guardó el comentario: ${err.message}`);}
      return;
    }
    ticket.comments??=[];
    ticket.comments.push({author:window.NexoAuth.user?.name||demoSession?.name||"Usuario demo",date:new Date().toLocaleString("es-AR"),text:message});
    saveTickets();openTicket(ticket.id);showToast("Comentario enviado.");
  });
  const dialog=document.querySelector("#detailDialog");if(!dialog.open)dialog.showModal();
}
document.querySelector("#newTicketButton").addEventListener("click", () => {
  if(window.NexoBridge?.isServer() && window.NexoAuth.isRequester()){
    form.querySelector('[name="requester"]').value=window.NexoAuth.user.name;
  }
  dialog.showModal();
});
document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
document.querySelector("#cancelDialog").addEventListener("click", () => dialog.close());
form.addEventListener("submit", event => {
  event.preventDefault();
  if(window.NexoBridge?.isServer()&&!window.NexoBridge.isReady()){showToast("Sin conexión a PostgreSQL.");return;}
  const data = new FormData(form);
  const ticket = {
    id: tickets.reduce((max,t) => Math.max(max, Number(t.id)), 10300) + 1,
    title: data.get("title").trim(), type: data.get("type"), priority: data.get("priority") || "Media",
    description: data.get("description").trim(), requester: data.get("requester").trim(),
    assignee: data.get("assignee") || "Sin asignar", status: "Registrado"
  };
  tickets.unshift(ticket); saveTickets(); form.reset(); dialog.close(); currentView = "dashboard"; render();
  showToast(`Ticket #${ticket.id} creado correctamente.`);
});
document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => { if(button.hidden)return;currentView = button.dataset.view; render(); }));
window.addEventListener("nexodesk:open-view",event=>{ if(["pulse","assets","portal","tickets","dashboard","relaciones","intelligence","triage"].includes(event.detail)){ const button=document.querySelector(`.nav-item[data-view="${event.detail}"]`);if(button?.hidden)return;currentView=event.detail;render();} });
searchInput.addEventListener("input", render);
priorityFilter.addEventListener("change", render);
board.addEventListener("click", event => {
  const card = event.target.closest("[data-ticket-id]");
  if (card) openTicket(card.dataset.ticketId);
});
board.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-ticket-id]")) {
    event.preventDefault(); openTicket(event.target.dataset.ticketId);
  }
});
document.querySelector("#alternateView").addEventListener("change", event => {
  const id = event.target.dataset.statusId;
  if (!id) return;
  const ticket = tickets.find(item => item.id === Number(id));
  if (window.NexoBridge?.isServer() && (!window.NexoBridge.isReady() || window.NexoAuth.isRequester())) { showToast("No está permitido cambiar el estado en este momento."); render(); return; }
  if (ticket) { ticket.status = event.target.value; saveTickets(); render(); showToast(`Estado del ticket #${id} actualizado.`); }
});
document.querySelector("#resetButton").addEventListener("click", () => {
  if (window.NexoBridge?.isServer()) { showToast("Restablecer solo está disponible en modo demo."); return; }
  if (!confirm("¿Restablecer los tickets de demostración? Se perderán los cambios guardados en este navegador.")) return;
  tickets = initialTickets.map(ticket => ({...ticket})); saveTickets(); render(); showToast("Demo restablecida.");
});
document.querySelector("#closeDetail").addEventListener("click",()=>document.querySelector("#detailDialog").close());
board.addEventListener("dragstart",e=>{if(window.NexoBridge?.isServer() && window.NexoAuth.isRequester()){e.preventDefault();return;}const card=e.target.closest("[data-ticket-id]");if(!card)return;e.dataTransfer.setData("text/plain",card.dataset.ticketId);e.dataTransfer.effectAllowed="move";});
board.addEventListener("dragover",e=>{const column=e.target.closest("[data-status]");if(column){e.preventDefault();e.dataTransfer.dropEffect="move";}});
board.addEventListener("drop",e=>{if(window.NexoBridge?.isServer() && (!window.NexoBridge.isReady() || window.NexoAuth.isRequester())){e.preventDefault();return;}const column=e.target.closest("[data-status]");if(!column)return;e.preventDefault();const id=Number(e.dataTransfer.getData("text/plain"));const ticket=tickets.find(t=>t.id===id);if(ticket&&columns.some(c=>c.key===column.dataset.status)){ticket.status=column.dataset.status;saveTickets();render();showToast(`Ticket #${id} movido a ${ticket.status}.`);}});
document.querySelector("#alternateView").addEventListener("click",e=>{
 const open=e.target.closest("[data-open-id]");if(open){openTicket(open.dataset.openId);return;}
 const toggle=e.target.closest("[data-toggle-user]");if(toggle){const u=users.find(u=>u.id===Number(toggle.dataset.toggleUser));if(u){u.active=!u.active;persist(USERS_KEY,users);render();}return;}
 if(e.target.id==="exportTickets"){const blob=new Blob([JSON.stringify(tickets,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="nexodesk-tickets-demo.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
});
document.querySelector("#alternateView").addEventListener("submit",e=>{
 if(e.target.id!=="userForm")return;e.preventDefault();const data=new FormData(e.target);const email=String(data.get("email")).trim().toLowerCase();if(users.some(u=>u.email.toLowerCase()===email)){showToast("Ya existe ese correo.");return;}
 users.push({id:Math.max(0,...users.map(u=>u.id))+1,name:String(data.get("name")).trim(),email,role:data.get("role"),active:true});persist(USERS_KEY,users);render();showToast("Usuario demo agregado.");
});
document.querySelector("#alternateView").addEventListener("change",e=>{
 const key=e.target.dataset.setting;if(!key)return;settings[key]=e.target.checked;persist(SETTINGS_KEY,settings);render();
});

window.NexoAuth.ensure().then(allowed=>{
  if(!allowed)return;
  render();
  window.NexoBridge.init({
  getTickets: () => tickets,
  setTickets: list => { tickets = list; render(); window.dispatchEvent(new CustomEvent("nexodesk:tickets-changed")); },
  render, showToast, loadDemo: loadTickets
  });
  document.body.classList.remove("nx-auth-pending");
});

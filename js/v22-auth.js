/* NEXODESK V2.2 - sesión real con cookie HttpOnly; las credenciales no se almacenan en JS. */
(() => {
  'use strict';
  const HOST = ['127.0.0.1','localhost'].includes(location.hostname) ? location.hostname : '127.0.0.1';
  const API = `http://${HOST}:3001/api`;
  const ACCESS_KEY = 'nexodesk-v22-login-mode';
  let user=null;
  let currentMode=sessionStorage.getItem(ACCESS_KEY)==='api'?'api':'demo';
  let source='demo';
  const limitedViews=['pulse','relaciones','intelligence'];
  const safe = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function api(path, options={}) {
    const control=new AbortController();const timeout=setTimeout(()=>control.abort(),10000);
    try {
      const response=await fetch(API+path,{
        ...options,credentials:'include',signal:control.signal,
        headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok){
        const err=new Error(result.error||`Error HTTP ${response.status}`);
        err.status=response.status;throw err;
      }
      return result;
    } finally { clearTimeout(timeout); }
  }
  async function login(email,password){
    const result=await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
    user=result.user; currentMode='api';source='api';
    sessionStorage.setItem(ACCESS_KEY,'api');
    localStorage.setItem('nexodesk-v21-mode','api');
    sessionStorage.removeItem('nexodesk-demo-session');
    return user;
  }
  async function logout(){
    if(currentMode==='api'||user){
      try { await api('/auth/logout',{method:'POST',body:'{}'}); }
      catch(e) { console.warn('No se pudo confirmar el cierre de sesión con la API:', e); }
    }
    user=null;currentMode='demo';source='demo';
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem('nexodesk-demo-session');
    localStorage.setItem('nexodesk-v21-mode','demo');
    location.replace('login.html');
  }
  async function ensure(){
    if(currentMode==='api'){
      try { user=(await api('/auth/me')).user; source='api'; return true; }
      catch{location.replace('login.html?expired=1');return false;}
    }
    try {
      if(JSON.parse(sessionStorage.getItem('nexodesk-demo-session')||'null'))return true;
    } catch {}
    location.replace('login.html');return false;
  }
  function useSource(next){source=next;applyAccess();}
  function isRequester(){return source==='api' && user?.role==='Solicitante';}
  function canEdit(){return source!=='api'||(user && user.role!=='Solicitante');}
  function applyAccess(){
    document.querySelectorAll('.nav-item').forEach(b=>{
      const restricted=limitedViews.includes(b.dataset.view) ||
        (['assets','triage'].includes(b.dataset.view) && user?.role==='Solicitante') ||
        (b.dataset.view==='usuarios'&&!['Administrador','Coordinador'].includes(user?.role));
      b.hidden=source==='api'&&restricted;
    });
    const button=document.querySelector('#resetButton');if(button)button.disabled=source==='api';
    const requester=isRequester();
    const requesterInput=document.querySelector('#ticketForm [name="requester"]');
    const assignee=document.querySelector('#ticketForm [name="assignee"]');
    const priority=document.querySelector('#ticketForm [name="priority"]');
    if(requesterInput){requesterInput.readOnly=requester;if(requester)requesterInput.value=user.name;}
    if(assignee)assignee.disabled=requester;
    if(priority)priority.disabled=requester;
    const warning=document.querySelector('#nxAuthNote');
    if(warning)warning.textContent=source==='api'
      ? `Sesión real: ${user?.name||'usuario'} · ${user?.role||''}${user?.supportLevel?' L'+user.supportLevel:''}. Tickets, Assets, Triage y Portal utilizan PostgreSQL; Pulse, Relaciones e Intelligence siguen en demo local.`
      : 'Demo: cualquier correo válido (sin autenticación). La información se guarda solo en este navegador.';
    if(user && source==='api'){
      const name=document.querySelector('#profileName');if(name)name.textContent=user.name;
      const role=document.querySelector('#profileRole');if(role)role.textContent=user.role+(user.supportLevel?' L'+user.supportLevel:'');
      const avatar=document.querySelector('#profileAvatar');if(avatar)avatar.textContent=user.name.split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase();
    }
  }
  function renderUsers(root){
    if(source!=='api')return;
    root.innerHTML=`<h2>Usuarios del servidor</h2><p class="muted">Cuentas reales con roles y sesiones. No se muestran contraseñas.</p><div id="nxRealUsers" role="status">Cargando usuarios…</div>`;
    api('/users').then(({data})=>{
      const canManage=user.role==='Administrador';
      const rows=data.map(v=>`<tr><td>${safe(v.name)}</td><td>${safe(v.email)}</td><td>${safe(v.role)} ${v.supportLevel?'L'+v.supportLevel:''}</td><td>${v.active?'Activo':'Inactivo'}</td><td>${canManage&&v.id!==user.id?`<button type="button" class="link-button" data-nx-user-toggle="${Number(v.id)}" data-nx-active="${v.active?'1':'0'}">${v.active?'Desactivar':'Activar'}</button><button type="button" class="link-button" data-nx-password-id="${Number(v.id)}">${v.hasPassword?'Restablecer clave':'Activar acceso'}</button>`:'—'}</td></tr>`).join('');
      root.innerHTML=`<h2>Usuarios del servidor</h2><p class="muted">Solo el administrador puede crear cuentas y activarlas o desactivarlas.</p><div class="table-wrap"><table class="ticket-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${rows}</tbody></table></div>${canManage?`<form id="nxRealUserForm" class="inline-form"><h3>Crear cuenta real</h3><div class="detail-grid"><label>Nombre<input name="name" required maxlength="120"></label><label>Correo<input name="email" required type="email"></label><label>Contraseña inicial (mínimo 12 caracteres)<input name="password" required minlength="12" type="password" autocomplete="new-password"></label><label>Rol<select name="role"><option>Solicitante</option><option>Técnico</option><option>Coordinador</option><option>Administrador</option></select></label><label>Nivel técnico<select name="supportLevel"><option value="">No aplica</option><option value="1">L1</option><option value="2">L2</option><option value="3">L3</option></select></label></div><button type="submit" class="primary-button">Crear usuario</button><p id="nxUserFeedback" role="status"></p></form>`:''}`;
    }).catch(err=>{root.innerHTML=`<h2>Usuarios del servidor</h2><p class="muted">${safe(err.message)}</p>`;});
  }
  function renderPasswordPanel(root){
    if(source!=='api')return;
    root.insertAdjacentHTML('beforeend',`<form id="nxPasswordForm" class="inline-form"><h3>Cambiar contraseña de mi cuenta</h3><p class="muted">Usá al menos 12 caracteres. El cambio cierra las demás sesiones de esta cuenta.</p><div class="detail-grid"><label>Contraseña actual<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>Nueva contraseña<input name="newPassword" type="password" minlength="12" autocomplete="new-password" required></label></div><button type="submit" class="primary-button">Cambiar contraseña</button><p id="nxPasswordFeedback" role="status"></p></form>`);
  }
  const passwordDialog=document.createElement('dialog');passwordDialog.className='ticket-dialog nx-reset-dialog';
  passwordDialog.innerHTML=`<form id="nxAdminResetForm"><h3>Establecer contraseña de usuario</h3><p class="muted" id="nxResetWho"></p><label>Nueva contraseña (mínimo 12 caracteres)<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><p role="status" id="nxResetFeedback"></p><div class="dialog-actions"><button type="button" class="secondary-button" id="nxCloseReset">Cancelar</button><button class="primary-button" type="submit">Guardar contraseña</button></div></form>`;
  document.body.appendChild(passwordDialog);
  passwordDialog.querySelector('#nxCloseReset').addEventListener('click',()=>passwordDialog.close());
  document.addEventListener('submit',async e=>{
    if(e.target.id==='nxRealUserForm'){
      e.preventDefault();const form=e.target;const values=new FormData(form);
      const body={name:String(values.get('name')).trim(),email:String(values.get('email')).trim(),password:String(values.get('password')),role:String(values.get('role')),supportLevel:values.get('role')==='Técnico'?Number(values.get('supportLevel')):null};
      const feed=form.querySelector('#nxUserFeedback');feed.textContent='Creando usuario…';
      try{await api('/users',{method:'POST',body:JSON.stringify(body)});renderUsers(document.querySelector('#alternateView'));}
      catch(err){feed.textContent=err.message;}
    }
    if(e.target.id==='nxAdminResetForm'){
      e.preventDefault();const target=e.target;const feedback=target.querySelector('#nxResetFeedback');
      feedback.textContent='Guardando…';
      try{await api(`/users/${Number(passwordDialog.dataset.userId)}/reset-password`,{
        method:'POST',body:JSON.stringify({password:target.elements.password.value})});
        passwordDialog.close();renderUsers(document.querySelector('#alternateView'));
      }catch(err){feedback.textContent=err.message;}
    }
    if(e.target.id==='nxPasswordForm'){
      e.preventDefault();const form=e.target;const data=new FormData(form);const feedback=form.querySelector('#nxPasswordFeedback');feedback.textContent='Cambiando contraseña…';
      try {await api('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:data.get('currentPassword'),newPassword:data.get('newPassword')})});form.reset();feedback.textContent='Contraseña actualizada. Las otras sesiones se cerraron.';}
      catch(err){feedback.textContent=err.message;}
    }
  });
  document.addEventListener('click',async e=>{
    const reset=e.target.closest('[data-nx-password-id]');
    if(reset){passwordDialog.dataset.userId=reset.dataset.nxPasswordId;
      passwordDialog.querySelector('#nxResetWho').textContent='Cuenta #'+reset.dataset.nxPasswordId;
      passwordDialog.querySelector('form').reset();passwordDialog.querySelector('#nxResetFeedback').textContent='';
      passwordDialog.showModal();return;}
    const button=e.target.closest('[data-nx-user-toggle]');if(!button)return;
    const id=Number(button.dataset.nxUserToggle);const active=button.dataset.nxActive==='1';
    if(!confirm(`${active?'Desactivar':'Activar'} esta cuenta?`))return;
    try {await api('/users/'+id,{method:'PATCH',body:JSON.stringify({active:!active})});renderUsers(document.querySelector('#alternateView'));}
    catch(err){alert(err.message);}
  });
  window.NexoAuth={api,login,logout,ensure,applyAccess,useSource,isRequester,canEdit,renderUsers,renderPasswordPanel,
    get user(){return user;},get source(){return source;},get sessionMode(){return currentMode;},setDemo(){currentMode='demo';sessionStorage.setItem(ACCESS_KEY,'demo');}};
})();

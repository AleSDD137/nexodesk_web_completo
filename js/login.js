/* NEXODESK V2.2 - Demo separado de autenticación real en el servidor. */
const loginForm=document.querySelector('#loginForm');
const emailInput=document.querySelector('#email');
const passwordInput=document.querySelector('#password');
const errorMessage=document.querySelector('#formError');
const rememberCheckbox=document.querySelector('#remember');
const togglePassword=document.querySelector('#togglePassword');
const mode=document.querySelector('#loginMode');
const submit=loginForm.querySelector('[type="submit"]');
const note=document.querySelector('#loginModeNote');
const params=new URLSearchParams(location.search);
if(params.get('expired'))errorMessage.textContent='La sesión terminó o el servidor no respondió. Volvé a iniciar sesión.';
try {
  const savedEmail=localStorage.getItem('nexodesk-demo-email');
  if(savedEmail){emailInput.value=savedEmail;rememberCheckbox.checked=true;}
} catch {}
function syncMode(){
  const real=mode.value==='api';
  note.textContent=real?'Acceso real: necesitás PostgreSQL, backend en ejecución y una cuenta creada por el administrador.':'Demo local: cualquier correo válido y contraseña de 4 caracteres. No utiliza el backend.';
  passwordInput.minLength=real?12:4;
  document.querySelector('.secure-note').textContent=real?'Sesión protegida':'Acceso de demostración';
  document.querySelector('.submit-button').firstChild.textContent=real?'Ingresar con mi cuenta ':'Ingresar a la demo ';
}
mode.addEventListener('change',syncMode);
if(params.get('expired'))mode.value='api';
syncMode();
togglePassword.addEventListener('click',()=>{
  const showing=passwordInput.type==='text';passwordInput.type=showing?'password':'text';
  togglePassword.textContent=showing?'Mostrar':'Ocultar';
  togglePassword.setAttribute('aria-label',showing?'Mostrar contraseña':'Ocultar contraseña');
});
loginForm.addEventListener('submit',async e=>{
  e.preventDefault();errorMessage.textContent='';
  const email=emailInput.value.trim(),password=passwordInput.value;
  if(!emailInput.checkValidity()){errorMessage.textContent='Ingresá un correo válido.';return;}
  if(mode.value==='demo'&&password.length<4){errorMessage.textContent='La contraseña demo requiere 4 caracteres.';return;}
  if(mode.value==='api'&&password.length<12){errorMessage.textContent='Ingresá la contraseña completa (mínimo 12 caracteres).';return;}
  submit.disabled=true;
  try{
    if(rememberCheckbox.checked)localStorage.setItem('nexodesk-demo-email',email);
    else localStorage.removeItem('nexodesk-demo-email');
    if(mode.value==='api') await window.NexoAuth.login(email,password);
    else {
      sessionStorage.setItem('nexodesk-demo-session',JSON.stringify({email,name:email.split('@')[0],startedAt:new Date().toISOString()}));
      localStorage.setItem('nexodesk-v21-mode','demo');
      window.NexoAuth.setDemo();
    }
    location.href='dashboard.html';
  }catch(err){errorMessage.textContent=err.message||'No fue posible iniciar sesión. Revisá el servidor y PostgreSQL.';}
  finally{submit.disabled=false;}
});

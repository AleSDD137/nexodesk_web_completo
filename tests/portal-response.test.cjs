const test = require('node:test');
const assert = require('node:assert/strict');

test('autoservicio devuelve solo campos públicos, sin identidad ajena ni datos de gestión', async () => {
  const {requestView} = await import('../backend/src/portal-response.ts');
  const input = {id:7,title:'Ayuda',description:'Detalle',type:'Incidente',priority:'Media',
    status:'Registrado',createdAt:'2026-11-15',updatedAt:'2026-11-15',
    requester_email:'private@example.test',assignee:'Personal IT',source:'Dashboard',
    comments:[{author:'Soporte',date:'2026-11-15',text:'Respuesta pública',metadata:'No publicar'},
      {author:'Soporte',text:'Registro privado importado',visibility:'internal'},
      {author:'Soporte',text:'Registro restringido importado',internal:true},null,{text:42}]};
  const output=requestView(input);
  assert.deepEqual(Object.keys(output).sort(), ['id','title','description','type','priority',
    'status','createdAt','updatedAt','comments'].sort());
  assert.deepEqual(output.comments,[{author:'Soporte',date:'2026-11-15',text:'Respuesta pública'}]);
  assert.equal(input.comments.length,5,'La proyección no debe modificar registros persistidos');
});

test('un documento de comentarios inválido no se expone como información pública', async () => {
  const {requestView} = await import('../backend/src/portal-response.ts');
  assert.deepEqual(requestView({id:7,comments:{private:'metadata'}}).comments,[]);
});

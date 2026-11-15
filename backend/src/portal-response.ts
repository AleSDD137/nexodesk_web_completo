/** Contrato de lectura del autoservicio. No expone asignaciones, correos,
 * origen ni metadatos de gestión del ticket. No agrega notas internas. */
export const requestFields = `id,title,description,type,priority,status,comments,
  created_at AS "createdAt",updated_at AS "updatedAt"`;

export function requestView(row:Record<string,unknown>) {
  const comments = Array.isArray(row.comments) ? row.comments : [];
  return {
    id:row.id,title:row.title,description:row.description,type:row.type,
    priority:row.priority,status:row.status,createdAt:row.createdAt,updatedAt:row.updatedAt,
    // Los comentarios actuales son públicos. Ante un registro importado con
    // una marca de privacidad, excluirlo y proyectar solo los campos públicos.
    comments:comments.filter(c=>c && typeof c==='object' && typeof c.text==='string' &&
      c.internal!==true && (c.visibility===undefined || c.visibility==='public'))
      .map(c=>({author:typeof c.author==='string'?c.author:'Usuario',
        date:typeof c.date==='string'?c.date:'',text:c.text}))
  };
}

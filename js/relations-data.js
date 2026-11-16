/* Relaciones IT: adaptadores separados. Ningún fallo API lee o escribe Demo. */
(() => {
  'use strict';
  const ASSETS='nexodesk-demo-assets-v12', EXTRAS='nexodesk-demo-asset-links-v13', OWNERS='nexodesk-demo-asset-users-v25';
  const clone=value=>structuredClone(value);
  const error=(message,status)=>Object.assign(Error(message),{status});
  function read(key,fallback,array=false){
    const raw=localStorage.getItem(key),value=raw===null?fallback():JSON.parse(raw);
    if(!value || typeof value!=='object' || Array.isArray(value)!==array)throw Error('Los datos Demo de Relaciones no son válidos. No se sobrescribieron.');
    return clone(value);
  }
  function query(values){
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(values))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));
    const suffix=params.toString();return suffix?'?'+suffix:'';
  }
  function create(mode,ctx){
    if(mode==='api'){
      const api=(path,options)=>window.NexoAuth.api(path,options);
      return {
        mode,
        async listAssets(params={}){return api('/relations/assets'+query(params));},
        async getAsset(id,params={}){return (await api(`/relations/assets/${Number(id)}`+query(params))).data;},
        async searchTickets(params={}){return api('/relations/tickets'+query(params));},
        async searchUsers(params={}){return api('/relations/users'+query(params));},
        async link(assetId,ticketId){return api('/relations/links',{method:'POST',body:JSON.stringify({assetId:Number(assetId),ticketId:Number(ticketId)})});},
        async unlink(assetId,ticketId){return api(`/relations/links/${Number(assetId)}/${Number(ticketId)}`,{method:'DELETE',body:'{}'});},
        async setOwner(id,userId){return api(`/relations/assets/${Number(id)}/owner`,{method:'PUT',body:JSON.stringify({userId:userId==null?null:Number(userId)})});}
      };
    }
    if(mode!=='demo')throw Error('Origen de Relaciones desconocido');
    const assets=()=>read(ASSETS,()=>window.NexoV12.assets(),true);
    const extras=()=>read(EXTRAS,()=>({}));
    const owners=()=>read(OWNERS,()=>({}));
    const users=()=>Array.isArray(ctx.users)?ctx.users:[];
    const tickets=()=>Array.isArray(ctx.tickets)?ctx.tickets:[];
    const same=(a,b)=>String(a)===String(b);
    const norm=value=>String(value??'').trim().toLocaleLowerCase('es');
    function page(items,{limit=20,offset=0}={}){limit=Math.max(1,Math.min(100,Number(limit)||20));offset=Math.max(0,Number(offset)||0);return {data:clone(items.slice(offset,offset+limit)),total:items.length,limit,offset};}
    function linked(asset){
      const additional=extras()[asset.id]||[];
      if(!Array.isArray(additional))throw Error('Los vínculos Demo no tienen un formato válido.');
      const ids=new Set([asset.ticketId,...additional].filter(id=>id!==null&&id!==undefined&&id!=='').map(String));
      return tickets().filter(t=>ids.has(String(t.id))).map(t=>({...t,primary:same(asset.ticketId,t.id),additional:additional.some(id=>same(id,t.id))}));
    }
    function enrich(asset){
      const userId=owners()[asset.id]??null,user=userId==null?null:users().find(u=>same(u.id,userId));
      return {...asset,ownerUserId:user?.id??null,ownerUserName:user?.name??null,linkedCount:linked(asset).length};
    }
    function findAsset(id){const asset=assets().find(a=>same(a.id,id));if(!asset)throw error('Activo no encontrado.',404);return asset;}
    return {
      mode,
      async listAssets(params={}){
        const q=norm(params.search),items=assets().filter(a=>!q||norm([a.id,a.brand,a.serial,a.location,a.owner].join(' ')).includes(q)).map(enrich);
        return page(items,params);
      },
      async getAsset(id,params={}){
        const original=findAsset(id),asset=enrich(original),selection=page(linked(original),{limit:50,...params});
        const owner=asset.ownerUserId==null?null:users().find(u=>same(u.id,asset.ownerUserId));
        return {asset,tickets:selection.data,total:selection.total,limit:selection.limit,offset:selection.offset,
          ownerUser:owner?{id:owner.id,name:owner.name,role:owner.role,active:owner.active}:null};
      },
      async searchTickets(params={}){
        const q=norm(params.search).replace(/^#/,''),items=tickets().filter(t=>!q||same(t.id,q)||norm(t.title).includes(q));return page(items,params);
      },
      async searchUsers(params={}){
        const q=norm(params.search),items=users().filter(u=>u.active&&(!q||same(u.id,q)||norm(u.name).includes(q)))
          .map(u=>({id:u.id,name:u.name,role:u.role,active:u.active}));return page(items,params);
      },
      async link(assetId,ticketId){
        const asset=findAsset(assetId);if(!tickets().some(t=>same(t.id,ticketId)))throw error('Ticket no encontrado.',404);
        if(linked(asset).some(t=>same(t.id,ticketId)))throw error('Ese activo y ticket ya están vinculados.',409);
        const links=extras();links[asset.id]=[...(links[asset.id]||[]),String(ticketId)];
        localStorage.setItem(EXTRAS,JSON.stringify(links));return {data:{assetId,ticketId}};
      },
      async unlink(assetId,ticketId){
        const asset=findAsset(assetId);if(same(asset.ticketId,ticketId))throw error('El vínculo principal se conserva. Se administra desde Assets.',409);
        const links=extras(),existing=links[asset.id]||[];
        if(!Array.isArray(existing))throw Error('Los vínculos Demo no tienen un formato válido.');
        if(!existing.some(id=>same(id,ticketId)))throw error('Vínculo adicional no encontrado.',404);
        links[asset.id]=existing.filter(id=>!same(id,ticketId));localStorage.setItem(EXTRAS,JSON.stringify(links));return {data:{assetId,ticketId}};
      },
      async setOwner(id,userId){
        const asset=findAsset(id),links=owners();
        if(userId!=null&&!users().some(u=>same(u.id,userId)&&u.active))throw error('Elegí un usuario registrado y activo.',400);
        if(userId==null)delete links[asset.id];else links[asset.id]=userId;
        localStorage.setItem(OWNERS,JSON.stringify(links));return {data:enrich(asset)};
      }
    };
  }
  window.NexoRelationsData={create};
})();

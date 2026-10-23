(function (root) {
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const props=['width','height','autoPosition'];
  const geometry=node=>({x:node.x,y:node.y,width:node.width,height:node.height,autoPosition:node.autoPosition});
  function createTracker() {
    let offsets=new Map(),active=new Set(),generation=0,journal=[];
    const entry=id=>offsets.get(id)||{x:0,y:0,props:{}};
    function project(records,manual=false) {
      if(manual)return records.map(node=>({...node}));
      return records.map(node=>{
        const result={...node},pending=entry(node.id);
        result.x+=pending.x;result.y+=pending.y;
        for(const key of props)if(pending.props[key]&&Object.is(node[key],pending.props[key].live))result[key]=pending.props[key].saved;
        for(const token of active){
          const before=token.raw.get(node.id),saved=token.projected.get(node.id);
          if(!before)continue;
          result.x=saved.x;
          result.y=saved.y;
          for(const key of props)if(!Object.is(node[key],before[key]))result[key]=saved[key];
        }
        return result;
      });
    }
    function begin(records) {
      const token={generation,raw:new Map(records.map(n=>[n.id,geometry(n)])),projected:new Map(project(records).map(n=>[n.id,geometry(n)]))};
      active.add(token);return token;
    }
    function finish(token,records,{cancelled=false}={}) {
      if(!active.delete(token)||token.generation!==generation)return;
      // Pointer cancellation still ends a visible gesture; its geometry remains manual.
      for(const node of records){
        const before=token.raw.get(node.id),saved=token.projected.get(node.id);
        if(!before)continue;
        const pending=copy(entry(node.id));
        if(node.x!==before.x)pending.x=saved.x-node.x;
        if(node.y!==before.y)pending.y=saved.y-node.y;
        for(const key of props)if(!Object.is(node[key],before[key]))pending.props[key]={saved:saved[key],live:node[key]};
        offsets.set(node.id,pending);
      }
    }
    function captureCommit(records) {
      return {generation,revision:journal.length,raw:records.map(n=>({id:n.id,...geometry(n)})),projected:project(records).map(n=>({id:n.id,...geometry(n)}))};
    }
    function commit(token) {
      if(!token||token.generation!==generation)return;
      const before=new Map(token.projected.map(n=>[n.id,n])),adjustments=[];
      for(let i=token.revision;i<journal.length;i++)for(const delta of journal[i]){
        const node=before.get(delta.id);if(!node)continue;
        node.x+=delta.x;node.y+=delta.y;Object.assign(node,delta.props);
      }
      for(const saved of token.raw){
        const old=before.get(saved.id),delta={id:saved.id,x:saved.x-old.x,y:saved.y-old.y,props:{}};
        for(const key of props)if(!Object.is(old[key],saved[key]))delta.props[key]=saved[key];
        if(!delta.x&&!delta.y&&!Object.keys(delta.props).length)continue;
        adjustments.push(delta);
      }
      applyAdjustments(adjustments);
      for(const gesture of active)for(const delta of adjustments){
        const saved=gesture.projected.get(delta.id);if(!saved)continue;
        saved.x+=delta.x;saved.y+=delta.y;Object.assign(saved,delta.props);
      }
      journal.push(adjustments);
    }
    function applyAdjustments(adjustments,records) {
      const live=records&&new Map(records.map(n=>[n.id,n]));
      for(const delta of adjustments){
        const pending=copy(entry(delta.id));pending.x+=delta.x;pending.y+=delta.y;
        for(const key of Object.keys(delta.props)){
          const current=live?.has(delta.id)?live.get(delta.id)[key]:pending.props[key]?.live;
          if(Object.is(current,delta.props[key]))delete pending.props[key];
          else pending.props[key]={saved:delta.props[key],live:current};
        }
        offsets.set(delta.id,pending);
      }
    }
    function capture(){return {generation,revision:journal.length,offsets:copy([...offsets])};}
    function rebase(records,snapshot) {
      const result=records.map(node=>({...node}));
      if(!snapshot||snapshot.generation!==generation)return result;
      const nodes=new Map(result.map(node=>[node.id,node]));
      for(let i=snapshot.revision;i<journal.length;i++)for(const delta of journal[i]){
        const node=nodes.get(delta.id);if(!node)continue;
        node.x+=delta.x;node.y+=delta.y;Object.assign(node,delta.props);
      }
      return result;
    }
    function restore(snapshot,records) {
      active.clear();
      if(!snapshot||snapshot.generation!==generation){offsets.clear();return;}
      offsets=new Map(copy(snapshot.offsets));
      for(let i=snapshot.revision;i<journal.length;i++)applyAdjustments(journal[i],records);
    }
    function reset(){generation++;offsets.clear();active.clear();journal=[];}
    return {project,begin,finish,captureCommit,commit,capture,restore,reset,rebase};
  }
  const api={createTracker};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CanvasManualLayout=api;
})(typeof window==='object'?window:globalThis);

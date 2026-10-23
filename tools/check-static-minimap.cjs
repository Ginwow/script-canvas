const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app.js','utf8');
const start=source.indexOf('      let minimapNodeCount'),end=source.indexOf('      let previewDetailTimer',start);
let geometryReads=0,created=0,rebuilds=0;
const element=()=>({attributes:{},setAttribute(k,v){this.attributes[k]=v;}});
const node=id=>({dataset:{id,x:10,y:20,kind:'asset'},classList:{contains:()=>false},get offsetWidth(){geometryReads++;return 100;},get offsetHeight(){geometryReads++;return 80;}});
const a=node('a'),nodesLayer={children:[a]},minimapSvg={children:[],replaceChildren(){this.children=[];rebuilds++;},append(el){this.children.push(el);}};
const context=vm.createContext({nodesLayer,minimapSvg,minimapTransform:null,view:{x:0,y:0,scale:1},dockShiftX:0,viewport:{clientWidth:1000,clientHeight:800},connections:[],document:{createElementNS(){created++;return element();}}});
vm.runInContext(source.slice(start,end),context);
context.renderMinimap();assert.equal(rebuilds,1);const originalCreated=created,originalReads=geometryReads;
a.dataset.x=500;a.classList.contains=()=>true;
for(let i=0;i<100;i++){context.view.x=i;context.renderMinimap();context.updateMinimapViewport();}
assert.equal(rebuilds,1);assert.equal(created,originalCreated);assert.equal(geometryReads,originalReads,'Movement/collapse/view changes do not read node geometry');
const viewRect=minimapSvg.children.at(-1);assert(Number.isFinite(viewRect.attributes.x));
nodesLayer.children.push(node('b'));context.renderMinimap();assert.equal(rebuilds,2);
nodesLayer.children.pop();context.renderMinimap();assert.equal(rebuilds,3);
nodesLayer.children=[node('other-project')];context.renderMinimap();assert.equal(rebuilds,4,'Switching projects rebuilds even with same node count');
nodesLayer.children=[];context.renderMinimap();assert.equal(rebuilds,5);context.renderMinimap();assert.equal(rebuilds,5);
console.log('PASS static minimap: add/delete/project switch rebuild; 100 move/collapse/view changes create no elements or geometry reads');

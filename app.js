    (() => {
      const viewport = document.querySelector('#viewport');
      const world = document.querySelector('#world');
      const shotLanes = document.querySelector('#shotLanes');
      const connectionLayer = document.querySelector('#connections');
      const nodesLayer = document.querySelector('#nodes');
      const connectionAnchorLayer = document.createElement('div');
      connectionAnchorLayer.id = 'connectionAnchors'; world.append(connectionAnchorLayer);
      const minimap = document.querySelector('#minimap');
      const minimapSvg = document.querySelector('#minimapSvg');
      const fileInput = document.querySelector('#fileInput');
      const projectFileInput = document.querySelector('#projectFileInput');
      const characterImageInput = document.querySelector('#characterImageInput');
      const dropOverlay = document.querySelector('#dropOverlay');
      const zoomLabel = document.querySelector('#zoomLabel');
      const toastEl = document.querySelector('#toast');
      const quickNav = document.querySelector('#quickNav');
      const quickOverlay = document.querySelector('#quickOverlay');
      const quickPanel = document.querySelector('#quickPanel');
      const quickTitle = document.querySelector('#quickTitle');
      const quickBody = document.querySelector('#quickBody');
      const quickBack = document.querySelector('#quickBack');
      const quickClose = document.querySelector('#quickClose');
      const quickPrevious = document.querySelector('#quickPrevious');
      const quickNext = document.querySelector('#quickNext');
      let quickTrail = [];
      let quickRenderedSignature='',quickSyncPending=false;
      function quickContentSignature(){
        const state=quickTrail.at(-1);if(!state)return '';
        let roots=[];
        const kind={people:'person',shots:'shot-group',cover:'cover-group',video:'video-group',bgm:'bgm-group'}[state.view] || state.view;
        if(state.nodeId){const node=getNode(state.nodeId);if(node)roots=[node];}
        else roots=quickNodesOfKind(kind);
        const ids=new Set(roots.map(n=>n.dataset.id));
        for(const edge of connections)if(roots.some(n=>n.dataset.id===edge.fromId))ids.add(edge.toId);
        const records=[...ids].map(id=>getNode(id)).filter(Boolean).map(n=>({id:n.dataset.id,title:quickNodeTitle(n),text:getBodyText(n.querySelector('.node-body')),path:n.dataset.assetPath,project:n.dataset.projectPath,name:n.dataset.fileName,duration:n.dataset.duration}));
        return JSON.stringify([state,records,connections.filter(e=>ids.has(e.fromId)&&ids.has(e.toId))]);
      }
      function scheduleQuickSync(){
        if(quickOverlay.hidden || quickSyncPending)return;quickSyncPending=true;
        queueMicrotask(()=>{quickSyncPending=false;if(!quickOverlay.hidden && quickContentSignature()!==quickRenderedSignature)renderQuickView({preserve:true});});
      }
      async function openQuickImage(id){
        const node=getNode(id);if(!node){toast('该参考图已移除');return;}
        const result=await window.canvasFiles.loadProjectAsset({projectPath:node.dataset.projectPath || importedProjectPath,assetPath:node.dataset.assetPath});
        if(result?.ok && result.url)openImageViewer(result.originalUrl || result.url);else toast(result?.error || '无法打开参考图');
      }
      let quickPinned=localStorage.getItem('canvas-quick-pinned')==='true';
      function quickBlocksCanvas(event){return !quickOverlay.hidden && (!quickPinned || quickPanel.contains(event.target));}
      function applyQuickPin(){quickOverlay.classList.toggle('is-pinned',quickPinned);quickPanel.setAttribute('aria-modal',String(!quickPinned));const pin=document.querySelector('#quickPin');if(pin){pin.setAttribute('aria-pressed',String(quickPinned));pin.title=quickPinned?'取消固定':'固定到右侧';}}
      let saveStatusHideTimer=null;
      function setSaveStatus(state,message){const panel=document.querySelector('#saveStatus'),label=document.querySelector('#saveStatusText'),retry=document.querySelector('#saveRetry');clearTimeout(saveStatusHideTimer);saveStatusHideTimer=null;if(!panel)return;panel.hidden=false;panel.dataset.state=state;label.textContent=message || ({saving:'保存中…',saved:importedProjectPath?'已保存':'已保存到本机',error:'保存失败'})[state];retry.hidden=state!=='error';if(state==='saved')saveStatusHideTimer=setTimeout(()=>{saveStatusHideTimer=null;if(panel.dataset.state==='saved')panel.hidden=true;},2000);}

      const SAVE_KEY = 'white-canvas-demo-v1';
      let importedProjectPath = '';
      let importedCodexConversation = null;
      let importedProjectFingerprint = '';
      let importedCanvasFingerprint = '';
      let refreshingProject = false;
      let view = { x: innerWidth / 2, y: innerHeight / 2, scale: 1 };
      let dockShiftX = 0;
      let shotLaneLayoutVersion = 0;
      let nodeSeq = 0;
      let activePointer = null;
      let panFrame = 0;
      let connections = [];
      let connectionDrag = null;
      let pendingConnection = null;
      let pendingCharacterImage = null;
      let minimapTransform = null;
      let minimapPointerId = null;
      let toastTimer;
      let imageZoomSaveTimer;
      const objectUrls = new Set();
      const pendingProjectAssets = new WeakMap();
      const projectAssetObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          projectAssetObserver.unobserve(entry.target);
          const asset = pendingProjectAssets.get(entry.target);
          if (asset) { pendingProjectAssets.delete(entry.target); renderProjectAsset(entry.target, asset.path, asset.projectPath); }
        });
      }, { root: viewport, rootMargin: '120px' });

      function toast(message) {
        toastEl.replaceChildren(document.createTextNode(message));
        toastEl.classList.remove('has-action');
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
      }

      function toastAction(message, label, onClick) {
        const text = document.createElement('span'); text.textContent = message;
        const action = document.createElement('button'); action.type = 'button'; action.textContent = label;
        action.addEventListener('click', event => { event.stopPropagation(); onClick(); if (toastEl.classList.contains('has-action')) toastEl.classList.remove('show', 'has-action'); });
        toastEl.replaceChildren(text, action);
        toastEl.classList.add('show', 'has-action');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show', 'has-action'), 5000);
      }

      function syncDockShift() {
        const reservedWidth = Math.max(0, innerWidth - viewport.clientWidth);
        dockShiftX = Math.min(160, Math.round(reservedWidth * .42));
      }

      function worldPoint(clientX, clientY) {
        return { x: (clientX - view.x + dockShiftX) / view.scale, y: (clientY - view.y) / view.scale };
      }

      let minimapNodeCount = -1, minimapRootNode = null, minimapViewportRect = null;
      function updateMinimapViewport() {
        if (!minimapTransform || !minimapViewportRect) return;
        const {scale, offsetX, offsetY} = minimapTransform;
        minimapViewportRect.setAttribute('x', (-view.x + dockShiftX) / view.scale * scale + offsetX);
        minimapViewportRect.setAttribute('y', -view.y / view.scale * scale + offsetY);
        minimapViewportRect.setAttribute('width', viewport.clientWidth / view.scale * scale);
        minimapViewportRect.setAttribute('height', viewport.clientHeight / view.scale * scale);
      }
      function renderMinimap() {
        const count = nodesLayer.children.length, root = nodesLayer.children[0] || null;
        if (count === minimapNodeCount && root === minimapRootNode) { updateMinimapViewport(); return; }
        minimapNodeCount = count; minimapRootNode = root;
        const width = 240, height = 150, padding = 12;
        const visible = {
          x: (-view.x + dockShiftX) / view.scale,
          y: -view.y / view.scale,
          width: viewport.clientWidth / view.scale,
          height: viewport.clientHeight / view.scale
        };
        const nodes = [...nodesLayer.children].filter(node => !node.classList.contains('hidden-by-parent'));
        const bounds = [
          { left: visible.x, top: visible.y, right: visible.x + visible.width, bottom: visible.y + visible.height },
          ...nodes.map(node => ({
            left: Number(node.dataset.x), top: Number(node.dataset.y),
            right: Number(node.dataset.x) + node.offsetWidth, bottom: Number(node.dataset.y) + node.offsetHeight
          }))
        ];
        let left = Math.min(...bounds.map(item => item.left));
        let top = Math.min(...bounds.map(item => item.top));
        let right = Math.max(...bounds.map(item => item.right));
        let bottom = Math.max(...bounds.map(item => item.bottom));
        const padX = Math.max(60, (right - left) * .08), padY = Math.max(60, (bottom - top) * .08);
        left -= padX; right += padX; top -= padY; bottom += padY;
        const scale = Math.min((width - padding * 2) / (right - left), (height - padding * 2) / (bottom - top));
        const offsetX = (width - (right - left) * scale) / 2 - left * scale;
        const offsetY = (height - (bottom - top) * scale) / 2 - top * scale;
        const mapPoint = point => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY });
        minimapTransform = { scale, offsetX, offsetY };
        minimapSvg.replaceChildren();

        for (const connection of connections) {
          const from = getNode(connection.fromId), to = getNode(connection.toId);
          if (!from || !to || from.classList.contains('hidden-by-parent') || to.classList.contains('hidden-by-parent')) continue;
          if (from.dataset.kind === 'shot-group' && to.dataset.kind === 'shot') continue;
          const start = mapPoint(nodeRightAnchor(from)), end = mapPoint(nodeLeftAnchor(to));
          const dx = end.x - start.x, bend = Math.max(3, Math.abs(dx) * .45), direction = Math.sign(dx || 1);
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('class', 'map-connection');
          path.setAttribute('d', `M ${start.x} ${start.y} C ${start.x + direction * bend} ${start.y}, ${end.x - direction * bend} ${end.y}, ${end.x} ${end.y}`);
          minimapSvg.append(path);
        }

        const nodeColors = { script: '#58657b', plot: '#76549a', style: '#5d688f', person: '#88722d', character: '#81523f', 'shot-group': '#42617a', shot: '#456c83', storyboard: '#3d7665', asset: '#405660', prompt: '#594c6b' };
        for (const node of nodes) {
          const position = mapPoint({ x: Number(node.dataset.x), y: Number(node.dataset.y) });
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('class', 'map-node'); rect.setAttribute('x', position.x); rect.setAttribute('y', position.y);
          rect.setAttribute('width', Math.max(3, node.offsetWidth * scale)); rect.setAttribute('height', Math.max(3, node.offsetHeight * scale));
          rect.setAttribute('rx', '1.5'); rect.setAttribute('fill', nodeColors[node.dataset.kind] || '#4b5059');
          minimapSvg.append(rect);
        }

        const viewCorner = mapPoint({ x: visible.x, y: visible.y });
        const viewBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        viewBox.setAttribute('class', 'map-viewport');
        viewBox.setAttribute('x', viewCorner.x); viewBox.setAttribute('y', viewCorner.y);
        viewBox.setAttribute('width', visible.width * scale); viewBox.setAttribute('height', visible.height * scale);
        viewBox.setAttribute('rx', '2');
        minimapSvg.append(viewBox);
        minimapViewportRect = viewBox;

      }

      let previewDetailTimer=null,lightPreviewMode=null;
      function updatePreviewDetail(){
        const light=view.scale<.6;
        document.body.classList.toggle('canvas-overview',view.scale<.35);
        if(view.scale<.35)nodesLayer.querySelectorAll('video,audio').forEach(media=>{if(!media.paused)media.pause();});
        if(light===lightPreviewMode)return;
        lightPreviewMode=light;clearTimeout(previewDetailTimer);
        previewDetailTimer=setTimeout(()=>{
          for(const container of nodesLayer.querySelectorAll('.asset-preview')){
            const node=container.closest('.node');
            if(!node?.dataset.assetPath || !isCanvasImageFile({name:node.dataset.assetPath}) || pendingProjectAssets.has(container))continue;
            if(container.dataset.previewMode!==String(view.scale<.6))renderProjectAsset(container,node.dataset.assetPath,node.dataset.projectPath || importedProjectPath);
          }
        },180);
      }
      function applyView() {
        updatePreviewDetail();
        const screenX = view.x - dockShiftX;
        world.style.transform = `translate(${screenX}px, ${view.y}px) scale(${view.scale})`;
        viewport.style.backgroundPosition = `${screenX}px ${view.y}px`;
        viewport.style.backgroundSize = `${30 * view.scale}px ${30 * view.scale}px`;
        zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
        updateMinimapViewport();
      }

      function canvasRecords() {
        return [...nodesLayer.children].map(el => ({
          id: el.dataset.id, kind: el.dataset.kind, x: Number(el.dataset.x), y: Number(el.dataset.y),
          title: el.querySelector('.node-title')?.textContent || '',
          fileName: el.querySelector('.asset-name')?.textContent || el.dataset.fileName || '',
          assetPath: el.dataset.assetPath || '', projectPath: el.dataset.projectPath || '',
          text: getBodyText(el.querySelector('.node-body')),
          includeInChat: el.dataset.includeInChat === 'true',
          duration: el.dataset.duration || '', imageRole: el.dataset.imageRole || '', autoPosition: el.dataset.autoPosition || '', collapsed: el.classList.contains('collapsed'),
          childrenCollapsed: el.classList.contains('children-collapsed'),
          width: Number(el.dataset.userWidth) || null, height: Number(el.dataset.userHeight) || null,
          imageZoom: Number(el.dataset.imageZoom) || 1,
          imagePanX: Number(el.dataset.imagePanX) || 0, imagePanY: Number(el.dataset.imagePanY) || 0
        }));
      }

      function fingerprintText(value) {
        let first = 2166136261, second = 5381;
        for (let index = 0; index < value.length; index++) {
          const code = value.charCodeAt(index);
          first = Math.imul(first ^ code, 16777619);
          second = Math.imul(second, 33) ^ code;
        }
        return `${value.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
      }

      function canvasFingerprint() {
        const nodes = canvasRecords().map(({ includeInChat, collapsed, childrenCollapsed, width, height, imageZoom, imagePanX, imagePanY, ...record }) => record);
        return fingerprintText(JSON.stringify({ nodes, connections }));
      }

      function projectFingerprint(project) {
        return fingerprintText(JSON.stringify(project));
      }

      let canvasSaveQueue=Promise.resolve();
      let canvasContentObserved=null,canvasContentProject='',canvasContentChanged=false,canvasContentRevision=0;
      function canvasContentSignature() {
        const records=canvasRecords().map(({x,y,width,height,collapsed,childrenCollapsed,imageZoom,imagePanX,imagePanY,autoPosition,fileName,assetPath,projectPath,...record})=>record).sort((a,b)=>a.id.localeCompare(b.id));
        const edges=connections.map(edge=>[edge.fromId,edge.toId]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
        return JSON.stringify([records,edges]);
      }
      function resetCanvasContentTracking() {
        canvasContentObserved=canvasContentSignature();canvasContentProject=importedProjectPath;canvasContentChanged=false;canvasContentRevision++;
        if(typeof resetManualCanvasLayout==='function')resetManualCanvasLayout(canvasRecords());
      }
      function acknowledgeCanvasViewChange() { canvasContentObserved=canvasContentSignature(); }
      function observeCanvasContentChange() {
        const signature=canvasContentSignature();
        if(canvasContentObserved===null || canvasContentProject!==importedProjectPath){resetCanvasContentTracking();return true;}
        if(signature===canvasContentObserved)return false;
        canvasContentObserved=signature;canvasContentChanged=true;canvasContentRevision++;return true;
      }
      function recordCanvasLayoutChange() {
        observeCanvasContentChange();
        recordCanvasUndo({nodes:canvasRecords(),connections});
      }
      const manualCanvasLayout=window.CanvasManualLayout.createTracker();
      function beginManualCanvasLayout(){return manualCanvasLayout.begin(canvasRecords());}
      function finishManualCanvasLayout(token,options){manualCanvasLayout.finish(token,canvasRecords(),options);}
      function projectCanvasLayout(records,manual=false){return manualCanvasLayout.project(records,manual);}
      function resetManualCanvasLayout(){manualCanvasLayout.reset();}
      function captureManualCanvasLayout(){return manualCanvasLayout.capture();}
      function restoreManualCanvasLayout(snapshot){manualCanvasLayout.restore(snapshot,canvasRecords());}
      function captureCanvasSaveRequest(options){
        const records=canvasRecords();
        return {state:{
          view:{...view},nodes:projectCanvasLayout(records,options.manualLayout===true),connections:connections.map(edge=>({...edge})),
          shotLaneLayoutVersion,contextSelectionVersion:1,
          projectSource:{path:importedProjectPath,codex:importedCodexConversation,fingerprint:importedProjectFingerprint,canvasFingerprint:importedCanvasFingerprint}
        },layoutCommit:options.manualLayout===true?manualCanvasLayout.captureCommit(records):null,layoutRevision:manualCanvasLayout.capture()};
      }
      let pendingAutomaticSave=null;
      function save(options = {}) {
        observeCanvasContentChange();
        // Record at the mutation boundary, before queued disk writes can observe later edits.
        if (!options.skipUndo) recordCanvasUndo({nodes:canvasRecords(),connections});
        scheduleQuickSync();
        setSaveStatus('saving');
        // Only merge writes that have not started. Every mutation above still records history.
        // Explicit saves and restoration are barriers, and never inherit an automatic save's
        // non-strict error handling. A running write always gets a new trailing write.
        const automatic=!options.manualLayout&&!options.strict&&!options.skipUndo;
        const request=captureCanvasSaveRequest(options);
        if(automatic&&pendingAutomaticSave?.projectPath===importedProjectPath){pendingAutomaticSave.request=request;return pendingAutomaticSave.operation;}
        const pending=automatic?{projectPath:importedProjectPath,operation:null,request}:null;
        pendingAutomaticSave=pending;
        const operation=canvasSaveQueue.then(()=>{
          if(pendingAutomaticSave===pending)pendingAutomaticSave=null;
          return persistCanvas(options,pending?.request || request);
        }).then(async result=>{if(!nodeDeletionPending)await pruneUndoHistory();return result;});
        if(pending)pending.operation=operation;
        canvasSaveQueue=operation.catch(()=>{});
        return operation;
      }
      function persistCanvas(options = {},request=captureCanvasSaveRequest(options)) {
        setSaveStatus('saving');
        try {
          const {layoutCommit}=request;
          const state={...request.state,nodes:layoutCommit?request.state.nodes:manualCanvasLayout.rebase(request.state.nodes,request.layoutRevision)};
          if(!layoutCommit)localStorage.setItem(SAVE_KEY, JSON.stringify(state));
          if (state.projectSource.path && window.canvasFiles?.saveManagedProject) {
            const historySnapshots=canvasHistorySnapshots();
            return window.canvasFiles.saveManagedProject({path:state.projectSource.path,state,historyAssets:canvasHistoryAssetReferences(historySnapshots)}).then(result=> { if(!result?.ok) throw new Error(result?.error || '项目保存失败'); if(importedProjectPath===state.projectSource.path)manualCanvasLayout.commit(layoutCommit); const checkpointCurrent=canvasUndoStateSignature({nodes:canvasRecords(),connections})===canvasUndoSignature; rewriteCanvasHistoryAssets(result.historyAssets || [],historySnapshots); if(importedProjectPath===state.projectSource.path){for(const asset of result.videoAssets || []){const node=getNode(asset.id),original=state.nodes.find(n=>n.id===asset.id);if(node&&node.dataset.assetPath===original?.assetPath&&node.dataset.projectPath===(original.projectPath || '')){const pathChanged=node.dataset.assetPath!==asset.assetPath || node.dataset.projectPath!==asset.projectPath;node.dataset.assetPath=asset.assetPath;node.dataset.projectPath=asset.projectPath;if(pathChanged){const preview=node.querySelector('.asset-preview');if(preview){pendingProjectAssets.delete(preview);projectAssetObserver?.unobserve(preview);renderProjectAsset(preview,asset.assetPath,asset.projectPath);}}if(asset.fileName || isCanvasVideoFile({name:asset.assetPath})){const name=asset.fileName || asset.assetPath.split('/').pop();node.dataset.fileName=name;const label=node.querySelector('.asset-name');if(label)label.textContent=name;}}}const assetUpdates=new Map((result.videoAssets || []).map(asset=>[asset.id,asset]));localStorage.setItem(SAVE_KEY,JSON.stringify({...state,nodes:state.nodes.map(node=>assetUpdates.has(node.id)?{...node,...assetUpdates.get(node.id)}:node)}));} normalizeCanvasUndoCheckpoint(result.videoAssets || [],state); if(checkpointCurrent)refreshCanvasUndoCheckpoint(); scheduleQuickSync();setSaveStatus('saved'); }).catch(error=>{setSaveStatus('error','保存失败：'+error.message);toast('项目保存失败：'+error.message);if(options.strict)throw error;});
          }
          localStorage.setItem(SAVE_KEY,JSON.stringify(state));
          manualCanvasLayout.commit(layoutCommit);
          setSaveStatus('saved');
        } catch (error) { setSaveStatus('error','保存失败：'+error.message);if(options.strict)return Promise.reject(error);toast('状态保存失败：'+error.message); }
      }

      const canvasNodeIndex = new Map();
      function rebuildCanvasNodeIndex() {
        canvasNodeIndex.clear();
        for (const node of nodesLayer.children) canvasNodeIndex.set(node.dataset.id, node);
      }
      // Observer delivery is asynchronous. Validate cached ownership and fall back to
      // the live children for synchronous creation, restore, removal and ID reuse.
      const canvasNodeIndexObserver = new MutationObserver(records => {
        if (records.some(record => record.target === nodesLayer || (record.type === 'attributes' && record.target.parentElement === nodesLayer))) rebuildCanvasNodeIndex();
      });
      canvasNodeIndexObserver.observe(nodesLayer, {childList:true,subtree:true,attributes:true,attributeFilter:['data-id']});
      function getNode(id) {
        const cached = canvasNodeIndex.get(id);
        if (cached?.isConnected && cached.parentElement === nodesLayer && cached.dataset.id === id) return cached;
        canvasNodeIndex.delete(id);
        for (const node of nodesLayer.children) if (node.dataset.id === id) {
          canvasNodeIndex.set(id, node); return node;
        }
        return null;
      }

      function updateGroupCounts(outgoing = null) {
        for (const node of nodesLayer.children) {
          const childKind = node.dataset.kind === 'person' ? 'character' : node.dataset.kind === 'shot-group' ? 'shot' : node.dataset.kind === 'shot' ? 'storyboard' : null;
          if (!childKind) continue;
          const count = new Set((outgoing?.get(node.dataset.id) || (outgoing ? [] : connections.filter(connection => connection.fromId === node.dataset.id)))
            .filter(connection => getNode(connection.toId)?.dataset.kind === childKind)
            .map(connection => connection.toId)).size;
          const label = node.querySelector(node.dataset.kind === 'person' ? '.person-count' : node.dataset.kind === 'shot-group' ? '.shot-count' : '.storyboard-count');
          if (label) label.textContent = `(${count}${childKind === 'character' ? '人' : childKind === 'shot' ? '场景' : '镜头'})`;
        }
      }

      function isJpgPngFile(file) {
        return Boolean(file && /\.(jpe?g|png)$/i.test(file.name) && (!file.type || ['image/jpeg', 'image/png'].includes(file.type)));
      }

      function isReferenceImageNode(node) {
        if (node?.dataset.kind !== 'asset') return false;
        const name = node.dataset.fileName || node.querySelector('.asset-name')?.textContent || '';
        return /\.(jpe?g|png)$/i.test(node.dataset.assetPath || name);
      }

      function referenceImageTitle(parent) {
        return parent.dataset.kind === 'cover-group' ? '封面图' : parent.dataset.kind === 'storyboard' ? '参考图' : `${quickNodeTitle(parent)}参考图`;
      }

      function updateReferenceImageTitle(parent, image) {
        if (!parent || image?.dataset.kind !== 'asset' || !canConnectNodes(parent, image)) return;
        if (isCanvasVideoFile({name:image.dataset.assetPath || image.dataset.fileName || ''})) {
          if (parent.dataset.kind === 'prompt' || (parent.dataset.kind === 'text' && quickNodeTitle(parent) === '提示词')) image.querySelector('.node-title').textContent='生成视频';
          return;
        }
        if (!isCanvasImageFile({name: image.dataset.assetPath || image.dataset.fileName || ''})) return;
        const title = image.querySelector('.node-title');
        const name = referenceImageTitle(parent);
        if (title && title.textContent !== name) title.textContent = name;
      }

      function isAudioNode(node){const name=(node?.dataset.assetPath || node?.dataset.fileName || '').replace(/\\/g,'/');return node?.dataset.kind==='asset' && (/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(name)||/^assets\/(?:\.undo\/)?audio\/.+\.webm$/i.test(name));}
      function canConnectNodes(from, to) {
        const fromKind = from?.dataset.kind;
        const toKind = to?.dataset.kind;
        if (['cover-group','video-group','bgm-group'].includes(toKind)) return fromKind === 'script';
        if (fromKind === 'bgm-group') return isAudioNode(to);
        if (fromKind === 'cover-group') return toKind === 'asset' && isCanvasImageFile({name:to.dataset.assetPath || to.dataset.fileName || ''});
        if (fromKind === 'video-group') return toKind === 'asset' && !isAudioNode(to) && isCanvasVideoFile({name:to.dataset.assetPath || to.dataset.fileName || ''});
        if (fromKind === 'asset') return false;
        if (fromKind === 'plot' || fromKind === 'style') return false;
        if (toKind === 'plot' || toKind === 'style') return fromKind === 'script';
        if (fromKind === 'shot-group') return toKind === 'shot';
        if (toKind === 'shot-group') return fromKind === 'script';
        if (toKind === 'shot') return fromKind === 'shot-group';
        if (fromKind === 'shot') return toKind === 'storyboard';
        if (toKind === 'storyboard') return fromKind === 'shot';
        if (fromKind === 'script' && toKind === 'person') return true;
        if (fromKind === 'person' && toKind === 'character') return true;
        if (fromKind === 'person' || toKind === 'person') return false;
        if (fromKind === 'character' || toKind === 'character') {
          return isReferenceImageNode(fromKind === 'character' ? to : from) || (fromKind==='character' && isAudioNode(to));
        }
        return true;
      }

      function canConnectFromNodeBody(from, to) {
        if (!from || !to || from === to || !canConnectNodes(from, to)) return false;
        if (['character','bgm-group'].includes(from.dataset.kind) && isAudioNode(to))return true;
        if (from.dataset.kind === 'storyboard' && ['text', 'prompt'].includes(to.dataset.kind)) return true;
        if (to.dataset.kind === 'asset' && isCanvasVideoFile({name:to.dataset.assetPath || to.dataset.fileName || ''})) return from.dataset.kind === 'video-group' || from.dataset.kind === 'storyboard' || from.dataset.kind === 'prompt' || (from.dataset.kind === 'text' && quickNodeTitle(from) === '提示词');
        return to.dataset.kind === 'asset' && isCanvasImageFile({name:to.dataset.assetPath || to.dataset.fileName || to.querySelector('.node-title')?.textContent || ''});
      }

      function connectionErrorMessage(from, to) {
        const fromKind = from?.dataset.kind, toKind = to?.dataset.kind;
        if (fromKind === 'asset') return '参考图和素材节点不能向外连接';
        if (fromKind === 'plot' || toKind === 'plot' || fromKind === 'style' || toKind === 'style') return '剧情梗概和画风只连接剧本名，不能连接场景';
        if (fromKind === 'shot-group' || toKind === 'shot-group' || toKind === 'shot') return '场景卡片必须连接“场景”主节点';
        if (fromKind === 'shot' || toKind === 'storyboard') return '镜头必须连接在对应场景后面';
        if (fromKind === 'person' || toKind === 'person') return '人物节点必须连接剧本节点，也可以连接人物卡片';
        if (fromKind === 'character' || toKind === 'character') return '人物卡片只能连接 JPG 或 PNG 设定图';
        return '这两种节点不能连接';
      }

      function ensurePlotForScript(script, forcePosition = false, silent = false) {
        if (!script) return null;
        let plot = [...nodesLayer.children].find(node => node.dataset.kind === 'plot');
        const created = !plot;
        if (!plot) plot = makeNode('plot', 0, 0, { silent });
        if (created || forcePosition || plot.dataset.autoPosition !== 'false') {
          positionPlotForScript(script, plot);
          plot.dataset.autoPosition = 'true';
        }
        if (!connections.some(connection => connection.fromId === script.dataset.id && connection.toId === plot.dataset.id)) {
          connections.push({ fromId: script.dataset.id, toId: plot.dataset.id });
        }
        return plot;
      }

      function positionPlotForScript(script, plot) {
        if (!script || !plot) return;
        const x = Number(script.dataset.x) + script.offsetWidth + 130;
        const y = Number(script.dataset.y) + script.offsetHeight / 2 - plot.offsetHeight / 2;
        plot.dataset.x = x; plot.dataset.y = y; plot.style.left = `${x}px`; plot.style.top = `${y}px`;
      }

      function ensureStyleForScript(script, forcePosition = false, silent = false) {
        if (!script) return null;
        let style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
        const created = !style;
        if (!style) style = makeNode('style', 0, 0, { id: 'style', silent });
        if (created || forcePosition || style.dataset.autoPosition !== 'false') {
          positionStyleForScript(script, style);
          style.dataset.autoPosition = 'true';
        }
        if (!connections.some(connection => connection.fromId === script.dataset.id && connection.toId === style.dataset.id)) {
          connections.push({ fromId: script.dataset.id, toId: style.dataset.id });
        }
        return style;
      }

      function positionStyleForScript(script, style) {
        if (!script || !style) return;
        const plot = [...nodesLayer.children].find(node => node.dataset.kind === 'plot');
        const x = Number(script.dataset.x) + script.offsetWidth + 130;
        const y = plot ? Number(plot.dataset.y) + plot.offsetHeight + 72 : Number(script.dataset.y) + script.offsetHeight + 72;
        style.dataset.x = x; style.dataset.y = y; style.style.left = `${x}px`; style.style.top = `${y}px`;
      }

      function ensureRoleForScript(script, forcePosition = false, silent = false) {
        if (!script) return null;
        const roles = [...nodesLayer.children].filter(node => node.dataset.kind === 'person');
        let role = roles.shift();
        const created = !role;
        if (!role) role = makeNode('person', 0, 0, { silent });
        for (const duplicate of roles) {
          for (const connection of [...connections]) {
            if (connection.fromId !== duplicate.dataset.id) continue;
            const child = getNode(connection.toId);
            if (child?.dataset.kind === 'character' && !connections.some(edge => edge.fromId === role.dataset.id && edge.toId === child.dataset.id)) {
              connections.push({ fromId: role.dataset.id, toId: child.dataset.id });
            }
          }
          connections = connections.filter(connection => connection.fromId !== duplicate.dataset.id && connection.toId !== duplicate.dataset.id);
          duplicate.remove();
        }
        if (created || forcePosition || role.dataset.autoPosition !== 'false') {
          positionRoleForScript(script, role);
          role.dataset.autoPosition = 'true';
        }
        if (!connections.some(connection => connection.fromId === script.dataset.id && connection.toId === role.dataset.id)) {
          connections.push({ fromId: script.dataset.id, toId: role.dataset.id });
        }
        return role;
      }

      function positionRoleForScript(script, role) {
        if (!script || !role) return;
        const x = Number(script.dataset.x) + script.offsetWidth / 2 - role.offsetWidth / 2;
        const y = Number(script.dataset.y) + script.offsetHeight + 110;
        role.dataset.x = x; role.dataset.y = y; role.style.left = `${x}px`; role.style.top = `${y}px`;
      }

      function ensureShotGroupForScript(script, forcePosition = false, silent = false) {
        if (!script) return null;
        const groups = [...nodesLayer.children].filter(node => node.dataset.kind === 'shot-group');
        let group = groups.shift();
        const created = !group;
        if (!group) group = makeNode('shot-group', 0, 0, { id: '__shot-group', silent });
        for (const duplicate of groups) {
          connections = connections.filter(connection => connection.fromId !== duplicate.dataset.id && connection.toId !== duplicate.dataset.id);
          duplicate.remove();
        }
        if (created || forcePosition || group.dataset.autoPosition !== 'false') {
          positionShotGroupForScript(script, group);
          group.dataset.autoPosition = 'true';
        }
        const plot = [...nodesLayer.children].find(node => node.dataset.kind === 'plot');
        const style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
        connections = connections.filter(connection =>
          connection.fromId !== plot?.dataset.id && connection.fromId !== style?.dataset.id &&
          (getNode(connection.toId)?.dataset.kind !== 'shot' || connection.fromId === group.dataset.id) &&
          (connection.toId !== group.dataset.id || connection.fromId === script.dataset.id)
        );
        if (!connections.some(connection => connection.fromId === script.dataset.id && connection.toId === group.dataset.id)) {
          connections.push({ fromId: script.dataset.id, toId: group.dataset.id });
        }
        for (const shot of [...nodesLayer.children].filter(node => node.dataset.kind === 'shot')) {
          if (!connections.some(connection => connection.fromId === group.dataset.id && connection.toId === shot.dataset.id)) {
            connections.push({ fromId: group.dataset.id, toId: shot.dataset.id });
          }
        }
        return group;
      }

      function positionShotGroupForScript(script, group) {
        if (!script || !group) return;
        const x = Number(script.dataset.x) + script.offsetWidth + 130;
        const plot = [...nodesLayer.children].find(node => node.dataset.kind === 'plot');
        const plotBottom = plot ? Number(plot.dataset.y) + plot.offsetHeight : -Infinity;
        const style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
        const styleBottom = style ? Number(style.dataset.y) + style.offsetHeight : -Infinity;
        const y = Math.max(Number(script.dataset.y) + script.offsetHeight + 170, plotBottom + 72, styleBottom + 72);
        group.dataset.x = x; group.dataset.y = y; group.style.left = `${x}px`; group.style.top = `${y}px`;
      }

      function nodeCenter(node) {
        return { x: Number(node.dataset.x) + node.offsetWidth / 2, y: Number(node.dataset.y) + node.offsetHeight / 2 };
      }

      function nodeRightAnchor(node) {
        return { x: Number(node.dataset.x) + node.offsetWidth, y: Number(node.dataset.y) + node.offsetHeight / 2 };
      }

      function nodeLeftAnchor(node) {
        return { x: Number(node.dataset.x), y: Number(node.dataset.y) + node.offsetHeight / 2 };
      }

      // Drag frames keep curve/anchor elements alive; full render reconciles structure on release.
      const dragCurvesByNode = new Map();
      let dragGeometryFrame = 0;
      const dragGeometryNodes = new Set();
      function scheduleDragGeometry(nodes) {
        for (const node of nodes) if (node) dragGeometryNodes.add(node.dataset.id);
        if (dragGeometryFrame) return;
        dragGeometryFrame = requestAnimationFrame(() => {
          dragGeometryFrame = 0;
          const curves = new Set();
          for (const id of dragGeometryNodes) for (const curve of dragCurvesByNode.get(id) || []) curves.add(curve);
          dragGeometryNodes.clear();
          for (const curve of curves) curve();
        });
      }
      function cancelDragGeometry() {
        if (dragGeometryFrame) cancelAnimationFrame(dragGeometryFrame);
        dragGeometryFrame = 0; dragGeometryNodes.clear();
      }

      let connectionPreviewFrame = 0, connectionPreviewCurve = null;
      function cancelConnectionPreview() {
        if (connectionPreviewFrame) cancelAnimationFrame(connectionPreviewFrame);
        connectionPreviewFrame = 0;
      }
      function renderConnectionPreview() {
        const preview = pendingConnection || (connectionDrag?.moved ? {fromId:connectionDrag.fromId,point:connectionDrag.current} : null);
        const source = preview && getNode(preview.fromId);
        if (!source || source.classList.contains('hidden-by-parent')) {
          connectionPreviewCurve?.remove(); connectionPreviewCurve = null; return;
        }
        const start = nodeRightAnchor(source);
        if (connectionPreviewCurve) connectionPreviewCurve.update(start, preview.point);
        else connectionPreviewCurve = appendCurve(start, preview.point, 'connection-preview');
      }
      function scheduleConnectionPreview() {
        if (!connectionPreviewFrame) connectionPreviewFrame = requestAnimationFrame(() => {
          connectionPreviewFrame = 0; renderConnectionPreview();
        });
      }

      function appendCurve(start, end, className = '', connection = null) {
        const dx = end.x - start.x;
        const bend = Math.max(48, Math.abs(dx) * .45);
        const direction = Math.sign(dx || 1);
        const c1 = { x: start.x + direction * bend, y: start.y };
        const c2 = { x: end.x - direction * bend, y: end.y };
        const points = [start, c1, c2, end];
        const pad = 8;
        let left = Math.min(...points.map(point => point.x)) - pad;
        let top = Math.min(...points.map(point => point.y)) - pad;
        const width = Math.max(16, Math.max(...points.map(point => point.x)) - left + pad);
        const height = Math.max(16, Math.max(...points.map(point => point.y)) - top + pad);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width); svg.setAttribute('height', height);
        svg.style.left = `${left}px`; svg.style.top = `${top}px`;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', className);
        path.setAttribute('d', `M ${start.x - left} ${start.y - top} C ${c1.x - left} ${c1.y - top}, ${c2.x - left} ${c2.y - top}, ${end.x - left} ${end.y - top}`);
        svg.append(path);
        const anchors = svg.cloneNode(false);
        const anchorPoints = className === 'connection-preview' ? [start] : [start, end];
        for (const [anchorIndex, point] of anchorPoints.entries()) {
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', point.x - left); dot.setAttribute('cy', point.y - top); dot.setAttribute('r', '3.5');
          dot.setAttribute('fill', '#c4ccd8'); dot.setAttribute('stroke', '#151619'); dot.setAttribute('stroke-width', '1.5');
          if (connection) {
            dot.classList.add('connection-anchor');
            dot.addEventListener('pointerenter', () => dot.setAttribute('r', '6'));
            dot.addEventListener('pointerleave', () => dot.setAttribute('r', '3.5'));
            dot.addEventListener('pointerdown', event => beginConnectionDetach(event, connection, anchorIndex === 0 ? connection.fromId : connection.toId, dot, position => {
              const moving = position || (anchorIndex === 0 ? start : end);
              const a = anchorIndex === 0 ? moving : start, b = anchorIndex === 1 ? moving : end;
              const bend = Math.max(48, Math.abs(b.x-a.x)*.45), direction = Math.sign(b.x-a.x || 1);
              dot.setAttribute('cx', moving.x-left); dot.setAttribute('cy', moving.y-top);
              path.setAttribute('d', `M ${a.x-left} ${a.y-top} C ${a.x+direction*bend-left} ${a.y-top}, ${b.x-direction*bend-left} ${b.y-top}, ${b.x-left} ${b.y-top}`);
            }));
          }
          anchors.append(dot);
        }
        connectionLayer.append(svg);
        connectionAnchorLayer.append(anchors);
        if (connection) {
          const from = getNode(connection.fromId), to = getNode(connection.toId);
          const update = () => {
            if (!from || !to) return;
            start = nodeRightAnchor(from); end = nodeLeftAnchor(to);
            const dx = end.x - start.x, bend = Math.max(48, Math.abs(dx) * .45), direction = Math.sign(dx || 1);
            const c1 = { x: start.x + direction * bend, y: start.y }, c2 = { x: end.x - direction * bend, y: end.y };
            const points = [start, c1, c2, end];
            left = Math.min(...points.map(point => point.x)) - pad;
            top = Math.min(...points.map(point => point.y)) - pad;
            const width = Math.max(16, Math.max(...points.map(point => point.x)) - left + pad);
            const height = Math.max(16, Math.max(...points.map(point => point.y)) - top + pad);
            for (const layer of [svg, anchors]) {
              layer.setAttribute('width', width); layer.setAttribute('height', height);
              layer.style.left = `${left}px`; layer.style.top = `${top}px`;
            }
            path.setAttribute('d', `M ${start.x-left} ${start.y-top} C ${c1.x-left} ${c1.y-top}, ${c2.x-left} ${c2.y-top}, ${end.x-left} ${end.y-top}`);
            [start, end].forEach((point, index) => {
              anchors.children[index].setAttribute('cx', point.x-left);
              anchors.children[index].setAttribute('cy', point.y-top);
            });
          };
          for (const id of [connection.fromId, connection.toId]) {
            if (!dragCurvesByNode.has(id)) dragCurvesByNode.set(id, new Set());
            dragCurvesByNode.get(id).add(update);
          }
        }
        return {
          remove() { svg.remove(); anchors.remove(); },
          update(a, b) {
            const bend = Math.max(48, Math.abs(b.x-a.x)*.45), direction = Math.sign(b.x-a.x || 1);
            const c1 = {x:a.x+direction*bend,y:a.y}, c2 = {x:b.x-direction*bend,y:b.y};
            const points = [a,c1,c2,b];
            left = Math.min(...points.map(point=>point.x))-pad;
            top = Math.min(...points.map(point=>point.y))-pad;
            const width = Math.max(16,Math.max(...points.map(point=>point.x))-left+pad);
            const height = Math.max(16,Math.max(...points.map(point=>point.y))-top+pad);
            for (const layer of [svg,anchors]) {
              layer.setAttribute('width',width); layer.setAttribute('height',height);
              layer.style.left=`${left}px`; layer.style.top=`${top}px`;
            }
            path.setAttribute('d',`M ${a.x-left} ${a.y-top} C ${c1.x-left} ${c1.y-top}, ${c2.x-left} ${c2.y-top}, ${b.x-left} ${b.y-top}`);
            const previewPoints = className === 'connection-preview' ? [a] : [a,b];
            previewPoints.forEach((point,index)=>{
              anchors.children[index].setAttribute('cx',point.x-left);
              anchors.children[index].setAttribute('cy',point.y-top);
            });
          }
        };
      }

      function beginConnectionDetach(event, edge, endpointId, dot, updatePreview = () => {}) {
        if (event.button !== 0 || nodeDeletionPending) return;
        event.preventDefault(); event.stopPropagation();
        const start = {x:event.clientX,y:event.clientY};
        const endpoint = getNode(endpointId);
        if (!endpoint) return;
        const hint = document.createElement('div');
        hint.style.cssText = 'position:fixed;z-index:100;pointer-events:none;padding:7px 11px;border:1px solid #71869b;border-radius:7px;background:#202830;color:#e5edf5;font-size:12px;';
        hint.hidden = true; document.body.append(hint);
        dot.setPointerCapture(event.pointerId); dot.setAttribute('r', '6');
        const outside = e => {
          const rect = endpoint.getBoundingClientRect();
          return e.clientX < rect.left-8 || e.clientX > rect.right+8 || e.clientY < rect.top-8 || e.clientY > rect.bottom+8;
        };
        const move = e => {
          if (e.pointerId !== event.pointerId) return;
          e.preventDefault(); e.stopPropagation();
          updatePreview(worldPoint(e.clientX,e.clientY)); dot.setAttribute('r', '6');
          hint.hidden = Math.hypot(e.clientX-start.x,e.clientY-start.y) < 6;
          hint.textContent = outside(e) ? '松开取消连线' : '拖离节点可取消连线';
          hint.style.left = (e.clientX+16)+'px'; hint.style.top = (e.clientY+16)+'px';
        };
        const finish = async release => {
          if (release.pointerId !== event.pointerId) return;
          release.stopPropagation?.();
          dot.removeEventListener('pointermove', move); dot.removeEventListener('pointerup', finish); dot.removeEventListener('pointercancel', finish);
          hint.remove();
          if (dot.hasPointerCapture(event.pointerId)) dot.releasePointerCapture(event.pointerId);
          dot.setAttribute('r', '3.5'); updatePreview(null);
          if (release.type === 'pointercancel' || Math.hypot(release.clientX-start.x,release.clientY-start.y) < 12 || !outside(release)) return;
          await detachCanvasConnection(edge);
        };
        dot.addEventListener('pointermove', move); dot.addEventListener('pointerup', finish); dot.addEventListener('pointercancel', finish);
      }

      async function detachCanvasConnection(edge) {
        if (nodeDeletionPending || !connections.includes(edge)) return;
        nodeDeletionPending = true;
        try {
          await save({strict:true});
          const snapshot = captureCanvasSnapshot();
          connections = connections.filter(item => item !== edge);
          canvasUndoCheckpoint = snapshot;
          renderConnections(); await save({strict:true});
          toastAction('连线已取消', '撤销', undoLastCanvasChange);
        } catch (error) { toast('取消连线失败：' + error.message); }
        finally { nodeDeletionPending=false; pruneUndoHistory().catch(console.warn); }
      }

      function connectionEdgesFrom(id, outgoing = null) {
        // Array.flatMap callers also pass an index as the second argument.
        return outgoing instanceof Map ? outgoing.get(id) || [] : connections.filter(edge => edge.fromId === id);
      }

      function storyboardLaneNodes(board, outgoing = null) {
        const result = [], visited = new Set([board.dataset.id]), queue = [board];
        while (queue.length) {
          const parent = queue.shift();
          for (const edge of connectionEdgesFrom(parent.dataset.id, outgoing)) {
            const node = getNode(edge.toId);
            if (!node || visited.has(node.dataset.id) || !['asset', 'text', 'prompt'].includes(node.dataset.kind)) continue;
            visited.add(node.dataset.id); result.push(node); queue.push(node);
          }
        }
        return result;
      }

      function renderShotLanes(outgoing = null) {
        shotLanes.replaceChildren();
        if (!shotLaneLayoutVersion) return;
        const group = [...nodesLayer.children].find(node => node.dataset.kind === 'shot-group');
        if (!group || group.classList.contains('children-collapsed')) return;
        const shots = connectionEdgesFrom(group.dataset.id, outgoing)
          .map(edge => getNode(edge.toId))
          .filter(node => node?.dataset.kind === 'shot' && !node.classList.contains('hidden-by-parent'))
          .sort((a, b) => Number(a.dataset.y) - Number(b.dataset.y));
        if (!shots.length) return;
        const firstX = Number(shots[0].dataset.x);
        const boards = shots.flatMap(shot => connectionEdgesFrom(shot.dataset.id, outgoing))
          .map(edge => getNode(edge.toId)).filter(node => node?.dataset.kind === 'storyboard');
        const related = [...new Set(boards.flatMap(board => storyboardLaneNodes(board, outgoing)))];
        const assets = related.filter(node => node.dataset.kind === 'asset' && !isCanvasVideoFile({name:node.dataset.assetPath || node.dataset.fileName || ''}));
        const prompts = related.filter(node => ['text','prompt'].includes(node.dataset.kind));
        const videos = related.filter(node => node.dataset.kind === 'asset' && isCanvasVideoFile({name:node.dataset.assetPath || node.dataset.fileName || ''}));
        const boardX = boards.length ? Math.min(...boards.map(board => Number(board.dataset.x))) : firstX + 400;
        const assetX = assets.length ? Math.min(...assets.map(asset => Number(asset.dataset.x)))
          : boardX + Math.max(560, ...boards.map(board => board.offsetWidth + 100));
        const promptX = prompts.length ? Math.min(...prompts.map(node => Number(node.dataset.x))) : assetX + 400;
        const videoX = videos.length ? Math.min(...videos.map(node => Number(node.dataset.x))) : promptX + 400;
        const left = Math.min(firstX, ...related.map(node => Number(node.dataset.x))) - 18;
        const width = Math.max(assetX + 338,
          ...[...shots, ...boards, ...related].map(node => Number(node.dataset.x) + Math.max(node.offsetWidth, 300) + 20)) - left;
        const header = document.createElement('div'); header.className = 'shot-lane-header';
        header.style.left = `${left}px`; header.style.top = `${Number(shots[0].dataset.y) - 59}px`; header.style.width = `${width}px`;
        for (const [label, x] of [['场景 / 时间', firstX], ['镜头', boardX], ['参考图', assetX], ...(prompts.length ? [['提示词', promptX]] : []), ...(videos.length ? [['生成视频', videoX]] : [])]) {
          const span = document.createElement('span'); span.textContent = label; span.style.left = `${x - left + 14}px`; header.append(span);
        }
        shotLanes.append(header);
        appendCurve(nodeRightAnchor(group), { x: left, y: Number(shots[0].dataset.y) - 38 });
        shots.forEach((shot, index) => {
          const shotRelated = shotBoardsForLane(shot, outgoing);
          const top = Math.min(Number(shot.dataset.y), ...shotRelated.filter(node => !node.classList.contains('hidden-by-parent')).map(node => Number(node.dataset.y))) - 13;
          const nextTop = shots[index + 1] ? Number(shots[index + 1].dataset.y) - 13 : null;
          const shotBoards = connectionEdgesFrom(shot.dataset.id, outgoing)
            .map(edge => getNode(edge.toId)).filter(node => node?.dataset.kind === 'storyboard');
          const shotAssets = shotBoards.flatMap(board => storyboardLaneNodes(board, outgoing));
          const contentBottom = Math.max(Number(shot.dataset.y) + Math.max(shot.offsetHeight, 42),
            ...[...shotBoards, ...shotAssets]
              .filter(node => !node.classList.contains('hidden-by-parent'))
              .map(node => Number(node.dataset.y) + Math.max(node.offsetHeight, 42)));
          const row = document.createElement('div'); row.className = 'shot-lane-row';row.dataset.shotId=shot.dataset.id;row.sceneNode=shot;
          row.style.left = `${left}px`; row.style.top = `${top}px`;
          row.style.width = `${width}px`; row.style.height = `${Math.max(130, contentBottom - top + 20, nextTop == null ? 0 : nextTop - top - 10)}px`;
          shotLanes.append(row);
        });
      }

      function shotBoardsForLane(shot, outgoing = null) {
        return connectionEdgesFrom(shot.dataset.id, outgoing).map(edge => getNode(edge.toId))
          .filter(node => node?.dataset.kind === 'storyboard').flatMap(board => [board, ...storyboardLaneNodes(board, outgoing)]);
      }

      function renderConnections() {
        cancelConnectionPreview(); connectionPreviewCurve = null;
        cancelDragGeometry(); dragCurvesByNode.clear();
        rebuildCanvasNodeIndex();
        const nodes = [...nodesLayer.children];
        const nodeById = canvasNodeIndex;
        connections = connections.filter(connection => nodeById.has(connection.fromId) && nodeById.has(connection.toId));
        const outgoing = new Map(), incoming = new Map();
        for (const connection of connections) {
          if (!outgoing.has(connection.fromId)) outgoing.set(connection.fromId, []);
          if (!incoming.has(connection.toId)) incoming.set(connection.toId, []);
          outgoing.get(connection.fromId).push(connection); incoming.get(connection.toId).push(connection);
        }
        for(const asset of quickNodesOfKind('asset')){
          const parent=(incoming.get(asset.dataset.id) || []).map(e=>nodeById.get(e.fromId)).find(n=>['cover-group','video-group','bgm-group'].includes(n?.dataset.kind));
          asset.classList.toggle('project-media-asset',!!parent);
          if(parent){const kind=parent.dataset.kind;const title=asset.querySelector('.node-title'),icon=asset.querySelector('.node-icon');if(title)title.textContent=kind==='cover-group'?'封面图':kind==='video-group'?'成片视频':'BGM';if(icon)icon.innerHTML=window.canvasNodeIcon?.(asset) || ''; }
        }

        connectionLayer.replaceChildren();
        connectionAnchorLayer.replaceChildren();
        const childrenById = new Map();
        for (const connection of connections) {
          updateReferenceImageTitle(nodeById.get(connection.fromId), nodeById.get(connection.toId));
          if (nodeById.get(connection.fromId)?.dataset.kind === 'storyboard' && ['text','prompt'].includes(nodeById.get(connection.toId)?.dataset.kind)) {
            const promptNode = nodeById.get(connection.toId);
            promptNode.querySelector('.node-title').textContent = '提示词';
            promptNode.classList.add('prompt-card');
            const promptBody = promptNode.querySelector('.node-body');
            if (promptBody && promptBody.dataset.promptReader !== 'true') {
              promptNode.classList.add('collapsed');
              const raw = getBodyText(promptBody);
              promptBody.dataset.promptReader = 'true';
              setBodyText(promptBody, raw);
              promptBody.title = '双击编辑；滚轮上下滚动内容；拖动标题移动节点';
            }
          }
          if (!childrenById.has(connection.fromId)) childrenById.set(connection.fromId, []);
          childrenById.get(connection.fromId).push(connection.toId);
        }
        const hiddenIds = new Set();
        const queue = [];
        for (const group of nodes) {
          const kind = group.dataset.kind;
          const childKind = kind === 'person' ? 'character' : kind === 'shot-group' ? 'shot' : kind === 'shot' ? 'storyboard' : kind === 'storyboard' ? 'asset' : null;
          const collapsed = kind === 'storyboard' ? group.classList.contains('collapsed') : group.classList.contains('children-collapsed');
          if (!childKind || !collapsed) continue;
          for (const childId of childrenById.get(group.dataset.id) || []) {
            if (nodeById.get(childId)?.dataset.kind === childKind || (kind === 'storyboard' && ['text','prompt'].includes(nodeById.get(childId)?.dataset.kind))) queue.push(childId);
          }
        }
        while (queue.length) {
          const id = queue.pop();
          if (hiddenIds.has(id)) continue;
          hiddenIds.add(id);
          queue.push(...(childrenById.get(id) || []));
        }
        for (const node of nodes) node.classList.toggle('hidden-by-parent', hiddenIds.has(node.dataset.id));
        renderShotLanes(outgoing);
        for (const connection of connections) {
          const from = nodeById.get(connection.fromId), to = nodeById.get(connection.toId);
          if (from.classList.contains('hidden-by-parent') || to.classList.contains('hidden-by-parent')) continue;
          if (from.dataset.kind === 'shot-group' && to.dataset.kind === 'shot') continue;
          appendCurve(nodeRightAnchor(from), nodeLeftAnchor(to), '', connection);
        }
        updateGroupCounts(outgoing);
        renderConnectionPreview();
        renderMinimap();scheduleQuickSync();
      }

      function enableTextEditing(body, event) {
        event.stopPropagation();
        if (body.isContentEditable) return;
        body.canvasEditAction=beginCanvasAction('编辑正文');
        if (body.dataset.promptReader === 'true' || body.closest('.node.storyboard')) body.innerText = body.dataset.rawText || '';
        body.contentEditable = 'true';
        body.focus({ preventScroll: true });
        const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
        if (range && body.contains(range.startContainer)) {
          const selection = window.getSelection();
          selection.removeAllRanges(); selection.addRange(range);
        }
      }

      function getBodyText(body) {
        if (!body) return '';
        if (body.dataset.promptReader === 'true') return body.isContentEditable ? body.innerText : body.dataset.rawText || '';
        if (body.closest('.node.storyboard') && body.isContentEditable) return body.innerText;
        return (body.dataset.kind === 'storyboard' || body.closest('.node.storyboard')) && !body.isContentEditable
          ? body.dataset.rawText || ''
          : body.innerText || '';
      }

      function readablePromptLines(text) {
        const lines = [];
        for (const sourceLine of text.split(/\r?\n/)) {
          let part = '';
          for (const character of sourceLine) {
            part += character;
            if (/[。！？!?；;]/.test(character) || (part.length >= 78 && /[，,]/.test(character))) {
              if (part.trim()) lines.push(part.trim());
              part = '';
            }
          }
          if (part.trim()) lines.push(part.trim());
        }
        return lines;
      }

      function quickNodeTitle(node) {
        return node?.querySelector('.node-title')?.textContent?.trim() || node?.querySelector('.asset-name')?.textContent?.trim() || '未命名';
      }

      function quickNodesOfKind(kind) {
        return [...nodesLayer.children].filter(node => node.dataset.kind === kind);
      }

      function quickChildren(parent, kind) {
        if (!parent) return [];
        const seen = new Set();
        return connections.filter(edge => edge.fromId === parent.dataset.id)
          .map(edge => getNode(edge.toId))
          .filter(node => node?.dataset.kind === kind && !seen.has(node.dataset.id) && seen.add(node.dataset.id));
      }

      function quickListNodes(groupKind, itemKind) {
        const group = quickNodesOfKind(groupKind)[0];
        const children = quickChildren(group, itemKind);
        return children.length ? children : quickNodesOfKind(itemKind);
      }

      function quickParagraphs(raw) {
        const text = String(raw || '').trim();
        if (!text) return [];
        const paragraphs = [];
        for (const block of text.split(/\n\s*\n/)) {
          for (const line of block.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.length <= 165) { paragraphs.push(trimmed); continue; }
            let current = '';
            for (const sentence of trimmed.split(/(?<=[。！？!?；;])/)) {
              if (current && current.length + sentence.length > 165) { paragraphs.push(current.trim()); current = ''; }
              current += sentence;
            }
            if (current.trim()) paragraphs.push(current.trim());
          }
        }
        return paragraphs;
      }

      function quickReader(raw, emptyMessage = '暂无内容') {
        const reader = document.createElement('div'); reader.className = 'quick-reader';
        const paragraphs = quickParagraphs(raw);
        if (!paragraphs.length) {
          const empty = document.createElement('p'); empty.className = 'quick-empty'; empty.textContent = emptyMessage; reader.append(empty);
        } else paragraphs.forEach(text => {
          const paragraph = document.createElement('p'); paragraph.textContent = text; reader.append(paragraph);
        });
        return reader;
      }

      function quickHeading(label) {
        const heading = document.createElement('h3'); heading.className = 'quick-section-title'; heading.textContent = label;
        quickBody.append(heading);
      }

      function quickCards(nodes, className, nextView, emptyMessage) {
        if (!nodes.length) { quickBody.append(quickReader('', emptyMessage)); return; }
        const list = document.createElement('div'); list.className = `quick-list ${className}`;
        nodes.forEach((node, index) => {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'quick-item';
          const number = document.createElement('span'); number.className = 'quick-item-index'; number.textContent = String(index + 1).padStart(2, '0');
          const label = document.createElement('span'); label.className = 'quick-item-label'; label.textContent = quickNodeTitle(node);
          button.append(number, label);
          button.addEventListener('click', () => { quickTrail.push({ view: nextView, nodeId: node.dataset.id }); renderQuickView(); });
          list.append(button);
        });
        quickBody.append(list);
      }

      function quickImages(assets, audioLabel='参考音色') {
        for(const audioType of [false,true]) {
          const group=assets.filter(asset=>audioType?isAudioNode(asset):isImageNode(asset));if(!group.length)continue;
          quickHeading(audioType?audioLabel:'参考图');const gallery=document.createElement('div');gallery.className='quick-images';
          for(const asset of group){
            const card=document.createElement('div');card.className='quick-image-card'+(audioType?' quick-audio-card':'');card.dataset.nodeId=asset.dataset.id;
            const media=document.createElement(audioType?'audio':'img');media.dataset.nodeId=asset.dataset.id;const caption=document.createElement('span');caption.textContent=audioType?(asset.dataset.fileName || quickNodeTitle(asset)):quickNodeTitle(asset);
            if(audioType){media.controls=true;media.preload='metadata';}else{media.alt=quickNodeTitle(asset);media.loading='lazy';media.onclick=()=>openQuickImage(asset.dataset.id).catch(error=>toast(error.message));media.addEventListener('contextmenu',event=>{event.preventDefault();copyNodeImage(asset);});}
            card.append(media,caption);gallery.append(card);
            const existing=asset.querySelector(audioType?'.asset-preview audio':'.asset-preview img');
            if(existing?.src){media.src=existing.src;media.dataset.originalUrl=existing.dataset.originalUrl || existing.src;}
            else if(asset.dataset.assetPath && window.canvasFiles?.loadProjectAsset)window.canvasFiles.loadProjectAsset({projectPath:asset.dataset.projectPath || importedProjectPath,assetPath:asset.dataset.assetPath}).then(result=>{if(result?.ok && result.url && result.mimeType?.startsWith(audioType?'audio/':'image/'))media.src=result.url;else caption.textContent=result?.error || '无法读取素材';}).catch(error=>{caption.textContent=error.message;});
          }
          quickBody.append(gallery);
        }
      }

      function quickSiblingItems() {
        const state = quickTrail.at(-1);
        if (!state?.nodeId) return [];
        if (state.view === 'person') return quickListNodes('person', 'character');
        if (state.view === 'shot') return quickListNodes('shot-group', 'shot');
        if (state.view === 'storyboard') {
          const parent = getNode(quickTrail.at(-2)?.nodeId);
          return quickChildren(parent, 'storyboard');
        }
        return [];
      }

      function updateQuickSiblingButtons() {
        const state = quickTrail.at(-1);
        const siblings = quickSiblingItems();
        const index = siblings.findIndex(node => node.dataset.id === state?.nodeId);
        const label = state?.view === 'person' ? '人物' : state?.view === 'shot' ? '场景' : '镜头';
        quickPrevious.hidden = index <= 0;
        quickNext.hidden = index < 0 || index >= siblings.length - 1;
        quickPrevious.setAttribute('aria-label', `上一个${label}`);
        quickNext.setAttribute('aria-label', `下一个${label}`);
        quickPrevious.title = `上一个${label}`;
        quickNext.title = `下一个${label}`;
        quickPanel.classList.toggle('has-sibling-nav', !quickPrevious.hidden || !quickNext.hidden);
      }

      function moveQuickSibling(direction) {
        const state = quickTrail.at(-1);
        const siblings = quickSiblingItems();
        const index = siblings.findIndex(node => node.dataset.id === state?.nodeId);
        const next = siblings[index + direction];
        if (!next || index < 0) return;
        state.nodeId = next.dataset.id;
        renderQuickView();
      }

      function quickCopy(node) {
        if(!node)return;
        const heading=quickBody.lastElementChild;
        const button=document.createElement('button');button.type='button';button.className='quick-copy';button.textContent='复制';button.title='复制节点文本';
        button.onclick=async()=>{try{await navigator.clipboard.writeText(quickNodeTitle(node)+'\n'+getBodyText(node.querySelector('.node-body')).trim());toast('已复制');}catch(error){toast('复制失败：'+error.message);}};
        if(heading){heading.classList.add('quick-heading-copy');heading.append(button);}
      }

      function enableTitleEditing(node) {
        const title = node.querySelector('.node-title');
        if (!title || title.isContentEditable) return;
        const original = title.textContent;
        const editAction=beginCanvasAction('编辑标题');
        selectNode(node);
        title.contentEditable = 'true';
        title.setAttribute('role', 'textbox');
        title.setAttribute('aria-label', '节点标题');
        const finish = cancel => {
          title.textContent = cancel ? original : title.textContent.replace(/[\r\n]+/g, ' ').trim() || original;
          title.contentEditable = 'false';
          title.removeAttribute('role');
          title.removeAttribute('aria-label');
          title.removeEventListener('blur', onBlur);
          title.removeEventListener('keydown', onKey);
          title.removeEventListener('paste', onPaste);
          renderConnections(); endCanvasAction(editAction); save();
        };
        const onBlur = () => finish(false);
        const onKey = event => {
          event.stopPropagation();
          if (event.isComposing) return;
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault(); finish(event.key === 'Escape');
            viewport.focus({ preventScroll: true });
          }
        };
        const onPaste = event => {
          event.preventDefault(); event.stopPropagation();
          document.execCommand('insertText', false, (event.clipboardData?.getData('text/plain') || '').replace(/[\r\n]+/g, ' '));
        };
        title.addEventListener('blur', onBlur);
        title.addEventListener('keydown', onKey);
        title.addEventListener('paste', onPaste);
        title.focus({ preventScroll: true });
        const range = document.createRange(); range.selectNodeContents(title);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      }

      function ensureProjectMediaNodes() {
        const script = quickNodesOfKind('script')[0]; if (!script) return null;
        const groups = {};
        for (const [index,kind] of ['cover-group','video-group','bgm-group'].entries()) {
          let group=quickNodesOfKind(kind)[0];
          if(!group){group=makeNode(kind,Number(script.dataset.x)+script.offsetWidth+130,Number(script.dataset.y)+index*180,{title:kind==='cover-group'?'封面':kind==='video-group'?'视频':'BGM',text:kind==='cover-group'?'粘贴或拖入封面图':kind==='video-group'?'粘贴或拖入成片视频':'粘贴或拖入背景音乐',silent:true});connections.push({fromId:script.dataset.id,toId:group.dataset.id});}
          groups[kind]=group;
        }
        return groups;
      }
      async function importProjectMedia(files) {
        const mode=quickTrail.at(-1)?.view;
        if(!['cover','video','bgm'].includes(mode))return;
        const accepts=mode==='cover'?isCanvasImageFile:mode==='video'?isCanvasVideoFile:isCanvasAudioFile;
        if(![...files].length || ![...files].every(accepts)){toast('文件类型不匹配：'+(mode==='cover'?'请选择图片':mode==='video'?'请选择视频':'请选择音频'));return;}
        const parent=ensureProjectMediaNodes()?.[mode==='cover'?'cover-group':mode==='video'?'video-group':'bgm-group'];
        if(!parent){toast('请先打开剧本');return;}
        const point={x:Number(parent.dataset.x)+parent.offsetWidth+80,y:Number(parent.dataset.y)};
        if(mode==='cover')await importCanvasImages([...files].filter(isCanvasImageFile),point,parent);
        else if(mode==='video')await importCanvasVideos([...files].filter(isCanvasVideoFile),point,parent);
        else await importCanvasAudio([...files].filter(isCanvasAudioFile),point,parent);
        if(!quickOverlay.hidden && quickTrail.at(-1)?.view===mode)renderQuickView();
      }
      function renderQuickView(options={}) {
        const scroll=quickBody.scrollTop,hadFocus=quickBody.contains(document.activeElement);
        const playing=new Map(options.preserve?[...quickBody.querySelectorAll('audio,video')].map(media=>[media.dataset.nodeId,{time:media.currentTime,paused:media.paused,volume:media.volume,muted:media.muted}]):[]);
        const state = quickTrail.at(-1);
        if (!state) return;
        const node = state.nodeId ? getNode(state.nodeId) : null;
        quickBody.querySelectorAll('audio,video').forEach(audio=>audio.pause());
        quickBody.replaceChildren();
        quickBody.scrollTop = 0;
        quickBack.hidden = quickTrail.length < 2;
        quickPanel.classList.toggle('is-list', ['people', 'shots', 'shot'].includes(state.view));
        if (['cover','video','bgm'].includes(state.view)) {
          const parent=ensureProjectMediaNodes()?.[state.view==='cover'?'cover-group':state.view==='video'?'video-group':'bgm-group'];
          quickTitle.textContent=state.view==='cover'?'封面':state.view==='video'?'视频':'BGM';
          const button=document.createElement('button'),input=document.createElement('input');
          button.textContent=state.view==='cover'?'导入封面图':state.view==='video'?'导入视频':'导入BGM';input.type='file';input.multiple=true;input.hidden=true;input.accept=state.view==='cover'?'image/png,image/jpeg,image/webp,image/gif':state.view==='video'?'video/mp4,video/webm,video/quicktime':'audio/*';
          button.onclick=()=>input.click();input.onchange=()=>importProjectMedia(input.files);quickBody.append(button,input);
          const assets=quickChildren(parent,'asset');
          if(state.view==='cover')quickImages(assets);
          else if(state.view==='bgm')quickImages(assets,'BGM');
          else for(const asset of assets){const video=document.createElement('video');video.dataset.nodeId=asset.dataset.id;video.controls=true;video.preload='metadata';video.style.cssText='width:100%;max-height:60vh;margin:16px 0;background:#111;border-radius:10px';quickBody.append(video);window.canvasFiles.loadProjectAsset({projectPath:asset.dataset.projectPath || importedProjectPath,assetPath:asset.dataset.assetPath}).then(result=>{if(result?.ok && video.isConnected)video.src=result.url;});}
          if(!assets.length)quickBody.append(quickReader('',state.view==='cover'?'暂无封面，可粘贴或拖入图片':state.view==='video'?'暂无视频，可粘贴或拖入成片':'暂无BGM，可粘贴或拖入音频'));
        } else if (state.view === 'plot' || state.view === 'style') {
          const source = quickNodesOfKind(state.view)[0];
          quickTitle.textContent = state.view === 'plot' ? '剧情梗概' : '画风';
          quickBody.append(quickReader(getBodyText(source?.querySelector('.node-body')), state.view === 'plot' ? '画布中暂无剧情梗概' : '画布中暂无画风提示词'));
        } else if (state.view === 'people') {
          quickTitle.textContent = '人物';
          quickCards(quickListNodes('person', 'character'), 'people', 'person', '画布中暂无人物节点');
        } else if (state.view === 'person') {
          quickTitle.textContent = node ? quickNodeTitle(node) : '人物';
          quickHeading('背景设定');
          quickBody.append(quickReader(getBodyText(node?.querySelector('.node-body')), '暂无人物背景设定'));
          quickImages(quickChildren(node, 'asset'));
        } else if (state.view === 'shots') {
          quickTitle.textContent = '场景';
          quickCards(quickListNodes('shot-group', 'shot'), 'shots', 'shot', '画布中暂无场景节点');
        } else if (state.view === 'shot') {
          quickTitle.textContent = node ? quickNodeTitle(node) : '场景';
          quickHeading('场景叙事');quickCopy(node);
          const duration = node?.dataset.duration ? `建议时长：${node.dataset.duration}\n` : '';
          quickBody.append(quickReader(duration + getBodyText(node?.querySelector('.node-body')), '暂无场景叙事'));
          quickImages(quickChildren(node, 'asset'));
          quickHeading('镜头');
          quickCards(quickChildren(node, 'storyboard'), 'storyboards', 'storyboard', '这个场景暂无镜头');
        } else if (state.view === 'storyboard') {
          quickTitle.textContent = node ? quickNodeTitle(node) : '镜头';
          quickHeading('提示词');quickCopy(node);
          quickBody.append(quickReader(getBodyText(node?.querySelector('.node-body')), '暂无镜头提示词'));
          quickImages(quickChildren(node, 'asset'));
        }
        updateQuickSiblingButtons();
        quickRenderedSignature=quickContentSignature();
        if(options.preserve){
          quickBody.scrollTop=scroll;
          for(const media of quickBody.querySelectorAll('audio,video')){
            const previous=playing.get(media.dataset.nodeId);if(!previous)continue;
            const resume=()=>{if(!media.isConnected)return;media.currentTime=previous.time;media.volume=previous.volume;media.muted=previous.muted;if(!previous.paused)media.play().catch(()=>{});};
            if(media.readyState>=1)resume();else media.addEventListener('loadedmetadata',resume,{once:true});
          }
        }
        if(hadFocus){quickPanel.tabIndex=-1;quickPanel.focus({preventScroll:true});}
      }

      function closeQuickView() {
        quickBody.querySelectorAll('audio,video').forEach(audio=>audio.pause());
        quickOverlay.hidden = true;
        quickTrail = [];
      }

      function initQuickNavigation() {
        quickPanel.tabIndex=-1;
        quickPanel.addEventListener('pointerdown',event=>{if(!event.target.closest('input,textarea,select,button,audio,video,[contenteditable="true"]'))quickPanel.focus({preventScroll:true});},{capture:true});
        applyQuickPin();
        document.querySelector('#quickPin')?.addEventListener('click',()=>{quickPinned=!quickPinned;localStorage.setItem('canvas-quick-pinned',String(quickPinned));applyQuickPin();});
        document.querySelector('#saveRetry')?.addEventListener('click',()=>save({strict:true}).catch(()=>{}));

        const mediaDropActive=()=>!quickOverlay.hidden && ['cover','video','bgm'].includes(quickTrail.at(-1)?.view);
        const clearMediaDrop=()=>{dragDepth=0;dropOverlay.classList.remove('visible');clearExternalImageDropTarget();};
        for(const type of ['dragenter','dragover'])quickPanel.addEventListener(type,event=>{if(!mediaDropActive() || !event.dataTransfer?.types.includes('Files'))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';clearMediaDrop();displayFileDropHint(event,{valid:true,text:'松开以导入到 '+(quickTrail.at(-1)?.view==='cover'?'封面':quickTrail.at(-1)?.view==='bgm'?'BGM':'视频')});});
        quickPanel.addEventListener('drop',event=>{if(!mediaDropActive() || !event.dataTransfer?.files.length)return;event.preventDefault();event.stopPropagation();clearMediaDrop();importProjectMedia(event.dataTransfer.files).catch(error=>toast('素材导入失败：'+error.message));});
        document.addEventListener('paste',event=>{if(quickOverlay.hidden || (quickPinned && !quickPanel.contains(event.target)) || !['cover','video','bgm'].includes(quickTrail.at(-1)?.view) || !event.clipboardData?.files.length)return;event.preventDefault();event.stopPropagation();importProjectMedia(event.clipboardData.files);},true);
        quickNav.querySelectorAll('[data-quick-view]').forEach(button => button.addEventListener('click', () => {
          quickTrail = [{ view: button.dataset.quickView }];
          renderQuickView();
          quickOverlay.hidden = false;
          quickClose.focus();
        }));
        quickClose.addEventListener('click', closeQuickView);
        quickBack.addEventListener('click', () => { if (quickTrail.length > 1) { quickTrail.pop(); renderQuickView(); } });
        quickPrevious.addEventListener('click', () => moveQuickSibling(-1));
        quickNext.addEventListener('click', () => moveQuickSibling(1));
        quickOverlay.addEventListener('pointerdown', event => { if (event.target === quickOverlay) closeQuickView(); });
      }

      function renderStoryboardPrompt(body) {
        const raw = body.dataset.rawText || '';
        body.replaceChildren();
        body.classList.add('prompt-reading');
        if (!raw.trim()) return;
        const marker = body.dataset.promptReader === 'true'
          ? /\b(?:subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\b|\[(?:Shot|场景|镜头|分镜)\s*0*\d+[^\]\n]{0,60}\]/gi
          : /\[(?:Shot|场景|镜头|分镜)\s*0*\d+[^\]\n]{0,60}\]/gi;
        const matches = [...raw.matchAll(marker)];
        const sections = [];
        if (matches.length) {
          if (matches[0].index > 0) sections.push({ title: '整体要求', text: raw.slice(0, matches[0].index) });
          matches.forEach((match, index) => sections.push({
            title: match[0].replace(/^\[|\]$/g, '').replace(/\s*\|\s*/g, ' · '),
            text: raw.slice(match.index + match[0].length, matches[index + 1]?.index ?? raw.length)
          }));
        } else sections.push({ title: '', text: raw });
        for (const section of sections) {
          const card = document.createElement('section'); card.className = 'prompt-section';
          if (section.title) {
            const heading = document.createElement('div'); heading.className = 'prompt-section-title'; heading.textContent = section.title;
            heading.contentEditable = 'false';
            card.append(heading);
            const match = matches.find(match => match[0].slice(1, -1).replace(/\s*\|\s*/g, ' · ') === section.title);
            if (match) card.dataset.marker = match[0];
          }
          const lines = body.dataset.promptReader === 'true' ? readablePromptLines(section.text) : section.text.replace(/\r\n?/g,'\n').split('\n');
          for (const line of lines) {
            const paragraph = document.createElement('p'); paragraph.className = 'prompt-paragraph'; paragraph.textContent = line;paragraph.style.whiteSpace='pre-wrap';if(!line)paragraph.append(document.createElement('br'));
            card.append(paragraph);
          }
          body.append(card);
        }
      }

      function setBodyText(body, text) {
        if (!body) return;
        if (body.dataset.promptReader === 'true' || body.dataset.kind === 'storyboard' || body.closest('.node.storyboard')) {
          body.dataset.rawText = text || '';
          if (!body.isContentEditable) renderStoryboardPrompt(body);
          else body.innerText = text || '';
        } else body.innerText = text || '';
      }

      function prepareEditableBody(body, placeholder, text) {
        body.contentEditable = 'false'; body.spellcheck = false;
        body.dataset.placeholder = placeholder;
        setBodyText(body, text);
        body.title = '双击编辑；拖动标题栏移动节点；Alt+滚轮滚动内容；Alt+单击切换选择';
        if (body.dataset.promptReader === 'true') body.title = '双击编辑；滚轮上下滚动内容；拖动标题移动节点';
        body.addEventListener('pointerdown', event => { if (body.isContentEditable && !event.altKey) event.stopPropagation(); });
        body.addEventListener('dblclick', event => {
          event.preventDefault();
          selectNode(body.closest('.node'));
          enableTextEditing(body, event);
        });
        body.addEventListener('blur', () => {
          if (body.isContentEditable) {
            if (body.dataset.promptReader === 'true' || body.closest('.node.storyboard')) body.dataset.rawText = getBodyText(body);
            body.contentEditable = 'false';
            if (body.dataset.promptReader === 'true' || body.closest('.node.storyboard')) {
              renderStoryboardPrompt(body);
              if (shotLaneLayoutVersion) arrangeCanvasLanes(false);
              renderConnections();
            }
            endCanvasAction(body.canvasEditAction);delete body.canvasEditAction;
            save();
          }
        });
        body.addEventListener('input', () => {
          const owner = body.closest('.node');
          if (owner?.dataset.kind === 'storyboard' && body.isContentEditable) body.dataset.rawText = getBodyText(body);
          if (['script', 'plot', 'style'].includes(owner?.dataset.kind)) {
            const script = owner.dataset.kind === 'script' ? owner : [...nodesLayer.children].find(node => node.dataset.kind === 'script');
            const plot = [...nodesLayer.children].find(node => node.dataset.kind === 'plot');
            if (script && plot?.dataset.autoPosition !== 'false') positionPlotForScript(script, plot);
            const style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
            if (script && style?.dataset.autoPosition !== 'false') positionStyleForScript(script, style);
            const role = [...nodesLayer.children].find(node => node.dataset.kind === 'person');
            if (owner.dataset.kind === 'script' && script && role?.dataset.autoPosition !== 'false') positionRoleForScript(script, role);
            const shotGroup = [...nodesLayer.children].find(node => node.dataset.kind === 'shot-group');
            if (script && shotGroup?.dataset.autoPosition !== 'false') positionShotGroupForScript(script, shotGroup);
          }
          if (shotLaneLayoutVersion && ['shot', 'storyboard', 'character', 'plot', 'style'].includes(owner?.dataset.kind)) arrangeCanvasLanes(false);
          save(); renderConnections(); });
      }

      function selectedCanvasNodes(){return [...nodesLayer.querySelectorAll('.node.selected')];}
      function selectedReferenceImages(){return selectedCanvasNodes().filter(isImageNode);}
      async function copySelectedImages(){try{await canvasSaveQueue;const nodes=selectedReferenceImages();const result=await window.canvasFiles.copyImages(nodes.map(node=>({projectPath:node.dataset.projectPath || importedProjectPath,assetPath:node.dataset.assetPath})));if(!result.ok)throw Error(result.error);toast('已复制 '+result.count+' 张参考图');}catch(error){toast('复制失败：'+error.message);}}
      const selectionHint = document.createElement('div');
      selectionHint.className = 'canvas-selection-hint'; selectionHint.hidden = true;
      selectionHint.setAttribute('role','status'); selectionHint.setAttribute('aria-live','polite');
      viewport.append(selectionHint);
      new MutationObserver(() => {
        const count = selectedCanvasNodes().length;
        selectionHint.hidden = count < 2;
        const text = '已选 '+count+' 个节点 · 拖动标题栏移动 · Delete 删除 · Alt+单击切换选择';
        if (selectionHint.textContent !== text) selectionHint.textContent = text;
      }).observe(nodesLayer,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
      viewport.addEventListener('pointerdown',event=>{
        if(!event.altKey || event.button!==0 || event.target.closest('button,.connection-menu,dialog,.reference-floating'))return;
        event.preventDefault();event.stopImmediatePropagation();
        const hit=event.target.closest('.node');if(hit){hit.classList.toggle('selected');return;}
        const x=event.clientX,y=event.clientY,box=document.createElement('div');box.style.cssText='position:fixed;pointer-events:none;z-index:100;border:1px solid #9bdac8;background:#82cbb622';document.body.append(box);viewport.setPointerCapture(event.pointerId);
        const move=e=>{const left=Math.min(x,e.clientX),top=Math.min(y,e.clientY),right=Math.max(x,e.clientX),bottom=Math.max(y,e.clientY);Object.assign(box.style,{left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'});for(const node of nodesLayer.children){const r=node.getBoundingClientRect();node.classList.toggle('selected',!node.classList.contains('hidden-by-parent')&&r.right>=left&&r.left<=right&&r.bottom>=top&&r.top<=bottom);}};
        const end=e=>{viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',end);viewport.removeEventListener('pointercancel',end);box.remove();if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);};
        viewport.addEventListener('pointermove',move);viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
      },{capture:true});
      function selectNode(el) {
        // Pressing a member keeps the group available for a common drag.
        if (el.classList.contains('selected')) return;
        selectedCanvasNodes().forEach(node => node.classList.remove('selected'));
        el.classList.add('selected');
      }

      function deletionBlocker(targets) {
        const ids = new Set(targets.map(node => node.dataset.id));
        for (const el of targets) {
          const protectedLabel = {plot:'剧情梗概',style:'画风',person:'角色', 'shot-group':'场景主'}[el.dataset.kind];
          if (protectedLabel) return protectedLabel + '节点不能删除';
          if (el.dataset.kind === 'script' && [...nodesLayer.children].some(node => ['person','shot-group'].includes(node.dataset.kind))) return '角色和场景主节点必须连接剧本，剧本节点不能删除';
          if (connections.some(edge => edge.fromId === el.dataset.id && getNode(edge.toId) && !ids.has(edge.toId))) return '请先删除该节点下连接的子节点，或一起选中删除';
        }
        return '';
      }

      function renumberAfterNodesDeletion(targets) {
        const removedIds = new Set(targets.map(node => node.dataset.id));
        const groups = new Map();
        for (const deleted of targets) {
          const kind = deleted.dataset.kind;
          if (!['shot','storyboard'].includes(kind)) continue;
          const prefix = kind === 'shot' ? '场景' : '镜头';
          const pattern = new RegExp('^' + prefix + '\\s*0*(\\d+)');
          const number = Number(quickNodeTitle(deleted).match(pattern)?.[1]);
          const parentKind = kind === 'shot' ? 'shot-group' : 'shot';
          const parentId = connections.find(edge => edge.toId === deleted.dataset.id && getNode(edge.fromId)?.dataset.kind === parentKind)?.fromId;
          if (!number || !parentId) continue;
          const key = kind + ':' + parentId;
          if (!groups.has(key)) groups.set(key, {kind,prefix,pattern,parentId,numbers:[]});
          groups.get(key).numbers.push(number);
        }
        for (const {kind,prefix,pattern,parentId,numbers} of groups.values()) {
          const siblings = new Set(connections.filter(edge => edge.fromId === parentId).map(edge => getNode(edge.toId)));
          for (const sibling of siblings) {
            if (!sibling || removedIds.has(sibling.dataset.id) || sibling.dataset.kind !== kind) continue;
            const title = sibling.querySelector('.node-title');
            const number = Number(title?.textContent.match(pattern)?.[1]);
            const decrement = numbers.filter(removed => removed < number).length;
            if (decrement) title.textContent = title.textContent.replace(pattern, prefix + String(number - decrement).padStart(2,'0'));
          }
        }
      }

      let nodeDeletionPending=false;
      async function removeNode(el) { return removeNodes([el]); }
      async function removeNodes(requested) {
        if (nodeDeletionPending) return;
        const targets = [...new Set(requested)].filter(node => nodesLayer.contains(node));
        if (!targets.length) return;
        const blocked = deletionBlocker(targets);
        if (blocked) { toast(blocked); return; }
        nodeDeletionPending=true;
        try {
          await save({strict:true});
          // Saving can await asset work. Validate the complete group again before mutation.
          if (!targets.every(node => nodesLayer.contains(node))) return;
          const blocker = deletionBlocker(targets);
          if (blocker) { toast(blocker); return; }
          await runCanvasAction('删除节点', async () => {
            const ids = new Set(targets.map(node => node.dataset.id));
            renumberAfterNodesDeletion(targets);
            connections = connections.filter(edge => !ids.has(edge.fromId) && !ids.has(edge.toId));
            for (const node of targets) node.remove();
            if (shotLaneLayoutVersion) arrangeCanvasLanes(false);
            renderConnections(); await save({strict:true});
          });
          toastAction(targets.length > 1 ? '已删除 '+targets.length+' 个节点' : '节点已删除', '撤销', undoLastCanvasChange);
        } catch(error) { toast('删除未完成：'+error.message); }
        finally { nodeDeletionPending=false; pruneUndoHistory().catch(console.warn); }
      }

      function beginNodeMove(el, event, onFinish) {
        const selected = selectedCanvasNodes();
        const members = selected.includes(el) ? selected : [el];
        // A script keeps its automatic followers; Set prevents selected followers moving twice.
        const script = members.find(node => node.dataset.kind === 'script');
        const followers = script ? [...nodesLayer.children].filter(node => ['plot','style','person','shot-group'].includes(node.dataset.kind) && node.dataset.autoPosition !== 'false') : [];
        const moving = [...new Set([...members, ...followers])];
        const positions = new Map(moving.map(node => [node,{x:Number(node.dataset.x),y:Number(node.dataset.y),autoPosition:node.dataset.autoPosition}]));
        const start = {pointerId:event.pointerId,px:event.clientX,py:event.clientY,moved:false,action:null,layout:null};
        const move = ev => {
          if (ev.pointerId !== start.pointerId) return;
          if (!start.moved && Math.hypot(ev.clientX-start.px,ev.clientY-start.py) <= 6) return;
          if (!start.moved) {
            start.action = beginCanvasAction('移动节点');start.layout=beginManualCanvasLayout();start.moved=true;
            moving.forEach(node => node.classList.add('is-moving')); el.setPointerCapture(ev.pointerId);
          }
          ev.preventDefault();
          const dx=(ev.clientX-start.px)/view.scale,dy=(ev.clientY-start.py)/view.scale;
          for (const [node,position] of positions) {
            node.dataset.x=position.x+dx; node.dataset.y=position.y+dy;
            node.style.left=node.dataset.x+'px'; node.style.top=node.dataset.y+'px';
          }
          scheduleDragGeometry(moving);
        };
        const finish = ev => {
          if (ev.pointerId !== start.pointerId) return;
          document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',finish); document.removeEventListener('pointercancel',finish);
          moving.forEach(node => node.classList.remove('is-moving'));
          if (start.moved) {
            if (ev.type === 'pointercancel') {
              for (const [node,position] of positions) {
                node.dataset.x=position.x; node.dataset.y=position.y;
                if (position.autoPosition == null) delete node.dataset.autoPosition; else node.dataset.autoPosition=position.autoPosition;
                node.style.left=node.dataset.x+'px';node.style.top=node.dataset.y+'px';
              }
              finishManualCanvasLayout(start.layout,{cancelled:true});cancelCanvasAction(start.action);
            } else {
              members.forEach(node => {node.dataset.autoPosition='false';});
              finishManualCanvasLayout(start.layout);endCanvasAction(start.action); recordCanvasLayoutChange();
            }
            renderConnections();
          }
          if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
          onFinish?.(start.moved || ev.type === 'pointercancel');
        };
        document.addEventListener('pointermove',move); document.addEventListener('pointerup',finish); document.addEventListener('pointercancel',finish);
      }

      function beginNodeResize(el, event) {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = { pointerId: event.pointerId, px: event.clientX, py: event.clientY, width: el.offsetWidth, height: el.offsetHeight, moved: false,action:null,layout:null };
        const kind = el.dataset.kind;
        const imageOnly = kind === 'asset' && el.classList.contains('image-only');
        const minWidth = imageOnly ? 120 : kind === 'script' ? 140 : kind === 'plot' ? 200 : kind === 'asset' ? 180 : 170;
        const minHeight = imageOnly ? 100 : kind === 'script' ? 78 : kind === 'asset' ? 200 : kind === 'shot' ? 98 : 82;
        const move = ev => {
          if (ev.pointerId !== start.pointerId) return;
          const width = Math.max(minWidth, start.width + (ev.clientX - start.px) / view.scale);
          const height = Math.max(minHeight, start.height + (ev.clientY - start.py) / view.scale);
          if (Math.abs(width - start.width) + Math.abs(height - start.height) < 1) return;
          if(!start.moved){start.action=beginCanvasAction('调整节点大小');start.layout=beginManualCanvasLayout();}
          start.moved = true; el.classList.add('is-resizing', 'is-resized');
          el.dataset.userWidth = width; el.dataset.userHeight = height;
          el.style.width = `${width}px`; el.style.height = `${height}px`;
          if (kind === 'script') {
            const plot = [...nodesLayer.children].find(node => node.dataset.kind === 'plot');
            if (plot?.dataset.autoPosition !== 'false') positionPlotForScript(el, plot);
            const style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
            if (style?.dataset.autoPosition !== 'false') positionStyleForScript(el, style);
            const role = [...nodesLayer.children].find(node => node.dataset.kind === 'person');
            if (role?.dataset.autoPosition !== 'false') positionRoleForScript(el, role);
            const shotGroup = [...nodesLayer.children].find(node => node.dataset.kind === 'shot-group');
            if (shotGroup?.dataset.autoPosition !== 'false') positionShotGroupForScript(el, shotGroup);
          } else if (['plot', 'style'].includes(kind) && el.dataset.autoPosition !== 'false') {
            const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
            if (script) {
              if (kind === 'plot') positionPlotForScript(script, el);
              const style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
              if (style?.dataset.autoPosition !== 'false') positionStyleForScript(script, style);
              const shotGroup = [...nodesLayer.children].find(node => node.dataset.kind === 'shot-group');
              if (shotGroup?.dataset.autoPosition !== 'false') positionShotGroupForScript(script, shotGroup);
            }
          }
          renderConnections();
        };
        const finish = ev => {
          if (ev.pointerId !== start.pointerId) return;
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', finish);
          document.removeEventListener('pointercancel', finish);
          el.classList.remove('is-resizing');
          if (start.moved) {
            if (kind === 'asset') clampImagePan(el, el.querySelector('.asset-preview img'));
            if (shotLaneLayoutVersion && ['shot', 'storyboard', 'asset', 'plot', 'style', 'character'].includes(kind)) arrangeCanvasLanes(false);
            renderConnections();finishManualCanvasLayout(start.layout);endCanvasAction(start.action);recordCanvasLayoutChange();
          }
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', finish);
      }

      function beginConnectionDrag(el, event, referenceOnly = false) {
        // Capture only after a real drag, so clicks keep their body target for double-click editing.
        const point = worldPoint(event.clientX, event.clientY);
        connectionDrag = { pointerId: event.pointerId, fromId: el.dataset.id, startX: event.clientX, startY: event.clientY, current: point, moved: false, referenceOnly };
      }


      function currentNodeTitle(kind, title) {
        if (typeof title !== 'string') return title;
        if (kind === 'shot') return title.replace(/^(新)?镜头(?=\s*\d|\s*[·:：|｜-]|$)/, (_, fresh) => (fresh || '') + '场景');
        if (kind === 'storyboard') return title.replace(/^(新)?分镜(?:头)?(?=\s*\d|\s*[·:：|｜-]|$)/, (_, fresh) => (fresh || '') + '镜头');
        if (kind === 'asset' && title === '分镜参考图') return '参考图';
        return title;
      }

      function makeNode(kind, x, y, options = {}) {
        options = { ...options, title: currentNodeTitle(kind, options.title) };
        const id = options.id || `node-${++nodeSeq}`;
        nodeSeq = Math.max(nodeSeq, Number(id.split('-').at(-1)) || 0);
        const el = document.createElement('section');
        let headerClickReady = false;
        el.className = `node ${['shot-group', 'shot', 'storyboard', 'asset', 'script', 'plot', 'style', 'person', 'character', 'prompt'].includes(kind) ? kind : ''}`;
        if (kind === 'prompt' || (kind === 'text' && options.title === '提示词')) el.classList.add('prompt-card');
        if (kind === 'asset' && options.imageRole) el.classList.add('image-only');
        el.dataset.id = id; el.dataset.kind = kind; el.dataset.x = x; el.dataset.y = y;
        el.dataset.includeInChat = options.includeInChat === true ? 'true' : 'false';
        if (options.duration) el.dataset.duration = options.duration;
        if (options.fileName) el.dataset.fileName = options.fileName;
        if (options.assetPath) el.dataset.assetPath = options.assetPath;
        if (options.projectPath) el.dataset.projectPath = options.projectPath;
        if (options.imageRole) el.dataset.imageRole = options.imageRole;
        if(isAudioNode(el))el.classList.add('audio-card');
        if (kind === 'asset' && Number.isFinite(Number(options.imageZoom))) {
          const imageZoom = Math.min(6, Math.max(.25, Number(options.imageZoom)));
          el.dataset.imageZoom = imageZoom;
          el.style.setProperty('--image-zoom', imageZoom);
        }
        if (kind === 'asset') {
          el.dataset.imagePanX = Number.isFinite(Number(options.imagePanX)) ? Number(options.imagePanX) : 0;
          el.dataset.imagePanY = Number.isFinite(Number(options.imagePanY)) ? Number(options.imagePanY) : 0;
          el.style.setProperty('--image-pan-x', `${el.dataset.imagePanX}px`);
          el.style.setProperty('--image-pan-y', `${el.dataset.imagePanY}px`);
        }
        if (options.autoPosition != null) el.dataset.autoPosition = String(options.autoPosition);
        el.style.left = `${x}px`; el.style.top = `${y}px`;
        if (kind !== 'person' && Number(options.width) > 0) { el.dataset.userWidth = Number(options.width); el.style.width = `${Number(options.width)}px`; el.classList.add('is-resized'); }
        if (kind !== 'person' && Number(options.height) > 0) { el.dataset.userHeight = Number(options.height); el.style.height = `${Number(options.height)}px`; el.classList.add('is-resized'); }
        const groupNode = kind === 'person' || kind === 'shot-group';
        if ((options.collapsed || el.classList.contains('prompt-card')) && !groupNode) el.classList.add('collapsed');
        if (groupNode && (options.childrenCollapsed || options.collapsed)) el.classList.add('children-collapsed');
        if (kind === 'shot' && options.childrenCollapsed) el.classList.add('children-collapsed');

        if (kind === 'script') {
          const body = document.createElement('div'); body.className = 'node-body';
          body.dataset.kind = kind;
          prepareEditableBody(body, '输入剧本名…', options.text || options.title || '');
          el.append(body);
        } else {
          const head = document.createElement('header'); head.className = 'node-head';
          head.title = kind === 'person' ? '单击标题栏显示或隐藏角色卡；按住拖动节点；Alt+单击切换选择'
            : kind === 'shot-group' ? '单击标题栏显示或隐藏场景和镜头；按住拖动节点；Alt+单击切换选择'
            : kind === 'asset' ? '单击标题栏折叠或展开；拖动图片平移画面，拖动图片外区域移动节点；Alt+滚轮缩放图片；拖动右下角调整外框大小'
              : ['storyboard','character'].includes(kind) ? '左键按住正文拉线到参考图；拖动标题栏移动节点；单击标题栏折叠或展开'
              : '单击标题栏折叠或展开；按住拖动节点；Alt+单击切换选择';
          const icon = document.createElement('span'); icon.className = 'node-icon';
          if (kind === 'person' || kind === 'character') icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="currentColor"/><path d="M5.5 19c.5-3.1 2.9-5 6.5-5s6 1.9 6.5 5" fill="currentColor"/></svg>';
          else if (kind === 'plot') icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h9l3 3V20H6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14.5 3.8V7h3.2M9 11h6M9 14h6M9 17h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          else icon.textContent = ({ style: '✦', 'shot-group': '▧', shot: '▧', storyboard: '▤', asset: '▤', prompt: '✦', 'cover-group':'▧', 'video-group':'▶', 'bgm-group':'♫' })[kind] || 'T';
          if(window.canvasNodeIcon)icon.innerHTML=window.canvasNodeIcon(el);
          const title = document.createElement('span'); title.className = 'node-title'; title.textContent = kind === 'person' ? '角色' : kind === 'shot-group' ? '场景' : options.title || ({ shot: '新场景', storyboard: '镜头', asset: '素材', plot: '剧情梗概', style: '画风', character: '人物姓名', prompt: '提示词' })[kind] || '文本卡片';
          if (kind === 'character') title.title = '右键修改人物名';
          if (['shot', 'storyboard'].includes(kind)) {
            title.title = '双击修改标题；Enter 确认，Esc 取消';
            title.addEventListener('dblclick', event => {
              event.preventDefault(); event.stopPropagation(); enableTitleEditing(el);
            });
          }
          head.append(icon, title);

          if (kind === 'person') {
            const count = document.createElement('span'); count.className = 'person-count'; count.textContent = '(0人)'; head.append(count);
          } else if (kind === 'shot-group') {
            const count = document.createElement('span'); count.className = 'shot-count'; count.textContent = '(0镜)'; head.append(count);
          } else if (kind === 'shot') {
            const count = document.createElement('span'); count.className = 'storyboard-count'; count.textContent = '(0镜头)'; head.append(count);
          }
          el.append(head);
          head.addEventListener('click', e => {
            if (['shot', 'storyboard'].includes(kind) && e.target.closest('.node-title')) { headerClickReady = false; return; }
            const shouldToggle = headerClickReady && e.detail === 1 && !e.altKey;
            headerClickReady = false;
            if (!shouldToggle) return;
            if (groupNode) el.classList.toggle('children-collapsed');
            else if (kind === 'shot') {
              const collapsed = el.classList.toggle('collapsed');
              el.classList.toggle('children-collapsed', collapsed);
            } else el.classList.toggle('collapsed');
            if (kind === 'asset' && !el.classList.contains('collapsed')) clampImagePan(el, el.querySelector('.asset-preview img'));
            if (['plot', 'style'].includes(kind) && el.dataset.autoPosition !== 'false') {
              const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
              if (script) {
                if (kind === 'plot') positionPlotForScript(script, el);
                const style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
                if (style?.dataset.autoPosition !== 'false') positionStyleForScript(script, style);
                const shotGroup = [...nodesLayer.children].find(node => node.dataset.kind === 'shot-group');
                if (shotGroup?.dataset.autoPosition !== 'false') positionShotGroupForScript(script, shotGroup);
              }
            }
            renderConnections();
            if (shotLaneLayoutVersion && ['person', 'shot-group', 'shot', 'storyboard', 'character', 'asset', 'plot', 'style'].includes(kind)) {
              arrangeCanvasLanes(false);
              renderConnections();
            }
            acknowledgeCanvasViewChange();
          });

          if (kind === 'asset') {
            const preview = document.createElement('div'); preview.className = 'asset-preview';
            preview.textContent = options.previewText || '本地素材';
            const name = document.createElement('div'); name.className = 'asset-name'; name.textContent = options.fileName || options.title || '素材';
            el.append(preview, name);
            if (options.file) renderFile(preview, options.file);
            else if (options.assetPath && options.projectPath) queueProjectAsset(preview, options.assetPath, options.projectPath);
          } else if (!groupNode) {
            if (kind === 'shot') {
              const meta = document.createElement('div'); meta.className = 'shot-meta';
              meta.textContent = options.duration ? `建议时长 · ${options.duration}` : '场景 / 时长 / 机位';
              el.append(meta);
            }
            const body = document.createElement('div'); body.className = 'node-body';
            body.dataset.kind = kind;
            if (el.classList.contains('prompt-card')) body.dataset.promptReader = 'true';
            const placeholder = ({ shot: '写下场景画面、动作、时间或时长…', storyboard: '填写镜头提示词…', plot: '用几句话简述故事主线、核心冲突和走向…', style: '填写本项目所有生图都必须遵守的画风提示词…', character: '角色身份或背景性格描述', prompt: '输入生成提示词…' })[kind] || '输入想法、剧本片段或提示词…';
            prepareEditableBody(body, placeholder, options.text || '');
            el.append(body);
          }
        }

        if (!groupNode) {
          const resizeHandle = document.createElement('div'); resizeHandle.className = 'node-resize';
          resizeHandle.title = '拖动调整节点大小'; resizeHandle.setAttribute('aria-label', '调整节点大小');
          resizeHandle.addEventListener('pointerdown', event => beginNodeResize(el, event));
          el.append(resizeHandle);
        }

        el.addEventListener('pointerdown', e => {
          if (e.target.closest('audio,video')) { e.stopPropagation(); return; }
          if (e.button !== 0 || e.target.closest('button')) return;
          if (e.target.closest('.node-title[contenteditable="true"]')) return;
          const image = kind === 'asset' ? e.target.closest('.asset-preview img') : null;
          if (image && isPointerOnImagePixels(el, image, e.clientX, e.clientY)) {
            e.preventDefault(); e.stopPropagation();
            headerClickReady = false; selectNode(el); beginImagePan(el, image, e);
            return;
          }
          const body = e.target.closest('.node-body');
          if (body?.isContentEditable && !e.altKey) return;
          if (!body || e.altKey) e.preventDefault();
          headerClickReady = !e.altKey && Boolean(e.target.closest('.node-head'));
          e.stopPropagation(); selectNode(el);
          if (selectedCanvasNodes().length === 1 && (['storyboard','character','prompt'].includes(kind) || (kind === 'text' && quickNodeTitle(el) === '提示词')) && !e.altKey && !e.target.closest('.node-head')) beginConnectionDrag(el, e, true);
          else if (kind === 'asset' || !e.altKey) beginNodeMove(el, e, wasDragged => { if (wasDragged) headerClickReady = false; });
          else beginConnectionDrag(el, e);
        });
        el.addEventListener('dblclick', e => {
          if (e.target.closest('.node-head, .node-resize')) return;
          const body = e.target.closest('.node-body') || document.elementFromPoint(e.clientX, e.clientY)?.closest('.node-body');
          if (kind !== 'person' && body && el.contains(body)) enableTextEditing(body, e);
        });
        el.addEventListener('contextmenu', e => {
          if (e.target.closest('.node-body[contenteditable="true"], .node-title[contenteditable="true"]')) return;
          e.preventDefault(); e.stopPropagation(); selectNode(el); openNodeContextMenu(el, e.clientX, e.clientY);
        });
        el.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
        nodesLayer.append(el);
        if (!options.silent) {
          renderMinimap();
          save();
        }
        return el;
      }

      function renderFile(container, file) {
        container.textContent = '';
        const url = URL.createObjectURL(file); objectUrls.add(url);
        if (file.type.startsWith('image/')) {
          const img = document.createElement('img'); img.src = url; img.alt = file.name; img.draggable = false;
          watchImagePanBounds(container.closest('.node'), img); container.append(img);
        } else if (file.type.startsWith('video/')) {
          const video = document.createElement('video'); video.src = url; video.controls = true; video.draggable = false; container.append(video);
        } else if (file.type.startsWith('audio/')) {
          const audio = document.createElement('audio'); audio.src = url; audio.controls = true; audio.draggable = false; container.append(audio);
        } else {
          container.textContent = file.type === 'application/pdf' ? 'PDF 文件' : '文档素材';
        }
      }

      async function renderProjectAsset(container, assetPath, projectPath) {
        const request=Symbol(),preview=view.scale<.6;container.assetRequest=request;container.dataset.previewMode=String(preview);
        container.textContent = '读取项目素材…';
        const bridge = window.canvasFiles;
        if (!bridge?.loadProjectAsset) { container.textContent = '桌面程序中才能读取项目素材'; return; }
        try {
          const result = await bridge.loadProjectAsset({ projectPath, assetPath, preview });
          if(container.assetRequest!==request)return;
          if(result?.mimeType?.startsWith('image/') && preview!==(view.scale<.6)){return renderProjectAsset(container,assetPath,projectPath);}
          if (!result?.ok || !result.url) { container.textContent = result?.error || '无法读取项目素材'; return; }
          container.textContent = '';
          window.setCanvasNodeIcon?.(container.closest('.node'));
          if (result.mimeType.startsWith('image/')) {
            const image = document.createElement('img'); image.src = result.url; image.dataset.originalUrl=result.originalUrl || result.url;image.dataset.lightPreview=String(!!result.originalUrl && result.originalUrl!==result.url); image.alt = assetPath; image.draggable = false; image.loading = 'lazy'; image.decoding = 'async';
            watchImagePanBounds(container.closest('.node'), image); container.append(image);
          } else if (result.mimeType.startsWith('video/')) {
            const video = document.createElement('video'); video.src = result.url; video.controls = true; video.preload = 'metadata'; video.draggable = false; container.append(video);
          } else if (result.mimeType.startsWith('audio/')) {
            container.closest('.node')?.classList.add('audio-card');
            const audio = document.createElement('audio'); audio.src = result.url; audio.controls = true; audio.preload = 'metadata'; container.append(audio);
          } else container.textContent = '不支持预览此素材';
        } catch (_) { if(container.assetRequest===request)container.textContent = '读取项目素材失败'; }
      }

      function zoomImageByWheel(node, event) {
        if (!node?.querySelector('.asset-preview img') || event.deltaY === 0) return;
        const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 40
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * node.offsetHeight
            : event.deltaY;
        const current = Number(node.dataset.imageZoom) || 1;
        const next = Math.min(6, Math.max(.25, current * Math.exp(-delta * .0015)));
        if (Math.abs(next - current) < .001) return;
        node.dataset.imageZoom = next;
        node.style.setProperty('--image-zoom', next);
        clampImagePan(node, node.querySelector('.asset-preview img'));
      }

      function imagePanBounds(node, image) {
        const preview = node.querySelector('.asset-preview');
        if (!preview || !image?.naturalWidth || !image.naturalHeight) return null;
        const frameWidth = preview.clientWidth, frameHeight = preview.clientHeight;
        if (!frameWidth || !frameHeight) return null;
        const fitScale = Math.min(frameWidth / image.naturalWidth, frameHeight / image.naturalHeight);
        const zoom = Number(node.dataset.imageZoom) || 1;
        return {
          frameWidth, frameHeight,
          width: image.naturalWidth * fitScale * zoom,
          height: image.naturalHeight * fitScale * zoom,
          x: Math.max(0, (image.naturalWidth * fitScale * zoom - frameWidth) / 2),
          y: Math.max(0, (image.naturalHeight * fitScale * zoom - frameHeight) / 2)
        };
      }

      function isPointerOnImagePixels(node, image, clientX, clientY) {
        const geometry = imagePanBounds(node, image);
        if (!geometry) return false;
        const preview = node.querySelector('.asset-preview');
        const rect = preview.getBoundingClientRect();
        const x = (clientX - rect.left) / view.scale;
        const y = (clientY - rect.top) / view.scale;
        const panX = Number(node.dataset.imagePanX) || 0;
        const panY = Number(node.dataset.imagePanY) || 0;
        const left = (geometry.frameWidth - geometry.width) / 2 + panX;
        const top = (geometry.frameHeight - geometry.height) / 2 + panY;
        return x >= 0 && x <= geometry.frameWidth && y >= 0 && y <= geometry.frameHeight &&
          x >= left && x <= left + geometry.width && y >= top && y <= top + geometry.height;
      }

      function watchImagePanBounds(node, image) {
        const clamp = () => clampImagePan(node, image);
        image.addEventListener('load', clamp);
        if (image.complete && image.naturalWidth) clamp();
      }

      function clampImagePan(node, image) {
        if (!node || !image) return;
        const bounds = imagePanBounds(node, image);
        if (!bounds) return;
        const x = Math.min(bounds.x, Math.max(-bounds.x, Number(node.dataset.imagePanX) || 0));
        const y = Math.min(bounds.y, Math.max(-bounds.y, Number(node.dataset.imagePanY) || 0));
        node.dataset.imagePanX = x;
        node.dataset.imagePanY = y;
        node.style.setProperty('--image-pan-x', `${x}px`);
        node.style.setProperty('--image-pan-y', `${y}px`);
      }

      function beginImagePan(node, image, event) {
        if (event.button !== 0) return;
        event.preventDefault();
        image.setPointerCapture(event.pointerId);
        const start = {
          pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
          x: Number(node.dataset.imagePanX) || 0, y: Number(node.dataset.imagePanY) || 0, moved: false
        };
        const move = ev => {
          if (ev.pointerId !== start.pointerId) return;
          if (Math.hypot(ev.clientX - start.clientX, ev.clientY - start.clientY) > 6) start.moved = true;
          if (!start.moved) return;
          const bounds = imagePanBounds(node, image);
          if (!bounds) return;
          const x = start.x + (ev.clientX - start.clientX) / view.scale;
          const y = start.y + (ev.clientY - start.clientY) / view.scale;
          node.dataset.imagePanX = Math.min(bounds.x, Math.max(-bounds.x, x));
          node.dataset.imagePanY = Math.min(bounds.y, Math.max(-bounds.y, y));
          node.style.setProperty('--image-pan-x', `${node.dataset.imagePanX}px`);
          node.style.setProperty('--image-pan-y', `${node.dataset.imagePanY}px`);
          ev.preventDefault();
        };
        const finish = ev => {
          if (ev.pointerId !== start.pointerId) return;
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', finish);
          document.removeEventListener('pointercancel', finish);
          if (image.hasPointerCapture(start.pointerId)) image.releasePointerCapture(start.pointerId);
          if (ev.type === 'pointerup' && !start.moved && Math.hypot(ev.clientX - start.clientX, ev.clientY - start.clientY) <= 6 && image.isConnected && image.src) openImageViewer(image.dataset.originalUrl || image.src);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', finish);
      }

      function queueProjectAsset(container, assetPath, projectPath) {
        if (container.querySelector('img, video, audio')) return;
        container.textContent = '滚动到素材节点时载入预览';
        if (!projectAssetObserver) { renderProjectAsset(container, assetPath, projectPath); return; }
        pendingProjectAssets.set(container, { path: assetPath, projectPath });
        projectAssetObserver.observe(container);
      }

      function attachCharacterImage(character, file, point) {
        if (!character || !isJpgPngFile(file)) { toast('人物设定图仅支持 JPG 或 PNG'); return null; }
        return importCanvasImages([file], point, character);
      }

      function isCanvasImageFile(file) {
        return Boolean(file && (/^image\/(png|jpeg|webp|gif)$/.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name)));
      }

      function isCanvasVideoFile(file) {
        if (isCanvasAudioFile(file) || /^assets\/(?:\.undo\/)?audio\//i.test((file?.name || '').replace(/\\/g,'/'))) return false;
        return Boolean(file && (/^video\/(mp4|webm|quicktime)$/.test(file.type || '') || /\.(mp4|webm|mov)$/i.test(file.name || '')));
      }
      function isPromptNode(node) {
        return node && nodesLayer.contains(node) && (node.dataset.kind === 'prompt' || (node.dataset.kind === 'text' && quickNodeTitle(node) === '提示词'));
      }
      function promptColumnPoint(board) {
        const related = storyboardLaneNodes(board);
        const prompts = [...nodesLayer.children].filter(isPromptNode);
        const images = related.filter(isImageNode);
        const right = Math.max(Number(board.dataset.x) + board.offsetWidth + 400, ...images.map(node => Number(node.dataset.x) + node.offsetWidth + 100));
        const x = Math.max(right, prompts.length ? Math.min(...prompts.map(node => Number(node.dataset.x))) : right);
        const children = related.filter(isPromptNode);
        return {x, y:children.length ? Math.max(...children.map(node => Number(node.dataset.y) + node.offsetHeight)) + 40 : Number(board.dataset.y)};
      }
      async function importCanvasVideos(files, point, parent = null) {
        return runCanvasAction('导入视频',async()=>{
        const projectPath=importedProjectPath;
        const parentId=parent?.dataset.id;
        parent?.classList.add('image-drop-target');
        let count=0;
        for(const file of files) {
          try {
            const result=await window.canvasFiles.importVideo({path:window.canvasFiles.getPathForFile(file),name:file.name,bytes:window.canvasFiles.getPathForFile(file)?undefined:new Uint8Array(await file.arrayBuffer()),projectPath});
            if(!result?.ok)throw new Error(result?.error || '视频导入失败');
            if(projectPath!==importedProjectPath)throw new Error('项目已改变，请重新导入');
            if(parentId && getNode(parentId)!==parent)throw new Error('目标节点已移除');
            const node=makeNode('asset',point.x+count*30,point.y+count*30,{title:parent?'生成视频':'视频',fileName:result.name,assetPath:result.assetPath,projectPath:result.projectPath,silent:true});
            if(parentId) connections.push({fromId:parentId,toId:node.dataset.id});
            selectNode(node);count++;
          }catch(error){toast(error.message || '视频导入失败');}
        }
        parent?.classList.remove('image-drop-target');
        if(count){if(parent && shotLaneLayoutVersion)arrangeCanvasLanes(false);renderConnections();await save();toast(`已添加 ${count} 个视频`);}
        });
      }

      function isCanvasAudioFile(file){return /^audio\//.test(file?.type || '') || /\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(file?.name || '');}
      async function importCanvasAudio(files, point, parent = null) {
        return runCanvasAction('导入音频',async()=>{
        const projectPath=importedProjectPath;
        const parentId=parent?.dataset.id;
        parent?.classList.add('image-drop-target');
        let count=0;
        for(const file of files) {
          try {
            const result=await window.canvasFiles.importAudio({path:window.canvasFiles.getPathForFile(file),name:file.name,bytes:window.canvasFiles.getPathForFile(file)?undefined:new Uint8Array(await file.arrayBuffer()),projectPath});
            if(!result?.ok)throw new Error(result?.error || '音频导入失败');
            if(projectPath!==importedProjectPath)throw new Error('项目已改变，请重新导入');
            if(parentId && getNode(parentId)!==parent)throw new Error('目标节点已移除');
            const node=makeNode('asset',point.x+count*30,point.y+count*30,{title:parent?.dataset.kind==='bgm-group'?'BGM':parent?'参考音色':'音频',fileName:result.name,assetPath:result.assetPath,projectPath:result.projectPath,silent:true});
            if(parentId) connections.push({fromId:parentId,toId:node.dataset.id});
            selectNode(node);count++;
          }catch(error){toast(error.message || '音频导入失败');}
        }
        parent?.classList.remove('image-drop-target');
        if(count){if(parent && shotLaneLayoutVersion)arrangeCanvasLanes(false);renderConnections();await save();toast(`已添加 ${count} 个音频`);}
        });
      }

      async function importCanvasImages(files, point, parent = null) {
        return runCanvasAction('导入图片',async()=>{
        const projectPath = importedProjectPath;
        const parentId = parent?.dataset.id;
        const bridge = window.canvasFiles;
        let count = 0;
        for (const file of files) {
          try {
            if (!isCanvasImageFile(file)) throw new Error('图片支持 PNG、JPG、WebP 和 GIF');
            if (parent?.dataset.kind === 'character' && !isJpgPngFile(file)) throw new Error('人物设定图仅支持 JPG 或 PNG');
            const options = { fileName:file.name || '粘贴图片.png', file, silent:true };
            if (projectPath) {
              if (!bridge?.importImage) throw new Error('请使用桌面版导入图片');
              const sourcePath = bridge.getPathForFile?.(file);
              if (!sourcePath && file.size > 20*1024*1024) throw Error('粘贴图片需小于20 MB');
              const stored = await bridge.importImage(sourcePath ? {path:sourcePath,projectPath} : {bytes:new Uint8Array(await file.arrayBuffer()),name:file.name || '粘贴图片.png',projectPath});
              if (!stored?.ok) throw new Error(stored?.error || '图片保存失败');
              options.assetPath = stored.assetPath; options.projectPath = projectPath;
              delete options.file;
            }
            if (importedProjectPath !== projectPath || (parentId && getNode(parentId) !== parent)) throw new Error('剧本或目标节点已改变，请重新导入');
            if (parent) {
              if(parent.dataset.kind === 'character') options.imageRole='character-setting';
              else if(parent.dataset.kind === 'storyboard') options.imageRole='storyboard-reference';
              options.title = referenceImageTitle(parent);
            } else options.title = options.fileName;
            const offset = count * 30;
            const node = makeNode('asset', point.x + offset, point.y + offset, options);
            if (parent) {
              connections.push({fromId:parentId,toId:node.dataset.id});
              parent.classList.remove('collapsed','children-collapsed');
            }
            selectNode(node); count++;
          } catch (error) { toast(error.message || '图片导入失败'); }
        }
        if (count) {
          if (parent && shotLaneLayoutVersion) arrangeCanvasLanes(false);
          renderConnections(); await save();
          toast(parent ? `已连接 ${count} 张参考图` : `已添加 ${count} 张图片`);
        }
        });
      }

      function nextChildTitle(parent, kind) {
        const children = [...new Set(connections
          .filter(connection => connection.fromId === parent.dataset.id && getNode(connection.toId)?.dataset.kind === kind)
          .map(connection => connection.toId))].map(getNode);
        const prefix = kind === 'shot' ? '场景' : '镜头';
        const highest = children.reduce((max, child) => {
          const number = child.querySelector('.node-title')?.textContent.match(new RegExp(`^${prefix}\\s*0*(\\d+)`));
          return Math.max(max, Number(number?.[1]) || 0);
        }, 0);
        return `${prefix}${String(Math.max(highest, children.length) + 1).padStart(2, '0')}`;
      }

      function arrangeRoleTree(collapse = true, belowY = -Infinity) {
        const role = [...nodesLayer.children].find(node => node.dataset.kind === 'person');
        if (!role) return null;
        const childrenOf = parent => connections.filter(edge => edge.fromId === parent.dataset.id)
          .map(edge => getNode(edge.toId))
          .filter(Boolean);
        const characters = childrenOf(role).filter(node => node.dataset.kind === 'character');
        const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
        const plot = [...nodesLayer.children].find(node => node.dataset.kind === 'plot');
        const style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
        const roleX = role.dataset.autoPosition === 'false' ? Number(role.dataset.x) : script ? Number(script.dataset.x) + script.offsetWidth + 130 : Number(role.dataset.x);
        const treeTop = role.dataset.autoPosition === 'false' ? Number(role.dataset.y) : script
          ? Math.max(belowY, Number(script.dataset.y) + script.offsetHeight + 100,
            plot ? Number(plot.dataset.y) + plot.offsetHeight + 76 : -Infinity,
            style ? Number(style.dataset.y) + style.offsetHeight + 76 : -Infinity)
          : Number(role.dataset.y);
        const move = (node, x, y) => {
          if (node.dataset.autoPosition === 'false') return;
          node.dataset.x = x; node.dataset.y = y;
          node.style.left = `${x}px`; node.style.top = `${y}px`;
        };

        if (collapse) role.classList.remove('children-collapsed');
        const roleOpen = !role.classList.contains('children-collapsed');
        const characterX = roleX + role.offsetWidth + 100;
        const imageX = characterX + Math.max(390, ...characters.map(character => character.offsetWidth + 90));
        let rowY = treeTop;
        let lastCharacterBottom = treeTop;
        for (const character of characters) {
          const characterY = character.dataset.autoPosition === 'false' ? Number(character.dataset.y) : rowY;
          move(character, characterX, characterY);
          if (collapse) character.classList.add('collapsed');
          const images = childrenOf(character).filter(node => node.dataset.kind === 'asset');
          let imageHeight = 0;
          images.forEach(image => {
            move(image, imageX, characterY + imageHeight);
            if (roleOpen) imageHeight = Math.max(imageHeight, Number(image.dataset.y) - characterY + Math.max(42, image.offsetHeight) + 14);
          });
          if (imageHeight) imageHeight -= 14;
          const characterHeight = roleOpen ? Math.max(42, character.offsetHeight) : 42;
          lastCharacterBottom = characterY + Math.max(characterHeight, imageHeight);
          rowY = characterY + (roleOpen
            ? Math.max(140, characterHeight + 28, imageHeight + 28)
            : 140);
        }
        const roleY = characters.length
          ? treeTop + (lastCharacterBottom - treeTop - role.offsetHeight) / 2
          : treeTop;
        move(role, roleX, roleY);
        return roleOpen ? Math.max(rowY, roleY + role.offsetHeight) : roleY + role.offsetHeight;
      }

      function guardExpandedShotLanes(shots, previousRows, childrenOf) {
        // A rendered row is the baseline: ordinary edits and intentional manual
        // overlaps do not move anything unless this scene actually grows past it.
        const ordered = [...shots].sort((a, b) => Number(a.dataset.y) - Number(b.dataset.y));
        const owner = new Map();
        const blocks = ordered.map(shot => {
          const boards = childrenOf(shot, 'storyboard');
          const members = [...new Set([shot, ...boards, ...boards.flatMap(storyboardLaneNodes)])];
          for (const node of members) if (!owner.has(node)) owner.set(node, shot);
          return {shot, boards, members};
        });
        const visible = block => [block.shot, ...(!block.shot.classList.contains('children-collapsed')
          ? block.boards.flatMap(board => [board, ...(!board.classList.contains('collapsed') ? storyboardLaneNodes(board) : [])]) : [])]
          .filter(node => owner.get(node) === block.shot);
        for (let index = 0; index < blocks.length - 1; index++) {
          const block = blocks[index], previous = previousRows.get(block.shot.dataset.id);
          if (!previous) continue;
          const bottom = Math.max(...visible(block).map(node => Number(node.dataset.y) + Math.max(42, node.offsetHeight)));
          if (bottom <= previous.bottom - 20 + 0.5) continue;
          const next = blocks[index + 1];
          const nextTop = Math.min(...visible(next).map(node => Number(node.dataset.y)));
          const distance = Math.max(0, bottom + 42 - nextTop);
          if (!distance) continue;
          for (const node of next.members) {
            if (owner.get(node) !== next.shot) continue;
            node.dataset.y = String(Number(node.dataset.y) + distance);
            node.style.top = `${node.dataset.y}px`;
          }
        }
      }

      function arrangeShotLanes(collapse = true, belowY = -Infinity) {
        const group = [...nodesLayer.children].find(node => node.dataset.kind === 'shot-group');
        if (!group) return false;
        const childrenOf = (parent, kind) => connections
          .filter(edge => edge.fromId === parent.dataset.id)
          .map(edge => getNode(edge.toId))
          .filter(node => node?.dataset.kind === kind);
        const shots = childrenOf(group, 'shot');
        const previousRows = new Map([...shotLanes.querySelectorAll('.shot-lane-row')].filter(row => row.sceneNode === getNode(row.dataset.shotId)).map(row =>
          [row.dataset.shotId, {bottom:parseFloat(row.style.top) + parseFloat(row.style.height)}]));
        if (!shots.length) {
          const role = [...nodesLayer.children].find(node => node.dataset.kind === 'person');
          const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
          const plot = [...nodesLayer.children].find(node => node.dataset.kind === 'plot');
          const style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
          const groupX = group.dataset.autoPosition === 'false' ? Number(group.dataset.x) : role ? Number(role.dataset.x) : Number(group.dataset.x);
          const groupY = Math.max(belowY + 46, plot ? Number(plot.dataset.y) + plot.offsetHeight + 80 : -Infinity,
            style ? Number(style.dataset.y) + style.offsetHeight + 80 : -Infinity,
            script ? Number(script.dataset.y) + script.offsetHeight + 170 : Number(group.dataset.y));
          if (group.dataset.autoPosition !== 'false') {
            group.dataset.x = groupX; group.dataset.y = groupY;
            group.style.left = `${groupX}px`; group.style.top = `${groupY}px`;
          }
          if (collapse) group.classList.remove('children-collapsed');
          return true;
        }
        const allBoards = shots.flatMap(shot => childrenOf(shot, 'storyboard'));
        const role = [...nodesLayer.children].find(node => node.dataset.kind === 'person');
        const groupX = group.dataset.autoPosition === 'false' ? Number(group.dataset.x) : role ? Number(role.dataset.x) : Number(group.dataset.x);
        const shotX = groupX + group.offsetWidth + 100;
        const boardX = shotX + Math.max(400, ...shots.map(shot => shot.offsetWidth + 110));
        const assetX = boardX + Math.max(560, ...allBoards.map(board => board.offsetWidth + 100));
        const allRelated = [...new Set(allBoards.flatMap(storyboardLaneNodes))];
        const imageNodes = allRelated.filter(node => node.dataset.kind === 'asset' && !isCanvasVideoFile({name:node.dataset.assetPath || node.dataset.fileName || ''}));
        const promptNodes = allRelated.filter(node => ['text','prompt'].includes(node.dataset.kind));
        const promptX = assetX + Math.max(400, ...imageNodes.map(node => node.offsetWidth + 100));
        const videoX = promptX + Math.max(400, ...promptNodes.map(node => node.offsetWidth + 100));
        const plot = [...nodesLayer.children].find(node => node.dataset.kind === 'plot');
        const style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
        const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
        let rowY = Math.max(belowY + 90, plot ? Number(plot.dataset.y) + plot.offsetHeight + 80 : -Infinity,
          style ? Number(style.dataset.y) + style.offsetHeight + 80 : -Infinity,
          script ? Number(script.dataset.y) + script.offsetHeight + 170 : Number(group.dataset.y) + group.offsetHeight + 82);
        const move = (node, x, y) => {
          if (node.dataset.autoPosition === 'false') return;
          node.dataset.x = x; node.dataset.y = y;
          node.style.left = `${x}px`; node.style.top = `${y}px`;
        };
        move(group, groupX, rowY - 44);

        if (collapse) group.classList.remove('children-collapsed');
        for (const shot of shots) {
          const shotY = shot.dataset.autoPosition === 'false' ? Number(shot.dataset.y) : rowY + 15;
          move(shot, shotX, shotY);
          if (collapse) shot.classList.add('collapsed', 'children-collapsed');
          const shotOpen = !shot.classList.contains('children-collapsed');
          let laneHeight = 0;
          for (const board of childrenOf(shot, 'storyboard')) {
            const boardY = board.dataset.autoPosition === 'false' ? Number(board.dataset.y) : shotY + laneHeight;
            move(board, boardX, boardY);
            if (collapse) board.classList.add('collapsed');
            const related = storyboardLaneNodes(board);
            const images = related.filter(node => node.dataset.kind === 'asset' && !isCanvasVideoFile({name:node.dataset.assetPath || node.dataset.fileName || ''}));
            const prompts = related.filter(node => ['text','prompt'].includes(node.dataset.kind));
            const videos = related.filter(node => node.dataset.kind === 'asset' && isCanvasVideoFile({name:node.dataset.assetPath || node.dataset.fileName || ''}));
            const imagesVisible = shotOpen && !board.classList.contains('collapsed');
            let imageHeight = 0;
            images.forEach(asset => {
              move(asset, assetX, boardY + imageHeight);
              if (imagesVisible) imageHeight = Math.max(imageHeight, Number(asset.dataset.y) - boardY + Math.max(42, asset.offsetHeight) + 14);
            });
            if (imagesVisible && imageHeight) imageHeight -= 14;
            const stack = (items, x) => {
              let height = 0;
              for (const item of items) {
                move(item, x, boardY + height);
                if (imagesVisible) height = Math.max(height, Number(item.dataset.y) - boardY + Math.max(42, item.offsetHeight) + 14);
              }
              return height ? height - 14 : 0;
            };
            const promptHeight = stack(prompts, promptX);
            const videoHeight = stack(videos, videoX);
            const boardHeight = shotOpen ? Math.max(42, board.offsetHeight) : 42;
            laneHeight = Math.max(laneHeight, boardY - shotY + Math.max(boardHeight, imageHeight, promptHeight, videoHeight) + 16);
          }
          rowY = shotY - 15 + (shotOpen
            ? Math.max(144, shot.offsetHeight + 40, laneHeight + 42)
            : 144);
        }
        if (!collapse) guardExpandedShotLanes(shots, previousRows, childrenOf);
        shotLaneLayoutVersion = 1;
        return true;
      }

      function arrangeProjectMedia() {
        const script=quickNodesOfKind('script')[0];if(!script)return null;
        const column=Number(script.dataset.x)+script.offsetWidth+130;
        const designs=['plot','style'].flatMap(kind=>quickNodesOfKind(kind));
        const x=column;
        let y=Math.max(Number(script.dataset.y),...designs.map(n=>Number(n.dataset.y)+n.offsetHeight+72));
        const move=(n,x,y)=>{if(n.dataset.autoPosition==='false')return;n.dataset.x=x;n.dataset.y=y;n.style.left=x+'px';n.style.top=y+'px';};
        for(const kind of ['cover-group','video-group','bgm-group'])for(const group of quickNodesOfKind(kind)){
          move(group,x,y);let childY=Number(group.dataset.y);
          for(const asset of quickChildren(group,'asset')){move(asset,x+group.offsetWidth+100,childY);childY=Math.max(childY,Number(asset.dataset.y)+asset.offsetHeight+24);}
          y=Math.max(y+group.offsetHeight,childY)+72;
        }
        return y;
      }
      function arrangeCanvasLanes(collapse = true) {
        const mediaBottom=arrangeProjectMedia();
        const roleBottom = arrangeRoleTree(collapse,mediaBottom ?? -Infinity);
        const hasShots = arrangeShotLanes(collapse, Math.max(roleBottom ?? -Infinity,mediaBottom ?? -Infinity));
        if (roleBottom != null || hasShots) shotLaneLayoutVersion = 2;
        return roleBottom != null || hasShots;
      }

      function addAt(kind, clientX = viewport.clientWidth / 2, clientY = viewport.clientHeight / 2) {
        let parent = null;
        if (kind === 'shot') {
          const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
          if (!script) { toast('请先创建剧本名'); return; }
          parent = ensureShotGroupForScript(script);
        }
        const p = worldPoint(clientX, clientY);
        const offset = (nodesLayer.children.length % 6) * 22;
        const node = makeNode(kind, p.x - (kind === 'shot' ? 140 : 125) + offset, p.y - 76 + offset, parent ? { title: nextChildTitle(parent, kind) } : {});
        if (parent) {
          connections.push({ fromId: parent.dataset.id, toId: node.dataset.id });
          arrangeCanvasLanes(false);
          renderConnections(); save();
        }
        selectNode(node);
      }

      function closeConnectionMenu() {
        document.querySelector('.connection-menu')?.remove();
        pendingConnection = null;
        renderConnections();
      }

      function openCharacterNameDialog(clientX, clientY, initialValue, onConfirm) {
        document.querySelector('.character-name-dialog')?.remove();
        const dialog = document.createElement('div'); dialog.className = 'character-name-dialog';
        const header = document.createElement('div'); header.className = 'character-name-dialog-head';
        const title = document.createElement('div'); title.className = 'character-name-dialog-title'; title.textContent = '人物姓名';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'character-name-dialog-close'; cancel.textContent = '×'; cancel.title = '取消'; cancel.setAttribute('aria-label', '取消');
        const input = document.createElement('input'); input.type = 'text'; input.maxLength = 80; input.placeholder = '输入人物名字'; input.value = initialValue || '';
        const hint = document.createElement('div'); hint.className = 'character-name-dialog-hint'; hint.textContent = '按 Enter 确认 · Esc 取消';
        header.append(title, cancel); dialog.append(header, input, hint);
        dialog.addEventListener('pointerdown', e => e.stopPropagation());
        const close = () => dialog.remove();
        cancel.addEventListener('click', e => { e.stopPropagation(); close(); });
        input.addEventListener('keydown', e => {
          if (e.key === 'Escape') { e.preventDefault(); close(); }
          if (e.key === 'Enter') {
            e.preventDefault();
            const name = input.value.trim();
            if (!name) { input.focus(); return; }
            close(); onConfirm(name);
          }
        });
        viewport.append(dialog);
        const rect = dialog.getBoundingClientRect();
        dialog.style.left = `${Math.max(12, Math.min(clientX + 10, viewport.clientWidth - rect.width - 12))}px`;
        dialog.style.top = `${Math.max(12, Math.min(clientY + 10, innerHeight - rect.height - 12))}px`;
        input.focus(); input.select();
      }

      function isImageNode(node) {
        return node?.dataset.kind === 'asset' && (Boolean(node.querySelector('.asset-preview img')) ||
          isCanvasImageFile({name:node.dataset.assetPath || node.dataset.fileName || ''}));
      }

      async function copyNodeImage(node) {
        try {
          if (!window.canvasFiles?.copyImage) throw new Error('桌面程序中才能复制图片');
          let source = node.querySelector('.asset-preview img')?.src;
          if (node.dataset.assetPath) {
            const asset = await window.canvasFiles.loadProjectAsset({projectPath:node.dataset.projectPath || importedProjectPath,assetPath:node.dataset.assetPath});
            if (!asset?.ok || !asset.url) throw new Error(asset?.error || '图片无法读取');
            source = asset.url;
          }
          if (!source) throw new Error('图片暂不可读取');
          if (source.startsWith('file:')) {
            const result = await window.canvasFiles.copyImage(source);
            if (!result?.ok) throw new Error(result?.error || '复制失败');
            toast('已复制图片');
            return;
          }
          const response = await fetch(source);
          if (!response.ok) throw new Error('图片无法读取');
          const blob = await response.blob();
          let bytes;
          if (['image/png','image/jpeg'].includes(blob.type)) bytes = new Uint8Array(await blob.arrayBuffer());
          else {
            const bitmap = await createImageBitmap(blob);
            try {
              const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
              canvas.getContext('2d').drawImage(bitmap, 0, 0);
              const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
              if (!png) throw new Error('图片无法读取');
              bytes = new Uint8Array(await png.arrayBuffer());
            } finally { bitmap.close(); }
          }
          const result = await window.canvasFiles.copyImage(bytes);
          if (!result?.ok) throw new Error(result?.error || '复制失败');
          toast('已复制图片');
        } catch (error) { toast('复制失败：' + error.message); }
      }

      function openNodeContextMenu(node, clientX, clientY) {
        const kind = node.dataset.kind;
        if (['plot', 'style', 'person', 'shot-group'].includes(kind) ||
          (kind === 'script' && [...nodesLayer.children].some(child => ['person', 'shot-group'].includes(child.dataset.kind)))) return;
        document.querySelector('.connection-menu')?.remove();
        const menu = document.createElement('div'); menu.className = 'connection-menu';
        const title = document.createElement('div'); title.className = 'connection-menu-title';
        title.textContent = ({ character: '人物卡', shot: '场景', storyboard: '镜头', asset: '图片 / 素材', script: '剧本名' })[kind] || '节点';
        menu.append(title);
        if (isImageNode(node)) {
          const copy = document.createElement('button'); copy.type = 'button';
          copy.innerHTML = '<span class="connection-menu-icon">⧉</span><span>复制图片</span>';
          copy.addEventListener('click', event => { event.stopPropagation(); menu.remove(); copyNodeImage(node); });
          menu.append(copy);
          const reveal = document.createElement('button'); reveal.type = 'button';
          reveal.innerHTML = '<span class="connection-menu-icon">▱</span><span>打开文件所在文件夹</span>';
          reveal.addEventListener('click', async event => {
            event.stopPropagation(); menu.remove();
            try {
              if (!window.canvasFiles?.revealImage) throw new Error('桌面程序中才能打开文件夹');
              const result = await window.canvasFiles.revealImage({projectPath:node.dataset.projectPath || importedProjectPath,assetPath:node.dataset.assetPath,source:node.querySelector('.asset-preview img')?.src});
              if (!result?.ok) throw new Error(result?.error || '打开文件夹失败');
            } catch (error) { toast(error.message); }
          });
          menu.append(reveal);
          const library=document.createElement('button');library.textContent='导入素材库';
          library.onclick=event=>{event.stopPropagation();menu.remove();window.showReferenceCategoryPicker(async category=>{const result=await window.canvasFiles.saveReference({assetPath:node.dataset.assetPath,projectPath:node.dataset.projectPath || importedProjectPath,path:node.querySelector('.asset-preview img')?.src,category});if(!result.ok)throw new Error(result.error);toast('已存入素材库 · '+category);});};menu.append(library);
        }
        if (['shot', 'storyboard'].includes(kind)) {
          const rename = document.createElement('button'); rename.type = 'button';
          rename.innerHTML = '<span class="connection-menu-icon">✎</span><span>修改标题</span>';
          rename.addEventListener('click', event => {
            event.stopPropagation(); menu.remove(); enableTitleEditing(node);
          });
          menu.append(rename);
        }
        if (kind === 'character') {
          const rename = document.createElement('button'); rename.type = 'button'; rename.dataset.kind = 'character';
          rename.innerHTML = '<span class="connection-menu-icon">✎</span><span>修改姓名</span>';
          rename.addEventListener('click', e => {
            e.stopPropagation(); menu.remove();
            openCharacterNameDialog(clientX, clientY, node.querySelector('.node-title').textContent, name => {
              node.querySelector('.node-title').textContent = name; renderConnections(); save();
            });
          });
          menu.append(rename);
        }
        const deleteTargets = selectedCanvasNodes().length > 1 ? selectedCanvasNodes() : [node];
        const deleteBlocker = deletionBlocker(deleteTargets);
        const hasChildren = Boolean(deleteBlocker);
        const remove = document.createElement('button'); remove.type = 'button';
        remove.innerHTML = hasChildren
          ? '<span class="connection-menu-icon">•</span><span>' + deleteBlocker + '</span>'
          : '<span class="connection-menu-icon">×</span><span>' + (deleteTargets.length > 1 ? '删除选中 '+deleteTargets.length+' 个节点' : '删除节点') + '</span>';
        remove.disabled = hasChildren;
        if (!hasChildren) remove.addEventListener('click', e => { e.stopPropagation(); menu.remove(); removeNodes(deleteTargets); });
        menu.append(remove);
        menu.addEventListener('pointerdown', e => e.stopPropagation());
        viewport.append(menu);
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(12, Math.min(clientX, viewport.clientWidth - rect.width - 12))}px`;
        menu.style.top = `${Math.max(12, Math.min(clientY, innerHeight - rect.height - 12))}px`;
      }

      function openConnectionMenu(clientX, clientY, canvasPoint = null) {
        document.querySelector('.connection-menu')?.remove();
        const menu = document.createElement('div'); menu.className = 'connection-menu';
        const title = document.createElement('div'); title.className = 'connection-menu-title'; title.textContent = '添加节点'; menu.append(title);
        const menuSource = pendingConnection ? getNode(pendingConnection.fromId) : null;
        const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
        const choices = menuSource?.dataset.kind === 'shot-group' ? [['shot', '▧', '新场景']]
          : menuSource?.dataset.kind === 'shot' ? [['storyboard', '▤', '新镜头']]
            : menuSource ? [] : script ? [['shot', '▧', '新场景']] : [['script', 'T', '剧本名']];
        for (const [kind, icon, label] of choices) {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.kind = kind;
          button.innerHTML = `<span class="connection-menu-icon">${icon}</span><span>${label}</span>`;
          menu.append(button);
        }
        menu.addEventListener('pointerdown', event => event.stopPropagation());
        menu.addEventListener('click', event => {
          const button = event.target.closest('button');
          if (!button) return;
          event.stopPropagation();
          if (!button.dataset.kind) { closeConnectionMenu(); return; }
          const pending = pendingConnection;
          if (!pending && !canvasPoint) { closeConnectionMenu(); return; }
          const source = pending ? getNode(pending.fromId) : null;
          if (pending && !source) { closeConnectionMenu(); return; }
          const parent = source || (button.dataset.kind === 'shot' && script ? ensureShotGroupForScript(script) : null);
          const point = pending?.point || canvasPoint;
          let side = null;
          let x = point.x, y = point.y;
          if (pending) {
            const center = nodeCenter(source);
            const dx = point.x - center.x, dy = point.y - center.y;
            side = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
            x += side === 'right' ? 24 : side === 'left' ? -24 : 0;
            y += side === 'bottom' ? 24 : side === 'top' ? -24 : 0;
          }
          const newKind = button.dataset.kind;
          const nodeTitle = parent && ['shot', 'storyboard'].includes(newKind) ? nextChildTitle(parent, newKind) : undefined;
          const node = makeNode(newKind, x, y, nodeTitle ? { title: nodeTitle } : {});
          if (pending) {
            if (side === 'left') x = point.x - node.offsetWidth - 24;
            if (side === 'top') y = point.y - node.offsetHeight - 24;
            if (side === 'right' || side === 'left') y = point.y - node.offsetHeight / 2;
            else x = point.x - node.offsetWidth / 2;
            connections.push({ fromId: pending.fromId, toId: node.dataset.id });
          } else {
            x = point.x - node.offsetWidth / 2;
            y = point.y - node.offsetHeight / 2;
            if (parent) connections.push({ fromId: parent.dataset.id, toId: node.dataset.id });
          }
          node.dataset.x = x; node.dataset.y = y; node.style.left = `${x}px`; node.style.top = `${y}px`;
          if (button.dataset.kind === 'script') {
            ensurePlotForScript(node, true);
            ensureStyleForScript(node, true);
            ensureRoleForScript(node, true);
            ensureShotGroupForScript(node, true);
          }
          if (parent?.dataset.kind === 'shot-group') parent.classList.remove('children-collapsed');
          if (parent?.dataset.kind === 'shot' && newKind === 'storyboard') parent.classList.remove('collapsed', 'children-collapsed');
          if (shotLaneLayoutVersion && ['script', 'shot', 'storyboard', 'character'].includes(newKind)) arrangeCanvasLanes(false);
          pendingConnection = null; menu.remove(); selectNode(node); renderConnections(); save();
        });
        viewport.append(menu);
        const menuRect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(12, Math.min(clientX + 12, viewport.clientWidth - menuRect.width - 12))}px`;
        menu.style.top = `${Math.max(12, Math.min(clientY + 12, innerHeight - menuRect.height - 12))}px`;
      }

      function completeConnectionDrag(event) {
        if (!connectionDrag || connectionDrag.pointerId !== event.pointerId) return;
        const drag = connectionDrag;
        drag.hoverTarget?.classList.remove('reference-connect-target');
        connectionDrag = null;
        if (!drag.moved) { renderConnections(); return; }
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.node');
        const source = getNode(drag.fromId);
        if (drag.referenceOnly && !canConnectFromNodeBody(source, target)) {
          renderConnections(); return;
        }
        if (target && target.dataset.id !== drag.fromId) {
          if (!canConnectNodes(source, target)) {
            renderConnections(); toast(connectionErrorMessage(source, target)); return;
          }
          if (!connections.some(connection => connection.fromId === drag.fromId && connection.toId === target.dataset.id)) {
            connections.push({ fromId: drag.fromId, toId: target.dataset.id });
            if (source?.dataset.kind === 'storyboard' && target.dataset.kind === 'asset' && isCanvasImageFile({name:target.dataset.assetPath || target.dataset.fileName || target.querySelector('.node-title')?.textContent || ''}) && !target.dataset.imageRole) {
              target.dataset.imageRole = 'storyboard-reference'; target.classList.add('image-only');
            }
          }
          if (source?.dataset.kind === 'storyboard' && target.dataset.kind === 'asset') source.classList.remove('collapsed','children-collapsed');
          if (source?.dataset.kind === 'shot' && target.dataset.kind === 'storyboard') source.classList.remove('collapsed', 'children-collapsed');
          if (shotLaneLayoutVersion && ['shot', 'storyboard', 'character', 'asset'].includes(target.dataset.kind)) arrangeCanvasLanes(false);
          renderConnections(); save(); return;
        }
        if (target?.dataset.id === drag.fromId) { renderConnections(); return; }
        const point = worldPoint(event.clientX, event.clientY);
        if (['plot', 'style'].includes(source?.dataset.kind)) { renderConnections(); toast('剧情梗概和画风节点不能创建下级节点'); return; }
        if (source?.dataset.kind === 'person') {
          openCharacterNameDialog(event.clientX, event.clientY, '', name => {
            const character = makeNode('character', point.x, point.y, { title: name });
            const y = point.y - character.offsetHeight / 2;
            character.dataset.y = y; character.style.top = `${y}px`;
            source.classList.remove('children-collapsed');
            connections.push({ fromId: source.dataset.id, toId: character.dataset.id });
            if (shotLaneLayoutVersion) arrangeCanvasLanes(false);
            selectNode(character); renderConnections(); save();
          });
          renderConnections(); return;
        }
        if (['character','storyboard'].includes(source?.dataset.kind)) {
          pendingCharacterImage = { characterId: source.dataset.id, point };
          characterImageInput.accept = source.dataset.kind === 'character' ? 'image/jpeg,image/png,.jpg,.jpeg,.png' : 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif';
          characterImageInput.value = ''; characterImageInput.click(); renderConnections(); return;
        }
        if (!source || !['shot-group', 'shot'].includes(source.dataset.kind)) {
          renderConnections(); toast('请从“场景”主节点创建场景，或从场景创建镜头'); return;
        }
        pendingConnection = { fromId: drag.fromId, point };
        renderConnections();
        openConnectionMenu(event.clientX, event.clientY);
      }

      async function importFiles(files, clientX, clientY) {
        return runCanvasAction('导入素材',async()=>{
        const p = worldPoint(clientX, clientY);
        const images = [...files].filter(isCanvasImageFile);
        if (images.length) await importCanvasImages(images, {x:p.x - 135,y:p.y - 65});
        const videos=[...files].filter(isCanvasVideoFile);
        if(videos.length) await importCanvasVideos(videos,{x:p.x-135,y:p.y-65});
        const audio=[...files].filter(isCanvasAudioFile);
        if(audio.length)await importCanvasAudio(audio,{x:p.x-135,y:p.y-65});
        const otherFiles = [...files].filter(file => !isCanvasImageFile(file) && !isCanvasVideoFile(file) && !isCanvasAudioFile(file));
        otherFiles.forEach((file, i) => {
          const offset = i * 26;
          makeNode('asset', p.x - 135 + offset, p.y - 65 + offset, { title: file.name, fileName: file.name, file });
        });
        if (otherFiles.length) toast(`已添加 ${otherFiles.length} 个素材`);
        });
      }

      const CANVAS_FORMAT = 'white-canvas-video-project';
      const canvasUndoStack = [];
      const canvasRedoStack = [];
      let canvasUndoCheckpoint = null;
      let canvasUndoSignature = '';
      let canvasUndoRestoring = false;
      let canvasHistoryBusy = false;
      const canvasActionTokens = new Set();
      let canvasActionSnapshot = null;

      function canvasHistorySnapshots() {
        return [...canvasUndoStack,...canvasRedoStack,canvasUndoCheckpoint,canvasActionSnapshot].filter(Boolean);
      }
      function canvasHistoryAssetReferences(snapshots = canvasHistorySnapshots()) {
        const refs=new Map();
        for(const snapshot of snapshots)for(const record of snapshot.nodes){
          const projectPath=record.data.projectPath || snapshot.projectSource?.path,assetPath=record.data.assetPath;
          if(projectPath && assetPath)refs.set(JSON.stringify([projectPath,assetPath]),{projectPath,assetPath});
        }
        return [...refs.values()];
      }
      function rewriteCanvasHistoryAssets(assets,snapshots) {
        const projectKey=value=>String(value || '').replace(/\\/g,'/').toLowerCase();
        for(const asset of assets){
          const matches=(record,snapshot)=>projectKey(record.data.projectPath || snapshot.projectSource?.path)===projectKey(asset.projectPath) && record.data.assetPath===asset.assetPath;
          const elements=new Set(snapshots.flatMap(snapshot=>snapshot.nodes.filter(record=>matches(record,snapshot)).map(record=>record.el)).filter(Boolean));
          // Position/text edits during the write may capture this same immutable asset.
          // A newly imported same-name asset has another element and must stay untouched.
          const requested=new Set(snapshots);
          for(const snapshot of new Set([...snapshots,...canvasHistorySnapshots()]))for(const record of snapshot.nodes){
            if(matches(record,snapshot) && (requested.has(snapshot) || elements.has(record.el)))record.data.assetPath=asset.pinnedPath;
          }
        }
      }
      function refreshCanvasUndoCheckpoint() {
        // Saving may normalize asset filenames; that bookkeeping is not a user action.
        if(!canvasActionTokens.size && !canvasUndoRestoring){
          canvasUndoCheckpoint=captureCanvasSnapshot();
          canvasUndoSignature=canvasUndoStateSignature({nodes:canvasRecords(),connections});
        }
      }
      function normalizeCanvasUndoCheckpoint(assets, savedState) {
        if(!canvasUndoCheckpoint)return;
        for(const asset of assets){
          const original=savedState.nodes.find(record=>record.id===asset.id);
          const record=canvasUndoCheckpoint.nodes.find(record=>record.data.id===asset.id);
          const plain=canvasUndoCheckpoint.records?.find(record=>record.id===asset.id);
          if(!original || !record || record.data.assetPath!==original.assetPath || (record.data.projectPath || '')!==(original.projectPath || ''))continue;
          record.data.assetPath=asset.assetPath;record.data.projectPath=asset.projectPath;
          if(plain){plain.assetPath=asset.assetPath;plain.projectPath=asset.projectPath;}
          if(asset.fileName){record.fileName=asset.fileName;record.data.fileName=asset.fileName;if(plain)plain.fileName=asset.fileName;}
        }
        if(canvasUndoCheckpoint.records)canvasUndoSignature=canvasUndoStateSignature({nodes:canvasUndoCheckpoint.records,connections:canvasUndoCheckpoint.connections});
      }
      function beginCanvasAction(label = '') {
        if(!canvasActionTokens.size){
          recordCanvasUndo({nodes:canvasRecords(),connections});
          canvasActionSnapshot=captureCanvasSnapshot();
        }
        const token={label};canvasActionTokens.add(token);return token;
      }
      function endCanvasAction(token) {
        if(!canvasActionTokens.delete(token) || canvasActionTokens.size)return;
        const before=canvasActionSnapshot;canvasActionSnapshot=null;
        recordCanvasUndo({nodes:canvasRecords(),connections},before);
      }
      function cancelCanvasAction(token) { endCanvasAction(token); }
      async function runCanvasAction(label,callback) {
        const token=beginCanvasAction(label);
        try{return await callback();}finally{endCanvasAction(token);}
      }

      async function pruneUndoHistory(){
        if(!window.canvasFiles?.pruneUndoAssets)return;
        const projects=new Map();
        const collect=(project,asset)=>{if(!project || !asset?.startsWith('assets/.undo/'))return;if(!projects.has(project))projects.set(project,new Set());projects.get(project).add(asset);};
        for(const snapshot of canvasHistorySnapshots())for(const record of snapshot.nodes)collect(record.data.projectPath || snapshot.projectSource?.path,record.data.assetPath);
        for(const node of nodesLayer.children)collect(node.dataset.projectPath || importedProjectPath,node.dataset.assetPath);
        const result=await window.canvasFiles.pruneUndoAssets({projects:[...projects].map(([path,paths])=>({path,paths:[...paths]}))});if(!result.ok)console.warn('撤销副本清理失败',result.error);
      }
      function canvasUndoStateSignature(state) {
        return JSON.stringify({nodes:state.nodes, connections:state.connections});
      }

      function recordCanvasUndo(state, before = null) {
        if (canvasUndoRestoring || canvasActionTokens.size) return;
        const signature = canvasUndoStateSignature(state);
        if (canvasUndoCheckpoint && signature !== canvasUndoSignature) {
          canvasUndoStack.push(before || canvasUndoCheckpoint);
          if (canvasUndoStack.length > 100) canvasUndoStack.shift();
          canvasRedoStack.length=0;
        }
        canvasUndoCheckpoint=captureCanvasSnapshot();
        canvasUndoSignature=signature;
      }

      function validateImageReference(reference, owner, characterImage = false, canvasAsset = false) {
        const allowedFields = characterImage ? ['path', 'label'] : ['path', 'label', 'time'];
        if (!reference || typeof reference !== 'object' || Array.isArray(reference) || Object.keys(reference).some(key => !allowedFields.includes(key))) return `${owner} 的图片引用格式无效。`;
        const assetPath = reference.path;
        const normalized = typeof assetPath === 'string' ? assetPath.replace(/\\/g, '/') : '';
        const segments = normalized.split('/');
        if (!normalized || normalized.length > 1000 || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || segments.includes('..') || /[<>:"|?*\u0000]/.test(normalized)) return `${owner} 的图片必须使用项目目录内的相对路径。`;
        const imageExtension = /\.(jpe?g|png|webp|gif)$/i.test(normalized) || (canvasAsset && /\.(mp4|webm|mov|wav|mp3|m4a|aac|ogg|flac)$/i.test(normalized));
        if (!imageExtension || (characterImage && !/\.(jpe?g|png)$/i.test(normalized))) return characterImage ? `${owner} 的角色设定图只支持 JPG 或 PNG。` : `${owner} 只支持 JPG、PNG、WebP 或 GIF 图片。`;
        if (reference.label !== undefined && (typeof reference.label !== 'string' || reference.label.length > 200)) return `${owner} 的图片名称无效。`;
        if (reference.time !== undefined && reference.time !== null && (typeof reference.time !== 'string' || reference.time.length > 80)) return `${owner} 的关键帧时间无效。`;
        return '';
      }

      function isValidCodexConversation(source) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
        if (Object.keys(source).some(key => !['threadId', 'hostId', 'threadTitle', 'projectName'].includes(key))) return false;
        if (typeof source.threadId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.threadId)) return false;
        if (source.hostId !== undefined && source.hostId !== 'local') return false;
        return ['threadTitle', 'projectName'].every(key => source[key] === undefined || (typeof source[key] === 'string' && source[key].length <= 300));
      }

      function validateCanvasProject(project) {
        if (!project || typeof project !== 'object' || Array.isArray(project) || project.format !== CANVAS_FORMAT || ![1, 2, 3].includes(project.version)) return 'JSON 格式或版本不匹配。';
        if (Object.keys(project).some(key => !['format', 'version', 'project', 'synopsis', 'visualStyle', 'characters', 'shots', 'storyboards', 'canvas'].includes(key))) return 'JSON 包含画布不需要的字段；请只保留项目名、剧情、画风、角色、场景和镜头资料。';
        if (project.version === 1 && project.storyboards !== undefined) return 'v1 JSON 的提示词和图片需要放在场景字段中；如要单独使用镜头节点，请改为 v2 格式。';
        if (!project.project || typeof project.project !== 'object' || Array.isArray(project.project) || Object.keys(project.project).some(key => !['title', 'codex'].includes(key)) || typeof project.project.title !== 'string' || project.project.title.length > 300) return '项目标题格式无效。';
        if (project.project.codex !== undefined && !isValidCodexConversation(project.project.codex)) return 'project.codex 会话标记无效；需要真实 threadId，hostId 目前仅支持 local。';
        if (typeof project.synopsis !== 'string' || project.synopsis.length > 50000) return 'synopsis 必须是 50000 字以内的剧情梗概文本。';
        if (project.visualStyle !== undefined && (typeof project.visualStyle !== 'string' || project.visualStyle.length > 50000)) return 'visualStyle 必须是 50000 字以内的画风提示词。';
        if (!Array.isArray(project.characters) || project.characters.length > 100) return 'characters 必须是 100 个以内的角色数组。';
        if (!Array.isArray(project.shots) || project.shots.length > 300) return 'shots 必须是 300 个以内的场景数组。';
        if (project.version >= 2 && (!Array.isArray(project.storyboards) || project.storyboards.length > 500)) return 'storyboards 必须是 500 个以内的镜头数组。';
        if (project.canvas !== undefined) {
          const c=project.canvas;
          if(!c || !Array.isArray(c.nodes) || c.nodes.length>2000 || !Array.isArray(c.connections) || c.connections.length>4000 || !c.view || !Number.isFinite(c.view.x) || !Number.isFinite(c.view.y) || !Number.isFinite(c.view.scale) || c.view.scale<=0) return '画布布局格式无效';
          const canvasIds=new Set();
          for(const n of c.nodes) {
            if(!n || typeof n.id!=='string' || !(n.id==='__shot-group'||/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(n.id)) || canvasIds.has(n.id) || !['script','plot','style','person','shot-group','character','shot','storyboard','asset','prompt','text','cover-group','video-group','bgm-group'].includes(n.kind) || !Number.isFinite(n.x) || !Number.isFinite(n.y)) return '画布节点格式无效';
            canvasIds.add(n.id);
            if(n.assetPath) {const error=validateImageReference({path:n.assetPath},n.id,false,true);if(error)return error;}
            if(n.projectPath!==undefined) return '画布布局不得保存绝对项目路径';
            if(n.text!==undefined&&(typeof n.text!=='string'||n.text.length>50000))return '画布节点正文格式无效';
          }
          for(const e of c.connections) if(!e||!canvasIds.has(e.fromId)||!canvasIds.has(e.toId)||e.fromId===e.toId)return '画布连线引用无效';
        }
        const ids = new Set(['script', 'plot', 'style', 'roles', '__shot-group']); let totalText = project.project.title.length + project.synopsis.length + (project.visualStyle || '').length, totalImages = 0;
        const validateId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id) && !ids.has(id);
        for (const character of project.characters) {
          if (!character || typeof character !== 'object' || Array.isArray(character) || Object.keys(character).some(key => !['id', 'name', 'setting', 'referenceImages'].includes(key))) return '角色只支持 id、name、setting 和 referenceImages 字段。';
          if (!validateId(character.id)) return '角色 ID 必须唯一、使用英文数字或 - _ .，且不能占用 script、plot、roles。';
          if (typeof character.name !== 'string' || !character.name.trim() || character.name.length > 300) return `${character.id} 的角色名无效。`;
          if (character.setting !== undefined && (typeof character.setting !== 'string' || character.setting.length > 50000)) return `${character.id} 的角色设定无效。`;
          if (character.referenceImages !== undefined && (!Array.isArray(character.referenceImages) || character.referenceImages.length > 80)) return `${character.id} 的 referenceImages 格式无效。`;
          for (const reference of character.referenceImages || []) { const error = validateImageReference(reference, character.id, true); if (error) return error; totalImages++; totalText += (reference.label || '').length; }
          ids.add(character.id); totalText += character.name.length + (character.setting || '').length;
        }
        for (const shot of project.shots) {
          const legacyFields = project.version === 1 ? ['prompt', 'keyframes', 'referenceImages'] : [];
          if (!shot || typeof shot !== 'object' || Array.isArray(shot) || Object.keys(shot).some(key => !['id', 'title', 'time', 'duration', 'description', ...legacyFields].includes(key))) return '场景只支持 id、title、time、duration 和 description 字段；提示词与图片应放入 storyboards。';
          if (!validateId(shot.id)) return '场景 ID 必须唯一、使用英文数字或 - _ .，且不能占用 script、plot、roles。';
          for (const field of ['title', 'time', 'duration', 'description', ...(project.version === 1 ? ['prompt'] : [])]) {
            const max = field === 'description' || field === 'prompt' ? 50000 : 300;
            if (field === 'time' && shot[field] === null) continue;
            if (shot[field] !== undefined && (typeof shot[field] !== 'string' || shot[field].length > max)) return `${shot.id} 的 ${field} 格式无效。`;
          }
          for (const field of (project.version === 1 ? ['keyframes', 'referenceImages'] : [])) {
            if (shot[field] !== undefined && (!Array.isArray(shot[field]) || shot[field].length > 80)) return `${shot.id} 的 ${field} 格式无效。`;
            for (const reference of shot[field] || []) { const error = validateImageReference(reference, shot.id); if (error) return error; totalImages++; totalText += (reference.label || '').length + (reference.time || '').length; }
          }
          ids.add(shot.id); totalText += ['title', 'time', 'duration', 'description', ...(project.version === 1 ? ['prompt'] : [])].reduce((sum, field) => sum + (shot[field] || '').length, 0);
        }
        const storyboards = project.version >= 2 ? project.storyboards : [];
        const shotIds = new Set(project.shots.map(shot => shot.id));
        for (const board of storyboards) {
          if (!board || typeof board !== 'object' || Array.isArray(board) || Object.keys(board).some(key => !['id', 'shotId', 'title', 'prompt', 'keyframes', 'referenceImages'].includes(key))) return '镜头只支持 id、shotId、title、prompt、keyframes 和 referenceImages 字段。';
          if (!validateId(board.id)) return '镜头 ID 必须唯一、使用英文数字或 - _ .。';
          if (typeof board.shotId !== 'string' || !shotIds.has(board.shotId)) return `${board.id} 必须通过 shotId 连接到已存在的场景。`;
          for (const field of ['title', 'prompt']) if (board[field] !== undefined && (typeof board[field] !== 'string' || board[field].length > 50000)) return `${board.id} 的 ${field} 格式无效。`;
          for (const field of ['keyframes', 'referenceImages']) {
            if (board[field] !== undefined && (!Array.isArray(board[field]) || board[field].length > 80)) return `${board.id} 的 ${field} 格式无效。`;
            for (const reference of board[field] || []) { const error = validateImageReference(reference, board.id); if (error) return error; totalImages++; totalText += (reference.label || '').length + (reference.time || '').length; }
          }
          ids.add(board.id); totalText += (board.title || '').length + (board.prompt || '').length;
        }
        if (totalImages > 500) return '项目图片引用不能超过 500 个。';
        if (totalText > 1000000) return '项目文字总量超过 100 万字符。';
        return '';
      }

      function canvasAssetId(parentId, imageRole, assetPath, usedIds) {
        let hash = 2166136261;
        for (const char of assetPath) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
        const base = `asset-${parentId}-${imageRole}-${(hash >>> 0).toString(36)}`;
        let id = base, suffix = 1;
        while (usedIds.has(id)) id = `${base}-${suffix++}`;
        usedIds.add(id);
        return id;
      }

      function projectStoryboards(project) {
        if (project.version >= 2) return project.storyboards;
        return project.shots
          .map((shot, index) => ({ id: `legacy-storyboard-${index + 1}`, shotId: shot.id, title: `镜头 · ${shot.title || `场景 ${index + 1}`}`, prompt: shot.prompt || '', keyframes: shot.keyframes || [], referenceImages: shot.referenceImages || [] }));
      }

      function videoProjectToCanvasRecords(project, base, projectFilePath = '', arrange = true) {
        const records = [
          { id: 'script', type: 'script', title: project.project.title },
          { id: 'plot', type: 'plot', title: '剧情梗概', text: project.synopsis },
          { id: 'style', type: 'style', title: '画风', text: project.visualStyle || '' },
          { id: 'roles', type: 'person', title: '角色' },
          { id: '__shot-group', type: 'shot-group', title: '场景', ...(arrange ? { position: { x: base.x + 430, y: base.y + 190 } } : {}) }
        ];
        const edges = [{ from: 'script', to: 'plot' }, { from: 'script', to: 'style' }, { from: 'script', to: 'roles' }, { from: 'script', to: '__shot-group' }];
        const storyboards = projectStoryboards(project);
        const usedIds = new Set(['script', 'plot', 'style', 'roles', '__shot-group', ...project.characters.map(item => item.id), ...project.shots.map(item => item.id), ...storyboards.map(item => item.id)]);
        const imageName = reference => `${reference.time ? `${reference.time} · ` : ''}${reference.label || reference.path.replace(/\\/g, '/').split('/').pop()}`;
        const addImages = (parentId, references, imageRole) => {
          for (const reference of references || []) {
            const id = canvasAssetId(parentId, imageRole, reference.path, usedIds);
            const fileName = imageName(reference);
            records.push({ id, type: 'asset', title: fileName, fileName, assetPath: reference.path, projectPath: projectFilePath, imageRole, parentId });
            edges.push({ from: parentId, to: id });
          }
        };
        const charBase = { x: base.x + 350, y: base.y + 220 };
        let charY = charBase.y;
        project.characters.forEach((character, index) => {
          const y = charY;
          records.push({ id: character.id, type: 'character', title: character.name, text: character.setting || '', ...(arrange ? { position: { x: charBase.x, y } } : {}) });
          edges.push({ from: 'roles', to: character.id });
          const beforeImages = records.length;
          addImages(character.id, character.referenceImages, 'character-setting');
          const imageCount = records.length - beforeImages;
          if (arrange) records.slice(beforeImages).forEach((record, imageIndex) => { record.position = { x: charBase.x + 360, y: y + imageIndex * 58 }; });
          charY += Math.max(210, imageCount * 58 + 30) + 20;
        });
        const shotBase = { x: base.x + 760, y: base.y + 190 };
        let shotY = shotBase.y;
        const boardByShot = new Map();
        storyboards.forEach(board => {
          if (!boardByShot.has(board.shotId)) boardByShot.set(board.shotId, []);
          boardByShot.get(board.shotId).push(board);
        });
        project.shots.forEach((shot, index) => {
          const y = shotY;
          const shotBoards = boardByShot.get(shot.id) || [];
          const lines = [];
          if (shot.time) lines.push(`时间：${shot.time}`);
          if (shot.duration) lines.push(`时长：${shot.duration}`);
          if (shot.description) lines.push(`画面：${shot.description}`);
          const rawShotTitle = (shot.title || '').trim();
          const shotTitle = /^(?:场景|镜头)\s*0*\d+/.test(rawShotTitle) ? rawShotTitle : `场景${String(index + 1).padStart(2, '0')}${rawShotTitle ? ` · ${rawShotTitle}` : ''}`;
          records.push({ id: shot.id, type: 'shot', title: shot.time ? `${shotTitle} · ${shot.time}` : shotTitle, text: lines.join('\n'), duration: shot.duration || '', ...(arrange ? { position: { x: shotBase.x, y } } : {}) });
          edges.push({ from: '__shot-group', to: shot.id });
          let imageCount = 0;
          shotBoards.forEach((board, boardIndex) => {
            const boardX = shotBase.x + 360;
            const boardY = y + boardIndex * 58;
            const rawBoardTitle = (board.title || '').trim();
            const boardDescription = rawBoardTitle.replace(/^(?:镜头|分镜)\s*[·:：|｜-]?\s*/, '');
            const boardTitle = /^(?:镜头|分镜)\s*0*\d+/.test(rawBoardTitle) ? rawBoardTitle : `镜头${String(boardIndex + 1).padStart(2, '0')}${boardDescription ? ` · ${boardDescription}` : ''}`;
            records.push({ id: board.id, type: 'storyboard', title: boardTitle, text: board.prompt || '', ...(arrange ? { position: { x: boardX, y: boardY } } : {}) });
            edges.push({ from: shot.id, to: board.id });
            const beforeImages = records.length;
            addImages(board.id, board.keyframes, 'storyboard-keyframe');
            addImages(board.id, board.referenceImages, 'storyboard-reference');
            const boardImages = records.length - beforeImages;
            imageCount += boardImages;
            if (arrange) records.slice(beforeImages).forEach((record, imageIndex) => { record.position = { x: boardX + 360, y: y + (imageCount - boardImages + imageIndex) * 58 }; });
          });
          shotY += Math.max(210, shotBoards.length * 58 + 30, imageCount * 58 + 30) + 20;
        });
        return { records, edges };
      }

      function captureCanvasSnapshot() {
        return {
          records:canvasRecords(),
          manualLayout:typeof captureManualCanvasLayout==='function'?captureManualCanvasLayout():null,
          nodes: [...nodesLayer.children].map(el => ({
            el, data: { ...el.dataset }, className: el.className, style: el.getAttribute('style'),
            title: el.querySelector('.node-title')?.textContent ?? null,
            text: el.querySelector('.node-body') ? getBodyText(el.querySelector('.node-body')) : null,
            fileName: el.querySelector('.asset-name')?.textContent ?? null,
            includeInChat: el.dataset.includeInChat === 'true'
          })),
          connections: connections.map(edge => ({ ...edge })), view: { ...view }, shotLaneLayoutVersion,
          projectSource: { path: importedProjectPath, codex: importedCodexConversation, fingerprint: importedProjectFingerprint, canvasFingerprint: importedCanvasFingerprint }
        };
      }

      function restoreCanvasSnapshot(snapshot, options = {}) {
        const contentBefore=canvasContentSignature();
        const retainedView=options.preserveView && importedProjectPath===(snapshot.projectSource?.path || '') ? {...view} : null;
        nodesLayer.replaceChildren();
        for (const record of snapshot.nodes) {
          const el = record.el;
          const assetChanged = el.dataset.assetPath !== record.data.assetPath || el.dataset.projectPath !== record.data.projectPath;
          for (const key of Object.keys(el.dataset)) delete el.dataset[key];
          Object.assign(el.dataset, record.data);
          el.className = record.className;
          if (record.style == null) el.removeAttribute('style'); else el.setAttribute('style', record.style);
          if (record.title != null) { const title = el.querySelector('.node-title'); if (title) title.textContent = record.title; }
          if (record.text != null) setBodyText(el.querySelector('.node-body'), record.text);
          if (record.fileName != null) { const name = el.querySelector('.asset-name'); if (name) name.textContent = record.fileName; }
          if (el.dataset.kind === 'shot') {
            const meta = el.querySelector('.shot-meta');
            if (meta) meta.textContent = el.dataset.duration ? `建议时长 · ${el.dataset.duration}` : '场景 / 时长 / 机位';
          }
          if(record.includeInChat != null)el.dataset.includeInChat=record.includeInChat?'true':'false';
          nodesLayer.append(el);
          if (assetChanged && el.dataset.kind === 'asset') {
            const preview = el.querySelector('.asset-preview');
            if (preview) {
              pendingProjectAssets.delete(preview); projectAssetObserver?.unobserve(preview);
              preview.replaceChildren();
              if (el.dataset.assetPath && el.dataset.projectPath) queueProjectAsset(preview, el.dataset.assetPath, el.dataset.projectPath);
              else preview.textContent = '本地素材';
            }
          }
        }
        connections = snapshot.connections.map(edge => ({ ...edge }));
        view = retainedView || { ...snapshot.view };
        shotLaneLayoutVersion = snapshot.shotLaneLayoutVersion || 0;
        importedProjectPath = snapshot.projectSource?.path || '';
        importedCodexConversation = isValidCodexConversation(snapshot.projectSource?.codex) ? { ...snapshot.projectSource.codex } : null;
        importedProjectFingerprint = snapshot.projectSource?.fingerprint || '';
        importedCanvasFingerprint = snapshot.projectSource?.canvasFingerprint || '';
        if(typeof restoreManualCanvasLayout==='function')restoreManualCanvasLayout(snapshot.manualLayout);
        applyView(); renderConnections();
        if(contentBefore===canvasContentSignature())return canvasSaveQueue;
        return save({skipUndo:true,strict:true}); }

      function setCanvasUndoSnapshot(snapshot) {
        // Legacy callers already saved synchronously; use their pre-operation snapshot
        // only if no save recorded the mutation yet.
        if(canvasUndoStateSignature({nodes:canvasRecords(),connections})!==canvasUndoSignature)
          recordCanvasUndo({nodes:canvasRecords(),connections},snapshot);
      }

      async function travelCanvasHistory(redo = false) {
        if(nodeDeletionPending || canvasHistoryBusy || canvasActionTokens.size){toast('正在处理画布修改，请稍后');return false;}
        canvasHistoryBusy=true;
        try {
          await canvasSaveQueue;
          const source=redo?canvasRedoStack:canvasUndoStack,target=redo?canvasUndoStack:canvasRedoStack;
          const snapshot=source.pop();if(!snapshot)return false;
          target.push(captureCanvasSnapshot());
          canvasUndoRestoring=true;
          try {
            const saved=restoreCanvasSnapshot(snapshot,{preserveView:true});
            canvasUndoRestoring=false;
            canvasUndoCheckpoint=captureCanvasSnapshot();
            canvasUndoSignature=canvasUndoStateSignature({nodes:canvasRecords(),connections});
            await saved;
          }
          catch(error){toast('画布已恢复，但保存失败：'+error.message);}
          finally {canvasUndoRestoring=false;}
          toast(redo?'已重做上一次节点修改':'已撤销上一次节点修改');return true;
        } finally {canvasHistoryBusy=false;}
      }
      function undoLastCanvasChange() { return travelCanvasHistory(false); }
      function redoLastCanvasChange() { return travelCanvasHistory(true); }

      function defaultProjectPosition(type, base, counts) {
        const index = counts[type] || 0; counts[type] = index + 1;
        const positions = {
          script: { x: base.x - 150, y: base.y - 130 }, plot: { x: base.x + 430, y: base.y - 110 }, style: { x: base.x + 430, y: base.y + 20 }, person: { x: base.x - 50, y: base.y + 210 },
          character: { x: base.x + 350, y: base.y + 220 + index * 190 }, 'shot-group': { x: base.x + 430, y: base.y + 190 }, shot: { x: base.x + 760, y: base.y + 190 + index * 190 },
          storyboard: { x: base.x + 1120, y: base.y + 190 + index * 190 }, prompt: { x: base.x + 1110, y: base.y + 190 + index * 190 }, text: { x: base.x + 430, y: base.y + 300 + index * 190 },
          asset: { x: base.x + 1100, y: base.y + 300 + index * 190 }
        };
        return positions[type] || { x: base.x + index * 40, y: base.y + index * 40 };
      }

      function importCanvasProject(project, projectFilePath, base, replace = true, options = {}) {
        const validationError = validateCanvasProject(project);
        if (validationError) { toast(`无法导入：${validationError}`); return false; }
        if (replace && nodesLayer.children.length && !options.skipConfirmation && !confirm('导入完整项目会替换当前画布中的节点和连接。是否继续？')) return false;
        const previousNodes = options.refresh ? new Map(canvasRecords().map(record => [record.id, record])) : null;
        const previousSelection = options.refresh ? nodesLayer.querySelector('.node.selected')?.dataset.id : '';
        const snapshot = captureCanvasSnapshot();
        if (replace) { nodesLayer.replaceChildren(); connections = []; }
        const counts = {}, idMap = new Map();
        const mapped = videoProjectToCanvasRecords(project, base, projectFilePath, true);
        for (const record of mapped.records) {
          const fallback = defaultProjectPosition(record.type, base, counts);
          const position = record.position || fallback;
          const assetPath = record.assetPath || '';
          const previous = previousNodes?.get(record.id);
          const presentation = previous?.kind === record.type ? previous : null;
          const nodeOptions = {
            id: record.id, title: record.title, text: record.text, duration: record.duration,
            fileName: record.fileName, assetPath, projectPath: assetPath ? projectFilePath : '', imageRole: record.imageRole,
            autoPosition: record.type === 'shot-group' ? 'true' : record.position && ['plot', 'style', 'person'].includes(record.type) ? 'false' : (['plot', 'style', 'person'].includes(record.type) ? 'true' : ''),
            previewText: assetPath ? '读取项目素材…' : '项目素材',
            includeInChat: presentation?.includeInChat === true,
            collapsed: presentation?.collapsed ?? !['script', 'person', 'shot-group'].includes(record.type),
            childrenCollapsed: presentation?.childrenCollapsed ?? (record.type === 'shot-group'),
            width: presentation?.width, height: presentation?.height,
            imageZoom: presentation?.imageZoom, imagePanX: presentation?.imagePanX, imagePanY: presentation?.imagePanY
          };
          const node = makeNode(record.type, position.x, position.y, { ...nodeOptions, silent: true });
          idMap.set(record.id, node.dataset.id);
        }
        for (const edge of mapped.edges) {
          const from = getNode(idMap.get(edge.from)), to = getNode(idMap.get(edge.to));
          if (from && to && canConnectNodes(from, to) && !connections.some(existing => existing.fromId === from.dataset.id && existing.toId === to.dataset.id)) {
            connections.push({ fromId: from.dataset.id, toId: to.dataset.id });
          }
        }
        const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
        if (script) { ensurePlotForScript(script, false, true); ensureStyleForScript(script, false, true); ensureRoleForScript(script, false, true); ensureShotGroupForScript(script, false, true); }
        ensureProjectMediaNodes();
        arrangeCanvasLanes(true);
        const selectedNode = previousSelection ? getNode(previousSelection) : null;
        if (selectedNode || script) selectNode(selectedNode || script);
        renderConnections(); if (replace) {
          importedProjectPath = projectFilePath || '';
          importedCodexConversation = project.project.codex ? { ...project.project.codex } : null;
          importedProjectFingerprint = importedProjectPath ? projectFingerprint(project) : '';
          importedCanvasFingerprint = canvasFingerprint();
          }
        save();
        setCanvasUndoSnapshot(snapshot);
        toastAction(`${options.refresh ? '已刷新' : '已导入'} ${mapped.records.length} 个节点（内容已折叠）`, '撤销', undoLastCanvasChange);
        return true;
      }

      async function readAndImportProject(file, clientX = viewport.clientWidth / 2, clientY = viewport.clientHeight / 2) {
        if (!file || !file.name.toLowerCase().endsWith('.json')) { toast('请选择白画布项目 JSON 文件'); return; }
        if (file.size > 5 * 1024 * 1024) { toast('项目 JSON 文件不能超过 5 MB'); return; }
        try {
          const project = JSON.parse(await file.text());
          let projectPath = '';
          try { projectPath = window.canvasFiles?.getPathForFile(file) || ''; } catch (_) {}
          if (projectPath && window.canvasFiles?.manageProject) {
            const validationError=validateCanvasProject(project); if(validationError) {toast(validationError);return;}
            const managed=await window.canvasFiles.manageProject(projectPath);
            if(!managed.ok) throw new Error(managed.error);
            openManagedCanvas(managed,worldPoint(clientX,clientY));
          } else importCanvasProject(project, projectPath, worldPoint(clientX, clientY), true);
        } catch (error) {
          toast(error instanceof SyntaxError ? 'JSON 解析失败，请检查文件格式' : '无法读取项目 JSON 文件');
        }
      }

      async function refreshImportedProject() {
        if (refreshingProject) return;
        if (!importedProjectPath) { toast('请先打开本地项目 JSON，再按 R 刷新'); return; }
        if (!window.canvasFiles?.readProjectJson) { toast('只有桌面程序可以从磁盘刷新项目 JSON'); return; }
        const projectPath = importedProjectPath;
        refreshingProject = true;
        try {
          const result = await window.canvasFiles.readProjectJson(projectPath);
          if (importedProjectPath !== projectPath) return;
          if (!result?.ok) { toast(result?.error || '无法读取项目 JSON'); return; }
          let project;
          try { project = JSON.parse(result.text); }
          catch (_) { toast('项目 JSON 解析失败，画布未改变'); return; }
          const validationError = validateCanvasProject(project);
          if (validationError) { toast(`无法刷新：${validationError}`); return; }
          if (project.canvas?.nodes?.length) {
            const snapshot = captureCanvasSnapshot();
            const state = {...project.canvas, contextSelectionVersion:1,
              projectSource:{path:projectPath,codex:project.project.codex || null},
              nodes:project.canvas.nodes.map(node=>({...node,projectPath:node.kind==='asset'?projectPath:''}))};
            restore(state); applyView(); renderConnections();
            importedProjectFingerprint = projectFingerprint(project);
            importedCanvasFingerprint = canvasFingerprint();
            localStorage.setItem(SAVE_KEY, JSON.stringify(captureCanvasSaveRequest({}).state));
            setCanvasUndoSnapshot(snapshot);
            toast('已恢复最近保存的完整画布；Ctrl+Z 可撤销');
            return;
          }
          const nextFingerprint = projectFingerprint(project);
          if (importedProjectFingerprint && nextFingerprint === importedProjectFingerprint) { toast('项目 JSON 没有变化'); return; }
          const hasManualChanges = !importedCanvasFingerprint || canvasFingerprint() !== importedCanvasFingerprint;
          if (nodesLayer.children.length && hasManualChanges && !confirm('项目 JSON 已更新。刷新会覆盖当前画布中的手动改动，是否继续？')) return;
          if (imageZoomSaveTimer) { clearTimeout(imageZoomSaveTimer); imageZoomSaveTimer = null; }
          const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
          const base = script
            ? { x: Number(script.dataset.x) + 150, y: Number(script.dataset.y) + 130 }
            : worldPoint(viewport.clientWidth / 2, viewport.clientHeight / 2);
          importCanvasProject(project, projectPath, base, true, { skipConfirmation: true, refresh: true });
        } catch (_) {
          toast('读取项目 JSON 失败，画布未改变');
        } finally {
          refreshingProject = false;
        }
      }

      function projectNodeTitle(record) {
        if (record.type === 'script') return record.title || '未命名剧本';
        if (record.type === 'asset') return record.fileName || record.title || record.asset?.path?.split(/[\\/]/).pop() || '素材';
        return currentNodeTitle(record.type, record.title) || ({ plot: '剧情梗概', style: '画风', person: '角色', 'shot-group': '场景', character: '人物姓名', shot: '新场景', storyboard: '镜头', prompt: '提示词', text: '文本卡片' })[record.type] || record.type;
      }

      function findProjectTarget(record) {
        const exact = getNode(record.id);
        if (exact?.dataset.kind === record.type && (record.type !== 'asset' || exact.dataset.assetPath === record.assetPath)) return exact;
        if (['script', 'plot', 'style', 'person', 'shot-group'].includes(record.type)) return [...nodesLayer.children].find(node => node.dataset.kind === record.type) || null;
        if (record.type === 'asset') {
          return [...nodesLayer.children].find(node => node.dataset.kind === 'asset' && node.dataset.assetPath === record.assetPath && node.dataset.imageRole === record.imageRole && connections.some(edge => edge.fromId === record.parentId && edge.toId === node.dataset.id)) || null;
        }
        const title = projectNodeTitle(record).trim().toLocaleLowerCase();
        return [...nodesLayer.children].find(node => {
          if (node.dataset.kind !== record.type) return false;
          const current = record.type === 'asset'
            ? (node.querySelector('.asset-name')?.textContent || '')
            : (node.querySelector('.node-title')?.textContent || '');
          return current.trim().toLocaleLowerCase() === title;
        }) || null;
      }

      function updateProjectNode(node, record) {
        if (node.dataset.kind === 'script') {
          if (record.title != null) setBodyText(node.querySelector('.node-body'), record.title);
        } else if (node.dataset.kind === 'asset') {
          const name = node.querySelector('.asset-name');
          if (name && (record.fileName != null || record.title != null)) name.textContent = record.fileName || record.title;
          if (record.imageRole) { node.dataset.imageRole = record.imageRole; node.classList.add('image-only'); }
        } else if (!['person', 'shot-group'].includes(node.dataset.kind)) {
          const title = node.querySelector('.node-title');
          if (title && record.title != null) title.textContent = currentNodeTitle(node.dataset.kind, record.title);
          const body = node.querySelector('.node-body');
          if (body && record.text != null) setBodyText(body, record.text);
        }
        if (record.duration != null) {
          node.dataset.duration = record.duration;
          const meta = node.querySelector('.shot-meta'); if (meta) meta.textContent = record.duration ? `建议时长 · ${record.duration}` : '场景 / 时长 / 机位';
        }
        if (record.includeInChat != null) {
          node.dataset.includeInChat = record.includeInChat ? 'true' : 'false';
        }
        if (record.collapsed != null && !['person', 'shot-group'].includes(node.dataset.kind)) node.classList.toggle('collapsed', record.collapsed);
        if (record.childrenCollapsed != null && ['person', 'shot-group'].includes(node.dataset.kind)) node.classList.toggle('children-collapsed', record.childrenCollapsed);
        if (record.position) {
          node.dataset.x = record.position.x; node.dataset.y = record.position.y;
          node.style.left = `${record.position.x}px`; node.style.top = `${record.position.y}px`;
          node.dataset.autoPosition = 'false';
        }
        if (record.width) { node.dataset.userWidth = record.width; node.style.width = `${record.width}px`; node.classList.add('is-resized'); }
        if (record.height) { node.dataset.userHeight = record.height; node.style.height = `${record.height}px`; node.classList.add('is-resized'); }
      }

      function deployCanvasDraft(project) {
        const validationError = validateCanvasProject(project);
        if (validationError) { toast(`草稿无效：${validationError}`); return null; }
        const snapshot = captureCanvasSnapshot();
        const counts = {}, idMap = new Map();
        const currentScript = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
        const base = currentScript
          ? { x: Number(currentScript.dataset.x) + currentScript.offsetWidth + 300, y: Number(currentScript.dataset.y) + currentScript.offsetHeight / 2 }
          : worldPoint(viewport.clientWidth / 2, viewport.clientHeight / 2);
        let created = 0, updated = 0;
        const currentStyle = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
        const preservedStyle = currentStyle ? getBodyText(currentStyle.querySelector('.node-body')).trim() : '';
        const mapped = videoProjectToCanvasRecords({ ...project, visualStyle: project.visualStyle || preservedStyle }, base, '', false);
        for (const record of mapped.records) {
          let node = findProjectTarget(record);
          if (node) {
            updateProjectNode(node, record); updated++;
          } else {
            const position = record.position || defaultProjectPosition(record.type, base, counts);
            let id = record.id;
            if (getNode(id)) id = `node-${++nodeSeq}`;
            const assetPath = record.assetPath || '';
            const inheritedProjectPath = assetPath && [...nodesLayer.children].find(existing => existing.dataset.kind === 'asset' && existing.dataset.assetPath === assetPath)?.dataset.projectPath || '';
            node = makeNode(record.type, position.x, position.y, {
              id, title: record.title, text: record.text, duration: record.duration,
              fileName: record.fileName, assetPath, projectPath: record.projectPath || inheritedProjectPath, imageRole: record.imageRole,
              autoPosition: record.type === 'shot-group' ? 'true' : record.position && ['plot', 'style', 'person'].includes(record.type) ? 'false' : (['plot', 'style', 'person'].includes(record.type) ? 'true' : ''),
              previewText: assetPath ? '读取项目素材…' : '项目素材', silent: true, collapsed: false
            });
            created++;
          }
          idMap.set(record.id, node.dataset.id);
        }
        for (const edge of mapped.edges) {
          const from = getNode(idMap.get(edge.from)), to = getNode(idMap.get(edge.to));
          if (from && to && canConnectNodes(from, to) && !connections.some(existing => existing.fromId === from.dataset.id && existing.toId === to.dataset.id)) {
            connections.push({ fromId: from.dataset.id, toId: to.dataset.id });
          }
        }
        const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
        if (script) { ensurePlotForScript(script, false, true); ensureStyleForScript(script, false, true); ensureRoleForScript(script, false, true); ensureShotGroupForScript(script, false, true); }
        if (shotLaneLayoutVersion) arrangeCanvasLanes(false);
        if (!importedCodexConversation && project.project.codex) {
          importedCodexConversation = { ...project.project.codex };
          }
        renderConnections(); save();
        setCanvasUndoSnapshot(snapshot);
        return { created, updated };
      }

      function zoomAt(clientX, clientY, multiplier) {
        const oldScale = view.scale;
        const nextScale = Math.min(2.5, Math.max(.25, oldScale * multiplier));
        const p = worldPoint(clientX, clientY);
        view.scale = nextScale;
        view.x = clientX - p.x * nextScale + dockShiftX;
        view.y = clientY - p.y * nextScale;
        applyView();
      }

      function migrateCompoundStoryboards() {
        for (const shot of [...nodesLayer.children].filter(node => node.dataset.kind === 'shot')) {
          const boardChildren = () => connections
            .filter(edge => edge.fromId === shot.dataset.id)
            .map(edge => getNode(edge.toId))
            .filter(node => node?.dataset.kind === 'storyboard');
          const boards = boardChildren();
          if (boards.length === 1) {
            const board = boards[0];
            const body = board.querySelector('.node-body');
            const segments = getBodyText(body).split(/\r?\n[ \t]*--- 生成片段 ---[ \t]*\r?\n/).map(text => text.trim());
            const assets = connections
              .filter(edge => edge.fromId === board.dataset.id)
              .map(edge => getNode(edge.toId))
              .filter(node => node?.dataset.kind === 'asset');
            if (segments.length > 1 && segments.every(Boolean) && assets.length === segments.length && assets.every(node => node.dataset.imageRole === 'storyboard-reference')) {
              setBodyText(body, segments[0]);
              for (let index = 1; index < segments.length; index++) {
                const nextBoard = makeNode('storyboard', Number(board.dataset.x), Number(board.dataset.y) + index * 58, {
                  title: `镜头${String(index + 1).padStart(2, '0')}`,
                  text: segments[index], collapsed: true,
                  includeInChat: board.dataset.includeInChat === 'true', silent: true
                });
                connections.push({ fromId: shot.dataset.id, toId: nextBoard.dataset.id });
                connections = connections.filter(edge => !(edge.fromId === board.dataset.id && edge.toId === assets[index].dataset.id));
                connections.push({ fromId: nextBoard.dataset.id, toId: assets[index].dataset.id });
              }
            }
          }
          boardChildren().forEach((board, index) => {
            const title = board.querySelector('.node-title');
            if (title && /^镜头\s*[·:：|｜-]/.test(title.textContent)) title.textContent = title.textContent.replace(/^镜头/, `镜头${String(index + 1).padStart(2, '0')}`);
          });
        }
      }

      function restore(savedOverride = null) {
        try {
          const saved = savedOverride || JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
          if (!saved) return;
          if (savedOverride) nodesLayer.replaceChildren();
          importedProjectPath = typeof saved.projectSource?.path === 'string' ? saved.projectSource.path : '';
          importedCodexConversation = isValidCodexConversation(saved.projectSource?.codex) ? { ...saved.projectSource.codex } : null;
          importedProjectFingerprint = typeof saved.projectSource?.fingerprint === 'string' ? saved.projectSource.fingerprint : '';
          importedCanvasFingerprint = typeof saved.projectSource?.canvasFingerprint === 'string' ? saved.projectSource.canvasFingerprint : '';
          if (!importedProjectPath) importedProjectPath = (saved.nodes || []).find(node => node.kind === 'asset' && node.assetPath && node.projectPath)?.projectPath || '';
          shotLaneLayoutVersion = [1, 2].includes(saved.shotLaneLayoutVersion) ? saved.shotLaneLayoutVersion : 0;
          if (saved.view && Number.isFinite(saved.view.scale)) view = saved.view;
          (saved.nodes || []).forEach(n => {
            // A saved canvas is authoritative, including older nodes without a flag.
            n = { ...n, autoPosition: n.autoPosition === 'true' ? 'true' : 'false' };
            n.includeInChat = saved.contextSelectionVersion === 1 && n.includeInChat === true;
            if (n.kind === 'asset') {
              if(n.assetPath && !n.projectPath && importedProjectPath)n.projectPath=importedProjectPath;
              makeNode('asset', n.x, n.y, { ...n, id: n.id, title: n.title, fileName: n.fileName || n.title, previewText: n.assetPath ? '读取项目素材…' : '重新拖入文件以预览', silent: true });
            } else {
              const options = ['person', 'shot-group'].includes(n.kind)
                ? { ...n, title: n.kind === 'person' ? '角色' : '场景', childrenCollapsed: Boolean(n.childrenCollapsed || n.collapsed) }
                : n;
              makeNode(n.kind, n.x, n.y, { ...options, silent: true });
            }
          });
          connections = Array.isArray(saved.connections) ? saved.connections.filter(connection => {
            const from = getNode(connection.fromId), to = getNode(connection.toId);
            return from && to && from !== to && canConnectNodes(from, to);
          }) : [];
          let script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
          const roles = [...nodesLayer.children].filter(node => node.dataset.kind === 'person');
          const shots = [...nodesLayer.children].filter(node => node.dataset.kind === 'shot');
          if (!script && (roles.length || shots.length)) {
            const firstChild = roles[0] || shots[0];
            const scriptX = Number(firstChild.dataset.x) - 600;
            const scriptY = Number(firstChild.dataset.y) - 45;
            script = makeNode('script', scriptX, scriptY, { silent: true });
          }
          if (script) {
            if (![...nodesLayer.children].some(n=>n.dataset.kind==='plot')) ensurePlotForScript(script, false, true);
            if (![...nodesLayer.children].some(n=>n.dataset.kind==='style')) ensureStyleForScript(script, false, true);
            if (![...nodesLayer.children].some(n=>n.dataset.kind==='person')) ensureRoleForScript(script, false, true);
            if (![...nodesLayer.children].some(n=>n.dataset.kind==='shot-group')) ensureShotGroupForScript(script, false, true);
          }
          ensureProjectMediaNodes();
          migrateCompoundStoryboards();
          // Restore saved coordinates verbatim; automatic layout is for subsequent changes.
          shotLaneLayoutVersion = 2;
          renderConnections();
        } catch (_) {}
        if (savedOverride) {
          canvasUndoStack.length = 0;
          canvasRedoStack.length = 0;
          queueMicrotask(()=>pruneUndoHistory().catch(console.warn));
          canvasUndoCheckpoint = captureCanvasSnapshot();
          canvasUndoSignature = canvasUndoStateSignature({nodes:canvasRecords(),connections});
          resetCanvasContentTracking();
        }
      }

      function openManagedCanvas(result, base = worldPoint(viewport.clientWidth/2,viewport.clientHeight/2)) {
        const error=validateCanvasProject(result.project);if(error){toast('无法导入：'+error);return;}
        if(result.state){restore(result.state);applyView();renderConnections();}
        else importCanvasProject(result.project,result.projectPath,base,true,{skipConfirmation:true});
      }
      async function manageCurrentCanvas() {
        const source=importedProjectPath;
        if (!window.canvasFiles?.manageProject) return;
        if(!source){
          try{const result=await window.canvasFiles.openLastProject();if(!result.ok)throw new Error(result.error);if(result.project)openManagedCanvas(result);}catch(error){toast('恢复上次剧本失败：'+error.message);}
          return;
        }
        try {
          const state=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');
          const result=await window.canvasFiles.manageProject({path:source,state});
          if(!result.ok) throw new Error(result.error);
          if(importedProjectPath!==source)return;
          if(result.state) { restore(result.state); applyView(); renderConnections(); }
          importedProjectPath=result.projectPath;
          for(const node of nodesLayer.children) if(node.dataset.kind==='asset'&&node.dataset.projectPath===source) node.dataset.projectPath=result.projectPath;
          save(); toast('项目已保存到项目文件夹');
        } catch(error) {toast('项目归档失败：'+error.message);}
      }
      async function showProjectLibrary() {
        if(!window.canvasFiles?.listProjects){projectFileInput.click();return;}
        const dialog=document.createElement('dialog');dialog.className='reference-library';
        const header=document.createElement('header');const title=document.createElement('strong');title.textContent='剧本';
        const add=document.createElement('button');add.textContent='导入项目 JSON';add.onclick=()=>{dialog.close();projectFileInput.click();};
        const close=document.createElement('button');close.textContent='×';close.onclick=()=>dialog.close();header.append(title,add,close);
        const list=document.createElement('div');dialog.append(header,list);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
        try {const result=await window.canvasFiles.listProjects();if(!result.ok)throw new Error(result.error);
          if(!result.items.length)list.textContent='暂无项目，点击“导入项目 JSON”。';
          for(const item of result.items){const button=document.createElement('button');button.textContent=item.title;button.style.display='block';button.style.margin='8px 0';
            button.onclick=async()=>{button.disabled=true;button.textContent='正在载入…';try{const opened=await window.canvasFiles.openManagedProject(item.path);if(!opened.ok)throw new Error(opened.error);dialog.close();openManagedCanvas(opened);}catch(error){toast(error.message);}finally{button.disabled=false;button.textContent=item.title;}};list.append(button);}
        }catch(error){list.textContent=error.message;}
      }
      async function hydrateStyleFromProjectFile() {
        const projectPath = importedProjectPath;
        const bridge = window.canvasFiles;
        if (!projectPath || !bridge?.readProjectJson) return;
        const style = [...nodesLayer.children].find(node => node.dataset.kind === 'style');
        const script = [...nodesLayer.children].find(node => node.dataset.kind === 'script');
        if (!style || !script || getBodyText(style.querySelector('.node-body')).trim()) return;
        try {
          const result = await bridge.readProjectJson(projectPath);
          if (!result?.ok || importedProjectPath !== projectPath) return;
          const project = JSON.parse(result.text);
          if (validateCanvasProject(project) || !project.visualStyle?.trim()) return;
          if (getBodyText(script.querySelector('.node-body')).trim() !== project.project.title.trim()) return;
          if (getBodyText(style.querySelector('.node-body')).trim()) return;
          setBodyText(style.querySelector('.node-body'), project.visualStyle);
          renderConnections(); acknowledgeCanvasViewChange(); save();
        } catch (_) {}
      }

      function openImageViewer(url) {
        const dialog = document.createElement('dialog'); dialog.className = 'image-viewer';
        const toolbar = document.createElement('div'); toolbar.className = 'image-viewer-toolbar';
        const area = document.createElement('div'); area.className = 'image-viewer-area';
        const image = document.createElement('img'); image.src = url; image.alt = '图片预览'; area.append(image);

        let zoom = 1;
        const scale = value => { zoom = Math.max(.2, Math.min(8, value)); image.style.width = `${zoom * 100}%`; };
        for (const [label, action] of [['−', () => scale(zoom / 1.2)], ['＋', () => scale(zoom * 1.2)], ['适应窗口', () => scale(1)], ['保存', async () => { try { await window.canvasFiles.saveImage(url); } catch(error) { toast(error.message); } }]]) {
          const button = document.createElement('button'); button.type='button'; button.textContent=label; button.onclick=action; toolbar.append(button);
        }
        const close=document.createElement('button'); close.type='button'; close.className='image-viewer-close'; close.textContent='×'; close.title='关闭图片预览'; close.setAttribute('aria-label','关闭图片预览'); close.onclick=()=>dialog.close(); toolbar.append(close);
        area.addEventListener('wheel', event => { event.preventDefault(); scale(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive:false });
        image.draggable = false;
        let pan = null;
        const endPan = () => {
          if (!pan) return;
          const pointerId = pan.pointerId; pan = null; area.classList.remove('is-panning');
          if (area.hasPointerCapture(pointerId)) area.releasePointerCapture(pointerId);
        };
        area.addEventListener('pointerdown', event => {
          if (event.button !== 0 || event.target !== image) return;
          event.preventDefault(); event.stopPropagation();
          pan = { pointerId:event.pointerId, x:event.clientX, y:event.clientY, left:area.scrollLeft, top:area.scrollTop };
          area.setPointerCapture(event.pointerId); area.classList.add('is-panning');
        });
        area.addEventListener('pointermove', event => {
          if (!pan || event.pointerId !== pan.pointerId) return;
          if (!(event.buttons & 1)) { endPan(); return; }
          event.preventDefault(); area.scrollLeft = pan.left + pan.x - event.clientX; area.scrollTop = pan.top + pan.y - event.clientY;
        });
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) area.addEventListener(name, event => { if (pan?.pointerId === event.pointerId) endPan(); });
        window.addEventListener('blur', endPan);
        dialog.addEventListener('close', () => { endPan(); window.removeEventListener('blur', endPan); });

        dialog.append(toolbar, area); document.body.append(dialog);
        dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
      }
      window.openCanvasImageViewer=openImageViewer;
      function initSaveOnClose() {
        window.canvasFiles?.onPrepareClose?.(async()=>{
          try{
            if(imageZoomSaveTimer){clearTimeout(imageZoomSaveTimer);imageZoomSaveTimer=null;}
            document.activeElement?.blur?.();
            if(canvasContentChanged){
              const result=await window.canvasFiles.confirmCloseChanges();
              if(result?.action==='cancel'){await window.canvasFiles.finishClose({cancelled:true});return;}
              if(result?.action==='save')await save({strict:true,manualLayout:true});
              else if(result?.action!=='discard')throw Error('关闭确认未完成');
            }
            await canvasSaveQueue;
            await window.canvasFiles.finishClose({ok:true});
          }catch(error){toast('关闭前保存失败：'+error.message);await window.canvasFiles.finishClose({ok:false,error:error.message});}
        });
      }
      fileInput.addEventListener('change', e => { importFiles(e.target.files, viewport.clientWidth / 2, viewport.clientHeight / 2); fileInput.value = ''; });
      document.querySelector('#openProjectButton').addEventListener('click', async () => {
        try {
          const result = await window.canvasFiles.openProjectFolder();
          if (!result?.ok) throw Error(result?.error || '无法打开剧本文件夹');
        } catch(error) { toast(error.message); }
      });
      projectFileInput.addEventListener('change', e => { const file = e.target.files?.[0]; if (file) readAndImportProject(file); projectFileInput.value = ''; });
      characterImageInput.addEventListener('change', e => {
        const pending = pendingCharacterImage; pendingCharacterImage = null;
        const file = e.target.files?.[0]; e.target.value = '';
        if (!pending || !file) return;
        const parent = getNode(pending.characterId);
        if (!parent) return;
        if (parent.dataset.kind === 'character') attachCharacterImage(parent, file, pending.point);
        else importCanvasImages([file], pending.point, parent);
      });
      characterImageInput.addEventListener('cancel', () => { pendingCharacterImage = null; });
      document.querySelector('#zoomIn').addEventListener('click', () => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1.15));
      document.querySelector('#zoomOut').addEventListener('click', () => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1 / 1.15));
      minimap.addEventListener('wheel', e => {
        e.preventDefault(); e.stopPropagation();
        if (e.deltaY) zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, e.deltaY < 0 ? 1.08 : 1 / 1.08);
      }, { passive: false });
      minimap.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !minimapTransform) return;
        e.preventDefault(); e.stopPropagation();
        minimap.setPointerCapture(e.pointerId);
        const rect = minimapSvg.getBoundingClientRect();
        const mapX = (e.clientX - rect.left) / rect.width * 240;
        const mapY = (e.clientY - rect.top) / rect.height * 150;
        const worldX = (mapX - minimapTransform.offsetX) / minimapTransform.scale;
        const worldY = (mapY - minimapTransform.offsetY) / minimapTransform.scale;
        const centeredX = viewport.clientWidth / 2 - worldX * view.scale + dockShiftX;
        const centeredY = viewport.clientHeight / 2 - worldY * view.scale;
        minimapPointerId = e.pointerId;
        minimap.dataset.dragStartX = e.clientX; minimap.dataset.dragStartY = e.clientY;
        minimap.dataset.centeredX = centeredX; minimap.dataset.centeredY = centeredY;
        minimap.dataset.viewScale = view.scale;
        minimap.dataset.worldPerPixelX = 240 / (rect.width * minimapTransform.scale);
        minimap.dataset.worldPerPixelY = 150 / (rect.height * minimapTransform.scale);
        view.x = centeredX; view.y = centeredY;
        applyView();
      });
      minimap.addEventListener('pointermove', e => {
        if (e.pointerId !== minimapPointerId) return;
        const dx = e.clientX - Number(minimap.dataset.dragStartX);
        const dy = e.clientY - Number(minimap.dataset.dragStartY);
        view.x = Number(minimap.dataset.centeredX) - dx * Number(minimap.dataset.worldPerPixelX) * Number(minimap.dataset.viewScale);
        view.y = Number(minimap.dataset.centeredY) - dy * Number(minimap.dataset.worldPerPixelY) * Number(minimap.dataset.viewScale);
        applyView();
      });
      const finishMinimapDrag = e => {
        if (e.pointerId !== minimapPointerId) return;
        minimapPointerId = null;
      };
      minimap.addEventListener('pointerup', finishMinimapDrag);
      minimap.addEventListener('pointercancel', finishMinimapDrag);

      document.addEventListener('pointerdown', e => {
        if (document.querySelector('.connection-menu') && !e.target.closest('.connection-menu')) closeConnectionMenu();
      }, true);
      document.addEventListener('pointermove', e => {
        if (!connectionDrag || connectionDrag.pointerId !== e.pointerId) return;
        connectionDrag.current = worldPoint(e.clientX, e.clientY);
        if (connectionDrag.referenceOnly) {
          connectionDrag.hoverTarget?.classList.remove('reference-connect-target');
          const target = document.elementFromPoint(e.clientX,e.clientY)?.closest('.node');
          connectionDrag.hoverTarget = canConnectFromNodeBody(getNode(connectionDrag.fromId), target) ? target : null;
          connectionDrag.hoverTarget?.classList.add('reference-connect-target');
        }
        if (!connectionDrag.moved && Math.hypot(e.clientX - connectionDrag.startX, e.clientY - connectionDrag.startY) > 6) {
          connectionDrag.moved = true;
          getNode(connectionDrag.fromId)?.setPointerCapture(e.pointerId);
          window.getSelection()?.removeAllRanges();
        }
        if (connectionDrag.moved) scheduleConnectionPreview();
      });
      document.addEventListener('pointerup', completeConnectionDrag);
      document.addEventListener('pointercancel', e => {
        if (connectionDrag?.pointerId === e.pointerId) { connectionDrag.hoverTarget?.classList.remove('reference-connect-target'); connectionDrag = null; renderConnections(); }
      });

      viewport.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('.node') || e.target.closest('.zoom-controls')) return;
        e.preventDefault();
        activePointer = { id: e.pointerId, x: e.clientX, y: e.clientY, viewX: view.x, viewY: view.y };
        viewport.setPointerCapture(e.pointerId); viewport.classList.add('is-panning');
        document.querySelectorAll('.node.selected').forEach(n => n.classList.remove('selected'));
      });
      viewport.addEventListener('pointermove', e => {
        if (!activePointer || activePointer.id !== e.pointerId) return;
        if (!(e.buttons & 1)) { finishCanvasPan(e); return; }
        view.x = activePointer.viewX + e.clientX - activePointer.x;
        view.y = activePointer.viewY + e.clientY - activePointer.y;
        if (!panFrame) panFrame = requestAnimationFrame(() => { panFrame = 0; applyView(); });
      });
      function finishCanvasPan(event) {
        if (!activePointer || (event?.pointerId != null && activePointer.id !== event.pointerId)) return;
        const pointerId = activePointer.id;
        activePointer = null;
        viewport.classList.remove('is-panning');
        if (panFrame) { cancelAnimationFrame(panFrame); panFrame = 0; applyView(); }
        if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
      }
      viewport.addEventListener('pointerup', finishCanvasPan);
      viewport.addEventListener('pointercancel', finishCanvasPan);
      viewport.addEventListener('lostpointercapture', finishCanvasPan);
      window.addEventListener('pointerup', finishCanvasPan);
      window.addEventListener('blur', () => finishCanvasPan());
      viewport.addEventListener('wheel', e => {
        const node = e.target.closest?.('.node');
        if (node?.classList.contains('prompt-card') && !node.classList.contains('collapsed')) {
          e.preventDefault();
          const body = node.querySelector('.node-body');
          if (body) body.scrollTop += (e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * body.clientHeight : e.deltaY) / view.scale;
          return;
        }
        if (e.altKey && node?.dataset.kind === 'asset' && !node.classList.contains('collapsed') &&
          (node.classList.contains('image-only') || node.querySelector('.asset-preview img'))) {
          e.preventDefault();
          zoomImageByWheel(node, e);
          return;
        }
        if (e.altKey && node) {
          e.preventDefault();
          const body = node.querySelector('.node-body');
          if (body && body.clientHeight > 0) {
            const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40
              : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * body.clientHeight
                : e.deltaY;
            body.scrollTop += delta / view.scale;
          }
          return;
        }
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.08 : 1 / 1.08);
      }, { passive: false });
      function referenceDropParent(item,target) {
        if(!target || !nodesLayer.contains(target))return null;
        const candidate={dataset:{kind:'asset',assetPath:item.path || '',fileName:item.name || ''}};
        return canConnectFromNodeBody(target,candidate)?target:null;
      }
      async function importReferenceItems(items,point,parent=null) {
        return runCanvasAction('导入参考素材',async()=>{
          if(!importedProjectPath)throw new Error('请先打开一个项目');
          const source=importedProjectPath,snapshot=captureCanvasSnapshot();let count=0;
          try{for(const item of items){const result=await window.canvasFiles.attachReference({path:item.path,name:item.name,projectPath:source});
            if(!result.ok)throw new Error(result.error);if(importedProjectPath!==source)throw new Error('项目已切换');
            const node=makeNode('asset',point.x+count*340,point.y,{title:result.type==='audio'?'参考音色':'参考图',fileName:result.name,assetPath:result.assetPath,projectPath:result.projectPath,silent:true});selectNode(node);if(parent && nodesLayer.contains(parent) && canConnectNodes(parent,node))connections.push({fromId:parent.dataset.id,toId:node.dataset.id});count++;
          }}finally{if(count){renderConnections();await save({strict:true});setCanvasUndoSnapshot(snapshot);}}
          toast(`已导入 ${count} 项参考素材`);
        });
      }
      function sceneAtCanvasPoint(point) {
        const row = [...shotLanes.querySelectorAll('.shot-lane-row')].find(row =>
          point.x >= parseFloat(row.style.left) && point.x <= parseFloat(row.style.left) + parseFloat(row.style.width) &&
          point.y >= parseFloat(row.style.top) && point.y <= parseFloat(row.style.top) + parseFloat(row.style.height));
        const scene = row ? getNode(row.dataset.shotId) : null;
        return scene?.dataset.kind === 'shot' ? scene : null;
      }

      async function addShotToScene(scene) {
        if (nodeDeletionPending || !scene || !nodesLayer.contains(scene)) return;
        nodeDeletionPending = true;
        try {
          await save({strict:true});
          if (!nodesLayer.contains(scene)) throw Error('场景已不存在');
          const snapshot = captureCanvasSnapshot();
          const boards = connections.filter(edge=>edge.fromId===scene.dataset.id).map(edge=>getNode(edge.toId)).filter(node=>node?.dataset.kind==='storyboard');
          const related = shotBoardsForLane(scene);
          const x = boards.length ? Number(boards[0].dataset.x) : Number(scene.dataset.x) + Math.max(400, scene.offsetWidth + 110);
          const y = related.length ? Math.max(...related.map(node=>Number(node.dataset.y)+node.offsetHeight)) + 42 : Number(scene.dataset.y);
          const title = nextChildTitle(scene, 'storyboard');
          const board = makeNode('storyboard', x, y, {title,text:'',silent:true});
          connections.push({fromId:scene.dataset.id,toId:board.dataset.id});
          scene.classList.remove('children-collapsed');
          if (shotLaneLayoutVersion) arrangeCanvasLanes(false);
          canvasUndoCheckpoint = snapshot;
          selectNode(board); renderConnections();
          await save({strict:true});
          toast('已新增' + title);
        } catch (error) { toast('新增镜头失败：' + error.message); }
        finally { nodeDeletionPending = false; pruneUndoHistory().catch(console.warn); }
      }

      async function insertCanvasShot(point){
        if(nodeDeletionPending)return;nodeDeletionPending=true;
        try{
          await save({strict:true});
          const snapshot=captureCanvasSnapshot();
          const rows=[...shotLanes.querySelectorAll('.shot-lane-row')];
          const row=rows.find(r=>point.x>=parseFloat(r.style.left)&&point.x<=parseFloat(r.style.left)+parseFloat(r.style.width)&&point.y>=parseFloat(r.style.top)&&point.y<=parseFloat(r.style.top)+parseFloat(r.style.height));
          const target=row?getNode(row.dataset.shotId):null;
          let group=[...nodesLayer.children].find(n=>n.dataset.kind==='shot-group');
          if(!group){const script=[...nodesLayer.children].find(n=>n.dataset.kind==='script');if(!script)throw Error('请先创建或打开剧本');group=ensureShotGroupForScript(script,false,true);}
          const shots=connections.filter(e=>e.fromId===group.dataset.id).map(e=>getNode(e.toId)).filter(n=>n?.dataset.kind==='shot').sort((a,b)=>Number(a.dataset.y)-Number(b.dataset.y));
          const number=node=>Number(quickNodeTitle(node).match(/^场景\s*0*(\d+)/)?.[1]) || shots.indexOf(node)+1;
          const index=target?shots.indexOf(target):-1;
          const newNumber=index>=0?number(target):Math.max(0,...shots.map(number))+1;
          const x=target?Number(target.dataset.x):shots.length?Number(shots[shots.length-1].dataset.x):Number(group.dataset.x)+340;
          const descendants=shot=>[shot,...shotBoardsForLane(shot)];
          let y;
          if(index>=0){
            y=Number(target.dataset.y);const distance=Math.max(240,parseFloat(row.style.height)+10),moved=new Set();
            for(const shot of shots.slice(index)){
              const title=shot.querySelector('.node-title');title.textContent=quickNodeTitle(shot).replace(/^场景\s*\d+/, '场景'+String(number(shot)+1).padStart(2,'0'));
              for(const node of descendants(shot)){if(moved.has(node))continue;moved.add(node);node.dataset.autoPosition='false';node.dataset.y=String(Number(node.dataset.y)+distance);node.style.top=node.dataset.y+'px';}
            }
          }else{
            const last=shots[shots.length-1];y=last?Math.max(...descendants(last).map(n=>Number(n.dataset.y)+n.offsetHeight))+70:Number(group.dataset.y);
          }
          const shot=makeNode('shot',x,y,{title:'场景'+String(newNumber).padStart(2,'0'),text:'',autoPosition:'false',silent:true});
          if(target)nodesLayer.insertBefore(shot,target);
          const edge={fromId:group.dataset.id,toId:shot.dataset.id},edgeIndex=target?connections.findIndex(e=>e.fromId===group.dataset.id&&e.toId===target.dataset.id):-1;
          if(edgeIndex>=0)connections.splice(edgeIndex,0,edge);else connections.push(edge);
          group.classList.remove('children-collapsed');shotLaneLayoutVersion=shotLaneLayoutVersion || 1;
          canvasUndoCheckpoint=snapshot;selectNode(shot);renderConnections();await save({strict:true});toast('已新增场景'+String(newNumber).padStart(2,'0'));
        }catch(error){toast('新增场景失败：'+error.message);}finally{nodeDeletionPending=false;pruneUndoHistory().catch(console.warn);}
      }
      viewport.addEventListener('contextmenu', event => {
        if(event.target.closest('.node, .zoom-controls, .connection-menu, dialog'))return;
        event.preventDefault();closeConnectionMenu();
        const point=worldPoint(event.clientX,event.clientY),menu=document.createElement('div');menu.className='connection-menu';
        const scene = sceneAtCanvasPoint(point);
        if (scene) {
          const addBoard = document.createElement('button'); addBoard.textContent = '新增镜头';
          addBoard.onclick = () => { menu.remove(); addShotToScene(scene); }; menu.append(addBoard);
        }
        const addShot=document.createElement('button');addShot.textContent='新增场景';addShot.onclick=()=>{menu.remove();insertCanvasShot(point);};menu.append(addShot);
        const button=document.createElement('button');button.textContent='参考素材库';
        button.onclick=()=>{menu.remove();window.showCanvasReferencePicker(items=>importReferenceItems(items,point));};menu.append(button);menu.addEventListener('pointerdown',event=>event.stopPropagation());viewport.append(menu);
        const rect=menu.getBoundingClientRect();menu.style.left=`${Math.max(12,Math.min(event.clientX,viewport.clientWidth-rect.width-12))}px`;menu.style.top=`${Math.max(12,Math.min(event.clientY,innerHeight-rect.height-12))}px`;
      });

      let dragDepth = 0;
      let canvasPastePoint = null;
      viewport.tabIndex = -1;
      window.addEventListener('pointerdown', event => {
        if(!viewport.contains(event.target))return;
        if(quickPanel.contains(event.target))return;
        canvasPastePoint = {x:event.clientX,y:event.clientY};
        if (!event.target.closest('input,textarea,select,button,[contenteditable="true"]')) viewport.focus({preventScroll:true});
      },{capture:true});
      function hoveredImageNode() {
        const node = nodeDeletePointer ? document.elementFromPoint(nodeDeletePointer.x, nodeDeletePointer.y)?.closest('.node') : null;
        return node && nodesLayer.contains(node) && isImageNode(node) ? node : null;
      }
      function hoveredStoryboardNode() {
        const node = nodeDeletePointer ? document.elementFromPoint(nodeDeletePointer.x, nodeDeletePointer.y)?.closest('.node') : null;
        return node && nodesLayer.contains(node) && node.dataset.kind === 'storyboard' ? node : null;
      }
      window.addEventListener('copy', event => {
        if (event.defaultPrevented || quickBlocksCanvas(event) || event.target.closest?.('dialog,input,textarea,select,[contenteditable="true"]')) return;
        if(selectedReferenceImages().length>1){event.preventDefault();copySelectedImages();return;}
        const hoveredImage = hoveredImageNode();
        if (hoveredImage) { event.preventDefault(); copyNodeImage(hoveredImage); return; }
        const hoveredBoard = hoveredStoryboardNode();
        if (hoveredBoard && event.clipboardData) {
          event.preventDefault();
          event.clipboardData.setData('text/plain', getBodyText(hoveredBoard.querySelector('.node-body')));
          return;
        }
        if (window.getSelection()?.toString()) return;
        const selected = nodesLayer.querySelector('.node.selected');
        if (isImageNode(selected)) return;
        const body = selected?.querySelector('.node-body');
        if (!body || !event.clipboardData) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', getBodyText(body));
      });
      window.addEventListener('paste',event=>{
        if(quickOverlay.hidden || (quickPinned && !quickPanel.contains(event.target)) || event.defaultPrevented || document.querySelector('dialog[open]') || event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
        const state=quickTrail.at(-1),character=state?.view==='person'?getNode(state.nodeId):null;
        if(character?.dataset.kind!=='character')return;
        const clipboard=event.clipboardData;
        const files=clipboard?.files?.length?[...clipboard.files]:[...(clipboard?.items || [])].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
        const images=files.filter(isCanvasImageFile);if(!images.length)return;
        event.preventDefault();event.stopImmediatePropagation();
        const existing=quickChildren(character,'asset');
        const point={x:Number(character.dataset.x)+character.offsetWidth+80,y:existing.length?Math.max(...existing.map(node=>Number(node.dataset.y)+node.offsetHeight))+30:Number(character.dataset.y)};
        importCanvasImages(images,point,character).then(()=>{if(!quickOverlay.hidden && quickTrail.at(-1)?.nodeId===character.dataset.id)renderQuickView();}).catch(error=>toast('人物设定图添加失败：'+error.message));
      });
      window.addEventListener('paste', event => {
        if (event.defaultPrevented || event.target.closest?.('dialog,input,textarea,select,[contenteditable="true"]') || quickBlocksCanvas(event)) return;
        const files = [...(event.clipboardData?.files || [])].length ? [...event.clipboardData.files] : [...(event.clipboardData?.items || [])]
          .filter(item => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/')))
          .map(item => item.getAsFile()).filter(Boolean);
        const videos=files.filter(isCanvasVideoFile);
        if(videos.length){event.preventDefault();const rect=viewport.getBoundingClientRect();const hovered=nodeDeletePointer?document.elementFromPoint(nodeDeletePointer.x,nodeDeletePointer.y)?.closest('.node'):null;const parent=isVideoParentNode(hovered)?hovered:null;importCanvasVideos(videos,parent?{x:Number(parent.dataset.x)+parent.offsetWidth+100,y:Number(parent.dataset.y)}:worldPoint(nodeDeletePointer?.x ?? rect.left+rect.width/2,nodeDeletePointer?.y ?? rect.top+rect.height/2),parent);return;}
        if (!files.length) {
          if (!event.clipboardData?.types.includes('text/plain')) return;
          const hovered = nodeDeletePointer ? document.elementFromPoint(nodeDeletePointer.x, nodeDeletePointer.y)?.closest('.node') : null;
          if (hovered?.dataset.kind === 'shot' && nodesLayer.contains(hovered)) {
            event.preventDefault();
            const children = quickChildren(hovered, 'storyboard');
            const y = children.length ? Math.max(...children.map(node => Number(node.dataset.y) + node.offsetHeight)) + 40 : Number(hovered.dataset.y);
            const board = makeNode('storyboard', Number(hovered.dataset.x) + hovered.offsetWidth + 80, y, {
              title: nextChildTitle(hovered, 'storyboard'),
              text: event.clipboardData.getData('text/plain')
            });
            connections.push({fromId:hovered.dataset.id, toId:board.dataset.id});
            hovered.classList.remove('collapsed', 'children-collapsed');
            if (shotLaneLayoutVersion) arrangeCanvasLanes(false);
            selectNode(board);
            renderConnections();
            save();
            return;
          }
          const text = event.clipboardData.getData('text/plain');
          if (hovered?.dataset.kind === 'storyboard' && nodesLayer.contains(hovered) && !hovered.classList.contains('selected')) {
            event.preventDefault();
            const point = promptColumnPoint(hovered);
            const prompt = makeNode('prompt', point.x, point.y, {title:'提示词',text});
            connections.push({fromId:hovered.dataset.id,toId:prompt.dataset.id});
            hovered.classList.remove('collapsed','children-collapsed');
            if (shotLaneLayoutVersion) arrangeCanvasLanes(false);
            selectNode(prompt); renderConnections(); save();
            return;
          }
          const pointerElement = nodeDeletePointer ? document.elementFromPoint(nodeDeletePointer.x,nodeDeletePointer.y) : null;
          if (!hovered && pointerElement && viewport.contains(pointerElement) && !pointerElement.closest('button,.connection-menu')) {
            event.preventDefault();
            const point = worldPoint(nodeDeletePointer.x,nodeDeletePointer.y);
            const node = makeNode('text',point.x,point.y,{text});
            selectNode(node); renderConnections(); save();
            return;
          }
          const body = nodesLayer.querySelector('.node.selected .node-body');
          if (!body) return;
          event.preventDefault();
          setBodyText(body, event.clipboardData.getData('text/plain'));
          body.dispatchEvent(new Event('input', {bubbles:true}));
          return;
        }
        event.preventDefault();
        const selected = nodesLayer.querySelector('.node.selected');
        const hovered=nodeDeletePointer?document.elementFromPoint(nodeDeletePointer.x,nodeDeletePointer.y)?.closest('.node'):null;
        const parent = hovered && nodesLayer.contains(hovered) && ['character','storyboard','cover-group'].includes(hovered.dataset.kind) ? hovered : selected && ['character','storyboard','cover-group'].includes(selected.dataset.kind) ? selected : null;
        const rect = viewport.getBoundingClientRect();
        const point = parent ? {x:Number(parent.dataset.x) + parent.offsetWidth + 80,y:Number(parent.dataset.y)}
          : worldPoint(canvasPastePoint?.x ?? rect.left + rect.width / 2, canvasPastePoint?.y ?? rect.top + rect.height / 2);
        importCanvasImages(files, point, parent);
      });
      let externalImageDropTarget=null;
      function clearExternalImageDropTarget() {
        externalImageDropTarget?.classList.remove('image-drop-target');externalImageDropTarget=null;const hint=document.querySelector('#fileDropHint');if(hint)hint.hidden=true;
      }
      function imageDropParent(event,files=null) {
        const target=event.target?.closest?.('.node') || document.elementFromPoint(event.clientX,event.clientY)?.closest('.node');
        if(!target || !nodesLayer.contains(target))return null;
        const images=files || [...(event.dataTransfer?.items || [])].filter(item=>item.kind==='file');
        return images.some(file=>{
          const name=file.name || (file.type==='image/jpeg'?'reference.jpg':'reference.png');
          if(files ? !isCanvasImageFile(file) : file.type && !/^image\/(png|jpeg|webp|gif)$/.test(file.type))return false;
          if(target.dataset.kind==='character' && (files ? !isJpgPngFile(file) : file.type && !['image/png','image/jpeg'].includes(file.type)))return false;
          return canConnectNodes(target,{dataset:{kind:'asset',fileName:name}});
        })?target:null;
      }
      function fileDropFeedback(event,files=null) {
        const target=event.target?.closest?.('.node');
        const samples=files || [...(event.dataTransfer?.items || [])].filter(i=>i.kind==='file').map(i=>({type:i.type,name:i.type==='image/jpeg'?'image.jpg':i.type?.startsWith('image/')?'image.'+i.type.split('/')[1]:i.type?.startsWith('audio/')?'audio.mp3':i.type?.startsWith('video/')?'video.mp4':''}));
        if(!target)return {valid:true,target:null,text:'松开以添加到画布'};
        const accepts=samples.length && samples.every(file=>canConnectFromNodeBody(target,{dataset:{kind:'asset',fileName:file.name || '',assetPath:isCanvasAudioFile(file)?'assets/audio/'+(file.name || 'audio.mp3'):file.name || ''},querySelector:()=>null}));
        const label=quickNodeTitle(target);
        return {valid:!!accepts,target,text:accepts?'松开以关联到 '+label:'无法关联到 '+label+'：文件类型不匹配'};
      }
      function displayFileDropHint(event,feedback){const hint=document.querySelector('#fileDropHint');if(!hint)return;hint.hidden=false;hint.textContent=feedback.text;hint.classList.toggle('is-invalid',!feedback.valid);hint.style.left=Math.min(event.clientX+16,innerWidth-300)+'px';hint.style.top=Math.min(event.clientY+16,innerHeight-70)+'px';}
      function showFileDropTarget(event) {
        if(!quickOverlay.hidden && ['cover','video','bgm'].includes(quickTrail.at(-1)?.view) && quickPanel.contains(event.target)){dropOverlay.classList.remove('visible');clearExternalImageDropTarget();return;}
        const feedback=fileDropFeedback(event),target=feedback.valid?feedback.target:null;
        if(target!==externalImageDropTarget){clearExternalImageDropTarget();externalImageDropTarget=target;target?.classList.add('image-drop-target');}
        dropOverlay.classList.remove('visible');displayFileDropHint(event,feedback);
      }
      function isVideoParentNode(node) { return node?.dataset.kind === 'video-group' || node?.dataset.kind === 'storyboard' || isPromptNode(node); }
      function videoDropParent(event, files = null) {
        const node=event.target?.closest?.('.node') || document.elementFromPoint(event.clientX,event.clientY)?.closest('.node');
        if(!isVideoParentNode(node))return null;
        const candidates=files || [...(event.dataTransfer?.items || [])].filter(item=>item.kind==='file');
        return candidates.some(file=>files?isCanvasVideoFile(file):!file.type || /^video\/(mp4|webm|quicktime)$/.test(file.type))?node:null;
      }
      viewport.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('application/x-canvas-reference')){event.preventDefault();event.dataTransfer.dropEffect='copy';const target=event.target?.closest?.('.node'),item=window.canvasDraggingReference,parent=item?referenceDropParent(item,target):null;displayFileDropHint(event,{valid:!target || !!parent,text:target?(parent?'松开以关联到 '+quickNodeTitle(target):'无法关联到 '+quickNodeTitle(target)+'：文件类型不匹配'):'松开以添加素材'});}});
      viewport.addEventListener('drop',event=>{const raw=event.dataTransfer?.getData('application/x-canvas-reference');if(!raw)return;event.preventDefault();event.stopPropagation();try{const item=JSON.parse(raw);const target=event.target.closest('.node');const parent=referenceDropParent(item,target);clearExternalImageDropTarget();if(target && !parent){toast('无法关联到 '+quickNodeTitle(target)+'：文件类型不匹配');return;}const point=parent?{x:Number(parent.dataset.x)+parent.offsetWidth+80,y:Number(parent.dataset.y)}:worldPoint(event.clientX,event.clientY);importReferenceItems([item],point,parent).catch(error=>toast(error.message));}catch(error){toast('素材导入失败：'+error.message);}});
      window.addEventListener('dragenter', e => {
        if (e.dataTransfer?.types.includes('Files')) { dragDepth++; showFileDropTarget(e); }
      });
      window.addEventListener('dragleave', e => {
        if (e.dataTransfer?.types.includes('Files')) {
          dragDepth = Math.max(0, dragDepth - 1);
          if (!dragDepth) { dropOverlay.classList.remove('visible');clearExternalImageDropTarget(); }
        }
      });
      window.addEventListener('dragover', e => {
        if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; showFileDropTarget(e); }
      });
      window.addEventListener('drop', e => {
        if (!e.dataTransfer?.files?.length) {clearExternalImageDropTarget();return;}
        e.preventDefault(); dragDepth = 0; dropOverlay.classList.remove('visible');
        clearExternalImageDropTarget();
        const projectFile = [...e.dataTransfer.files].find(file => file.name.toLowerCase().endsWith('.json'));
        if (projectFile) { readAndImportProject(projectFile, e.clientX, e.clientY); return; }
        const feedback=fileDropFeedback(e,[...e.dataTransfer.files]);if(feedback.target && !feedback.valid){toast(feedback.text);return;}
        const files=[...e.dataTransfer.files],parent=feedback.target;
        const point=parent?{x:Number(parent.dataset.x)+parent.offsetWidth+80,y:Number(parent.dataset.y)}:worldPoint(e.clientX,e.clientY);
        runCanvasAction('拖入素材',async()=>{
          if(!parent){await importFiles(files,e.clientX,e.clientY);return;}
          const images=files.filter(isCanvasImageFile),audio=files.filter(isCanvasAudioFile),videos=files.filter(file=>!isCanvasAudioFile(file)&&isCanvasVideoFile(file));
          if(images.length)await importCanvasImages(images,point,parent);
          if(audio.length)await importCanvasAudio(audio,point,parent);
          if(videos.length)await importCanvasVideos(videos,point,parent);
        }).catch(error=>toast('素材导入失败：'+error.message));
      });
      window.addEventListener('dragend',()=>{dragDepth=0;dropOverlay.classList.remove('visible');clearExternalImageDropTarget();});
      window.addEventListener('blur',()=>{dragDepth=0;dropOverlay.classList.remove('visible');clearExternalImageDropTarget();});

      let nodeDeletePointer = null;
      const trackNodeDeletePointer = event => { nodeDeletePointer = { x:event.clientX, y:event.clientY }; };
      window.addEventListener('pointermove', trackNodeDeletePointer, { passive:true, capture:true });
      window.addEventListener('pointerdown', trackNodeDeletePointer, { passive:true, capture:true });
      window.addEventListener('keydown',event=>{
        if(!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase()!=='s')return;
        event.preventDefault();event.stopImmediatePropagation();if(event.repeat)return;
        if(imageZoomSaveTimer){clearTimeout(imageZoomSaveTimer);imageZoomSaveTimer=null;}
        document.activeElement?.blur?.();observeCanvasContentChange();const revision=canvasContentRevision;
        Promise.resolve().then(()=>save({strict:true,manualLayout:true})).then(()=>{if(canvasContentRevision===revision)canvasContentChanged=false;toast('当前画布已保存');},error=>toast('画布保存失败：'+error.message));
      },{capture:true});
      window.addEventListener('keydown', e => {
        if (e.key !== 'Delete' || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || quickBlocksCanvas(e) || document.querySelector('dialog[open]')) return;
        const hovered = nodeDeletePointer ? document.elementFromPoint(nodeDeletePointer.x,nodeDeletePointer.y) : null;
        const node = hovered?.closest('.node');
        const selection = selectedCanvasNodes();
        const targets = selection.length > 1 ? selection : node && nodesLayer.contains(node) ? [node] : [];
        if (!targets.length) return;
        const focused = document.activeElement;
        const editingNode = focused && (focused.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(focused.tagName));
        if (editingNode || hovered?.closest('input,textarea,select,[contenteditable="true"]')) return;
        e.preventDefault(); e.stopImmediatePropagation(); closeConnectionMenu(); removeNodes(targets);nodeDeletePointer=null;
      }, { capture:true });
      document.documentElement.addEventListener('pointerleave', () => { nodeDeletePointer = null; });
      window.addEventListener('blur', () => { nodeDeletePointer = null; });
      window.addEventListener('keydown', e => {
        if (!quickOverlay.hidden && (quickBlocksCanvas(e) || e.key==='Escape')) { if((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase()==='c' && !e.target.isContentEditable && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) && !document.querySelector('dialog[open]')){const image=nodeDeletePointer?document.elementFromPoint(nodeDeletePointer.x,nodeDeletePointer.y):null;const card=image?.tagName==='IMG'?image.closest('.quick-image-card'):null;if(card){e.preventDefault();if(!e.repeat)copyNodeImage(getNode(card.dataset.nodeId));return;}} if (e.key === 'Escape') { e.preventDefault(); closeQuickView(); } return; }
        if (e.key === 'Escape' && document.querySelector('.connection-menu')) { closeConnectionMenu(); return; }
        if (e.isComposing || e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || document.querySelector('dialog[open]')) return;
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c' && !document.querySelector('dialog[open]')) {
          if(selectedReferenceImages().length>1){e.preventDefault();if(!e.repeat)copySelectedImages();return;}
          const hoveredImage = hoveredImageNode();
          if (hoveredImage) { e.preventDefault(); if (!e.repeat) copyNodeImage(hoveredImage); return; }
          const hoveredBoard = hoveredStoryboardNode();
          if (hoveredBoard) {
            e.preventDefault();
            if (!e.repeat) navigator.clipboard.writeText(getBodyText(hoveredBoard.querySelector('.node-body'))).then(() => toast('已复制镜头正文'), error => toast('复制失败：' + error.message));
            return;
          }
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.repeat && e.key.toLowerCase() === 'o') { e.preventDefault(); projectFileInput.click(); return; }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === 'z' || (!e.shiftKey && e.key.toLowerCase() === 'y'))) { e.preventDefault();if(e.repeat)return;if(e.shiftKey || e.key.toLowerCase()==='y')redoLastCanvasChange();else undoLastCanvasChange();return; }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat && e.key.toLowerCase() === 'r' && !document.querySelector('dialog[open]')) {
          e.preventDefault(); refreshImportedProject();window.refreshCanvasReferenceLibrary?.().catch(error=>toast('素材库刷新失败：'+error.message)); return;
        }
        if(!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat && !document.querySelector('dialog[open]')){
          const key=e.key.toLowerCase();
          if(['n','s','i'].includes(key)){e.preventDefault();if(key==='n')addAt('text');else if(key==='s')addAt('shot');else fileInput.click();}
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat && e.key === 'Home') { view = { x: viewport.clientWidth / 2 + dockShiftX, y: viewport.clientHeight / 2, scale: 1 }; applyView(); }
        if (e.key === 'Escape') document.querySelectorAll('.node.selected').forEach(n => n.classList.remove('selected'));
      });
      window.addEventListener('resize', () => {
        syncDockShift();
        if (!nodesLayer.children.length) { view.x = viewport.clientWidth / 2 + dockShiftX; view.y = viewport.clientHeight / 2; }
        applyView();
      });
      window.addEventListener('beforeunload', () => {
        if (imageZoomSaveTimer) { clearTimeout(imageZoomSaveTimer); save(); }
        objectUrls.forEach(URL.revokeObjectURL);
      });

      restore();
      canvasUndoCheckpoint = captureCanvasSnapshot();
      canvasUndoSignature = canvasUndoStateSignature({nodes:canvasRecords(),connections});
      resetCanvasContentTracking();
      syncDockShift(); applyView(); initSaveOnClose(); initQuickNavigation(); hydrateStyleFromProjectFile();
      manageCurrentCanvas();
    })();

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion, deleteDoc, addDoc, collection, query, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- ★ご自身の「合鍵」をここに貼り付けてください★ ---
const firebaseConfig = {
    apiKey: "あなたのAPIキー",
    authDomain: "noto-no-kirehashi.firebaseapp.com",
    projectId: "noto-no-kirehashi",
    storageBucket: "noto-no-kirehashi.firebasestorage.app",
    messagingSenderId: "あなたのID",
    appId: "あなたのアプリID"
};
// --------------------------------------------------

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const COLLECTION_NAME = "rooms_v23_0_title"; 
const MAX_HISTORY = 40; 
const TIME_LIMIT_MS = 24 * 60 * 60 * 1000; 
const MAX_FUSEN_PER_TURN = 10; 
const MAX_PLAYERS = 8; 

// 記憶システム
const STORAGE = {
    ID: 'noto_user_id_v22', 
    JOINED_ROOMS: 'noto_joined_rooms_v24', 
    CANVAS: 'noto_canvas_backup_'
};

const State = {
    myId: null,
    myName: null,
    roomName: "",
    roomData: null,
    historyData: [],
    isProcessing: false,
    unsubRoom: null,
    unsubHistory: null,
    forceGallery: false,
    timer: null,
    lastTurnId: "",
    selectIndex: -1,
    colorUrl: "",
    tickets: 1
};

// 下駄箱データの読み書き関数
function getJoinedRooms() {
    try { return JSON.parse(localStorage.getItem(STORAGE.JOINED_ROOMS)) || []; }
    catch(e) { return []; }
}
function saveJoinedRoom(roomId, pass, myName) {
    let rooms = getJoinedRooms();
    rooms = rooms.filter(r => r.roomId !== roomId); 
    rooms.push({ roomId, pass, myName, lastAccessed: Date.now() });
    localStorage.setItem(STORAGE.JOINED_ROOMS, JSON.stringify(rooms));
}
function removeJoinedRoom(roomId) {
    let rooms = getJoinedRooms();
    rooms = rooms.filter(r => r.roomId !== roomId);
    localStorage.setItem(STORAGE.JOINED_ROOMS, JSON.stringify(rooms));
}

window.addEventListener('DOMContentLoaded', initApp);

function initApp() {
    window.resumeDrawing = resumeDrawing; 

    const urlParams = new URLSearchParams(window.location.search);
    const rawGroup = urlParams.get('group');
    const rawPass = urlParams.get('pass');
    const inviteGroup = rawGroup ? rawGroup.trim() : null;
    const invitePass = rawPass ? rawPass.trim() : null;

    let savedId = localStorage.getItem(STORAGE.ID);
    if (!savedId) {
        savedId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem(STORAGE.ID, savedId);
    }
    State.myId = savedId;

    if (inviteGroup) {
        window.showScreen('screen-getabako');
        const msgEl = document.getElementById('getabako-msg');
        const inputName = document.getElementById('getabako-name');
        const btnContinue = document.getElementById('btn-getabako-continue');
        const btnIgnore = document.getElementById('btn-getabako-ignore');

        const existRoom = getJoinedRooms().find(r => r.roomId === inviteGroup);
        if (existRoom) inputName.value = existRoom.myName;

        msgEl.innerHTML = `招待状が届いています。<br>教室「<strong>${inviteGroup}</strong>」に入りますか？`;
        btnContinue.innerText = `👟 入室する`;
        
        btnContinue.onclick = () => {
            const name = inputName.value.trim();
            if (!name) return alert("名前を入れてね！");
            State.myName = name;
            updateNameTag();
            joinRoomLogic(inviteGroup, invitePass, State.myName, true);
        };

        btnIgnore.style.display = "block";
        btnIgnore.onclick = () => {
            window.history.replaceState(null, null, window.location.pathname);
            window.showScreen('screen-title'); 
        };
        return;
    }

    setupTitleScreen();
    window.showScreen('screen-title');
}

// タイトル画面で下駄箱を表示
function setupTitleScreen() {
    const rooms = getJoinedRooms();
    const listEl = document.getElementById('joined-rooms-list');
    const container = document.getElementById('joined-rooms-container');
    listEl.innerHTML = '';
    
    if (rooms.length > 0) {
        rooms.sort((a,b) => b.lastAccessed - a.lastAccessed).forEach(r => {
            const btn = document.createElement('button');
            btn.className = 'title-menu-btn btn-continue';
            btn.style.margin = "0";
            btn.style.width = "100%";
            btn.innerHTML = `🚪 ${r.roomId} <span style="font-size:12px; margin-top:2px;">(名前: ${r.myName})</span>`;
            btn.onclick = () => {
                State.myName = r.myName;
                updateNameTag();
                joinRoomLogic(r.roomId, r.pass, r.myName, false);
            };
            listEl.appendChild(btn);
        });
        container.style.display = 'block';
    } else {
        container.style.display = 'none';
    }
}

// ★タイトル画面（下駄箱）に戻るための処理
window.returnToTitle = () => {
    // 裏側の通信を安全にストップする
    if (State.unsubRoom) { State.unsubRoom(); State.unsubRoom = null; }
    if (State.unsubHistory) { State.unsubHistory(); State.unsubHistory = null; }
    if (State.timer) { clearInterval(State.timer); State.timer = null; }
    
    State.roomName = ""; 
    setupTitleScreen();
    window.showScreen('screen-title');
};

function updateNameTag() {
    const el = document.getElementById('name-tag');
    if (State.myId) { el.style.display = 'block'; el.innerText = `📛 ${State.myName || '名無し'} (${State.myId.substring(0,4)})`; } 
    else { el.style.display = 'none'; }
}

window.showScreen = (id) => {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
        target.style.display = 'flex';
        try {
            const ads = target.querySelectorAll('.adsbygoogle');
            ads.forEach(ad => {
                if (!ad.getAttribute('data-adsbygoogle-status')) {
                    (window.adsbygoogle = window.adsbygoogle || []).push({});
                }
            });
        } catch(e) { console.log("広告ロード待機中"); }
    }
    if (id === 'screen-game' || id === 'screen-coloring') document.body.className = 'bg-desk';
    else document.body.className = 'bg-green';
    
    if(id === 'screen-game') setTimeout(() => initCanvas(), 100);
    if(id === 'screen-coloring') setTimeout(() => initColoringCanvas(), 100);
};

window.goToLobby = () => { window.showScreen('screen-lobby'); };
window.showHowTo = () => { document.getElementById('howto-modal').style.display = 'flex'; };
window.closeHowTo = () => { document.getElementById('howto-modal').style.display = 'none'; };

function getInviteUrl() {
    const baseUrl = window.location.href.split('?')[0];
    return `${baseUrl}?group=${encodeURIComponent(State.roomName)}&pass=${encodeURIComponent(State.roomData.password)}`;
}

window.createRoom = async () => {
    const roomName = document.getElementById('new-room-name').value.trim();
    const hostName = document.getElementById('new-host-name').value.trim();
    if(!roomName || !hostName) return alert("全部入力してね！");

    const pass = Math.random().toString(36).substring(2, 8);

    const docRef = doc(db, COLLECTION_NAME, roomName);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        if ((Date.now() - (data.startTime || 0)) < 60 * 60 * 1000) {
            return alert("その教室名は現在使われています。\n（作成から1時間以内のため上書きできません）");
        }
        if(!confirm(`「${roomName}」は以前使われていた教室ですが、\n時間が経っているため再利用できます！\n\nここを掃除して、新しい教室として使いますか？\n（※前の黒板の絵は消えます）`)) return;
    }
    
    State.forceGallery = false;
    State.myName = hostName;
    updateNameTag();

    const me = { id: State.myId, name: hostName };
    const now = Date.now();
    
    await setDoc(docRef, { 
        password: pass, 
        players: [me], 
        currentTurnIndex: 0, 
        startTime: now, 
        turnStartTime: now 
    });
    
    State.roomName = roomName;
    saveJoinedRoom(roomName, pass, hostName); 
    startListen();
};

async function joinRoomLogic(roomName, pass, guestName, isAuto = false) {
    const docRef = doc(db, COLLECTION_NAME, roomName);
    try {
        const rDoc = await getDoc(docRef);
        if(!rDoc.exists()) {
            if(isAuto) { alert(`教室「${roomName}」が見つかりません。解散した可能性があります。`); removeJoinedRoom(roomName); location.reload(); } 
            else { alert("グループが見つかりません。"); }
            return;
        }
        if(rDoc.data().password !== pass) {
            if(isAuto) { alert(`合言葉が変わりました。もう一度招待URLから入ってください。`); removeJoinedRoom(roomName); location.reload(); }
            else { alert("合言葉が違います。"); }
            return;
        }

        State.roomName = roomName;
        State.myName = guestName;

        let players = rDoc.data().players || [];
        const existingIndex = players.findIndex(p => p.id === State.myId);
        
        if (existingIndex === -1 && players.length >= MAX_PLAYERS) {
            alert(`ごめんね！この教室は満員（${MAX_PLAYERS}人）です。`);
            if(isAuto) window.showScreen('screen-title');
            return;
        }

        if (existingIndex !== -1) {
            players[existingIndex].name = guestName;
        } else {
            players.push({ id: State.myId, name: guestName });
        }

        await updateDoc(docRef, { players: players });
        
        saveJoinedRoom(roomName, pass, guestName); 
        State.forceGallery = false;
        startListen();
    } catch(e) { console.error(e); alert("入室エラー:\n" + e.message); window.showScreen('screen-title'); }
}

function startListen() {
    if (State.unsubRoom) { State.unsubRoom(); State.unsubRoom = null; }
    if (State.unsubHistory) { State.unsubHistory(); State.unsubHistory = null; }

    const roomRef = doc(db, COLLECTION_NAME, State.roomName);
    
    State.unsubRoom = onSnapshot(roomRef, (snap) => {
        if (!snap.exists()) { 
            alert("教室が解散されました。"); 
            removeJoinedRoom(State.roomName); localStorage.removeItem(STORAGE.CANVAS + State.roomName); location.reload(); return; 
        }
        State.roomData = snap.data();
        updateUI();
    });

    const historyQuery = query(collection(roomRef, "drawings"), orderBy("ts", "asc"));
    State.unsubHistory = onSnapshot(historyQuery, (snap) => {
        State.historyData = snap.docs.map(d => ({id: d.id, ...d.data()}));
        updateUI();
    });
}

function updateUI() {
    if (!State.roomData) return;
    const players = State.roomData.players || [];
    
    if (!players.find(p => p.id === State.myId) && State.roomName) {
        alert("退学（キック）になりました。");
        removeJoinedRoom(State.roomName); localStorage.removeItem(STORAGE.CANVAS + State.roomName); location.reload(); return;
    }

    const history = State.historyData || [];
    const isHost = (players.length > 0 && players[0].id === State.myId);

    if (history.length >= MAX_HISTORY) { renderGraduationScreen(history, isHost); return; }

    let turnIdx = State.roomData.currentTurnIndex;
    if (turnIdx >= players.length) turnIdx = 0;

    const currentPlayerObj = players[turnIdx];
    const currentTurnId = currentPlayerObj ? currentPlayerObj.id : "???";
    const isMyTurn = (currentTurnId === State.myId);

    if (currentTurnId === State.myId && State.lastTurnId !== State.myId && State.lastTurnId !== "") {
        State.forceGallery = false;
    }
    State.lastTurnId = currentTurnId;

    document.querySelectorAll('.room-name-label').forEach(el => el.innerText = State.roomName);
    
    const isAlone = players.length < 2;
    let subMsg = "";
    if (isAlone) {
        subMsg = "👥 友達を待っています...";
    } else {
        subMsg = `今は ${currentPlayerObj ? currentPlayerObj.name : "誰か"} さんの番`;
    }
    document.getElementById('header-sub-msg').innerText = subMsg;

    checkTimeLimit();
    if (!State.timer) State.timer = setInterval(checkTimeLimit, 1000 * 60);

    const disbandBtn = document.getElementById('btn-disband');
    const gameDisbandBtn = document.getElementById('btn-game-disband');

    if (isHost) { 
        disbandBtn.style.display = 'block'; 
        gameDisbandBtn.style.display = 'inline-block'; 
    } else { 
        disbandBtn.style.display = 'none'; 
        gameDisbandBtn.style.display = 'none'; 
    }

    const memberListEl = document.getElementById('member-list');
    memberListEl.innerHTML = "";
    players.forEach((p, index) => {
        const li = document.createElement('li');
        const badge = index === 0 ? "👑" : "👤";
        const isMe = p.id === State.myId ? " (自分)" : "";
        const isTurn = index === turnIdx ? "🖌️" : "";
        li.innerHTML = `<span>${badge}${isTurn} ${p.name}${isMe}</span>`;
        if (isHost && p.id !== State.myId) {
            const kickBtn = document.createElement('button');
            kickBtn.innerText = "×"; kickBtn.className = "kick-btn";
            kickBtn.onclick = () => kickPlayer(p.id, p.name);
            li.appendChild(kickBtn);
        }
        memberListEl.appendChild(li);
    });

    const myIdx = players.findIndex(p => p.id === State.myId);
    let waitMsg = "";
    if (isAlone) { waitMsg = "👥 友達を待っています（2人から開始）"; } 
    else if (myIdx !== -1) {
        let waitCount = (myIdx - turnIdx + players.length) % players.length;
        waitMsg = (waitCount === 0) ? "あなたの番！" : `あと ${waitCount} 人`;
    }
    document.getElementById('turn-indicator').innerText = waitMsg;
    document.querySelectorAll('.invite-url-box').forEach(el => el.value = getInviteUrl());

    const continueBtn = document.getElementById('continue-btn');
    if (isMyTurn && State.forceGallery && !isAlone) { continueBtn.style.display = 'block'; } 
    else { continueBtn.style.display = 'none'; }

    const gallery = document.getElementById('gallery');
    gallery.innerHTML = "";
    if (history.length === 0) {
        gallery.innerHTML = '<p class="empty-msg">まだ絵がありません。<br>1ページ目を描こう！</p>';
    } else {
        history.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = "gallery-item";

            const img = document.createElement('img');
            img.src = item.url; 
            img.onclick = () => openDetailModal(index);
            div.appendChild(img);

            const badge = document.createElement('div');
            badge.className = "order-badge";
            badge.innerText = index + 1;
            div.appendChild(badge);

            if (index < history.length - 1) {
                const arrow = document.createElement('div');
                arrow.className = "flow-arrow";
                arrow.innerText = "⬇";
                div.appendChild(arrow);
            }

            if (item.fusens && item.fusens.length > 0) {
                const fBadge = document.createElement('div');
                fBadge.className = "fusen-badge";
                fBadge.innerText = item.fusens.length;
                div.appendChild(fBadge);
            }

            gallery.appendChild(div);
        });
        
        setTimeout(() => { gallery.scrollTop = gallery.scrollHeight; }, 100);
    }
    document.getElementById('history-count').innerText = `${history.length}/${MAX_HISTORY}`;

    if (State.selectIndex !== -1 && document.getElementById('detail-modal').style.display === 'flex') {
        renderModalFusens(history[State.selectIndex]);
    }

    if (isMyTurn && !State.isProcessing && !State.forceGallery && !isAlone) {
        window.showScreen('screen-game');

        const prevBar = document.getElementById('prev-history-bar');
        prevBar.innerHTML = ""; 
        
        const historyLen = history.length;
        if (historyLen > 0) {
            const startIdx = Math.max(0, historyLen - 5);
            const recentHistory = history.slice(startIdx, historyLen);
            
            recentHistory.forEach((item) => {
                const thumbBox = document.createElement('div');
                thumbBox.className = "thumb-box";
                const img = document.createElement('img');
                img.src = item.url;
                img.onclick = () => openReferenceModal(item.url);
                thumbBox.appendChild(img);
                prevBar.appendChild(thumbBox);
            });
            document.getElementById('prev-history-container').style.display = 'flex';
        } else {
            document.getElementById('prev-history-container').style.display = 'none';
        }
        setTimeout(() => initCanvas(), 100);
    } else {
        window.showScreen('screen-waiting');
    }
}

window.openReferenceModal = (url) => {
    const modal = document.getElementById('reference-modal');
    const img = document.getElementById('ref-modal-img');
    img.src = url;
    modal.style.display = 'flex';
};
window.closeReferenceModal = () => { document.getElementById('reference-modal').style.display = 'none'; };

function renderModalFusens(item) {
    const fc = document.getElementById('detail-fusen-layer'); 
    fc.innerHTML=""; 
    if(item && item.fusens) {
        item.fusens.forEach(f=>{ 
            const el=document.createElement('div'); 
            el.className=`fusen-sticker fusen-${f.type}`; 
            let t = "😊"; 
            if(f.type==='good') t="👍"; 
            if(f.type==='clap') t="👏";
            el.innerText=t; 
            el.style.left=f.x+"%"; el.style.top=f.y+"%"; 
            fc.appendChild(el); 
        }); 
    }
}

window.sendFusen = async (type) => {
    if (State.isProcessing) return;
    if (State.selectIndex === -1) return;
    
    const item = State.historyData[State.selectIndex];
    if(!item || !item.id) return;

    const myCount = (item.fusens || []).filter(f => f.from === State.myId).length;
    if (myCount >= MAX_FUSEN_PER_TURN) { alert("この絵への応援は10回まで！"); return; }

    State.isProcessing = true;
    const corner = Math.floor(Math.random() * 4);
    let x, y; const margin = 10; const jitter = 10;
    if (corner === 0) { x = margin + Math.random()*jitter; y = margin + Math.random()*jitter; }
    else if (corner === 1) { x = (90-margin) - Math.random()*jitter; y = margin + Math.random()*jitter; }
    else if (corner === 2) { x = margin + Math.random()*jitter; y = (90-margin) - Math.random()*jitter; }
    else { x = (90-margin) - Math.random()*jitter; y = (90-margin) - Math.random()*jitter; }

    const newFusen = { from: State.myId, type: type, x: x, y: y, ts: Date.now() };
    try { 
        await updateDoc(doc(db, COLLECTION_NAME, State.roomName, "drawings", item.id), { 
            fusens: arrayUnion(newFusen) 
        }); 
    } catch(e) { 
        console.error(e); 
    } finally {
        State.isProcessing = false;
    }
};

window.openDetailModal = (index) => { 
    State.selectIndex = index; 
    const item = State.historyData[index]; 
    document.getElementById('detail-img').src = item.url; 
    
    renderModalFusens(item);
    
    let html = "";
    if (State.historyData.length >= MAX_HISTORY) {
        html += `<hr style="margin:10px 0;border:0;border-top:1px dashed #ccc;"><button onclick="startColoringFromModal('${item.url}')" style="background:#ff9800;color:#fff;border:none;padding:5px 15px;border-radius:15px;font-size:12px;margin-top:10px;">🎨 塗り絵する (CM)</button>`; 
    } else {
        html += `<p style="color:#888; font-size:10px;">卒業（${MAX_HISTORY}枚）すると塗り絵ができます</p>`;
    }
    
    document.getElementById('detail-coloring-btn-container').innerHTML = html; 
    document.getElementById('detail-modal').style.display='flex'; 
};
window.closeDetailModal = () => { document.getElementById('detail-modal').style.display='none'; State.selectIndex=-1; };
window.startColoringFromModal = (url) => { closeDetailModal(); startColoring(url); };

function resumeDrawing() { State.forceGallery = false; updateUI(); }

window.resetRoomHistory = async () => {
    if(!confirm("【重要】\n今までの絵を全て消して、\n1ページ目からやり直しますか？\n（参加者はそのままです）")) return;
    deleteRoomLogic(false);
};

window.disbandRoom = async () => {
    if(!confirm("【解散】\n本当に解散しますか？\n部屋もデータも全て消えます。")) return;
    deleteRoomLogic(true);
};

async function deleteRoomLogic(deleteRoomSelf) {
    try {
        const roomRef = doc(db, COLLECTION_NAME, State.roomName);
        const q = query(collection(roomRef, "drawings"));
        const snap = await getDocs(q);
        const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
        await Promise.all(deletePromises);

        if (deleteRoomSelf) {
            await deleteDoc(roomRef);
            alert("教室を解散しました。");
            removeJoinedRoom(State.roomName);
            localStorage.removeItem(STORAGE.CANVAS + State.roomName);
            location.reload();
        } else {
            await updateDoc(roomRef, { 
                currentTurnIndex: 0, 
                turnStartTime: Date.now()
            });
            alert("黒板をきれいにしました！");
        }
    } catch(e) { alert(e.message); }
}

let ctx, drawing = false; 
const PENCIL_COLOR = "#555555"; 

function initCanvas(isResize = false) {
    const c = document.getElementById('canvas'); 
    const container = document.getElementById('canvas-area'); 
    if (!c || !container) return; 
    if (!ctx) ctx = c.getContext('2d');

    if (c.width !== container.clientWidth || c.height !== container.clientHeight) {
        c.width = container.clientWidth;
        c.height = container.clientHeight;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        window.setPen('thin'); 
        restoreFromBackup();
    }

    function restoreFromBackup() {
        const backup = localStorage.getItem(STORAGE.CANVAS + State.roomName);
        if (backup) {
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
            img.src = backup;
        }
    }

    const getPos = (e) => { 
        const rect = c.getBoundingClientRect(); 
        const scaleX = c.width / rect.width; 
        const scaleY = c.height / rect.height;
        return { 
            x: (e.clientX - rect.left) * scaleX, 
            y: (e.clientY - rect.top) * scaleY,
            pressure: e.pressure 
        }; 
    };

    const saveToLocal = () => { if (State.roomName) localStorage.setItem(STORAGE.CANVAS + State.roomName, c.toDataURL()); };

    c.onpointerdown = (e) => { 
        drawing = true; 
        c.setPointerCapture(e.pointerId); 
        const p = getPos(e); 
        ctx.beginPath(); 
        ctx.moveTo(p.x, p.y); 
        e.preventDefault(); 
    };

    c.onpointermove = (e) => { 
        if(drawing) { 
            const p = getPos(e);
            if (ctx.globalCompositeOperation !== 'destination-out' && p.pressure > 0 && e.pointerType === 'pen') {
                let baseWidth = document.getElementById('btn-thin').classList.contains('selected') ? 2 : 8;
                ctx.lineWidth = baseWidth * (p.pressure * 2); 
            }
            ctx.lineTo(p.x, p.y); 
            ctx.stroke(); 
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            e.preventDefault(); 
        } 
    };

    c.onpointerup = (e) => { 
        drawing = false; 
        c.releasePointerCapture(e.pointerId);
        saveToLocal(); 
        window.setPen(document.getElementById('btn-thin').classList.contains('selected') ? 'thin' : 'thick');
    };
    
    if (!isResize) restoreFromBackup();
}

window.setPen = (type) => { 
    document.querySelectorAll('#screen-game .tool-btn').forEach(b => b.classList.remove('selected'));
    if (type === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 20; ctx.globalAlpha = 1.0; ctx.shadowBlur = 0; document.getElementById('btn-eraser').classList.add('selected'); } else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = PENCIL_COLOR; ctx.shadowColor = PENCIL_COLOR; if (type === 'thin') { ctx.lineWidth = 2; ctx.globalAlpha = 0.6; ctx.shadowBlur = 1; document.getElementById('btn-thin').classList.add('selected'); } else { ctx.lineWidth = 8; ctx.globalAlpha = 0.4; ctx.shadowBlur = 3; document.getElementById('btn-thick').classList.add('selected'); } }
};

function isCanvasBlank(canvas) {
    const context = canvas.getContext('2d');
    const pixelBuffer = new Uint32Array(context.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    return !pixelBuffer.some(color => color !== 0);
}

function getCanvasJpeg() {
    const c = document.getElementById('canvas');
    const tempC = document.createElement('canvas');
    tempC.width = c.width; tempC.height = c.height;
    const tCtx = tempC.getContext('2d');
    tCtx.fillStyle = "#ffffff";
    tCtx.fillRect(0, 0, tempC.width, tempC.height);
    tCtx.drawImage(c, 0, 0);
    return tempC.toDataURL("image/jpeg", 0.8);
}

window.submitArt = async () => {
    const canvas = document.getElementById('canvas');
    if (isCanvasBlank(canvas)) {
        return alert("まっしろだよ！\n何か描いてから回してね。");
    }

    if(!confirm("描き終わった？")) return;
    State.isProcessing = true; 
    try {
        const dataUrl = getCanvasJpeg();
        const nextTurn = (State.roomData.currentTurnIndex + 1) % State.roomData.players.length;
        
        const newHistoryItem = { url: dataUrl, authorId: State.myId, fusens: [], ts: Date.now() };

        await addDoc(collection(db, COLLECTION_NAME, State.roomName, "drawings"), newHistoryItem);

        await updateDoc(doc(db, COLLECTION_NAME, State.roomName), { 
            currentTurnIndex: nextTurn, 
            turnStartTime: Date.now()
        });
        
        localStorage.removeItem(STORAGE.CANVAS + State.roomName);
        const c = document.getElementById('canvas'); const tCtx = c.getContext('2d'); tCtx.clearRect(0, 0, c.width, c.height);
        State.forceGallery = true; State.isProcessing = false; 
        updateUI();
    } catch (e) { alert("送信エラー: " + e.message); State.isProcessing = false; updateUI(); }
};

window.leaveRoom = async () => {
    if(!confirm("本当に転校（退出）しますか？")) return;
    if (State.roomData && State.roomData.players) {
        const newPlayers = State.roomData.players.filter(p => p.id !== State.myId);
        let newTurnIdx = State.roomData.currentTurnIndex; if (newTurnIdx >= newPlayers.length) newTurnIdx = 0;
        try { await updateDoc(doc(db, COLLECTION_NAME, State.roomName), { players: newPlayers, currentTurnIndex: newTurnIdx }); } catch(e) { console.error(e); }
    }
    removeJoinedRoom(State.roomName); 
    localStorage.removeItem(STORAGE.CANVAS + State.roomName);
    alert("転校しました。"); location.reload();
};

window.resetIdentity = () => { if(!confirm("⚠️本当に全データを消去して引退しますか？参加していた教室には入れなくなります。")) return; localStorage.clear(); location.reload(); };

function checkTimeLimit() { 
    if(!State.roomData||State.historyData.length>=MAX_HISTORY)return; 
    const p=State.roomData.players||[]; if(p.length===0)return; 
    const elapsed=Date.now()-(State.roomData.turnStartTime||State.roomData.startTime||Date.now()); 
    const ratio=(TIME_LIMIT_MS-elapsed)/TIME_LIMIT_MS; 
    document.querySelectorAll('.timer-bar-fill').forEach(pb => {
        pb.style.width=Math.max(0,Math.floor(ratio*100))+"%"; 
        if(ratio*100<20)pb.classList.add('short');else pb.classList.remove('short'); 
    });
    if(ratio<=0&&!State.isProcessing)skipTurnAutomatically(); 
}
async function skipTurnAutomatically() { State.isProcessing=true; try{ const next=(State.roomData.currentTurnIndex+1)%State.roomData.players.length; await updateDoc(doc(db,COLLECTION_NAME,State.roomName),{currentTurnIndex:next,turnStartTime:Date.now()}); }catch(e){console.error(e);}finally{State.isProcessing=false;} }
window.startColoring = async (url) => { if(State.tickets<=0)return alert("チケットがありません"); if(!confirm("CMを見て塗り絵を始めますか？"))return; document.getElementById('cm-overlay').style.display='flex'; await new Promise(r=>setTimeout(r,3000)); document.getElementById('cm-overlay').style.display='none'; State.tickets--; State.colorUrl=url; window.showScreen('screen-coloring'); };
window.closeColoring = () => { if(!confirm("終了しますか？"))return; if(State.historyData.length>=MAX_HISTORY)window.showScreen('screen-graduation'); else window.showScreen('screen-waiting'); updateUI(); };

window.deleteRoomData = async () => { if(!confirm("削除しますか？"))return; deleteRoomLogic(true); };

function renderGraduationScreen(history, isHost) { const currentScreen = document.querySelector('.screen.active'); if (currentScreen && (currentScreen.id === 'screen-coloring' || document.getElementById('detail-modal').style.display === 'flex')) return; window.showScreen('screen-graduation'); document.querySelectorAll('.room-name-label').forEach(el => el.innerText = State.roomName); document.getElementById('coloring-ticket-count').innerText = State.tickets; const grid = document.getElementById('grad-grid'); grid.innerHTML = ""; history.forEach((item, i) => { const div = document.createElement('div'); div.className = "grad-item"; const img = document.createElement('img'); img.src = item.url; img.onclick = () => openDetailModal(i); div.appendChild(img); if (item.fusens && item.fusens.length > 0) { const badge = document.createElement('span'); badge.style.fontSize = "10px"; badge.innerText = `💌 ${item.fusens.length}`; div.appendChild(document.createElement('br')); div.appendChild(badge); } grid.appendChild(div); }); const deleteArea = document.getElementById('host-delete-area'); if (isHost) { deleteArea.style.display = 'block'; } else { deleteArea.style.display = 'none'; } }

function initColoringCanvas() { 
    const c = document.getElementById('coloring-canvas'); 
    if(!cCtx) cCtx = c.getContext('2d'); 
    c.width = c.parentElement.clientWidth; 
    c.height = c.parentElement.clientHeight; 
    cCtx.lineCap = "round"; 
    cCtx.lineJoin = "round"; 
    
    document.getElementById('line-art-overlay').src = State.colorUrl; 
    document.getElementById('pen-size-slider').value = 20; 
    window.setMarker('marker'); 

    const getPos = (e) => {
        const r = c.getBoundingClientRect(); 
        const sx = c.width / r.width; 
        const sy = c.height / r.height; 
        return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy, pressure: e.pressure };
    }; 
    
    let d = false; 
    
    c.onpointerdown = (e) => { d = true; c.setPointerCapture(e.pointerId); const p = getPos(e); cCtx.beginPath(); cCtx.moveTo(p.x, p.y); e.preventDefault(); }; 
    c.onpointermove = (e) => {
        if(d){
            const p = getPos(e);
            if (cCtx.globalCompositeOperation !== 'destination-out' && p.pressure > 0 && e.pointerType === 'pen') {
                let baseSize = document.getElementById('pen-size-slider').value;
                cCtx.lineWidth = baseSize * (p.pressure * 1.5);
            }
            cCtx.lineTo(p.x, p.y); cCtx.stroke(); cCtx.beginPath(); cCtx.moveTo(p.x, p.y); e.preventDefault();
        }
    }; 
    c.onpointerup = (e) => { d = false; c.releasePointerCapture(e.pointerId); window.updateSize(); }; 
}

let cCtx;
window.setMarker=(t)=>{ cCtx.globalCompositeOperation='source-over'; cCtx.lineWidth=document.getElementById('pen-size-slider').value; document.querySelectorAll('.tool-box').forEach(b=>b.classList.remove('selected')); if(t==='marker'){document.getElementById('tool-marker').classList.add('selected');updateColor();}else if(t==='crayon'){document.getElementById('tool-crayon').classList.add('selected');updateColor();}else{cCtx.globalCompositeOperation='destination-out';cCtx.globalAlpha=1;document.getElementById('tool-eraser').classList.add('selected');} };
window.updateSize=()=>{cCtx.lineWidth=document.getElementById('pen-size-slider').value;}; window.updateColor=()=>{const c=document.getElementById('color-picker').value; document.documentElement.style.setProperty('--current-color',c); if(cCtx.globalCompositeOperation!=='destination-out'){ if(document.getElementById('tool-marker').classList.contains('selected')){ const r=parseInt(c.substr(1,2),16),g=parseInt(c.substr(3,2),16),b=parseInt(c.substr(5,2),16); cCtx.strokeStyle=`rgba(${r},${g},${b},0.4)`; }else{ cCtx.strokeStyle=c; } } };

window.saveColoring=async()=>{ 
    if(!confirm("完成？"))return; 
    const t=document.createElement('canvas'); 
    t.width=cCtx.canvas.width; t.height=cCtx.canvas.height; 
    const tx=t.getContext('2d'); 
    tx.fillStyle="#fff"; tx.fillRect(0,0,t.width,t.height); 
    tx.drawImage(cCtx.canvas,0,0); 
    tx.globalCompositeOperation = 'multiply';
    tx.drawImage(document.getElementById('line-art-overlay'),0,0,t.width,t.height); 
    t.toBlob(b=>{ 
        const f=new File([b],"nurie.png",{type:"image/png"}); 
        if(navigator.share){navigator.share({files:[f]}).catch(()=>{downloadBlob(b)})}else{downloadBlob(b)} 
    }); 
};

function downloadBlob(blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = "nurie.png"; a.click(); alert("画像を保存しました！"); }
window.kickPlayer = async (targetId, targetName) => { if (!confirm(`${targetName} さんを強制退室させますか？`)) return; const newPlayers = State.roomData.players.filter(p => p.id !== targetId); let newTurnIdx = State.roomData.currentTurnIndex; if (newTurnIdx >= newPlayers.length) newTurnIdx = 0; try { await updateDoc(doc(db, COLLECTION_NAME, State.roomName), { players: newPlayers, currentTurnIndex: newTurnIdx }); } catch(e) { alert(e.message); } };
let resizeTimeout; window.addEventListener('resize', () => { clearTimeout(resizeTimeout); resizeTimeout = setTimeout(() => { const gameScreen = document.getElementById('screen-game'); const colorScreen = document.getElementById('screen-coloring'); if (gameScreen.style.display === 'flex') initCanvas(true); if (colorScreen.style.display === 'flex') initColoringCanvas(); }, 200); });
window.copyInvite = () => { navigator.clipboard.writeText(getInviteUrl()).then(()=>alert("URLコピーしました")); };

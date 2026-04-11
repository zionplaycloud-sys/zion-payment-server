

    window.onerror = function(message) {
        console.error("ERROR:", message);
        return true;
    };
        const BACKEND_URL = "https://zion-payment-server-o7p6.onrender.com";

    async function safeFetch(url, options = {}) {
        try {
            const res = await fetch(url, options);

            if (!res.ok) {
                console.error("Server error:", res.status);
                return null;
            }

            return await res.json();

        } catch (err) {
            console.error("Network error:", err);
            return null;
        }
    }

    async function loadGamesFromServer() {
        const data = await safeFetch(`${BACKEND_URL}/get-games`);

        if(data && data.success){
            state.content.games = data.games;
            renderUI();
        }
    }
        async function loadStats(range) {
        const data = await safeFetch(`${BACKEND_URL}/admin-stats?range=${range}`);
        if(!data){
            showPopup("Server offline", "ERROR ❌");
            return;
        }

        if(data.success){
            document.getElementById("stats-box").innerHTML = `
                <div style="background:#111;padding:10px;border-radius:10px;">
                    <div>💰 Revenue: ₹${data.totalRevenue}</div>
                    <div>📦 Orders: ${data.totalOrders}</div>
                    <div>⏱ Hours Sold: ${data.totalHours}</div>
                    <div>⚡ Points: ${data.totalPoints}</div>
                </div>
            `;
        } else {
            document.getElementById("stats-box").innerText = "Failed to load stats";
        }

    }
            // --- 1. NEURAL ENGINE ---
            const canvas = document.getElementById('bg-canvas');
            const ctx = canvas.getContext('2d');
            let dots = [], mouse = { x: null, y: null };
            window.onmousemove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; };
            window.ontouchmove = (e) => { mouse.x = e.touches[0].clientX; mouse.y = e.touches[0].clientY; };
            function initBG() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; dots = []; for(let i=0; i<50; i++) dots.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height, vx: (Math.random()-0.5)*0.4, vy: (Math.random()-0.5)*0.4, color: Math.random() > 0.5 ? '#bc13fe' : '#00d2ff' }); }
            function drawBG() { ctx.clearRect(0,0,canvas.width, canvas.height); dots.forEach((d, i) => { d.x += d.vx; d.y += d.vy; if(d.x<0 || d.x>canvas.width) d.vx*=-1; if(d.y<0 || d.y>canvas.height) d.vy*=-1; let mDist = Math.hypot(d.x-mouse.x, d.y-mouse.y); if(mDist < 120) { ctx.strokeStyle = d.color; ctx.globalAlpha = 1 - (mDist / 120); ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke(); ctx.globalAlpha = 1; } dots.slice(i+1).forEach(d2 => { if(Math.hypot(d.x-d2.x, d.y-d2.y)<100){ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.beginPath();ctx.moveTo(d.x,d.y);ctx.lineTo(d2.x,d2.y);ctx.stroke();}}); ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(d.x, d.y, 1.2, 0, Math.PI*2); ctx.fill(); }); requestAnimationFrame(drawBG); }
            initBG(); drawBG();
            window.onresize = initBG;

            // --- 2. GLOBAL STATE ---
            

            let state = {
                pts: 0, hrs: 0, isCmd: false, activeTab: 'home',
                tabs: ['Home', 'Games', 'Arcade', 'Shop', 'Reward'],
                homeData: {
                    heroTitle: "MW III", heroImg: "https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1200",
                    offerTitle: "POINTS SYSTEM", offerDesc: "₹100 Spent = 10 Pts | Referral = 20 Pts",
                    userLabel: "WELCOME COMMANDER", userLevel: "LEGENDARY"
                },
                content: {
                    games: [
                        { id: 'g1', name: "MODERN WARFARE III", img: "https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=800", desc: "Elite realistic warfare instance.", exePath: "" },
                        { id: 'g2', name: "FC MOBILE 25", img: "https://images.unsplash.com/photo-1552820728-8b83bb6b773f?q=80&w=800", desc: "Build your legacy squad.", exePath: "" },
                        { id: 'g3', name: "GHOST OF TSUSHIMA", img: "https://images.unsplash.com/photo-1605898835373-013eb423b0f2?q=80&w=800", desc: "Honor vs Survival.", exePath: "" }
                    ],
                    arcade: [{ id: 'a1', name: "DHAKA COMMUNITY CUP", img: "https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=800", prize: "25k PTS", desc: "Pro Tournament." }],
                    shop: [
                        { id: 's1', name: "TRIAL", cost: "49", time: 0.5, bonus: 5, img: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=800", desc: "30 Mins Access + 5 Pts" },
                        { id: 's2', name: "BASIC", cost: "99", time: 1.0, bonus: 10, img: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=800", desc: "1 Hour Access + 10 Pts" },
                        { id: 's3', name: "VALUE", cost: "249", time: 3.0, bonus: 30, img: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=800", desc: "3 Hours Access + 30 Pts" },
                        { id: 's4', name: "POWER", cost: "399", time: 5.0, bonus: 50, img: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=800", desc: "5 Hours Access + 50 Pts" },
                        { id: 's5', name: "PRO", cost: "699", time: 10.0, bonus: 100, img: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=800", desc: "10 Hours Access + 100 Pts" },
                        { id: 's6', name: "ELITE", cost: "1199", time: 20.0, bonus: 200, img: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=800", desc: "20 Hours Access + 200 Pts + Priority" }
                    ],
                    reward: [
                        { id: 'r1', name: "REDEEM PLAYTIME", cost: "99", time: 0.5, img: "https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?q=80&w=800", desc: "Redeem 99 Pts for 30 Mins." }
                    ]
                }
            };

        async function syncStateFromServer() {
        const data = await safeFetch(`${BACKEND_URL}/get-system-state`);
        if(!data){
            showPopup("Server offline", "ERROR ❌");
            return;
        }

        if(data.success && data.state && currentUserEmail){
            if(data.state[currentUserEmail]){
                state.hrs = data.state[currentUserEmail].timeLeft;
            }
        }

    }

            let currentUserEmail = "";
            let timerInterval;
            let insMode = 'edit', editId = '', editList = '';
            let currentGameRunning = "Game"; // 🔥 Track which game is running
            let isLaunchingGame = false;

            function goToSignup() { document.getElementById('landing-page').style.display = 'none'; document.getElementById('signup-page').style.display = 'flex'; }
            function goToLogin() { document.getElementById('signup-page').style.display = 'none'; document.getElementById('landing-page').style.display = 'flex'; }


            async function processAuth(mode) {
                if(mode === 'signup') {
                    const email = document.getElementById('new-uid').value;
                    const password = document.getElementById('new-ups').value;
                    if(!email || !password) return showPopup("ENTER DETAILS");
                    const data = await safeFetch(`${BACKEND_URL}/signup`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });
                    if(!data){
                        showPopup("Server offline", "ERROR ❌");
                        return;
                    }
                    if(data.success){ showPopup("ACCOUNT CREATED"); goToLogin(); } 
                    else { showPopup("USER EXISTS OR ERROR OCCURRED"); }
                    return;
                }

                const email = document.getElementById('uid').value;
                const password = document.getElementById('ups').value;
                if(!email || !password) return showPopup("CREDENTIALS REQUIRED");


                const data = await safeFetch(`${BACKEND_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                if(!data){
                    showPopup("Server offline", "ERROR ❌");
                    return;
                }

    if(data.success){

        // 👑 ADMIN
        if(data.isAdmin){
            state.isCmd = true;
            enterOS();
            return;
        }

        // 👤 USER
        if((data.hrs || 0) <= 0){
            showPopup("You don't have enough balance.\nContact admin.", "ACCESS DENIED ⚠️");
            return;
        }

        state.isCmd = false;
    currentUserEmail = email;
    state.pts = data.pts || 0;

    // 🔥 FIRST LOAD REAL TIME FROM SESSION
    await syncStateFromServer();

    // 🔥 NOW CHECK REAL TIME
    if((state.hrs || 0) <= 0){
        showPopup("You don't have enough balance.\nContact admin.", "ACCESS DENIED ⚠️");
        return;
    }

    enterOS();
    startTimer();

    }
    else {
        showPopup("INVALID LOGIN ❌");
    }
    }

            async function enterOS() {
                document.getElementById('gaming-bg').style.opacity = "1";
                document.getElementById('landing-page').style.display = 'none';
                document.getElementById('signup-page').style.display = 'none';
                document.getElementById('dashboard-wrapper').style.display = 'flex';

                await loadGamesFromServer();

                renderUI();
                if(state.isCmd){ showAdminPanel(); }
            }

            function renderUI() {
                const pen = state.isCmd ? 'display:block' : 'display:none';
    document.getElementById('pts-box').innerText = (state.pts || 0).toLocaleString();            
    document.getElementById('hrs-box').innerText = (state.hrs || 0).toFixed(2);
                document.getElementById('pill-nav').innerHTML = state.tabs.map(t => `<div class="nav-link ${state.activeTab === t.toLowerCase() ? 'active' : ''}" onclick="setTab('${t.toLowerCase()}')">${t}</div>`).join('');
                let port = document.getElementById('view-port'), tab = state.activeTab, html = '';
                
                if(tab === 'home') {
                    html = `<section class="section active">
                        <div style="position:relative; margin-bottom:30px">
                            <i data-lucide="pencil" class="edit-pen" style="${pen}" onclick="openEdit('heroTitle', 'homeData')"></i>
                            <h1 class="hero-title">${state.homeData.heroTitle}</h1>
                            <button class="btn-zion" style="width:160px; margin: 0 auto;" onclick="openPortal('g1','games')">LAUNCH</button>
                        </div>
                        <div style="position:relative; background:rgba(255,255,255,0.03); border:1px solid var(--border); padding:20px; border-radius:25px; display:flex; justify-content:space-between; align-items:center; margin-bottom:30px">
                            <i data-lucide="pencil" class="edit-pen" style="${pen}" onclick="openEdit('offerTitle', 'homeData')"></i>
                            <div style="flex:1; padding-right:10px;"><h2 style="font-weight:700; font-size: 0.9rem">${state.homeData.offerTitle}</h2><p style="color:#666; font-size:0.7rem">${state.homeData.offerDesc}</p></div>
                            <button class="btn-zion" style="width:80px; background:#fff; color:#000; font-size:0.6rem; padding:10px; margin:0" onclick="setTab('reward')">VIEW</button>
                        </div>
                        <h2 style="font-weight:700; margin-bottom:15px; font-size:0.8rem;">// POPULAR</h2>
                        <div class="grid">${state.content.games.map(g => `<div class="card" onclick="openPortal('${g.id}','games')"><img src="${g.img}" class="card-img"><h4>${g.name}</h4><span class="time-badge">OS TIME: ${state.hrs.toFixed(2)} HRS</span></div>`).join('')}</div>
                    </section>`;
                } else {
                    html = `<section class="section active"><h2>// ${tab.toUpperCase()}</h2><div class="grid" style="margin-top:20px">${(state.content[tab] || []).map(i => `
                        <div class="card" onclick="openPortal('${i.id}', '${tab}')">
                            <i data-lucide="pencil" class="edit-pen" style="${pen}" onclick="event.stopPropagation(); openEdit('${i.id}', '${tab}')"></i>
                            <img src="${i.img || 'https://via.placeholder.com/400'}" class="card-img">
                            <h4>${i.name}</h4>
                            ${tab === 'games' ? `<span class="time-badge">OS TIME: ${state.hrs.toFixed(2)} HRS</span>` : `<p class="price-tag">${tab === 'shop' ? '₹'+i.cost : i.cost + ' PTS'}</p>`}
                        </div>`).join('')}</div></section>`;
                }
                port.innerHTML = html;
                document.getElementById('sidebar-container').innerHTML = `
                    <div class="side-card"><i data-lucide="pencil" class="edit-pen" style="${pen}" onclick="openEdit('userLabel', 'homeData')"></i><span class="side-tag">USER</span><h2 style="font-weight:700; font-size:1.1rem">${state.homeData.userLabel}</h2></div>
                    <div class="side-card" style="border-left:4px solid var(--purple)"><i data-lucide="pencil" class="edit-pen" style="${pen}" onclick="openEdit('userLevel', 'homeData')"></i><span class="side-tag">LEVEL</span><h2 style="font-weight:700; font-size:1.1rem">${state.homeData.userLevel}</h2></div>`;
                lucide.createIcons();
            }

            function openPortal(id, list) {
    document.getElementById('universal-portal').style.display = 'flex';
                let item = state.content[list].find(x => x.id === id);
                document.getElementById('portal-media').src = item.img;
                document.getElementById('portal-title').innerText = item.name;
                document.getElementById('portal-desc').innerText = item.desc;
                let btn = document.getElementById('portal-action-btn');
                if(list === 'games') btn.innerText = "START SESSION";
                else if(list === 'shop') btn.innerText = "BUY FOR ₹" + item.cost;
                else btn.innerText = "REDEEM FOR " + item.cost + " PTS";
                btn.onclick = async () => {

        // 🔥 SHOP → PAYMENT SYSTEM
    if(list === 'shop') {

        if(!currentUserEmail){
            showPopup("LOGIN REQUIRED ❌");
            return;
        }

        showPopup("Redirecting to payment...", "WAIT ⏳");

        try {
            const data = await safeFetch(`${BACKEND_URL}/create-order`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: currentUserEmail,
                    plan: item.name,
                    amount: parseInt(item.cost),
                    phone: ""
                })
            });
            if(!data){
                showPopup("Server offline", "ERROR ❌");
                return;
            }

            if(data.link){
                // 🔥 IMPORTANT: delay for smooth UX
                setTimeout(() => {
                    window.location.href = data.link;
                }, 800);
            } else {
                showPopup("PAYMENT LINK FAILED ❌");
            }

        } catch (err) {
            console.error(err);
    showPopup("Server issue, try again", "ERROR ❌");    }

        return;
    }
        // 🎁 REWARD SYSTEM
    else if(list === 'reward') {
        if(state.pts >= parseInt(item.cost)) {
            state.pts -= parseInt(item.cost);
            state.hrs += parseFloat(item.time);
            showPopup("EXCHANGE SUCCESSFUL!");
        } else {
            showPopup("INSUFFICIENT BALANCE");
        }
    }

    // 🎮 GAME LAUNCH
    else {

        if(state.hrs <= 0){
            showPopup("No time left ❌");
            return;
        }

        if(isLaunchingGame){
            showPopup("Already launching game ⏳");
            return;
        }

        isLaunchingGame = true;

        showPopup("Finding available PC...", "WAIT ⏳");

        const data = await safeFetch(`${BACKEND_URL}/assign-pc`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: currentUserEmail,
                game: item.name
            })
        });

        if(!data){
            showPopup("Server offline", "ERROR ❌");
            isLaunchingGame = false;
            return;
        }

        if(data && data.success){

            showPopup("PC Assigned: " + data.pc, "SUCCESS ✅");

            currentGameRunning = item.name.replace(/\s+/g, "");

            // 🔥 STEP 1 — LAUNCH GAME FIRST
            if(item.exePath && item.exePath.length > 3){

                let launched = false;

                try {
                    launched = await triggerExeOnHost(item.exePath);
                } catch (err) {
                    console.error("Game launch failed:", err);
                    showPopup("Game launch failed ❌");
                    isLaunchingGame = false;
                    return;
                }

                if(!launched){
                    isLaunchingGame = false;
                    return;
                }

            } else {
                showPopup("Launching cloud...");
            }

            // 🔥 CLOSE UI AFTER SUCCESS
            renderUI();
            closePortal();

  // 🔥 STEP 2 — CONNECT TO WEBRTC (REPLACES PARSEC)
setTimeout(() => {
    try {

        const viewer = window.open("", "_blank");

        const streamHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>ZION STREAM</title>
    <style>
        body { margin:0; background:black; display:flex; justify-content:center; align-items:center; height:100vh; }
        video { width:100%; height:100%; object-fit:contain; }
    </style>
</head>
<body>

<video id="video" autoplay playsinline></video>

<script>
(function(){

const pc = new RTCPeerConnection({
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
});

const video = document.getElementById("video");

pc.ontrack = function(event) {
    console.log("🎥 Stream received");
    video.srcObject = event.streams[0];
};

const ws = new WebSocket("wss://zion-payment-server-o7p6.onrender.com");

ws.onopen = async function () {
    const offer = await pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true
    });

    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
        type: "offer",
        offer: offer
    }));
};

ws.onmessage = async function (msg) {
    const data = JSON.parse(msg.data);

    if (data.type === "answer") {
        await pc.setRemoteDescription(data.answer);
    }

    if (data.type === "candidate") {
        await pc.addIceCandidate(data.candidate);
    }
};

pc.onicecandidate = function (event) {
    if (event.candidate) {
        ws.send(JSON.stringify({
            type: "candidate",
            candidate: event.candidate
        }));
    }
};

})();
<\/script>

</body>
</html>
`;

        viewer.document.open();
        viewer.document.write(streamHTML);
        viewer.document.close();

    } catch (err) {
        console.error(err);
        showPopup("Streaming failed ❌");
    }
}, 1000);

} else {
    showPopup("No PC available ❌");
    isLaunchingGame = false;
    return;
}

    }   }; // ✅ closes btn.onclick

    } // ✅ closes openPortal

            function switchIns(m) {
                insMode = m;
                document.querySelectorAll('.ins-tab').forEach(t => t.classList.remove('active'));
                document.getElementById('tab-btn-' + m).classList.add('active');
                let body = document.getElementById('ins-body');
                let apply = document.getElementById('admin-apply-btn');
                apply.style.background = m === 'delete' ? '#ff4b2b' : '#facc15';

                const nonHomeTabs = state.tabs.filter(t => t !== 'Home');
                const lowerOptions = nonHomeTabs.map(t => '<option value="' + t.toLowerCase() + '">' + t + '</option>').join('');
                const sameCaseOptions = nonHomeTabs.map(t => '<option value="' + t + '">' + t + '</option>').join('');

                if (m === 'add-tab') {
                    body.innerHTML = '<input type="text" id="new-tab-name" placeholder="Tab Name">';
                } else if (m === 'add-item') {
                    body.innerHTML =
                        '<select id="add-cat">' + lowerOptions + '</select>' +
                        '<input type="text" id="new-name" placeholder="Name">' +
                        '<input type="text" id="new-img" placeholder="Img URL">' +
                        '<input type="text" id="new-val" placeholder="Value">' +
                        '<input type="text" id="new-exe" placeholder="C:\\\\Games\\\\Game.exe (Host Path)">' +
                        '<textarea id="new-desc" placeholder="Desc"></textarea>';
                } else if (m === 'delete') {
                    body.innerHTML =
                        '<p style="color:#666; font-size:0.7rem; mb:10px">DELETE TAB:</p>' +
                        '<select id="del-tab-select">' + sameCaseOptions + '</select>' +
                        '<p style="color:#666; font-size:0.7rem; mt:15px; mb:10px">DELETE ITEM:</p>' +
                        '<select id="del-cat-list" onchange="updateDelItemList()">' + lowerOptions + '</select>' +
                        '<select id="del-item-list" style="margin-top:10px"></select>';
                    updateDelItemList();
                } else {
                    body.innerHTML = '<p style="color:#666; font-size:0.7rem;">Select a yellow pencil to edit.</p>';
                }
            }

            function updateDelItemList() { 
                let cat = document.getElementById('del-cat-list').value; 
                let list = document.getElementById('del-item-list');
                list.innerHTML = `<option value="">-- Select Item --</option>` + (state.content[cat] || []).map(i => `<option value="${i.id}">${i.name}</option>`).join('');
            }

            function openEdit(id, list) {
                switchIns('edit');
                editId = id; editList = list;
                let itm = (list === 'homeData') ? { name: state.homeData[id], img: state.homeData.heroImg, desc: state.homeData.offerDesc } : state.content[list].find(x => x.id === id);
                
                // Add EXE Path input specifically for games
                let exeInput = (list === 'games') ? `<input type="text" id="edit-exe" value="${itm.exePath || ''}" placeholder="C:\\Path\\To\\Game.exe">` : '';

                document.getElementById('ins-body').innerHTML = `
                    <input type="text" id="edit-n" value="${itm.name || itm}" placeholder="Title">
                    <input type="text" id="edit-s" value="${itm.img || itm.cost || ''}" placeholder="URL/Value">
                    ${exeInput}
                    <textarea id="edit-d" placeholder="Desc" rows="4">${itm.desc || ''}</textarea>
                `;
                toggleInspector();
            }

            async function applyAdminAction() {
                if(insMode === 'add-tab') { let n = document.getElementById('new-tab-name').value; if(n && !state.tabs.includes(n)){ state.tabs.push(n); state.content[n.toLowerCase()] = []; } }
                else if(insMode === 'add-item') { 
                    let cat = document.getElementById('add-cat').value; 
                    let newItem = { id: Date.now().toString(), name: document.getElementById('new-name').value, img: document.getElementById('new-img').value, desc: document.getElementById('new-desc').value, cost: document.getElementById('new-val').value, exePath: document.getElementById('new-exe').value, time: 1, bonus: 10 }; 
                    state.content[cat].push(newItem); 
                }
                else if(insMode === 'edit') { 
                    let n = document.getElementById('edit-n').value, s = document.getElementById('edit-s').value, d = document.getElementById('edit-d').value;
                    if(editList === 'homeData') { state.homeData[editId] = n; if(editId === 'heroTitle') state.homeData.heroImg = s; if(editId === 'offerTitle') state.homeData.offerDesc = d; }
                    else { 
                        let itm = state.content[editList].find(x => x.id === editId); 
                        itm.name = n; itm.desc = d; 
                        if(itm.img !== undefined) itm.img = s; else itm.cost = s; 
                        if(editList === 'games') itm.exePath = document.getElementById('edit-exe').value;
                    }
                }
                else if(insMode === 'delete') {
                    let tabToDel = document.getElementById('del-tab-select').value;
                    let itemToDelId = document.getElementById('del-item-list').value;
                    let catOfItem = document.getElementById('del-cat-list').value;

                    if(itemToDelId){
                        state.content[catOfItem] = state.content[catOfItem].filter(i => i.id !== itemToDelId);
                    }
                    else if(tabToDel){
                        state.tabs = state.tabs.filter(t => t !== tabToDel);
                        delete state.content[tabToDel.toLowerCase()];
                        if(state.activeTab === tabToDel.toLowerCase()){
                            state.activeTab = 'home';
                        }
                    }
                }
            // 🔥 SAFE SAVE LOGIC
    let shouldSaveGames = false;

    if(editList === 'games') {
        shouldSaveGames = true;
    }
    else if(insMode === 'add-item'){
        const cat = document.getElementById('add-cat');
        if(cat && cat.value === 'games'){
            shouldSaveGames = true;
        }
    }
    else if(insMode === 'delete'){
        const cat = document.getElementById('del-cat-list');
        if(cat && cat.value === 'games'){
            shouldSaveGames = true;
        }
    }

    // 🔥 SAVE GAMES
    if(shouldSaveGames){
        await safeFetch(`${BACKEND_URL}/save-games`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                games: state.content.games
            })
        });
    }

    // 🔥 SAVE USER STATE (KEEP INSIDE FUNCTION)
    const data = await safeFetch(`${BACKEND_URL}/update-system-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            state: {
                [currentUserEmail]: {
                    timeLeft: state.hrs
                }
            }
        })
    });
                if(!data){
                    showPopup("Server offline", "ERROR ❌");
                    return;
                }
                showPopup("Global Update Successful", "SUCCESS ✅");

                renderUI();
                toggleInspector();
            }

            function toggleInspector() { document.getElementById('admin-inspector').classList.toggle('open'); }
            function closePortal() { document.getElementById('universal-portal').style.display = 'none'; }
            function setTab(t) { state.activeTab = t; renderUI(); }
            function showAdminPanel(){ document.getElementById('admin-panel').style.display = 'block'; }

            function showPopup(message, title = "NOTICE"){
                const titleEl = document.getElementById('popup-title');
                titleEl.innerText = title;
                if(title.includes("SUCCESS")) titleEl.style.color = "#00ff88";
                else if(title.includes("ERROR")) titleEl.style.color = "#ff4b2b";
                else if(title.includes("ACCESS")) titleEl.style.color = "#facc15";
                else titleEl.style.color = "#00d2ff";
                document.getElementById('popup-msg').innerText = message;
                document.getElementById('custom-popup').style.display = 'flex';
            }
            function closePopup(){ document.getElementById('custom-popup').style.display = 'none'; }

    function startTimer(){
        clearInterval(timerInterval);

        timerInterval = setInterval(async ()=>{
            if(state.hrs > 0){

    state.hrs = Math.max(0, state.hrs - (1/60));

                // 🔥 ONLY SAVE TO SESSION (NO update-time anymore)
                const data = await safeFetch(`${BACKEND_URL}/update-system-state`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        state: {
                            [currentUserEmail]: {
                                timeLeft: state.hrs
                            }
                        }
                    })
                });
                if(!data){
        console.error("Server sync failed");
        return; // DON'T STOP TIMER
    }

                // ⏰ TIME OVER → KILL PROCESS
                if(state.hrs <= 0){
                    state.hrs = 0;
                    clearInterval(timerInterval);
                    
                    // 🔥 SEND KILL SIGNAL TO BACKEND
                    const data = await safeFetch(`${BACKEND_URL}/kill-process`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            processName: currentGameRunning
                        })
                    });
                    if(!data){
                        showPopup("Server offline", "ERROR ❌");
                        return;
                    }

                    await safeFetch(`${BACKEND_URL}/release-pc`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            username: currentUserEmail
                        })
                    });

                    showPopup("Your session time has ended.\nGame process terminated.", "TIME OVER ⚠️");
                    setTimeout(()=>{ logoutUser(); }, 2000);
                }

                renderUI(); 
            }

        }, 60000);
    }

            function logoutUser(){
                clearInterval(timerInterval);
                safeFetch(`${BACKEND_URL}/release-pc`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        username: currentUserEmail
                    })
                });
                document.getElementById('dashboard-wrapper').style.display = 'none';
                document.getElementById('landing-page').style.display = 'flex';
                document.getElementById('admin-panel').style.display = 'none';
                document.getElementById('gaming-bg').style.opacity = "0";
                document.getElementById('uid').value = "";
                document.getElementById('ups').value = "";
                state.hrs = 0;
                state.pts = 0;
                currentUserEmail = "";
                currentGameRunning = "Game"; // 🔥 Reset game tracking
            }

            document.getElementById('admin-email').addEventListener('input', async (e) => {
                const email = e.target.value;
                if (email.length > 5) {
                    const data = await safeFetch(`${BACKEND_URL}/login`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: email, password: "FETCH_ONLY" }) 
                    });
                    if(!data){
                        showPopup("Server offline", "ERROR ❌");
                        return;
                    }
                    if (data.success) {
                        document.getElementById('admin-hrs').placeholder = "Current: " + (data.hrs || 0);
                        document.getElementById('admin-pts').placeholder = "Current: " + (data.pts || 0);
                    }
                }
            });

            async function adminAddTime(){
                const email = document.getElementById('admin-email').value;
                const addHrs = parseFloat(document.getElementById('admin-hrs').value) || 0;
                const addPts = parseInt(document.getElementById('admin-pts').value) || 0;
                if(!email) return showPopup("ENTER USER EMAIL");
                try{
                    const data = await safeFetch(`${BACKEND_URL}/admin-add`, {
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({ email, hrs: addHrs, pts: addPts })
                    });
                    if(!data){
                        showPopup("Server offline", "ERROR ❌");
                        return;
                    }
                    if(data.success){

    // 🔥 ALSO UPDATE SESSION
    const data2 = await safeFetch(`${BACKEND_URL}/update-system-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            state: {
                [email]: {
                    timeLeft: state.hrs + addHrs
                }
            }
        })
    });
    if(!data2){
        showPopup("Server offline", "ERROR ❌");
        return;
    }
                        showPopup(`Added ${addHrs} hrs & ${addPts} pts to ${email}`, "SUCCESS ✅");
                        if(email === currentUserEmail){ state.hrs += addHrs; state.pts += addPts; renderUI(); }
                        document.getElementById('admin-hrs').value = "";
                        document.getElementById('admin-pts').value = "";
                    } else { showPopup("Failed ❌ Check email existence."); }
                } catch (err) {
                    console.error(err);
    showPopup("Server issue, try again", "ERROR ❌");            }
            }
async function triggerExeOnHost(path) {
    const AGENT_URL = "https://era-nonsolvable-ciara.ngrok-free.dev";

    try {
        console.log("🔍 Checking agent...");

        const res1 = await fetch(AGENT_URL + "/status");
        const text = await res1.text();
        console.log("STATUS TEXT:", text);

        console.log("🚀 Sending launch request...");

        const res2 = await fetch(AGENT_URL + "/launch-exe", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ path })
        });

        const data = await res2.json();
        console.log("LAUNCH DATA:", data);

        if (data.success) {
            showPopup("Launching game...", "SUCCESS ✅");
            return true;
        } else {
            showPopup("Launch failed ❌");
            return false;
        }

    } catch (err) {
        console.error("❌ FULL ERROR:", err);
        showPopup("Agent connection failed ❌");
        return false;
    }
}
    

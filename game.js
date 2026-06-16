const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// --- グローバルランキング設定 (dreamlo API を使用) ---
// 先ほど取得されたご自身専用のキーを正確に設定しています。
const DREAMLO_PUBLIC_KEY = "6a31c3eb8f40bb1318c774ac";
const DREAMLO_PRIVATE_KEY = "Msa1Oh9DikOgg3FIjbKM1gIWyo9dx52Ei_DpJ51QN1Gw";

// --- ゲーム設定と状態 ---
let gameState = "TITLE";
let currentMode = "NORMAL";
let gameTimer = 0;
let orbTimer = 15;
let orbsCollected = 0;
let itemSpawned = false;
let lastItemSpawnTime = 0;

// 弾幕パターン管理用のタイマー
let rainTimer = 0;
let waveTimer = 0;
let patternTimer = 0;

// --- スプライト画像の定義 ---
const images = {};
const imageSources = {
    kankichi_UP: "assets/kankichi_up.png",
    kankichi_DOWN: "assets/kankichi_down.png",
    kankichi_LEFT: "assets/kankichi_left.png",
    kankichi_RIGHT: "assets/kankichi_right.png",
    drone_UP: "assets/drone_up.png",
    drone_DOWN: "assets/drone_down.png",
    drone_LEFT: "assets/drone_left.png",
    drone_RIGHT: "assets/drone_right.png",
    item_speed: "assets/item_speed.png",
    item_life: "assets/item_life.png",
    item_freeze: "assets/item_freeze.png",
    orb: "assets/orb.png",

    // 弾幕スプライト群
    bullet_blue: "assets/bullet_blue.png",
    bullet_pink: "assets/bullet_pink.png",
    bullet_green: "assets/bullet_green.png",
    bullet_yellow: "assets/bullet_yellow.png",
    bullet_rain: "assets/bullet_rain.png",
    bullet_wall: "assets/bullet_wall.png"
};

Object.keys(imageSources).forEach(key => {
    images[key] = new Image();
    images[key].src = imageSources[key];
    images[key].onload = () => { images[key].loaded = true; };
    images[key].onerror = () => { images[key].loaded = false; };
});

// --- キャラクター・オブジェクトの定義 ---
let player = {};
let drone = {};
let bullets = [];
let darkOrb = {};
let activeItem = null;

// キー入力管理
const keys = {};
window.addEventListener("keydown", e => keys[e.key] = true);
window.addEventListener("keyup", e => keys[e.key] = false);

// --- 世界ランキングの取得（セキュリティ対策 www. 付き） ---
function fetchLeaderboard() {
    const listDiv = document.getElementById("leaderboard-list");
    listDiv.innerHTML = "読み込み中...";

    // 接続の安定性を高めるため www.dreamlo.com を宛先に指定
    fetch(`https://www.dreamlo.com/lb/${DREAMLO_PUBLIC_KEY}/json`)
        .then(response => response.json())
        .then(data => {
            listDiv.innerHTML = "";
            if (!data.dreamlo || !data.dreamlo.leaderboard || !data.dreamlo.leaderboard.entry) {
                listDiv.innerHTML = "<div style='color:#888; text-align:center; padding-top:20px;'>まだ記録がありません。</div>";
                return;
            }

            let entries = data.dreamlo.leaderboard.entry;
            if (!Array.isArray(entries)) {
                entries = [entries];
            }

            entries.sort((a, b) => parseFloat(b.seconds) - parseFloat(a.seconds));

            entries.slice(0, 10).forEach((entry, index) => {
                const row = document.createElement("div");
                row.className = "leaderboard-row";
                const orbCount = entry.text || "0";
                row.innerHTML = `
                    <span>${index + 1}. ${entry.name}</span>
                    <span>${entry.seconds}秒 (${orbCount}個)</span>
                `;
                listDiv.appendChild(row);
            });
        })
        .catch(err => {
            listDiv.innerHTML = "<div style='color:#ff4444; text-align:center; padding-top:20px;'>ランキングを取得できませんでした。</div>";
        });
}

fetchLeaderboard();

// --- ゲーム開始 ---
function startGame(mode) {
    currentMode = mode;
    gameState = "PLAYING";
    gameTimer = 0;
    orbTimer = 15;
    orbsCollected = 0;
    itemSpawned = false;
    lastItemSpawnTime = 0;
    bullets = [];
    activeItem = null;

    rainTimer = 0;
    waveTimer = 0;
    patternTimer = 0;

    document.getElementById("menu-screen").style.display = "none";
    document.getElementById("gameover-screen").style.display = "none";
    document.getElementById("clear-screen").style.display = "none";
    canvas.style.display = "block";

    player = {
        x: canvas.width / 2,
        y: canvas.height * 0.75,
        width: 32,
        height: 32,
        hitRadius: 4,
        baseSpeed: 4.5,
        speed: 4.5,
        direction: "UP",
        lives: 0,
        isStunned: false,
        isInvincible: false,
        stunTimer: 0,
        invincibleTimer: 0,
        speedBoostTimer: 0
    };

    initDrone();
    spawnDarkOrb();
}

function initDrone() {
    let droneSpeed = 1.0;
    if (currentMode === "EASY") droneSpeed = 0.6;
    else if (currentMode === "NORMAL") droneSpeed = 1.0;
    else if (currentMode === "HARD" || currentMode === "ENDLESS") droneSpeed = 1.2;

    drone = {
        x: canvas.width / 2,
        y: 80,
        width: 48,
        height: 48,
        speed: droneSpeed,
        direction: "DOWN",
        frozenTimer: 0,
        shootCooldown: 0,
        spiralAngle: 0,
        sweepDirection: 1,
        sweepAngleOffset: 0,
        currentPattern: "SPIRAL"
    };
}

function showMenu() {
    gameState = "TITLE";
    document.getElementById("menu-screen").style.display = "flex";
    document.getElementById("gameover-screen").style.display = "none";
    document.getElementById("clear-screen").style.display = "none";
    canvas.style.display = "none";
    fetchLeaderboard();
}

function spawnDarkOrb() {
    let rx, ry, dist;
    do {
        rx = Math.random() * (canvas.width - 80) + 40;
        ry = Math.random() * (canvas.height - 120) + 60;
        dist = Math.hypot(player.x - rx, player.y - ry);
    } while (dist < 150);

    darkOrb = { x: rx, y: ry, radius: 12 };
}

function spawnRandomItem() {
    const types = ["speed", "life", "freeze"];
    const type = types[Math.floor(Math.random() * types.length)];
    activeItem = {
        x: Math.random() * (canvas.width - 80) + 40,
        y: Math.random() * (canvas.height - 120) + 60,
        width: 24,
        height: 24,
        type: type
    };
}

// --- メインアップデート処理 ---
function update(deltaTime) {
    if (gameState !== "PLAYING") return;

    gameTimer += deltaTime;
    orbTimer -= deltaTime;

    if (orbTimer <= 0) {
        endGame("ORB_TIMEOUT");
        return;
    }

    if (currentMode !== "ENDLESS" && gameTimer >= 45) {
        gameState = "CLEAR";
        canvas.style.display = "none";
        document.getElementById("clear-screen").style.display = "flex";
        document.getElementById("clear-score").innerText = `最終獲得オーブ数: ${orbsCollected} 個`;
        return;
    }

    // アイテム出現管理
    if (currentMode !== "ENDLESS") {
        if (!itemSpawned && gameTimer >= 22.5) {
            spawnRandomItem();
            itemSpawned = true;
        }
    } else {
        if (gameTimer - lastItemSpawnTime >= 60) {
            spawnRandomItem();
            lastItemSpawnTime = gameTimer;
        }
    }

    // かんきちの状態タイマー更新
    if (player.isStunned) {
        player.stunTimer -= deltaTime;
        if (player.stunTimer <= 0) {
            player.isStunned = false;
        }
    }
    if (player.isInvincible) {
        player.invincibleTimer -= deltaTime;
        if (player.invincibleTimer <= 0) {
            player.isInvincible = false;
        }
    }
    if (player.speedBoostTimer > 0) {
        player.speedBoostTimer -= deltaTime;
        player.speed = player.baseSpeed * 2;
        if (player.speedBoostTimer <= 0) player.speed = player.baseSpeed;
    } else {
        player.speed = player.baseSpeed;
    }

    if (drone.frozenTimer > 0) {
        drone.frozenTimer -= deltaTime;
    }

    // --- かんきちの移動 ---
    if (!player.isStunned) {
        let dx = 0;
        let dy = 0;
        if (keys["ArrowUp"] || keys["w"] || keys["W"]) { dy = -1; player.direction = "UP"; }
        if (keys["ArrowDown"] || keys["s"] || keys["S"]) { dy = 1; player.direction = "DOWN"; }
        if (keys["ArrowLeft"] || keys["a"] || keys["A"]) { dx = -1; player.direction = "LEFT"; }
        if (keys["ArrowRight"] || keys["d"] || keys["D"]) { dx = 1; player.direction = "RIGHT"; }

        if (dx !== 0 && dy !== 0) {
            dx *= 0.7071;
            dy *= 0.7071;
        }

        player.x += dx * player.speed;
        player.y += dy * player.speed;
        player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));
        player.y = Math.max(0, Math.min(canvas.height - player.height, player.y));
    }

    // --- ドローンZの挙動と弾幕制御 ---
    if (drone.frozenTimer <= 0) {
        const pCenterX = player.x + player.width/2;
        const pCenterY = player.y + player.height/2;
        const dCenterX = drone.x + drone.width/2;
        const dCenterY = drone.y + drone.height/2;

        const angleToPlayer = Math.atan2(pCenterY - dCenterY, pCenterX - dCenterX);

        let currentDroneSpeed = drone.speed;
        if (currentMode === "ENDLESS") {
            currentDroneSpeed = Math.min(2.0, drone.speed + (gameTimer / 150));
        }

        const wander = Math.sin(gameTimer * 1.5) * 0.3;
        drone.x += Math.cos(angleToPlayer + wander) * currentDroneSpeed;
        drone.y += Math.sin(angleToPlayer + wander) * currentDroneSpeed;

        if (Math.abs(Math.cos(angleToPlayer)) > Math.abs(Math.sin(angleToPlayer))) {
            drone.direction = Math.cos(angleToPlayer) > 0 ? "RIGHT" : "LEFT";
        } else {
            drone.direction = Math.sin(angleToPlayer) > 0 ? "DOWN" : "UP";
        }

        // 弾幕パターン切り替え
        if (currentMode === "HARD" || currentMode === "ENDLESS") {
            patternTimer += deltaTime;
            if (patternTimer < 7.0) {
                drone.currentPattern = "SPIRAL";
            } else if (patternTimer < 14.0) {
                drone.currentPattern = "SWEEP";
            } else if (patternTimer < 21.0) {
                drone.currentPattern = "FLOWER";
            } else {
                patternTimer = 0;
            }
        } else {
            drone.currentPattern = "CLASSIC";
        }

        // 弾幕発射
        drone.shootCooldown -= deltaTime;
        if (drone.shootCooldown <= 0) {
            executeDroneBarrage(dCenterX, dCenterY, angleToPlayer);
        }
    }

    // --- 画面全体の環境弾幕 ---
    if (drone.frozenTimer <= 0) {
        triggerScreenBulletPatterns(deltaTime);
    }

    // 弾の更新
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        if (b.x < -20 || b.x > canvas.width + 20 || b.y < -20 || b.y > canvas.height + 20) {
            bullets.splice(i, 1);
        }
    }

    // --- 衝突判定 ---
    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;

    // 1. 闇のオーブ
    const distToOrb = Math.hypot(playerCenterX - darkOrb.x, playerCenterY - darkOrb.y);
    if (distToOrb < (16 + darkOrb.radius)) {
        orbsCollected++;
        spawnDarkOrb();
        orbTimer = 15.0;
    }

    // 2. アイテム
    if (activeItem) {
        const itemCenterX = activeItem.x + activeItem.width / 2;
        const itemCenterY = activeItem.y + activeItem.height / 2;
        const distToItem = Math.hypot(playerCenterX - itemCenterX, playerCenterY - itemCenterY);
        if (distToItem < (16 + activeItem.width / 2)) {
            applyItemEffect(activeItem.type);
            activeItem = null;
        }
    }

    // 3. 弾との当たり判定
    if (!player.isInvincible && !player.isStunned) {
        for (let i = 0; i < bullets.length; i++) {
            const b = bullets[i];
            const distToBullet = Math.hypot(playerCenterX - b.x, playerCenterY - b.y);
            if (distToBullet < (player.hitRadius + b.radius)) {
                player.isStunned = true;
                player.stunTimer = 2.0;
                player.isInvincible = true;
                player.invincibleTimer = 4.0;
                bullets.splice(i, 1);
                break;
            }
        }
    }

    // 4. ドローンZ本体との衝突
    const droneCenterX = drone.x + drone.width / 2;
    const droneCenterY = drone.y + drone.height / 2;
    const distToDrone = Math.hypot(playerCenterX - droneCenterX, playerCenterY - droneCenterY);
    if (distToDrone < (player.hitRadius + 16)) {
        endGame("DRONE_CONTACT");
    }
}

// --- カッコいい幾何学パターン弾幕の実行システム ---
function executeDroneBarrage(dx, dy, angleToPlayer) {
    if (drone.currentPattern === "CLASSIC") {
        let ways = 3;
        let spread = currentMode === "EASY" ? 0.38 : 0.32;
        let bulletSpeed = currentMode === "EASY" ? 3.2 : 4.5;
        let interval = currentMode === "EASY" ? 1.8 : 1.2;

        spawnFan(dx, dy, angleToPlayer, ways, spread, bulletSpeed, "#ffbb00", "bullet_yellow");
        drone.shootCooldown = interval;

    } else if (drone.currentPattern === "SPIRAL") {
        // パターンA：ウッキー・スパイラル
        drone.spiralAngle = (drone.spiralAngle || 0) + 0.16;
        const speed = 3.8;

        bullets.push({ x: dx, y: dy, vx: Math.cos(drone.spiralAngle) * speed, vy: Math.sin(drone.spiralAngle) * speed, radius: 5, color: "#00b7ff", spriteKey: "bullet_blue" });
        bullets.push({ x: dx, y: dy, vx: Math.cos(drone.spiralAngle + Math.PI) * speed, vy: Math.sin(drone.spiralAngle + Math.PI) * speed, radius: 5, color: "#00b7ff", spriteKey: "bullet_blue" });

        drone.shootCooldown = 0.08;

    } else if (drone.currentPattern === "SWEEP") {
        // パターンB：ヴァイパー・スイープ
        drone.sweepAngleOffset = (drone.sweepAngleOffset || 0) + (0.05 * drone.sweepDirection);
        if (Math.abs(drone.sweepAngleOffset) > 0.6) {
            drone.sweepDirection *= -1;
        }

        const currentAngle = angleToPlayer + drone.sweepAngleOffset;
        const ways = 5;
        const spread = 0.26;
        const speed = 4.5;

        spawnFan(dx, dy, currentAngle, ways, spread, speed, "#ff00bb", "bullet_pink");
        drone.shootCooldown = 0.4;

    } else if (drone.currentPattern === "FLOWER") {
        // パターンC：ふくびきけん・キャットバースト
        const numBullets = 10;
        const speed = 3.0;
        const offsetAngle = gameTimer * 1.5;

        for (let i = 0; i < numBullets; i++) {
            const angle = (Math.PI * 2 / numBullets) * i + offsetAngle;
            bullets.push({
                x: dx,
                y: dy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: 6,
                color: "#00ffaa",
                spriteKey: "bullet_green"
            });
        }
        drone.shootCooldown = 0.9;
    }
}

// 扇状展開のヘルパー関数
function spawnFan(dx, dy, centerAngle, ways, spread, speed, color, spriteKey) {
    const startIdx = -Math.floor(ways / 2);
    const endIdx = Math.floor(ways / 2);

    for (let i = startIdx; i <= endIdx; i++) {
        const bulletAngle = centerAngle + (i * spread);
        bullets.push({
            x: dx,
            y: dy,
            vx: Math.cos(bulletAngle) * speed,
            vy: Math.sin(bulletAngle) * speed,
            radius: 6,
            color: color,
            spriteKey: spriteKey || "bullet_yellow"
        });
    }
}

// --- 画面全体の環境弾幕 ---
function triggerScreenBulletPatterns(deltaTime) {
    let rainInterval = 0.5;
    let rainSpeed = 2.5;
    let waveInterval = 4.0;
    let waveSpeed = 3.5;

    if (currentMode === "EASY") {
        rainInterval = 0.8;
        rainSpeed = 2.0;
        waveInterval = 999;
    } else if (currentMode === "NORMAL") {
        rainInterval = 0.5;
        rainSpeed = 2.5;
        waveInterval = 6.0;
        waveSpeed = 3.0;
    } else if (currentMode === "HARD" || currentMode === "ENDLESS") {
        rainInterval = 0.35;
        rainSpeed = 3.2;
        waveInterval = 4.5;
        waveSpeed = 3.8;
    }

    if (currentMode === "ENDLESS") {
        rainInterval = Math.max(0.18, 0.35 - (gameTimer / 300));
        rainSpeed = Math.min(5.0, 3.2 + (gameTimer / 80));
        waveInterval = Math.max(2.5, 4.5 - (gameTimer / 150));
        waveSpeed = Math.min(5.5, 3.8 + (gameTimer / 60));
    }

    // 縦の雨
    rainTimer -= deltaTime;
    if (rainTimer <= 0) {
        bullets.push({
            x: Math.random() * canvas.width,
            y: -10,
            vx: (Math.random() - 0.5) * 0.6,
            vy: rainSpeed,
            radius: 5,
            color: "#4488ff",
            spriteKey: "bullet_rain"
        });
        rainTimer = rainInterval;
    }

    // 左右からの往復壁
    waveTimer -= deltaTime;
    if (waveTimer <= 0 && currentMode !== "EASY") {
        const side = Math.random() > 0.5 ? "LEFT" : "RIGHT";
        const startY = Math.random() * (canvas.height - 200) + 100;
        const bulletCount = currentMode === "NORMAL" ? 5 : 7;

        const gateIndex = Math.floor(Math.random() * (bulletCount - 2)) + 1;
        const spacing = 50;

        for (let i = 0; i < bulletCount; i++) {
            if (i === gateIndex) continue;

            const offset = (i - bulletCount / 2) * spacing;
            bullets.push({
                x: side === "LEFT" ? -10 : canvas.width + 10,
                y: startY + offset,
                vx: side === "LEFT" ? waveSpeed : -waveSpeed,
                vy: 0,
                radius: 6,
                color: "#ff7700",
                spriteKey: "bullet_wall"
            });
        }
        waveTimer = waveInterval;
    }
}

// --- アイテム効果発動 ---
function applyItemEffect(type) {
    if (type === "speed") {
        player.speedBoostTimer = 7.0;
    } else if (type === "life") {
        player.lives++;
    } else if (type === "freeze") {
        drone.frozenTimer = 5.0;
    }
}

// --- コンティニュー機能 ---
function continueGame() {
    if (player.lives <= 0) return;

    player.lives--;
    gameState = "PLAYING";

    player.x = canvas.width / 2;
    player.y = canvas.height * 0.75;
    player.isStunned = false;
    player.isInvincible = true;
    player.invincibleTimer = 3.0;

    initDrone();
    drone.frozenTimer = 2.0;

    bullets = [];

    document.getElementById("gameover-screen").style.display = "none";
    canvas.style.display = "block";
}

// --- ゲーム終了 ---
function endGame(reason) {
    gameState = "GAMEOVER";
    canvas.style.display = "none";
    document.getElementById("gameover-screen").style.display = "flex";

    let reasonText = "";
    if (reason === "ORB_TIMEOUT") {
        reasonText = "闇のオーブを時間内に取得できなかった！";
    } else if (reason === "DRONE_CONTACT") {
        reasonText = "ドローンZに捕獲された！";
    }
    document.getElementById("gameover-reason").innerText = reasonText;

    const formattedTime = gameTimer.toFixed(2);
    document.getElementById("gameover-score").innerText = `逃走時間: ${formattedTime}秒 (獲得オーブ: ${orbsCollected}個)`;

    if (player.lives > 0) {
        document.getElementById("continue-container").style.display = "block";
        document.getElementById("continue-button").innerText = `しゅっせいだけで復活（残機: ${player.lives}）`;
    } else {
        document.getElementById("continue-container").style.display = "none";
    }

    if (currentMode === "ENDLESS") {
        document.getElementById("ranking-input-container").style.display = "block";
    } else {
        document.getElementById("ranking-input-container").style.display = "none";
    }
}

// --- 世界ランキング送信（セキュリティ・CORS回避設定を追加） ---
function submitScore() {
    const nameInput = document.getElementById("player-name");
    const name = nameInput.value.trim().replace(/[^a-zA-Z0-9]/g, "");

    if (!name) {
        alert("名前を入力してください（半角英数のみ有効）。");
        return;
    }

    const seconds = gameTimer.toFixed(2);
    const scoreVal = Math.floor(gameTimer * 100);

    // 通信エラーを防ぐため www.dreamlo.com 宛てに設定
    const url = `https://www.dreamlo.com/lb/${DREAMLO_PRIVATE_KEY}/add/${name}/${scoreVal}/${seconds}/${orbsCollected}`;

    // ★重要: browserのCORSブロックを完全に無視する { mode: 'no-cors' } を設定して送信
    fetch(url, { mode: 'no-cors' })
        .then(() => {
            alert("世界ランキングに記録が登録されました！");
            document.getElementById("ranking-input-container").style.display = "none";
            fetchLeaderboard(); // 送信完了後にランキングを再描画
        })
        .catch(err => {
            alert("通信環境により送信できませんでした。");
        });
}

// --- 描画ロジック ---
function drawPlayer() {
    const key = `kankichi_${player.direction}`;
    if (images[key] && images[key].loaded) {
        if (player.isStunned && Math.floor(gameTimer * 10) % 2 === 0) return;
        if (player.isInvincible && Math.floor(gameTimer * 15) % 2 === 0) ctx.globalAlpha = 0.5;

        ctx.drawImage(images[key], player.x, player.y, player.width, player.height);
        ctx.globalAlpha = 1.0;
    } else {
        ctx.fillStyle = player.isStunned ? "#ff3333" : (player.isInvincible ? "#ffaa00" : "#4444ff");
        ctx.fillRect(player.x, player.y, player.width, player.height);

        ctx.fillStyle = "#fff";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("かんきち", player.x + player.width / 2, player.y - 6);
        ctx.textAlign = "left";
    }

    if (gameState === "PLAYING" && !player.isStunned && !player.isInvincible) {
        ctx.beginPath();
        ctx.arc(player.x + player.width / 2, player.y + player.height / 2, player.hitRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.closePath();
    }
}

function drawDrone() {
    const key = `drone_${drone.direction}`;
    if (images[key] && images[key].loaded) {
        if (drone.frozenTimer > 0 && Math.floor(gameTimer * 5) % 2 === 0) {
            ctx.shadowBlur = 15;
            ctx.shadowColor = "#00ffff";
        }
        ctx.drawImage(images[key], drone.x, drone.y, drone.width, drone.height);
        ctx.shadowBlur = 0;
    } else {
        ctx.fillStyle = drone.frozenTimer > 0 ? "#00ffff" : "#880000";
        ctx.fillRect(drone.x, drone.y, drone.width, drone.height);

        ctx.fillStyle = "#fff";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("ドローンZ", drone.x + drone.width / 2, drone.y - 6);
        ctx.textAlign = "left";
    }
}

function drawBullets() {
    bullets.forEach(b => {
        const img = images[b.spriteKey];
        if (img && img.loaded) {
            ctx.save();

            const visualRadius = b.radius * 1.25;

            ctx.beginPath();
            ctx.arc(b.x, b.y, visualRadius, 0, Math.PI * 2);
            ctx.closePath();

            ctx.clip();

            ctx.drawImage(img, b.x - visualRadius, b.y - visualRadius, visualRadius * 2, visualRadius * 2);

            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
            ctx.fillStyle = b.color || "#ffffff";
            ctx.fill();
            ctx.closePath();
        }
    });
}

function drawOrbAndItems() {
    if (images.orb && images.orb.loaded) {
        ctx.drawImage(images.orb, darkOrb.x - darkOrb.radius, darkOrb.y - darkOrb.radius, darkOrb.radius * 2, darkOrb.radius * 2);
    } else {
        ctx.beginPath();
        ctx.arc(darkOrb.x, darkOrb.y, darkOrb.radius, 0, Math.PI * 2);
        ctx.fillStyle = "#aa00ff";
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#aa00ff";
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.closePath();
    }

    if (activeItem) {
        const key = `item_${activeItem.type}`;
        if (images[key] && images[key].loaded) {
            ctx.drawImage(images[key], activeItem.x, activeItem.y, activeItem.width, activeItem.height);
        } else {
            ctx.fillStyle = activeItem.type === "speed" ? "#00ff00" : (activeItem.type === "life" ? "#ff00ff" : "#00ffff");
            ctx.fillRect(activeItem.x, activeItem.y, activeItem.width, activeItem.height);
            ctx.fillStyle = "#fff";
            ctx.font = "9px sans-serif";
            ctx.fillText(activeItem.type, activeItem.x - 5, activeItem.y - 4);
        }
    }
}

function drawUI() {
    ctx.fillStyle = "#fff";
    ctx.font = "18px Arial";
    ctx.fillText(`生存時間: ${gameTimer.toFixed(2)}s` + (currentMode !== "ENDLESS" ? " / 45s" : ""), 15, 30);

    ctx.fillStyle = orbTimer < 5 ? "#ff3333" : "#aa00ff";
    ctx.font = "bold 18px Arial";
    ctx.fillText(`オーブ制限: ${orbTimer.toFixed(2)}s (獲得: ${orbsCollected}個)`, 15, 60);

    ctx.fillStyle = "#ffaa00";
    ctx.font = "16px Arial";
    ctx.fillText(`予備残機 (しゅっせいだけ): ${player.lives}`, 15, 90);

    if (currentMode === "HARD" || currentMode === "ENDLESS") {
        ctx.fillStyle = "#ff55ff";
        ctx.font = "14px Arial";
        let patternName = "";
        if (drone.currentPattern === "SPIRAL") patternName = "ウッキー・スパイラル（渦巻き）";
        if (drone.currentPattern === "SWEEP") patternName = "ヴァイパー・スイープ（スイング）";
        if (drone.currentPattern === "FLOWER") patternName = "ふくびきけん・キャットバースト（十方放射）";
        ctx.fillText(`弾幕モード: ${patternName}`, 15, 120);
    }

    if (player.speedBoostTimer > 0) {
        ctx.fillStyle = "#55ff55";
        ctx.fillText(`スピードUP: ${player.speedBoostTimer.toFixed(1)}s`, 15, 150);
    }

    if (drone.frozenTimer > 0) {
        ctx.fillStyle = "#33ffff";
        ctx.fillText(`ドローン停止: ${drone.frozenTimer.toFixed(1)}s`, 15, 180);
    }

    ctx.fillStyle = "#888";
    ctx.font = "14px Arial";
    ctx.fillText(`モード: ${currentMode}`, canvas.width - 120, 30);
}

let lastTime = performance.now();
function loop(now) {
    const deltaTime = (now - lastTime) / 1000;
    lastTime = now;

    update(deltaTime);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (gameState === "PLAYING") {
        drawPlayer();
        drawDrone();
        drawBullets();
        drawOrbAndItems();
        drawUI();
    }
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
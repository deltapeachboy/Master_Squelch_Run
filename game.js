const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// --- 世界共通ランキング設定 (Supabase を使用) ---
const SUPABASE_URL = "https://hpsfntzpdwkxscgigcpx.supabase.co";
const SUPABASE_KEY = "ここに先ほどコピーした sb_publishable_... のキーを貼り付けてください";

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

// --- スプライト画像の定義（プレイヤーとドローンのみ画像を使用） ---
const images = {};
const imageSources = {
    kankichi_UP: "assets/kankichi_up.png",
    kankichi_DOWN: "assets/kankichi_down.png",
    kankichi_LEFT: "assets/kankichi_left.png",
    kankichi_RIGHT: "assets/kankichi_right.png",
    drone_UP: "assets/drone_up.png",
    drone_DOWN: "assets/drone_down.png",
    drone_LEFT: "assets/drone_left.png",
    drone_RIGHT: "assets/drone_right.png"
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

// --- 世界ランキングの取得（Supabase REST API 経由） ---
function fetchLeaderboard() {
    const listDiv = document.getElementById("leaderboard-list");
    listDiv.innerHTML = "読み込み中...";

    fetch(`${SUPABASE_URL}/rest/v1/leaderboard?select=*&order=seconds.desc&limit=10`, {
        method: "GET",
        headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`
        }
    })
    .then(response => response.json())
    .then(data => {
        listDiv.innerHTML = "";
        if (!data || data.length === 0) {
            listDiv.innerHTML = "<div style='color:#888; text-align:center; padding-top:20px;'>まだ記録がありません。</div>";
            return;
        }

        data.forEach((entry, index) => {
            const row = document.createElement("div");
            row.className = "leaderboard-row";
            const orbCount = entry.text || "0";
            row.innerHTML = `
                <span>${index + 1}. ${entry.name}</span>
                <span>${parseFloat(entry.seconds).toFixed(2)}秒 (${orbCount}個)</span>
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
        baseSpeed: 5.85, // 基本速度を 4.5 → 5.85 にアップ (1.3倍)
        speed: 5.85,
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
    // 各難易度ごとのドローン基本速度を1.3倍にアップ
    let droneSpeed = 1.3; // NORMAL基準：1.0 → 1.3
    if (currentMode === "EASY") droneSpeed = 0.78; // EASY: 0.6 → 0.78
    else if (currentMode === "NORMAL") droneSpeed = 1.3;
    else if (currentMode === "HARD" || currentMode === "ENDLESS") droneSpeed = 1.56; // HARD: 1.2 → 1.56

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
        currentPattern: "FIST"
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
            // エンドレス時の上昇上限値も1.3倍の 2.6 まで緩和
            currentDroneSpeed = Math.min(2.6, drone.speed + (gameTimer / 150));
        }

        const wander = Math.sin(gameTimer * 1.5) * 0.3;
        drone.x += Math.cos(angleToPlayer + wander) * currentDroneSpeed;
        drone.y += Math.sin(angleToPlayer + wander) * currentDroneSpeed;

        if (Math.abs(Math.cos(angleToPlayer)) > Math.abs(Math.sin(angleToPlayer))) {
            drone.direction = Math.cos(angleToPlayer) > 0 ? "RIGHT" : "LEFT";
        } else {
            drone.direction = Math.sin(angleToPlayer) > 0 ? "DOWN" : "UP";
        }

        // 弾幕パターン切り替えロジック
        if (currentMode === "HARD" || currentMode === "ENDLESS") {
            patternTimer += deltaTime;
            if (patternTimer < 6.0) {
                drone.currentPattern = "FIST";
            } else if (patternTimer < 12.0) {
                drone.currentPattern = "BEAM";
            } else if (patternTimer < 18.0) {
                drone.currentPattern = "SPIRAL";
            } else if (patternTimer < 24.0) {
                drone.currentPattern = "SWEEP";
            } else if (patternTimer < 30.0) {
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

    // 弾の更新（特殊弾幕の動作処理、および不要な弾の消去）
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];

        // Zパンチ（拳形状）の制御
        if (b.type === "fist_part") {
            if (b.state === "charge") {
                b.timer -= deltaTime;
                if (b.timer <= 0) {
                    if (b.action === "dash") {
                        b.state = "dash";
                        b.vx = b.dashVx;
                        b.vy = b.dashVy;
                    } else {
                        b.state = "scatter";
                        const randomOffset = (Math.random() - 0.5) * Math.PI;
                        const scatterAngle = b.targetAngle + randomOffset;
                        const speed = 4.5;
                        b.vx = Math.cos(scatterAngle) * speed;
                        b.vy = Math.sin(scatterAngle) * speed;
                    }
                }
            }
        }
        // じごくのほのおの制御（タメ減速から追尾急加速）
        else if (b.type === "delayed_flame") {
            if (b.state === "slowdown") {
                b.vx *= 0.88;
                b.vy *= 0.88;
                if (Math.hypot(b.vx, b.vy) < 0.2) {
                    b.vx = 0; b.vy = 0;
                    b.state = "hover";
                    b.timer = 0.6;
                }
            } else if (b.state === "hover") {
                b.timer -= deltaTime;
                if (b.timer <= 0) {
                    b.state = "shoot";
                    const px = player.x + player.width/2;
                    const py = player.y + player.height/2;
                    const angle = Math.atan2(py - b.y, px - b.x);
                    b.vx = Math.cos(angle) * 7.5;
                    b.vy = Math.sin(angle) * 7.5;
                }
            }
        }

        b.x += b.vx;
        b.y += b.vy;

        if (b.toRemove || b.x < -40 || b.x > canvas.width + 40 || b.y < -40 || b.y > canvas.height + 40) {
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

// --- 特殊ギミック弾幕生成ロジック ---
function executeDroneBarrage(dx, dy, angleToPlayer) {
    if (drone.currentPattern === "CLASSIC") {
        let ways = 3;
        let spread = currentMode === "EASY" ? 0.38 : 0.32;
        let bulletSpeed = currentMode === "EASY" ? 3.2 : 4.5;
        let interval = currentMode === "EASY" ? 1.8 : 1.2;

        spawnFan(dx, dy, angleToPlayer, ways, spread, bulletSpeed, "#ffbb00");
        drone.shootCooldown = interval;

    } else if (drone.currentPattern === "FIST") {
        // Zパンチ（拳フォーメーション・高低差あり・超巨大）
        const fistOffsets = [
            // 手首
            {x: -35, y: 70}, {x: 0, y: 70}, {x: 35, y: 70},
            {x: -35, y: 42}, {x: 0, y: 42}, {x: 35, y: 42},
            // 手のひら
            {x: -56, y: 14}, {x: -28, y: 14}, {x: 0, y: 14}, {x: 28, y: 14}, {x: 56, y: 14},
            {x: -56, y: -14}, {x: -28, y: -14}, {x: 0, y: -14}, {x: 28, y: -14}, {x: 56, y: -14},
            // 各指の関節
            {x: -56, y: -42}, {x: -56, y: -63},
            {x: -21, y: -42}, {x: -21, y: -70},
            {x: 14, y: -42}, {x: 14, y: -73},
            {x: 49, y: -42}, {x: 49, y: -67},
            // 折りたたんだ親指
            {x: -84, y: -7}, {x: -84, y: 21}, {x: -63, y: 35}
        ];

        const px = player.x + player.width/2;
        const py = player.y + player.height/2;

        const targetAngle = Math.atan2(py - dy, px - dx);

        const action = Math.random() < 0.5 ? "dash" : "scatter";
        let dashVx = 0;
        let dashVy = 0;
        if (action === "dash") {
            const speed = 8.5;
            dashVx = Math.cos(targetAngle) * speed;
            dashVy = Math.sin(targetAngle) * speed;
        }

        fistOffsets.forEach(offset => {
            bullets.push({
                type: "fist_part",
                state: "charge",
                timer: 1.0,
                x: dx + offset.x,
                y: dy + offset.y,
                centerX: dx,
                centerY: dy,
                vx: 0,
                vy: 0,
                radius: 7.0,
                color: "#00b7ff",
                action: action,
                dashVx: dashVx,
                dashVy: dashVy,
                targetAngle: targetAngle
            });
        });

        drone.shootCooldown = 1.9;

    } else if (drone.currentPattern === "BEAM") {
        // じごくのほのお（時間差・追尾炎）
        const angle = angleToPlayer + (Math.random() - 0.5) * 0.5;
        const initialSpeed = 6.0;

        bullets.push({
            type: "delayed_flame",
            state: "slowdown",
            timer: 0,
            x: dx,
            y: dy,
            vx: Math.cos(angle) * initialSpeed,
            vy: Math.sin(angle) * initialSpeed,
            radius: 7,
            color: "#ff6600"
        });

        drone.shootCooldown = 0.25;

    } else if (drone.currentPattern === "SPIRAL") {
        // ウッキー・スパイラル（渦巻き：隙間緩和版）
        drone.spiralAngle = (drone.spiralAngle || 0) + 0.16;
        const speed = 3.8;

        bullets.push({ x: dx, y: dy, vx: Math.cos(drone.spiralAngle) * speed, vy: Math.sin(drone.spiralAngle) * speed, radius: 5, color: "#00b7ff" });
        bullets.push({ x: dx, y: dy, vx: Math.cos(drone.spiralAngle + Math.PI) * speed, vy: Math.sin(drone.spiralAngle + Math.PI) * speed, radius: 5, color: "#00b7ff" });

        drone.shootCooldown = 0.14;

    } else if (drone.currentPattern === "SWEEP") {
        // ヴァイパー・スイープ（スイング扇弾）
        drone.sweepAngleOffset = (drone.sweepAngleOffset || 0) + (0.05 * drone.sweepDirection);
        if (Math.abs(drone.sweepAngleOffset) > 0.6) {
            drone.sweepDirection *= -1;
        }

        const currentAngle = angleToPlayer + drone.sweepAngleOffset;
        const ways = 5;
        const spread = 0.26;
        const speed = 4.5;

        spawnFan(dx, dy, currentAngle, ways, spread, speed, "#ff00bb");
        drone.shootCooldown = 0.4;

    } else if (drone.currentPattern === "FLOWER") {
        // ふくびきけん・キャットバースト（十方放射）
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
                color: "#00ffaa"
            });
        }
        drone.shootCooldown = 0.9;
    }
}

// 扇状展開のヘルパー関数
function spawnFan(dx, dy, centerAngle, ways, spread, speed, color) {
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
            color: color
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

    // 縦の雨 (代替色: 青)
    rainTimer -= deltaTime;
    if (rainTimer <= 0) {
        bullets.push({
            x: Math.random() * canvas.width,
            y: -10,
            vx: (Math.random() - 0.5) * 0.6,
            vy: rainSpeed,
            radius: 5,
            color: "#4488ff"
        });
        rainTimer = rainInterval;
    }

    // 左右からの往復壁 (代替色: オレンジ)
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
                color: "#ff7700"
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

// --- 世界ランキング送信 (Supabaseへのスコア登録) ---
function submitScore() {
    const nameInput = document.getElementById("player-name");
    const name = nameInput.value.trim().replace(/[^a-zA-Z0-9あ-んア-ン一-龠]/g, "");

    if (!name) {
        alert("名前を入力してください。");
        return;
    }

    const seconds = parseFloat(gameTimer.toFixed(2));

    fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
        method: "POST",
        headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        body: JSON.stringify({
            name: name,
            seconds: seconds,
            orbs: orbsCollected
        })
    })
    .then(() => {
        alert("世界ランキングに記録が登録されました！");
        document.getElementById("ranking-input-container").style.display = "none";
        fetchLeaderboard();
    })
    .catch(err => {
        alert("送信エラーが発生しました。");
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

// 弾幕を描画するロジック（シンプルなベクトルサークルに変更し、完全にラグが解消されました）
function drawBullets() {
    bullets.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = b.color || "#ffffff";
        ctx.fill();
        ctx.closePath();
    });
}

// 闇のオーブとお助けアイテムの描画ロジック（画像から高性能なパーティクル描画に移行）
function drawOrbAndItems() {
    ctx.beginPath();
    ctx.arc(darkOrb.x, darkOrb.y, darkOrb.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#aa00ff";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#aa00ff";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.closePath();

    if (activeItem) {
        ctx.beginPath();
        ctx.arc(activeItem.x + activeItem.width/2, activeItem.y + activeItem.height/2, activeItem.width/2, 0, Math.PI * 2);

        let color = "#ffffff";
        let text = "";
        if (activeItem.type === "speed") { color = "#00ff00"; text = "S"; }
        else if (activeItem.type === "life") { color = "#ff00ff"; text = "L"; }
        else if (activeItem.type === "freeze") { color = "#00ffff"; text = "F"; }

        ctx.fillStyle = color;
        ctx.fill();
        ctx.closePath();

        ctx.fillStyle = "#000000";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(text, activeItem.x + activeItem.width/2, activeItem.y + activeItem.height/2 + 4);
        ctx.textAlign = "left";
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
        if (drone.currentPattern === "FIST") patternName = "Zパンチ（巨大拳・タメ突進/前方霧散）";
        if (drone.currentPattern === "BEAM") patternName = "じごくのほのお（時間差・追尾炎）";
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
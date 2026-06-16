const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

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
    bullet_blue: "assets/bullet_blue.png",
    bullet_green: "assets/bullet_green.png",
    bullet_pink: "assets/bullet_pink.png",
    bullet_rain: "assets/bullet_rain.png",
    bullet_wall: "assets/bullet_wall.png"
};

Object.keys(imageSources).forEach(key => {
    images[key] = new Image();
    images[key].src = imageSources[key];
    images[key].onload = () => { images[key].loaded = true; };
    images[key].onerror = () => { images[key].loaded = false; };
});

// --- Safari高速化用：オフスクリーンキャッシュシステム ---
const offscreenCache = {};

// 画像が読み込めなかった場合の動的ベクターキャッシュ作成
function getFallbackSprite(color, radius) {
    const key = `${color}_${radius}`;
    if (offscreenCache[key]) return offscreenCache[key];

    const size = Math.round(radius * 2) + 4;
    const offCanvas = document.createElement("canvas");
    offCanvas.width = size;
    offCanvas.height = size;
    const oCtx = offCanvas.getContext("2d");

    oCtx.beginPath();
    oCtx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    oCtx.fillStyle = color;
    oCtx.fill();
    oCtx.closePath();

    offscreenCache[key] = offCanvas;
    return offCanvas;
}

// 闇のオーブのプリレンダリングキャッシュ
let orbCanvas = null;
function preRenderDarkOrb() {
    orbCanvas = document.createElement("canvas");
    orbCanvas.width = 40;
    orbCanvas.height = 40;
    const oCtx = orbCanvas.getContext("2d");

    // 1層目
    oCtx.beginPath();
    oCtx.arc(20, 20, 12 * 1.3, 0, Math.PI * 2);
    oCtx.fillStyle = "rgba(170, 0, 255, 0.25)";
    oCtx.fill();
    oCtx.closePath();

    // コア
    oCtx.beginPath();
    oCtx.arc(20, 20, 12, 0, Math.PI * 2);
    oCtx.fillStyle = "#aa00ff";
    oCtx.fill();
    oCtx.closePath();
}
preRenderDarkOrb();

// --- 弾丸のオブジェクトプール（GCスパイク完全防止） ---
const MAX_BULLETS = 600;
const bulletPool = [];
for (let i = 0; i < MAX_BULLETS; i++) {
    bulletPool.push({
        active: false,
        x: 0, y: 0,
        vx: 0, vy: 0,
        radius: 0,
        color: "",
        img: null,
        fallback: null,
        type: "",
        state: "",
        timer: 0,
        action: "",
        dashVx: 0, dashVy: 0,
        targetAngle: 0
    });
}

// プールから不活性な弾を取得して有効化
function spawnBullet(x, y, vx, vy, radius, color, imgKey, type = "", state = "") {
    for (let i = 0; i < MAX_BULLETS; i++) {
        const b = bulletPool[i];
        if (!b.active) {
            b.active = true;
            b.x = x;
            b.y = y;
            b.vx = vx;
            b.vy = vy;
            b.radius = radius;
            b.color = color;
            b.img = images[imgKey] || null;
            b.fallback = getFallbackSprite(color, radius);
            b.type = type;
            b.state = state;
            b.timer = 0;
            b.action = "";
            b.dashVx = 0;
            b.dashVy = 0;
            b.targetAngle = 0;
            return b;
        }
    }
    return null; // プール空きなし時のセーフティ
}

// --- キャラクター・オブジェクトの定義 ---
let player = {};
let drone = {};
let darkOrb = {};
let activeItem = null;

// キー入力管理
const keys = {};
window.addEventListener("keydown", e => keys[e.key] = true);
window.addEventListener("keyup", e => keys[e.key] = false);

// --- ローカルランキング表示用 ---
function loadLocalLeaderboard() {
    const listDiv = document.getElementById("leaderboard-list");
    listDiv.innerHTML = "";

    const data = localStorage.getItem("kankichi_local_leaderboard");
    let entries = [];
    if (data) {
        entries = JSON.parse(data);
    }

    if (entries.length === 0) {
        listDiv.innerHTML = "<div style='color:#888; text-align:center; padding-top:20px;'>まだ記録がありません。<br>エンドレスに挑戦して記録を残そう！</div>";
        return;
    }

    entries.sort((a, b) => b.seconds - a.seconds);

    entries.slice(0, 10).forEach((entry, index) => {
        const row = document.createElement("div");
        row.className = "leaderboard-row";
        row.innerHTML = `
            <span>${index + 1}. ${entry.name}</span>
            <span>${entry.seconds.toFixed(2)}秒 (${entry.orbs}個)</span>
        `;
        listDiv.appendChild(row);
    });
}

function saveLocalScore(name, seconds, orbs) {
    const data = localStorage.getItem("kankichi_local_leaderboard");
    let entries = [];
    if (data) {
        entries = JSON.parse(data);
    }
    entries.push({ name: name, seconds: seconds, orbs: orbs });
    localStorage.setItem("kankichi_local_leaderboard", JSON.stringify(entries));
}

loadLocalLeaderboard();

// --- ゲーム開始 ---
function startGame(mode) {
    currentMode = mode;
    gameState = "PLAYING";
    gameTimer = 0;
    orbTimer = 15;
    orbsCollected = 0;
    itemSpawned = false;
    lastItemSpawnTime = 0;
    activeItem = null;

    // すべての弾丸をリセット
    for (let i = 0; i < MAX_BULLETS; i++) {
        bulletPool[i].active = false;
    }

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
        baseSpeed: 5.85,
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
    let droneSpeed = 1.3;
    if (currentMode === "EASY") droneSpeed = 0.78;
    else if (currentMode === "NORMAL") droneSpeed = 1.3;
    else if (currentMode === "HARD" || currentMode === "ENDLESS") droneSpeed = 1.56;

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
    loadLocalLeaderboard();
}

function spawnDarkOrb() {
    let rx, ry, distSq;
    do {
        rx = Math.random() * (canvas.width - 80) + 40;
        ry = Math.random() * (canvas.height - 120) + 60;
        const dx = player.x - rx;
        const dy = player.y - ry;
        distSq = dx * dx + dy * dy; // 高速な2乗比較
    } while (distSq < 22500); // 150の2乗

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

        drone.shootCooldown -= deltaTime;
        if (drone.shootCooldown <= 0) {
            executeDroneBarrage(dCenterX, dCenterY, angleToPlayer);
        }
    }

    // --- 画面全体の環境弾幕 ---
    if (drone.frozenTimer <= 0) {
        triggerScreenBulletPatterns(deltaTime);
    }

    // 弾の物理更新
    for (let i = 0; i < MAX_BULLETS; i++) {
        const b = bulletPool[i];
        if (!b.active) continue;

        // Zパンチ制御
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
        // じごくのほのお制御
        else if (b.type === "delayed_flame") {
            if (b.state === "slowdown") {
                b.vx *= 0.88;
                b.vy *= 0.88;
                if (b.vx * b.vx + b.vy * b.vy < 0.04) {
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

        // 画面外への離脱判定
        if (b.x < -40 || b.x > canvas.width + 40 || b.y < -40 || b.y > canvas.height + 40) {
            b.active = false;
        }
    }

    // --- 衝突判定 ---
    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;

    // 1. 闇のオーブ
    const dxOrb = playerCenterX - darkOrb.x;
    const dyOrb = playerCenterY - darkOrb.y;
    const distOrbSq = dxOrb * dxOrb + dyOrb * dyOrb;
    const touchOrbRad = 16 + darkOrb.radius;
    if (distOrbSq < touchOrbRad * touchOrbRad) {
        orbsCollected++;
        spawnDarkOrb();
        orbTimer = 15.0;
    }

    // 2. アイテム
    if (activeItem) {
        const itemCenterX = activeItem.x + activeItem.width / 2;
        const itemCenterY = activeItem.y + activeItem.height / 2;
        const dxItem = playerCenterX - itemCenterX;
        const dyItem = playerCenterY - itemCenterY;
        const distItemSq = dxItem * dxItem + dyItem * dyItem;
        const touchItemRad = 16 + activeItem.width / 2;
        if (distItemSq < touchItemRad * touchItemRad) {
            applyItemEffect(activeItem.type);
            activeItem = null;
        }
    }

    // 3. 弾との当たり判定 (高負荷ループ内のためMath.hypotを排除し、完全2乗距離で計算)
    if (!player.isInvincible && !player.isStunned) {
        for (let i = 0; i < MAX_BULLETS; i++) {
            const b = bulletPool[i];
            if (!b.active) continue;

            const dx = playerCenterX - b.x;
            const dy = playerCenterY - b.y;
            const distSq = dx * dx + dy * dy;
            const limitRad = player.hitRadius + b.radius;

            if (distSq < limitRad * limitRad) {
                player.isStunned = true;
                player.stunTimer = 2.0;
                player.isInvincible = true;
                player.invincibleTimer = 4.0;
                b.active = false; // 弾丸消滅
                break;
            }
        }
    }

    // 4. ドローンZ本体との衝突
    const droneCenterX = drone.x + drone.width / 2;
    const droneCenterY = drone.y + drone.height / 2;
    const dxDrone = playerCenterX - droneCenterX;
    const dyDrone = playerCenterY - droneCenterY;
    const distDroneSq = dxDrone * dxDrone + dyDrone * dyDrone;
    const touchDroneRad = player.hitRadius + 16;
    if (distDroneSq < touchDroneRad * touchDroneRad) {
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

        spawnFan(dx, dy, angleToPlayer, ways, spread, bulletSpeed, "#ffbb00", "bullet_green");
        drone.shootCooldown = interval;

    } else if (drone.currentPattern === "FIST") {
        const fistOffsets = [
            {x: -35, y: 70}, {x: 0, y: 70}, {x: 35, y: 70},
            {x: -35, y: 42}, {x: 0, y: 42}, {x: 35, y: 42},
            {x: -56, y: 14}, {x: -28, y: 14}, {x: 0, y: 14}, {x: 28, y: 14}, {x: 56, y: 14},
            {x: -56, y: -14}, {x: -28, y: -14}, {x: 0, y: -14}, {x: 28, y: -14}, {x: 56, y: -14},
            {x: -56, y: -42}, {x: -56, y: -63},
            {x: -21, y: -42}, {x: -21, y: -70},
            {x: 14, y: -42}, {x: 14, y: -73},
            {x: 49, y: -42}, {x: 49, y: -67},
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
            const b = spawnBullet(dx + offset.x, dy + offset.y, 0, 0, 7.0, "#00b7ff", "bullet_blue", "fist_part", "charge");
            if (b) {
                b.timer = 1.0;
                b.action = action;
                b.dashVx = dashVx;
                b.dashVy = dashVy;
                b.targetAngle = targetAngle;
            }
        });

        drone.shootCooldown = 1.9;

    } else if (drone.currentPattern === "BEAM") {
        const angle = angleToPlayer + (Math.random() - 0.5) * 0.5;
        const initialSpeed = 6.0;

        spawnBullet(dx, dy, Math.cos(angle) * initialSpeed, Math.sin(angle) * initialSpeed, 7, "#ff6600", "bullet_pink", "delayed_flame", "slowdown");
        drone.shootCooldown = 0.25;

    } else if (drone.currentPattern === "SPIRAL") {
        drone.spiralAngle = (drone.spiralAngle || 0) + 0.16;
        const speed = 3.8;

        spawnBullet(dx, dy, Math.cos(drone.spiralAngle) * speed, Math.sin(drone.spiralAngle) * speed, 5, "#00b7ff", "bullet_blue");
        spawnBullet(dx, dy, Math.cos(drone.spiralAngle + Math.PI) * speed, Math.sin(drone.spiralAngle + Math.PI) * speed, 5, "#00b7ff", "bullet_blue");

        drone.shootCooldown = 0.14;

    } else if (drone.currentPattern === "SWEEP") {
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
        const numBullets = 10;
        const speed = 3.0;
        const offsetAngle = gameTimer * 1.5;

        for (let i = 0; i < numBullets; i++) {
            const angle = (Math.PI * 2 / numBullets) * i + offsetAngle;
            spawnBullet(dx, dy, Math.cos(angle) * speed, Math.sin(angle) * speed, 6, "#00ffaa", "bullet_green");
        }
        drone.shootCooldown = 0.9;
    }
}

// 扇状展開のヘルパー関数
function spawnFan(dx, dy, centerAngle, ways, spread, speed, color, spriteName = "bullet_green") {
    const startIdx = -Math.floor(ways / 2);
    const endIdx = Math.floor(ways / 2);

    for (let i = startIdx; i <= endIdx; i++) {
        const bulletAngle = centerAngle + (i * spread);
        spawnBullet(dx, dy, Math.cos(bulletAngle) * speed, Math.sin(bulletAngle) * speed, 6, color, spriteName);
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
        spawnBullet(Math.random() * canvas.width, -10, (Math.random() - 0.5) * 0.6, rainSpeed, 5, "#4488ff", "bullet_rain");
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
            spawnBullet(
                side === "LEFT" ? -10 : canvas.width + 10,
                startY + offset,
                side === "LEFT" ? waveSpeed : -waveSpeed,
                0,
                6,
                "#ff7700",
                "bullet_wall"
            );
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

    for (let i = 0; i < MAX_BULLETS; i++) {
        bulletPool[i].active = false;
    }

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

// --- ローカルランキングへの保存処理 ---
function submitLocalScore() {
    const nameInput = document.getElementById("player-name");
    const name = nameInput.value.trim().replace(/[^a-zA-Z0-9あ-んア-ン一-龠]/g, "") || "名無し";
    const seconds = parseFloat(gameTimer.toFixed(2));

    saveLocalScore(name, seconds, orbsCollected);
    alert("ランキングに記録が保存されました！");
    document.getElementById("ranking-input-container").style.display = "none";
    loadLocalLeaderboard();
}

// --- 描画ロジック ---
function drawPlayer() {
    const key = `kankichi_${player.direction}`;
    const rx = Math.round(player.x);
    const ry = Math.round(player.y);

    if (images[key] && images[key].loaded) {
        if (player.isStunned && Math.floor(gameTimer * 10) % 2 === 0) return;
        if (player.isInvincible && Math.floor(gameTimer * 15) % 2 === 0) ctx.globalAlpha = 0.5;

        ctx.drawImage(images[key], rx, ry, player.width, player.height);
        ctx.globalAlpha = 1.0;
    } else {
        ctx.save();
        if (player.isStunned && Math.floor(gameTimer * 10) % 2 === 0) return;
        if (player.isInvincible && Math.floor(gameTimer * 15) % 2 === 0) ctx.globalAlpha = 0.5;

        const cx = Math.round(player.x + player.width / 2);
        const cy = Math.round(player.y + player.height / 2);

        ctx.beginPath();
        ctx.arc(cx, cy, player.width / 2, 0, Math.PI * 2);
        ctx.fillStyle = "#3366ff";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.closePath();

        ctx.restore();
    }

    if (gameState === "PLAYING" && !player.isStunned && !player.isInvincible) {
        ctx.beginPath();
        ctx.arc(Math.round(player.x + player.width / 2), Math.round(player.y + player.height / 2), player.hitRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.closePath();
    }
}

function drawDrone() {
    const key = `drone_${drone.direction}`;
    const rx = Math.round(drone.x);
    const ry = Math.round(drone.y);

    if (images[key] && images[key].loaded) {
        ctx.drawImage(images[key], rx, ry, drone.width, drone.height);
    } else {
        ctx.save();
        const cx = Math.round(drone.x + drone.width / 2);
        const cy = Math.round(drone.y + drone.height / 2);

        ctx.beginPath();
        ctx.arc(cx, cy, drone.width / 3, 0, Math.PI * 2);
        ctx.fillStyle = "#aa0000";
        ctx.strokeStyle = "#ff3333";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.closePath();
        ctx.restore();
    }
}

function drawBullets() {
    for (let i = 0; i < MAX_BULLETS; i++) {
        const b = bulletPool[i];
        if (!b.active) continue;

        const rx = Math.round(b.x);
        const ry = Math.round(b.y);
        const size = Math.round(b.radius * 3.0);
        const halfSize = Math.round(size / 2);

        if (b.img && b.img.loaded) {
            ctx.drawImage(b.img, rx - halfSize, ry - halfSize, size, size);
        } else {
            // オフスクリーンに事前キャッシュされた仮想Canvasから転送 (ベクターパス生成を回避)
            ctx.drawImage(b.fallback, rx - halfSize, ry - halfSize);
        }
    }
}

function drawOrbAndItems() {
    const ox = Math.round(darkOrb.x);
    const oy = Math.round(darkOrb.y);

    // 闇のオーブ (プリレンダリングしたオフスクリーンCanvasから1発で転送)
    ctx.drawImage(orbCanvas, ox - 20, oy - 20);

    // お助けアイテム
    if (activeItem) {
        const itemKey = `item_${activeItem.type}`;
        const ix = Math.round(activeItem.x);
        const iy = Math.round(activeItem.y);

        if (images[itemKey] && images[itemKey].loaded) {
            ctx.drawImage(images[itemKey], ix, iy, activeItem.width, activeItem.height);
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
        if (drone.currentPattern === "FIST") patternName = "Zパンチ";
        if (drone.currentPattern === "BEAM") patternName = "じごくのほのお";
        if (drone.currentPattern === "SPIRAL") patternName = "ウッキー・スパイラル";
        if (drone.currentPattern === "SWEEP") patternName = "ヴァイパー・スイープ";
        if (drone.currentPattern === "FLOWER") patternName = "ふくびきけん・キャットバースト";
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
    let deltaTime = (now - lastTime) / 1000;
    lastTime = now;

    if (deltaTime > 0.1) deltaTime = 0.1;

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
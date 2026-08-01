function updateStonePhysics(stone, dt) {
        if (!stone.isMoving) return;

        if (isSweeping && gameState === 'SLIDING') {
            sweepHeat = Math.min(1.0, sweepHeat + dt * 3.0);
        } else {
            sweepHeat = Math.max(0.0, sweepHeat - dt * 4.0);
            sweepSide = 0;
        }

        let speed = Math.hypot(stone.vx, stone.vy);

        if (speed <= (0.5 / TIME_STRETCH)) {
            stone.vx = 0;
            stone.vy = 0;
            stone.isMoving = false;
            checkTurnEnd();
            return;
        }

        let baseDecel = 45 / (TIME_STRETCH * TIME_STRETCH); 
        
        // Si on balaye sur le flanc, la réduction de friction est un peu moins efficace (compromis distance/ligne)
        let frictionMod = 1.0 - ((sweepSide === 0 ? 0.25 : 0.15) * sweepHeat);
        let decel = baseDecel * frictionMod * dt;
        let newSpeed = Math.max(0, speed - decel);

        stone.vx = (stone.vx / speed) * newSpeed;
        stone.vy = (stone.vy / speed) * newSpeed;

        let nx = -stone.vy / (newSpeed + 1);
        let ny = stone.vx / (newSpeed + 1);
        let curlIntensity = 800 / TIME_STRETCH; 
        let curlAccel = (stone.spin * curlIntensity) / (newSpeed + (40 / TIME_STRETCH));
        
        stone.vx += nx * curlAccel * dt;
        stone.vy += ny * curlAccel * dt;

        // Vraie physique réaliste : guidage latéral extrêmement subtil (dosé à 3.5 au lieu de 7)
        if (sweepSide !== 0 && sweepHeat > 0) {
            let guideForce = sweepSide * 3.5 * sweepHeat * dt; 
            let perpX = -stone.vy / (speed + 0.1);
            let perpY = stone.vx / (speed + 0.1);
            stone.vx += perpX * guideForce;
            stone.vy += perpY * guideForce;
        }

        stone.spin *= 0.999;

        stone.x += stone.vx * dt;
        stone.y += stone.vy * dt;

        if (stone.x < STONE_RADIUS) { stone.x = STONE_RADIUS; stone.vx *= -0.9; }
        if (stone.x > SHEET_WIDTH - STONE_RADIUS) { stone.x = SHEET_WIDTH - STONE_RADIUS; stone.vx *= -0.9; }

        if (stone === activeStone) {
            targetCameraY = stone.y - 350;
            targetCameraY = Math.max(0, Math.min(SHEET_HEIGHT - 700, targetCameraY));
        }
    }

    function handleSweepingInput(clientX, clientY) {
        if (gameState !== 'SLIDING' || !activeStone) {
            isSweeping = false;
            sweepSide = 0;
            document.getElementById('sweepHint').classList.remove('active');
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const scaleX = SHEET_WIDTH / rect.width;
        const scaleY = 700 / rect.height; 

        const touchWorldX = (clientX - rect.left) * scaleX;
        const touchWorldY = ((clientY - rect.top) * scaleY) + cameraY;

        const isNearStoneVertical = touchWorldY >= activeStone.y - 100 && touchWorldY <= activeStone.y + 25;
        const laneWidth = STONE_RADIUS * 3.5; 
        const offsetX = touchWorldX - activeStone.x;

        if (isNearStoneVertical && Math.abs(offsetX) < laneWidth) {
            isSweeping = true;
            // Zone centrale sécurisée élargie (±18 pixels) pour éviter de déclencher le flanc par erreur
            if (offsetX < -18) {
                sweepSide = -1; // Flanc gauche
                document.getElementById('sweepHint').textContent = "🧹 BALAYAGE FLANC GAUCHE (Correction subtile)";
            } else if (offsetX > 18) {
                sweepSide = 1;  // Flanc droit
                document.getElementById('sweepHint').textContent = "🧹 BALAYAGE FLANC DROIT (Correction subtile)";
            } else {
                sweepSide = 0;  // Devant (Centre pur)
                document.getElementById('sweepHint').textContent = "🧹 BALAYAGE DEVANT (Distance Max)";
            }
            document.getElementById('sweepHint').classList.add('active');
        } else {
            isSweeping = false;
            sweepSide = 0;
            document.getElementById('sweepHint').classList.remove('active');
        }
    }
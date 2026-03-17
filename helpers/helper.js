import * as THREE from '../third_part/three/three.module.js';
import { OrbitControls } from '../third_part/three/examples/jsm/controls/OrbitControls.js';

window.THREE = THREE;

(function () {

    let helperArray = [];

const helperApp = async function (bp) {
        let abort = false;
        let isActive = false;
        let isSending = false;
        let physicsTimer = null; // 引入计时器变量
        const targetFPS = 30;    // 锁定 30fps

        let tabIndex = addTab("Model " + bp.model + " DrawRange");
        let workshop = ".tab-content #tab" + tabIndex;

        const html = await $.get("helpers/helper.html");
        $(workshop).html(html);

        const $canvas = $("<canvas>");
        $canvas.attr({ width: bp.resX, height: bp.resY });
        $canvas.css({ width: bp.resX + "px", height: bp.resY + "px" });
        $(workshop).find("#canvas-wrapper").prepend($canvas);
        const canvas = $canvas[0];

        // 1. GUI 参数
        const effectController = {
            showDots: true,
            showLines: true,
            minDistance: 150,
            limitConnections: true,
            maxConnections: 20,
            particleCount: 400
        };

        const gui = new dat.GUI({ autoPlace: false });
        gui.add(effectController, "showDots").onChange(v => pointCloud && (pointCloud.visible = v));
        gui.add(effectController, "showLines").onChange(v => linesMesh && (linesMesh.visible = v));
        gui.add(effectController, "minDistance", 10, 300);
        gui.add(effectController, "limitConnections");
        gui.add(effectController, "maxConnections", 0, 30).step(1);
        gui.add(effectController, "particleCount", 1, 1000).step(1);

        const guiMount = $(workshop).find("#gui-mount-point")[0];
        if (guiMount) guiMount.appendChild(gui.domElement);

        let renderer, scene, camera, controls;
        let particlesData = [];
        let positions;
        let pointCloud, linesMesh, helper;
        let linePositions, lineColors;
        const maxParticleCount = 1000;
        const r = 800; 

        const pixelBuffer = new Uint8Array(bp.resX * bp.resY * 4);
        const rgb565Buffer = new Uint16Array(bp.resX * bp.resY);

        const encodeRGB565 = (rgbaData, outBuffer) => {
            const data32 = new Uint32Array(rgbaData.buffer);
            for (let i = 0; i < data32.length; i++) {
                const pixel = data32[i];
                const r = (pixel & 0xFF) >> 3;
                const g = (pixel >> 8 & 0xFF) >> 2;
                const b = (pixel >> 16 & 0xFF) >> 3;
                outBuffer[i] = (r << 11) | (g << 5) | b;
            }
        };

        /**
        * 将 RGBA8888 转换为 RGB565 并进行垂直翻转 (WebGL 像素对齐修正)
        * @param {Uint8Array} rgbaData - gl.readPixels 获取的原始像素数据
        * @param {Uint16Array} outBuffer - 预分配的 RGB565 目标缓冲区
        * @param {number} width - 图像宽度
        * @param {number} height - 图像高度
        */
        const encodeRGB565Flip = (rgbaData, outBuffer, width, height) => {
            // 使用 Uint32Array 视图，一次性处理 4 个字节（一个像素），比操作 Uint8Array 快得多
            const data32 = new Uint32Array(rgbaData.buffer);

            for (let y = 0; y < height; y++) {
                // WebGL 数据是从底向上的，所以源索引（sourceRow）要从最后一行开始取
                // 目标索引（destRow）从第一行开始存
                const sourceRowOffset = (height - 1 - y) * width;
                const destRowOffset = y * width;

                for (let x = 0; x < width; x++) {
                    const pixel = data32[sourceRowOffset + x];

                    // 提取通道 (基于 Little-endian 字节序: R 是低 8 位)
                    // R: 取低 8 位 -> 右移 3 位 剩 5 位
                    // G: 取中 8 位 -> 右移 2 位 剩 6 位
                    // B: 取高 8 位 -> 右移 3 位 剩 5 位
                    const r = (pixel & 0xFF) >> 3;
                    const g = (pixel >> 8 & 0xFF) >> 2;
                    const b = (pixel >> 16 & 0xFF) >> 3;

                    // 组合为 RGB565: [RRRRRGGGGGGBBBBB]
                    outBuffer[destRowOffset + x] = (r << 11) | (g << 5) | b;
                }
            }
        };

        const initThree = () => {
            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(45, bp.resX / bp.resY, 1, 4000);
            camera.position.z = 1750;

            renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(bp.resX, bp.resY, false);
            renderer.setPixelRatio(1); 
            controls = new OrbitControls(camera, canvas);

            const boxGeometry = new THREE.BoxGeometry(r, r, r);
            const boxMesh = new THREE.Mesh(boxGeometry, new THREE.MeshBasicMaterial({ visible: false }));
            helper = new THREE.BoxHelper(boxMesh, 0xffffff); 
            helper.material.transparent = true;
            helper.material.opacity = 0.3;
            scene.add(helper);

            positions = new Float32Array(maxParticleCount * 3);
            for (let i = 0; i < maxParticleCount; i++) {
                positions[i * 3] = Math.random() * r - r / 2;
                positions[i * 3 + 1] = Math.random() * r - r / 2;
                positions[i * 3 + 2] = Math.random() * r - r / 2;
                
                const vx = -1 + Math.random() * 2;
                const vy = -1 + Math.random() * 2;
                const vz = -1 + Math.random() * 2;
                particlesData.push({
                    velocity: new THREE.Vector3(
                        vx + (vx > 0 ? 0.3 : -0.3), 
                        vy + (vy > 0 ? 0.3 : -0.3), 
                        vz + (vz > 0 ? 0.3 : -0.3)
                    ),
                    numConnections: 0
                });
            }

            const pGeometry = new THREE.BufferGeometry();
            pGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
            pointCloud = new THREE.Points(pGeometry, new THREE.PointsMaterial({ 
                color: 0xFFFFFF, size: 3.5, sizeAttenuation: true, 
                transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthTest: false 
            }));
            scene.add(pointCloud);

            const segments = maxParticleCount * maxParticleCount;
            linePositions = new Float32Array(segments * 3);
            lineColors = new Float32Array(segments * 3);
            const lGeometry = new THREE.BufferGeometry();
            lGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
            lGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3).setUsage(THREE.DynamicDrawUsage));
            linesMesh = new THREE.LineSegments(lGeometry, new THREE.LineBasicMaterial({ 
                vertexColors: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending 
            }));
            scene.add(linesMesh);
        };

        const updatePhysics = () => {
            let vertexpos = 0, colorpos = 0, numConnected = 0;
            for (let i = 0; i < effectController.particleCount; i++) particlesData[i].numConnections = 0;

            for (let i = 0; i < effectController.particleCount; i++) {
                const pData = particlesData[i];
                positions[i * 3] += pData.velocity.x;
                positions[i * 3 + 1] += pData.velocity.y;
                positions[i * 3 + 2] += pData.velocity.z;

                if (Math.abs(positions[i * 3]) > r / 2) pData.velocity.x *= -1;
                if (Math.abs(positions[i * 3 + 1]) > r / 2) pData.velocity.y *= -1;
                if (Math.abs(positions[i * 3 + 2]) > r / 2) pData.velocity.z *= -1;

                if (effectController.limitConnections && pData.numConnections >= effectController.maxConnections) continue;

                for (let j = i + 1; j < effectController.particleCount; j++) {
                    const pDataB = particlesData[j];
                    if (effectController.limitConnections && pDataB.numConnections >= effectController.maxConnections) continue;

                    const dx = positions[i * 3] - positions[j * 3];
                    const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
                    const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (dist < effectController.minDistance) {
                        pData.numConnections++; pDataB.numConnections++;
                        const alpha = 1.0 - dist / effectController.minDistance;
                        linePositions[vertexpos++] = positions[i * 3];
                        linePositions[vertexpos++] = positions[i * 3 + 1];
                        linePositions[vertexpos++] = positions[i * 3 + 2];
                        linePositions[vertexpos++] = positions[j * 3];
                        linePositions[vertexpos++] = positions[j * 3 + 1];
                        linePositions[vertexpos++] = positions[j * 3 + 2];
                        for(let k=0; k<6; k++) lineColors[colorpos++] = alpha;
                        numConnected++;
                    }
                }
            }
            linesMesh.geometry.setDrawRange(0, numConnected * 2);
            linesMesh.geometry.attributes.position.needsUpdate = true;
            linesMesh.geometry.attributes.color.needsUpdate = true;
            pointCloud.geometry.attributes.position.needsUpdate = true;
        };

        const pushToUSB = async () => {
            if (isSending || abort || !isActive) return;
            isSending = true;
            try {
                const gl = renderer.getContext();
                gl.readPixels(0, 0, bp.resX, bp.resY, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);
                encodeRGB565Flip(pixelBuffer, rgb565Buffer, bp.resX, bp.resY);
                await bp.sendMediaData(rgb565Buffer.buffer);
            } catch (err) { } finally { isSending = false; }
        };

        const cleanup = async () => {
            abort = true; isActive = false;
            if (physicsTimer) { clearInterval(physicsTimer); physicsTimer = null; }
            if (gui) gui.destroy();
            if (scene) {
                scene.traverse((object) => {
                    if (object.geometry) object.geometry.dispose();
                    if (object.material) {
                        if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
                        else object.material.dispose();
                    }
                });
            }
            if (renderer) { renderer.dispose(); renderer = null; }
            scene = null; camera = null; controls = null;
        };

        $(workshop).find("#Start").on('click', async function() {
            if ($(this).hasClass("disabled")) return;
            $(this).addClass("disabled");
            $(workshop).find("#Stop").removeClass("disabled");

            await bp.sendPLHead({ 'cmdType': 5, 'fmtStr': `video/x-raw, format=RGB16, width=${bp.resX}, height=${bp.resY}, framerate=0/1` });
            
            abort = false; isActive = true;
            if (!renderer) initThree();
            if (scene) scene.rotation.set(0, 0, 0); // 启动重置角度

            // 使用 setInterval 锁定帧率
            physicsTimer = setInterval(() => {
                if (abort || !isActive) return;
                if (scene) {
                    scene.rotation.y += 0.001 * (60 / targetFPS);
                    scene.rotation.x += 0.0005 * (60 / targetFPS);
                }
                updatePhysics();
                controls.update();
                renderer.render(scene, camera);
                pushToUSB();
            }, 1000 / targetFPS);
        });

        $(workshop).find("#Stop, #Close").on('click', async function() {
            const isClose = this.id === "Close";
            await cleanup();
            await bp.sendSLHead({ 'cmdType': 2 });
            if (isClose) {
                helperArray = helperArray.filter(item => item.tabIndex !== tabIndex);
                closeTab(tabIndex);
            } else {
                $(workshop).find("#Start").removeClass("disabled");
                $(workshop).find("#Stop").addClass("disabled");
            }
        });

        return { tabIndex };
    };

    const helperReg = (bp) => {
        const btnHtml = `
      <button id="Help" type="button" class="btn btn-primary btn-app" 
            data-bs-toggle="tooltip" title="Particle DrawRange Demo">
        <i class="bi-2-circle"></i>
      </button>`;

        $(btnHtml)
            .appendTo(".banner .crumbs")
            .on('click', async function () {
                $(this).tooltip('hide');
                const instance = await helperApp(bp);
                if (instance) helperArray.push(instance);
            });
    };

    if (window.apps) apps.push(helperReg);

})();

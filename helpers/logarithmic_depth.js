import * as THREE from '../third_part/three/three.module.js';
import { OrbitControls } from '../third_part/three/examples/jsm/controls/OrbitControls.js';

(function () {
    let instanceArray = [];

    const logDepthApp = async function (bp) {
        let abort = false;
        let isActive = false;
        let isSending = false;
        let renderTimer = null;
        const targetFPS = 30;

        let tabIndex = addTab("Model " + bp.model + " LogDepth");
        let workshop = ".tab-content #tab" + tabIndex;

        const html = await $.get("helpers/helper.html");
        $(workshop).html(html);

        const $canvas = $("<canvas>");
        $canvas.attr({ width: bp.resX, height: bp.resY });
        $(workshop).find("#canvas-wrapper").prepend($canvas);
        const canvas = $canvas[0];

        const effectController = {
            logarithmicDepth: true,
            animate: true,
            labels: true
        };

        const gui = new dat.GUI({ autoPlace: false });
        gui.add(effectController, "logarithmicDepth").name("对数深度缓冲");
        gui.add(effectController, "animate").name("自动巡航");

        const guiMount = $(workshop).find("#gui-mount-point")[0];
        if (guiMount) guiMount.appendChild(gui.domElement);

        let renderer, scene, camera, controls, objectsGroup;
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

        const initThree = () => {
            scene = new THREE.Scene();
            // 范围从 1微米 到 10^24
            camera = new THREE.PerspectiveCamera(50, bp.resX / bp.resY, 1e-6, 1e27);
            
            renderer = new THREE.WebGLRenderer({ 
                canvas: canvas, 
                antialias: true, 
                preserveDrawingBuffer: true,
                logarithmicDepthBuffer: effectController.logarithmicDepth 
            });
            renderer.setSize(bp.resX, bp.resY, false);
            
            controls = new OrbitControls(camera, canvas);

            // --- 核心修改：生成一系列不同量级的物体 ---
            objectsGroup = new THREE.Group();
            scene.add(objectsGroup);

            const geometry = new THREE.BoxGeometry(1, 1, 1);
            
            // 从 10^-5 到 10^24 次方，每隔一个量级放一个盒子
            for (let i = -5; i < 25; i++) {
                const material = new THREE.MeshNormalMaterial();
                const mesh = new THREE.Mesh(geometry, material);
                
                const scale = Math.pow(10, i);
                mesh.scale.set(scale, scale, scale);
                
                // 错开位置，形成隧道感
                mesh.position.x = (i % 2 === 0 ? 1 : -1) * scale * 2;
                mesh.position.y = (i % 3 === 0 ? 1 : -1) * scale;
                mesh.position.z = -scale * 4; // 放在前方
                
                objectsGroup.add(mesh);
            }

            scene.add(new THREE.AmbientLight(0x444444));
            const light = new THREE.DirectionalLight(0xffffff, 1);
            light.position.set(1, 1, 1);
            scene.add(light);
        };

        const pushToUSB = async () => {
            if (isSending || abort || !isActive) return;
            isSending = true;
            try {
                const gl = renderer.getContext();
                gl.readPixels(0, 0, bp.resX, bp.resY, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);
                encodeRGB565(pixelBuffer, rgb565Buffer);
                await bp.sendMediaData(rgb565Buffer.buffer);
            } catch (err) { } finally { isSending = false; }
        };

        const cleanup = async () => {
            abort = true; isActive = false;
            if (renderTimer) clearInterval(renderTimer);
            if (gui) gui.destroy();
            if (renderer) renderer.dispose();
        };

        $(workshop).find("#Start").on('click', async function() {
            if ($(this).hasClass("disabled")) return;
            $(this).addClass("disabled");
            $(workshop).find("#Stop").removeClass("disabled");

            await bp.sendSLHead({ 'cmdType': 2 });
            await bp.sendPLHead({ 'cmdType': 5, 'fmtStr': `video/x-raw, format=RGB16, width=${bp.resX}, height=${bp.resY}, framerate=0/1` });

            abort = false; isActive = true;
            if (renderer) renderer.dispose();
            initThree();

            let startTime = Date.now();

            renderTimer = setInterval(() => {
                if (abort || !isActive) return;

                if (effectController.animate) {
                    const elapsed = (Date.now() - startTime) * 0.0005;
                    // 使用正弦波控制指数，实现从极近到极远的往复穿梭
                    // 范围大约在 10^-4 到 10^22 之间
                    const exponent = Math.sin(elapsed) * 13 + 9;
                    const zPos = Math.pow(10, exponent);
                    camera.position.z = zPos;
                    camera.position.x = zPos * 0.2; // 稍微偏离中心，增加视觉差
                    
                    // 让物体也转起来
                    objectsGroup.rotation.y += 0.01;
                }

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
                instanceArray = instanceArray.filter(item => item.tabIndex !== tabIndex);
                closeTab(tabIndex);
            } else {
                $(workshop).find("#Start").removeClass("disabled");
                $(workshop).find("#Stop").addClass("disabled");
            }
        });

        return { tabIndex };
    };

    const registerApp = (bp) => {
        const btnHtml = `
            <button id="LogDepthDemo" type="button" class="btn btn-primary btn-app" 
                    data-bs-toggle="tooltip" title="Logarithmic Depth Buffer">
                <i class="bi-eye"></i>
            </button>`;

        $(btnHtml)
            .appendTo(".banner .crumbs")
            .on('click', async function () {
                $(this).tooltip('hide');
                const instance = await logDepthApp(bp);
                if (instance) instanceArray.push(instance);
            });
    };

    if (window.apps) apps.push(registerApp);
})();
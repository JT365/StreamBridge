import * as THREE from '../third_part/three/three.module.js';
import { OrbitControls } from '../third_part/three/examples/jsm/controls/OrbitControls.js';

// 保持全局 THREE 以兼容可能的旧逻辑
window.THREE = THREE;

(function () {
    let instanceArray = [];

    const linesApp = async function (bp) {
        let abort = false;
        let isActive = false;
        let isSending = false;
        let renderTimer = null; 
        const targetFPS = 30;

        // 1. 创建 UI Tab
        let tabIndex = addTab("Model " + bp.model + " LinesDemo");
        let workshop = ".tab-content #tab" + tabIndex;

        // 借用 helper.html 的布局 (包含 canvas-wrapper, gui-mount-point, Start/Stop 按钮)
        const html = await $.get("helpers/helper.html");
        $(workshop).html(html);

        const $canvas = $("<canvas>");
        $canvas.attr({ width: bp.resX, height: bp.resY });
        $canvas.css({ width: bp.resX + "px", height: bp.resY + "px" });
        $(workshop).find("#canvas-wrapper").prepend($canvas);
        const canvas = $canvas[0];

        // 2. GUI 控制参数 (对应官方示例的逻辑)
        const effectController = {
            segments: 10000,
            radius: 800,
            animate: true
        };

        const gui = new dat.GUI({ autoPlace: false });
        gui.add(effectController, "segments", 1000, 50000).step(1000).onChange(() => initLines());
        gui.add(effectController, "radius", 200, 1500).onChange(() => initLines());
        gui.add(effectController, "animate");

        const guiMount = $(workshop).find("#gui-mount-point")[0];
        if (guiMount) guiMount.appendChild(gui.domElement);

        // 3. Three.js 变量
        let renderer, scene, camera, controls, linesMesh;
        const pixelBuffer = new Uint8Array(bp.resX * bp.resY * 4);
        const rgb565Buffer = new Uint16Array(bp.resX * bp.resY);

        // RGB565 转换算法 (同 helper.js)
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
            camera = new THREE.PerspectiveCamera(27, bp.resX / bp.resY, 5, 3500);
            camera.position.z = 2750;

            renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(bp.resX, bp.resY, false);
            renderer.setPixelRatio(1);
            controls = new OrbitControls(camera, canvas);

            initLines();
        };

        const initLines = () => {
            if (linesMesh) {
                scene.remove(linesMesh);
                linesMesh.geometry.dispose();
            }

            const segments = effectController.segments;
            const r = effectController.radius;
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(segments * 3);
            const colors = new Float32Array(segments * 3);

            for (let i = 0; i < segments; i++) {
                const x = Math.random() * r - r / 2;
                const y = Math.random() * r - r / 2;
                const z = Math.random() * r - r / 2;
                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;
                colors[i * 3] = (x / r) + 0.5;
                colors[i * 3 + 1] = (y / r) + 0.5;
                colors[i * 3 + 2] = (z / r) + 0.5;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.computeBoundingSphere();

            const material = new THREE.LineBasicMaterial({ vertexColors: true });
            linesMesh = new THREE.LineSegments(geometry, material);
            scene.add(linesMesh);
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
            if (renderTimer) clearInterval(renderTimer);
            if (gui) gui.destroy();
            if (scene) {
                scene.traverse(obj => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
                });
            }
            if (renderer) renderer.dispose();
        };

        // 按钮事件绑定
        $(workshop).find("#Start").on('click', async function() {
            if ($(this).hasClass("disabled")) return;
            $(this).addClass("disabled");
            $(workshop).find("#Stop").removeClass("disabled");

            await bp.sendPLHead({ 'cmdType': 5, 'fmtStr': `video/x-raw, format=RGB16, width=${bp.resX}, height=${bp.resY}, framerate=0/1` });

            abort = false; isActive = true;
            if (!renderer) initThree();

            renderTimer = setInterval(() => {
                if (abort || !isActive) return;
                if (effectController.animate && linesMesh) {
                    const time = Date.now() * 0.001;
                    linesMesh.rotation.x = time * 0.25;
                    linesMesh.rotation.y = time * 0.5;
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
            <button id="LinesDemo" type="button" class="btn btn-primary btn-app" 
                    data-bs-toggle="tooltip" title="WebGL BufferGeometry Lines">
                <i class="bi-bounding-box-circles"></i>
            </button>`;

        $(btnHtml)
            .appendTo(".banner .crumbs")
            .on('click', async function () {
                $(this).tooltip('hide');
                const instance = await linesApp(bp);
                if (instance) instanceArray.push(instance);
            });
    };

    if (window.apps) apps.push(registerApp);
})();
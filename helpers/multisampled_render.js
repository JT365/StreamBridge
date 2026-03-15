import * as THREE from '../third_part/three/three.module.js';

(function () {
    let instanceArray = [];

    const multisampleApp = async function (bp) {
        let abort = false;
        let isActive = false;
        let isSending = false;
        let renderTimer = null;
        const targetFPS = 30;

        let tabIndex = addTab("Model " + bp.model + " MSAA");
        let workshop = ".tab-content #tab" + tabIndex;

        const html = await $.get("helpers/helper.html");
        $(workshop).html(html);

        const $canvas = $("<canvas>");
        $canvas.attr({ width: bp.resX, height: bp.resY });
        $(workshop).find("#canvas-wrapper").prepend($canvas);
        const canvas = $canvas[0];

        const params = {
            samples: 4,      
            useMSAA: true,   
            animate: true
        };

        const gui = new dat.GUI({ autoPlace: false });
        gui.add(params, "samples", [0, 2, 4, 8, 16]).name("采样倍数").onChange(() => initRenderTarget());
        gui.add(params, "useMSAA").name("启用抗锯齿");

        const guiMount = $(workshop).find("#gui-mount-point")[0];
        if (guiMount) guiMount.appendChild(gui.domElement);

        let renderer, scene, camera, mesh, renderTarget, intermediateTarget;
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

        const initRenderTarget = () => {
            if (renderTarget) renderTarget.dispose();
            if (intermediateTarget) intermediateTarget.dispose();

            // r170 下创建多重采样目标
            renderTarget = new THREE.WebGLRenderTarget(bp.resX, bp.resY, {
                samples: parseInt(params.samples)
            });

            // 普通目标，用于解析
            intermediateTarget = new THREE.WebGLRenderTarget(bp.resX, bp.resY);
        };

        const initThree = () => {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x222222);
            camera = new THREE.PerspectiveCamera(50, bp.resX / bp.resY, 1, 1000);
            camera.position.z = 200;

            renderer = new THREE.WebGLRenderer({ 
                canvas: canvas, 
                antialias: false, 
                preserveDrawingBuffer: true 
            });
            renderer.setSize(bp.resX, bp.resY, false);

            const geometry = new THREE.TorusKnotGeometry(60, 20, 150, 20);
            const material = new THREE.MeshNormalMaterial({ wireframe: true });
            mesh = new THREE.Mesh(geometry, material);
            scene.add(mesh);

            initRenderTarget();
        };

        const pushToUSB = async (target) => {
            if (isSending || abort || !isActive) return;
            isSending = true;
            try {
                // 确保从当前的解析目标读取
                renderer.setRenderTarget(target);
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
            if (renderTarget) renderTarget.dispose();
            if (intermediateTarget) intermediateTarget.dispose();
            if (renderer) renderer.dispose();
        };

        $(workshop).find("#Start").on('click', async function() {
            if ($(this).hasClass("disabled")) return;
            $(this).addClass("disabled");
            $(workshop).find("#Stop").removeClass("disabled");

            await bp.sendSLHead({ 'cmdType': 2 });
            await bp.sendPLHead({ 'cmdType': 5, 'fmtStr': `video/x-raw, format=RGB16, width=${bp.resX}, height=${bp.resY}, framerate=0/1` });

            abort = false; isActive = true;
            if (!renderer) initThree();

            renderTimer = setInterval(() => {
                if (abort || !isActive) return;
                
                if (params.animate) {
                    mesh.rotation.x += 0.01;
                    mesh.rotation.y += 0.02;
                }

                if (params.useMSAA && params.samples > 0) {
// 1. 渲染到多重采样缓冲
                    renderer.setRenderTarget(renderTarget);
                    renderer.render(scene, camera);

                    // 2. 使用底层的 WebGL2 属性进行 blit，避免 API 冲突
                    const gl = renderer.getContext();
                    const state = renderer.state;

                    // 获取 r170 中 renderTarget 对应的原生 framebuffer
                    // 注意：在 r170 中，framebuffer 存储在内部属性中，通常是 __webglFramebuffer
                    const readFb = renderer.properties.get(renderTarget).__webglFramebuffer;
                    const drawFb = renderer.properties.get(intermediateTarget).__webglFramebuffer;

                    // 显式绑定，确保 Read 和 Draw 不是同一个对象
                    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb);
                    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFb);
                    
                    gl.blitFramebuffer(
                        0, 0, bp.resX, bp.resY,
                        0, 0, bp.resX, bp.resY,
                        gl.COLOR_BUFFER_BIT, gl.NEAREST
                    );

                    // 3. 必须切回到解析后的目标，供 pushToUSB 里的 readPixels 读取
                    renderer.setRenderTarget(intermediateTarget);
                    pushToUSB(intermediateTarget);

                    // 4. 反馈到网页预览屏幕 (null 代表系统默认的画布)
                    renderer.setRenderTarget(null);
                    renderer.render(scene, camera);
                } else {
                    renderer.setRenderTarget(null);
                    renderer.render(scene, camera);
                    pushToUSB(null);
                }
                
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
        const btnHtml = `<button id="MSAADemo" type="button" class="btn btn-primary btn-app" title="MSAA"><i class="bi-layers"></i></button>`;
        $(btnHtml).appendTo(".banner .crumbs").on('click', async function () {
            const instance = await multisampleApp(bp);
            if (instance) instanceArray.push(instance);
        });
    };

    if (window.apps) apps.push(registerApp);
})();
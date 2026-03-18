import * as THREE from '../third_part/three/three.module.js';
import { OrbitControls } from '../third_part/three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from '../third_part/three/examples/jsm/loaders/PLYLoader.js';

window.THREE = THREE;

(function () {
    let spotlightArray = [];

    const spotlightApp = async function (bp) {
        let abort = false, isActive = false, isSending = false, physicsTimer = null;
        const targetFPS = 30;

        let tabIndex = addTab("Model " + bp.model + " SpotLight");
        let workshop = ".tab-content #tab" + tabIndex;

        const html = await $.get("helpers/helper.html");
        $(workshop).html(html);

        const $canvas = $("<canvas>").attr({ width: bp.resX, height: bp.resY })
                        .css({ width: bp.resX + "px", height: bp.resY + "px" });
        $(workshop).find("#canvas-wrapper").prepend($canvas);
        const canvas = $canvas[0];

        const effectController = {
            spotIntensity: 9.2,   
            hemiIntensity: 0.74,  
            exposure: 1.6,        
            animateModel: true
        };

        const gui = new dat.GUI({ autoPlace: false });
        gui.add(effectController, "spotIntensity", 0, 15).name("投影强度");
        gui.add(effectController, "hemiIntensity", 0, 3).name("身体细节");
        gui.add(effectController, "exposure", 0.1, 4).name("整体亮度").onChange(v => {
            if (renderer) renderer.toneMappingExposure = v;
        });

        const guiMount = $(workshop).find("#gui-mount-point")[0];
        if (guiMount) guiMount.appendChild(gui.domElement);

        let renderer, scene, camera, controls, spotLight, hemiLight, meshModel = null;
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

        const initThree = async () => {
            if (renderer) return; // 关键：如果已经有渲染器，不再重新创建

            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(32, bp.resX / bp.resY, 1, 1000);
            camera.position.set(170, 85, 170);

            renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(bp.resX, bp.resY, false);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.LinearToneMapping; 
            renderer.toneMappingExposure = effectController.exposure;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFShadowMap; 

            controls = new OrbitControls(camera, canvas);
            controls.target.set(0, 52, 0); 
            controls.enableDamping = true;

            hemiLight = new THREE.HemisphereLight(0xffffff, 0x111122, effectController.hemiIntensity);
            scene.add(hemiLight);

            spotLight = new THREE.SpotLight(0xffffff, effectController.spotIntensity);
            spotLight.position.set(70, 160, 70);
            spotLight.angle = 0.5;
            spotLight.penumbra = 0.4;
            spotLight.decay = 0; 
            spotLight.distance = 500;
            spotLight.castShadow = true;
            spotLight.shadow.bias = -0.0008; 
            spotLight.shadow.mapSize.set(1024, 1024);

            const tLoader = new THREE.TextureLoader();
            const spotMap = tLoader.load('third_part/three/examples/textures/disturb.jpg');
            spotMap.colorSpace = THREE.SRGBColorSpace; 
            spotLight.map = spotMap;
            scene.add(spotLight);

            const planeGeo = new THREE.PlaneGeometry(2000, 2000);
            const planeMat = new THREE.MeshPhongMaterial({ color: 0x222222, shininess: 0, side: THREE.DoubleSide });
            const plane = new THREE.Mesh(planeGeo, planeMat);
            plane.rotation.x = -Math.PI / 2;
            plane.receiveShadow = true; 
            scene.add(plane);

            const pLoader = new PLYLoader();
            pLoader.load('third_part/three/examples/models/ply/binary/Lucy100k.ply', function (geometry) {
                geometry.computeVertexNormals();
                geometry.computeBoundingBox();
                const offset = -geometry.boundingBox.min.y;
                geometry.translate(0, offset, 0);
                geometry.center(); 
                geometry.translate(0, (geometry.boundingBox.max.y - geometry.boundingBox.min.y) / 2, 0);

                const material = new THREE.MeshPhongMaterial({ color: 0xcccccc, shininess: 10, specular: 0x111111 });
                meshModel = new THREE.Mesh(geometry, material);
                meshModel.castShadow = true;
                meshModel.receiveShadow = true;
                meshModel.scale.set(0.08, 0.08, 0.08);
                meshModel.position.set(0, -2.0, 0); 
                
                scene.add(meshModel);
                spotLight.target = meshModel;
            });
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

        // 停止循环：不销毁渲染器
        const stopLoop = () => {
            abort = true;
            isActive = false;
            if (physicsTimer) { clearInterval(physicsTimer); physicsTimer = null; }
        };

        // 彻底清理：只有 Close 标签时执行
        const fullCleanup = async () => {
            stopLoop();
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
            if (renderer) {
                renderer.dispose();
                renderer.forceContextLoss(); // 强制断开上下文
                renderer = null;
            }
            scene = null; camera = null; controls = null;
        };

        $(workshop).find("#Start").on('click', async function() {
            if ($(this).hasClass("disabled")) return;
            $(this).addClass("disabled");
            $(workshop).find("#Stop").removeClass("disabled");
                       
            abort = false; isActive = true;
            if (!renderer) await initThree(); // 仅在没有渲染器时初始化
            
            physicsTimer = setInterval(() => {
                if (abort || !isActive) return;
                const time = performance.now() / 2000;
                spotLight.intensity = effectController.spotIntensity;
                hemiLight.intensity = effectController.hemiIntensity;
                spotLight.position.x = Math.cos(time) * 75;
                spotLight.position.z = Math.sin(time) * 75;
                if (meshModel && effectController.animateModel) meshModel.rotation.y += 0.01;
                
                controls.update();
                renderer.render(scene, camera);
                pushToUSB();
            }, 1000 / targetFPS);
        });

        $(workshop).find("#Stop, #Close").on('click', async function() {
            const isClose = this.id === "Close";
            
            if (isClose) {
                await fullCleanup();
                await bp.sendSLHead({ 'cmdType': 2 });
                spotlightArray = spotlightArray.filter(item => item.tabIndex !== tabIndex);
                closeTab(tabIndex);
            } else {
                stopLoop(); // 仅停止循环
                $(workshop).find("#Start").removeClass("disabled");
                $(workshop).find("#Stop").addClass("disabled");
            }
        });

        await bp.sendPLHead({ 'cmdType': 5, 'fmtStr': `video/x-raw, format=RGB16, width=${bp.resX}, height=${bp.resY}, framerate=0/1` });
 
        return { tabIndex };
    };

    const spotlightReg = (bp) => {
        $(`<button id="Spotlight" type="button" class="btn btn-primary btn-app" title="SpotLight"><i class="bi-lightbulb-fill"></i></button>`)
        .appendTo(".banner .crumbs").on('click', async () => {
            const instance = await spotlightApp(bp);
            if (instance) spotlightArray.push(instance);
        });
    };

    if (window.apps) apps.push(spotlightReg);
})();
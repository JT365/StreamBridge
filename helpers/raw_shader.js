import * as THREE from '../third_part/three/three.module.js';

(function () {
    let instanceArray = [];

    const rawShaderApp = async function (bp) {
        let abort = false;
        let isActive = false;
        let isSending = false;
        let renderTimer = null;
        const targetFPS = 30;

        let tabIndex = addTab("Model " + bp.model + " Raw Shader");
        let workshop = ".tab-content #tab" + tabIndex;

        // 复用 helper.html 的布局
        const html = await $.get("helpers/helper.html");
        $(workshop).html(html);

        const $canvas = $("<canvas>");
        $canvas.attr({ width: bp.resX, height: bp.resY });
        $(workshop).find("#canvas-wrapper").prepend($canvas);
        const canvas = $canvas[0];

        let renderer, scene, camera, mesh;
        const pixelBuffer = new Uint8Array(bp.resX * bp.resY * 4);
        const rgb565Buffer = new Uint16Array(bp.resX * bp.resY);

        // --- 着色器代码 ---
        const vertexShader = `
            precision mediump float;
            precision mediump int;
            uniform mat4 modelViewMatrix;
            uniform mat4 projectionMatrix;
            uniform float time;
            attribute vec3 position;
            attribute vec4 color;
            varying vec3 vPosition;
            varying vec4 vColor;
            void main()	{
                vPosition = position;
                vColor = color;
                vec3 newPosition = position;
                newPosition.z += sin( time + position.x * 10.0 ) * 0.2;
                newPosition.z += sin( time + position.y * 10.0 ) * 0.2;
                gl_Position = projectionMatrix * modelViewMatrix * vec4( newPosition, 1.0 );
            }
        `;

        const fragmentShader = `
            precision mediump float;
            precision mediump int;
            uniform float time;
            varying vec3 vPosition;
            varying vec4 vColor;
            void main()	{
                vec4 color = vec4( vColor );
                color.r += sin( vPosition.x * 10.0 + time ) * 0.5;
                gl_FragColor = color;
            }
        `;

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
            camera = new THREE.PerspectiveCamera(50, bp.resX / bp.resY, 1, 10);
            camera.position.z = 2;

            renderer = new THREE.WebGLRenderer({ 
                canvas: canvas, 
                antialias: true, 
                preserveDrawingBuffer: true 
            });
            renderer.setSize(bp.resX, bp.resY, false);

            // 生成几何体数据
            const triangles = 500;
            const geometry = new THREE.BufferGeometry();
            const positions = [];
            const colors = [];

            for (let i = 0; i < triangles; i++) {
                positions.push(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
                positions.push(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
                positions.push(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
                colors.push(Math.random(), Math.random(), Math.random(), Math.random());
                colors.push(Math.random(), Math.random(), Math.random(), Math.random());
                colors.push(Math.random(), Math.random(), Math.random(), Math.random());
            }

            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));

            const material = new THREE.RawShaderMaterial({
                uniforms: {
                    time: { value: 1.0 }
                },
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                side: THREE.DoubleSide,
                transparent: true
            });

            mesh = new THREE.Mesh(geometry, material);
            scene.add(mesh);
        };

        const pushToUSB = async () => {
            if (isSending || abort || !isActive) return;
            isSending = true;
            try {
                const gl = renderer.getContext();
                gl.readPixels(0, 0, bp.resX, bp.resY, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);
                encodeRGB565Flip(pixelBuffer, rgb565Buffer, bp.resX, bp.resY);;
                await bp.sendMediaData(rgb565Buffer.buffer);
            } catch (err) { } finally { isSending = false; }
        };

        const cleanup = async () => {
            abort = true; isActive = false;
            if (renderTimer) clearInterval(renderTimer);
            if (renderer) renderer.dispose();
            scene = null;
        };

        $(workshop).find("#Start").on('click', async function() {
            if ($(this).hasClass("disabled")) return;
            $(this).addClass("disabled");
            $(workshop).find("#Stop").removeClass("disabled");

            abort = false; isActive = true;
            initThree();

            renderTimer = setInterval(() => {
                if (abort || !isActive) return;
                
                const time = performance.now() * 0.005;
                mesh.material.uniforms.time.value = time;
                mesh.rotation.y = time * 0.1;
                
                renderer.render(scene, camera);
                pushToUSB();
            }, 1000 / targetFPS);
        });

        $(workshop).find("#Stop, #Close").on('click', async function() {
            const isClose = this.id === "Close";
            await cleanup();
            if (isClose) {
                await bp.sendSLHead({ 'cmdType': 2 });
                instanceArray = instanceArray.filter(item => item.tabIndex !== tabIndex);
                closeTab(tabIndex);
            } else {
                $(workshop).find("#Start").removeClass("disabled");
                $(workshop).find("#Stop").addClass("disabled");
            }
        });

        await bp.sendPLHead({ 'cmdType': 5, 'fmtStr': `video/x-raw, format=RGB16, width=${bp.resX}, height=${bp.resY}, framerate=0/1` });

        return { tabIndex };
    };

    const registerApp = (bp) => {
        const btnHtml = `
            <button id="RawShaderDemo" type="button" class="btn btn-primary btn-app" 
                    data-bs-toggle="tooltip" title="Raw Shader Material">
                <i class="bi-cpu"></i>
            </button>`;

        $(btnHtml)
            .appendTo(".banner .crumbs")
            .on('click', async function () {
                $(this).tooltip('hide');
                const instance = await rawShaderApp(bp);
                if (instance) instanceArray.push(instance);
            });
    };

    if (window.apps) apps.push(registerApp);
})();
const VS_SOURCE = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;

    uniform int u_angle;   // 0, 90, 180, 270

    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);

        vec2 uv = a_texCoord;

        if (u_angle == 90) {
            uv = vec2(a_texCoord.y, 1.0 - a_texCoord.x);
        }
        else if (u_angle == 180) {
            uv = vec2(1.0 - a_texCoord.x, 1.0 - a_texCoord.y);
        }
        else if (u_angle == 270) {
            uv = vec2(1.0 - a_texCoord.y, a_texCoord.x);
        }

        v_texCoord = uv;
    }
`;

const FS_SOURCE = `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_sampler;

    void main() {
        gl_FragColor = texture2D(u_sampler, v_texCoord);
    }
`;

const SANTA_CLAUS = {
    '2': 0,
    '2W': 0,
    '3': 90,
    '4': 90,
    '5': 0,
    '5C': 0,
    '5S': 90,
    '6': 90,
    '7': 0,
    '8': 90,
    'Y': 90,
    'X': 90,
    'Z': 90,
    '11': 90,
    'Default': 0  // 默认角度
};

class Dumpling {
    constructor(bp) {
        this.bp = bp;
        this.resX=bp.resX;
        this.resY=bp.resY;
        this.isActive = false;
        this.buffer = new Uint16Array(this.resX * this.resY);
        this.renderTimer = null;
        this.onTouchEvent = null; 
    }

    _createProgram(vs, fs) {
        const gl = this.gl;
        const loadShader = (type, source) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, source);
            gl.compileShader(s);
            return s;
        };
        const program = gl.createProgram();
        gl.attachShader(program, loadShader(gl.VERTEX_SHADER, vs));
        gl.attachShader(program, loadShader(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(program);
        return program;
    }

    _initBuffers() {
        const gl = this.gl;
        // 顶点位置
        const posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.locs.position);
        gl.vertexAttribPointer(this.locs.position, 2, gl.FLOAT, false, 0, 0);

        // 纹理 UV 坐标
        const texBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.locs.texCoord);
        gl.vertexAttribPointer(this.locs.texCoord, 2, gl.FLOAT, false, 0, 0);

        this.vbo = { posBuf, texBuf };
    }

initWebGL(gl, w, h) {
    this.gl = gl;

    const angle = this.currentRotation || 0;
    const isPortrait = (angle === 90 || angle === 270);
    this.outW = isPortrait ? h : w;
    this.outH = isPortrait ? w : h;

    const program = this._createProgram(VS_SOURCE, FS_SOURCE);
    this.program = program;
    gl.useProgram(program);

    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    this.locs = {
        position: gl.getAttribLocation(program, "a_position"),
        texCoord: gl.getAttribLocation(program, "a_texCoord"),

        uSampler: gl.getUniformLocation(program, "u_sampler")
    };

    this._initBuffers(); // 你的全屏 quad + UV

    // 源纹理：接收默认 framebuffer 的内容
    this.srcTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // 旋转 FBO：输出旋转后的图像
    this.rotFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rotFbo);

    this.rotTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.rotTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.outW, this.outH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rotTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);


    this.pixelBuffer = new Uint8Array(this.outW * this.outH * 4);
    this.buffer = new Uint16Array(this.outW * this.outH);

    this.locs.uAngle = gl.getUniformLocation(program, "u_angle");
    gl.uniform1i(this.locs.uAngle, this.currentRotation);

}

    async init(ontouch=null) {

        try {
            // 构造协议要求的 28 字节负载
            let buffer = new ArrayBuffer(28);
            let dataView1 = new Uint32Array(buffer, 20); 

            /**
             * 根据 Table 2-7 (Page 9):
             * Offset 0: Event Report Configuration Word (uint32)
             * Bit 0: Touch Event Enable (通常是 0x01)
             * Bit 1: Key Event Enable
             * ... 依此类推
             */
            dataView1[0] = 0x80001;
            dataView1[1] = 0x09;

            // 发送设置命令 (cmdType 18 = 0x12)
            await this.bp.sendSLHead({
                'cmdType': 18, 
                'cmdLength': 28, 
                'ab': buffer
            });

            this.canvas = new OffscreenCanvas(this.bp.resX, this.bp.resY);
            this.onTouchEvent = ontouch;
            this.currentRotation = SANTA_CLAUS[this.bp.model];

            if (this.currentRotation === 90 || this.currentRotation === 270) {
            this.resX = this.bp.resY;
            this.resY = this.bp.resX;
            }

            await this.bp.sendPLHead({
            cmdType: 5,
            fmtStr: `image/x-raw, format=BGR16, width=${this.resX}, height=${this.resY}, framerate=0/1`
            });

            this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
            this.initWebGL(this.gl, this.bp.resX, this.bp.resY);
            return this.canvas;
        } catch (e) {
            console.error("Dumpling: Hardware init failed:", e);
            return null;
        }
    }

    async start() {
        this.isActive = true;
        this.touchController = new AbortController();

        this._renderLoop();

        if ((this.bp.model === '5S' || this.bp.model === '8') && this.onTouchEvent)
            this._touchLoop(this.touchController.signal);
    }


 _renderLoop() {
    if (!this.isActive) return;

    const gl = this.gl;

    // 0°：保持现在的稳定路径
    if (this.currentRotation === 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, this.resX, this.resY, gl.RGBA, gl.UNSIGNED_BYTE, this.pixelBuffer);

        this._convertTo565Flip(this.pixelBuffer, this.resX, this.resY);
        this.bp.sendMediaData(this.buffer.buffer, this.resX, this.resY);

        this.renderTimer = setTimeout(() => this._renderLoop(), 30);
        return;
    }

    // 非 0°：走 GPU 旋转路径
    const srcW = this.bp.resX;
    const srcH = this.bp.resY;
    const outW = this.outW;
    const outH = this.outH;

    // 1. 从默认 framebuffer 拷贝到 srcTexture（fluid.js 画在这里）
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTexture);
    gl.copyTexSubImage2D(
        gl.TEXTURE_2D,
        0,
        0, 0,      // 纹理内偏移
        0, 0,      // framebuffer 起点
    this.bp.resX, this.bp.resY   // 1280×480
    );

    // 2. 在 rotFbo 里按 currentRotation 画一遍
    gl.useProgram(this.program);
    gl.uniform1i(this.locs.uAngle, this.currentRotation);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo.posBuf);
    gl.vertexAttribPointer(this.locs.position, 2, gl.FLOAT, false, 0, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rotFbo);
    gl.viewport(0, 0, outW, outH);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTexture);
    gl.uniform1i(this.locs.uSampler, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 3. 从 rotFbo 读回旋转后的像素
    gl.readPixels(0, 0, outW, outH, gl.RGBA, gl.UNSIGNED_BYTE, this.pixelBuffer);

    // 4. CPU 转 RGB565 + 发送（注意：用 outW/outH）
    this._convertTo565Flip(this.pixelBuffer, outW, outH);
    this.bp.sendMediaData(this.buffer.buffer, outW, outH);

    this.renderTimer = setTimeout(() => this._renderLoop(), 30);
}


async _touchLoop(signal) {
    while (this.isActive) {
        try {
            // 1. 物理阻塞：传入底层 receiveER 所需的 signal
            // 当 stop() 触发 abort() 时，这里会立即抛出 AbortError 并跳入 catch
            const result = await this.bp.receiveER(512, signal);

            // 2. 逻辑双保：异步唤醒后第一时间检查开关
            if (!this.isActive) break;

            if (!result || result.status !== 'ok' || !result.data) continue;

            const view = result.data;
            if (view.byteLength < 28) continue;

            const type  = view.getUint16(0, true); 
            const state = view.getInt32(4, true); 

            if (type !== 2 && type !== 5) continue;

            // 只有 IN_PROGRESS(2) 或 START(1) 状态认为有效
            const isValid = (state === 1 || state === 2);
            const rawX = view.getFloat32(20, true);
            const rawY = view.getFloat32(24, true);

            if (isValid) {
                // 按下 / 移动
                this.onTouchEvent(rawX, rawY, true);
            } else {
                // 抬起（如状态 4 COMPLETED）
                this.onTouchEvent(rawX, rawY, false);
                continue;
            }

        } catch (e) {
            // 3. 核心修改：如果是主动停止（AbortError）或 isActive 已关，优雅自杀
            // 这样控制台不会刷红字，且闭包引用的内存会被立刻回收
            if (e.name === 'AbortError' || !this.isActive) {
                console.log('Dumpling: Touch loop halted by abort signal.');
                break; 
            }

            console.error('Dumpling Touch Loop Error:', e);
            // 发生硬件级错误时稍微等待，防止死循环导致浏览器卡死
            await new Promise(r => setTimeout(r, 100));
        }
    }
}

    _convertTo565Flip(rgba, w, h) {
        const u32 = new Uint32Array(rgba.buffer);
        for (let y = 0; y < h; y++) {
            const srcY = h - 1 - y;
            for (let x = 0; x < w; x++) {
                const p = u32[srcY * w + x];
                const r = (p & 0xFF) >> 3;
                const g = (p >> 8 & 0xFF) >> 2;
                const b = (p >> 16 & 0xFF) >> 3;
                this.buffer[y * w + x] = (r << 11) | (g << 5) | b;
            }
        }
    }

    _fastConvertTo565(rgba, totalW, totalH) {
        const u32 = new Uint32Array(rgba.buffer);
        const len = totalW * totalH;
    
        // 无论角度是多少，这里永远是顺序遍历，缓存命中率 100%
        for (let i = 0; i < len; i++) {
            const p = u32[i];
            const r = (p & 0xFF) >> 3;
            const g = (p >> 8 & 0xFF) >> 2;
            const b = (p >> 16 & 0xFF) >> 3;
            this.buffer[i] = (r << 11) | (g << 5) | b;
        }
    }

    stop() {
        // 1. 逻辑关停：阻止下一次循环开始
        this.isActive = false;

        // 2. 物理关停：强行掐断正在阻塞的 receiveER
        if (this.touchController) {
            this.touchController.abort();
            this.touchController = null;
        }

        this.gl.deleteBuffer(this.vbo.posBuf)
    }

    async destroy() {
          await this.bp.sendSLHead({'cmdType': 2});
    }
}
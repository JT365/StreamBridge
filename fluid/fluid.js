(function() {
  fluidArray = [];   

  const fluidApp = async function(bp) {
        let tabIndex = addTab("Model " + bp.model + " Fluid");  	
        let workshop = ".tab-content #tab" + tabIndex;

        const html = await $.get("fluid/fluid.html");
        $(workshop).html(html);

        const $preview = $("<canvas>").css({"width":"100%","height":"auto"});
        $preview.attr({width: bp.resX, height: bp.resY});
        $(workshop + " #canvas-wrapper").prepend($preview);
        const pCtx = $preview[0].getContext('2d');

        const dmp = new Dumpling(bp);
        const onTouch = (x, y, isDown) => {
            const p = window.pointers[0];
            if (!p) return;

            // 1. 坐标处理：翻转 Y 轴 (Top-0 变 Bottom-0)
            const pixelX = x;
            const pixelY = y; 

            // 2. 状态逻辑：Down -> Move -> Up
            if (isDown) {
                if (!p.down) {
                    p.down = true;
                    if (typeof window.updatePointerDownData === "function") {
                        // 此时传入的是 120.5 这种精确像素坐标

                        window.updatePointerDownData(p, -1, pixelX, pixelY);
                    }
                } else {
                    // 只有显式调用 MoveData，流体才会有“被拨动”的速度感
                    if (typeof window.updatePointerMoveData === "function") {

                    window.updatePointerMoveData(p, pixelX, pixelY);
                    }
                }
            } else {
                if (p.down) {
                    p.down = false;
                    if (typeof window.updatePointerUpData === "function") {

                        window.updatePointerUpData(p);
                    }
                }
            }

        };

        const offscreen = await dmp.init(onTouch);
        if (!offscreen) {
            console.warn("Dumpling init failed, check USB connection.");
        }

        window.canvas = offscreen; // 注入引擎所需的全局变量

        // 预览同步逻辑 (rAF 驱动，仅供网页看)
        const syncPreview = () => {
            if (dmp && dmp.isActive) {
                pCtx.drawImage(offscreen, 0, 0);
                requestAnimationFrame(syncPreview);
            }
        };

        // 启停调度
        const stopProcess = async () => {
            window.stopFluidEngine(); // 引擎停
            await dmp.stop(); // 搬运工停

            $(workshop + " #Start").removeClass("disabled");
            $(workshop + " #Stop").addClass("disabled");
        };

        $(workshop + " #Start").click(async function() {
            $(this).addClass("disabled");
            $(workshop + " #Stop").removeClass("disabled");
            
            window.startFluidEngine(); // 启动引擎

            await dmp.start(); // 启动传输

            syncPreview(); // 启动预览
        });

        $(workshop + " #Stop").click(stopProcess);
        $(workshop + " #Close").click(async () => {
            await stopProcess();

          fluidArray = fluidArray.filter(item => item.tabIndex != tabIndex); 
          closeTab(tabIndex);

        });
    };

/**
   * Register the application button in the UI
   */
  const fluidReg = (bp) => {
    const btnHtml = `
      <button id="Fluid" type="button" class="btn btn-primary btn-app" 
            data-bs-toggle="tooltip" title="WebGL Fluid Simulation">
        <i class="bi-1-circle"></i>
      </button>`;

    $(btnHtml)
      .appendTo(".banner .crumbs")
      .on('click', async function() {
        $(this).tooltip('hide');

        // --- KEY CHANGE: Load JS only ONCE here ---
        const instance = await fluidApp(bp); 
        if (instance) fluidArray.push(instance);
      });
  };

  if (window.apps) apps.push(fluidReg);
})();
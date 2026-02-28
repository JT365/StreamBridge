(function() {
  // Global array to track active clock wall instances
  clockArray = [];   

  function encodeRGB565(rgbaData, rgb565Buffer) {
    const data32 = new Uint32Array(rgbaData.buffer);
    for (let i = 0; i < data32.length; i++) {
      const pixel = data32[i];
      const r = (pixel & 0xFF) >> 3;
      const g = (pixel >> 8 & 0xFF) >> 2;
      const b = (pixel >> 16 & 0xFF) >> 3;
      rgb565Buffer[i] = (r << 11) | (g << 5) | b;
    }
  }

  /**
   * Main Logic to initialize a Clock Wall Tab
   * @param {Object} bp - Blueprint containing resX, resY, and model info
   */
  let clockClass = async function(bp) {      	
 
    let tabIndex = addTab("Model " + bp.model + " Clock Wall");  	
    let workshop = ".tab-content #tab" + tabIndex;
    let abort = false; // Local scoped abort flag for this specific tab
    let timerId = null; // 必须在这里声明，以便 Stop 能够访问
    let clockInstances = null; // 1. HOIST DECLARATION HERE for shared access

    try {
        // 1. Load HTML Template
        const html = await $.get("clockwall.html");
        $(workshop).html(html);
        console.log("HTML Template Loaded");

        // 2. UI Initialization
        $(workshop + " #Start").tooltip({ trigger: 'hover' });
        $(workshop + " #Stop").tooltip({ trigger: 'hover' });
        $(workshop + " #Close").tooltip({ trigger: 'hover' });

        const scale = 2; // High-DPI Resolution
        const $canvas = $("<canvas>", { id: "myCanvas" });

        // Set INTERNAL resolution (2x) and CSS display size (1x)
        $canvas.attr({
          width: bp.resX * scale,
          height: bp.resY * scale
        });

        $canvas.css({
          "width": `${bp.resX/2}px`,
          "height": `${bp.resY/2}px`
        });

        $(workshop + " .form-fw .form-fw:first").empty().append($canvas);

        // Helper to populate select dropdowns
        function AppendOptions(selector, dataList) {
          let optionsHtml = "";
          $.each(dataList, function(index, ele) {
            optionsHtml += `<option value="${ele}">${ele}</option>`;
          });
          $(workshop + " " + selector).append(optionsHtml);
        }

        AppendOptions("#input-pointer", ["rounded", "pointer", "rect"]);
        AppendOptions("#input-number", ["ALB", "LM"]);
        AppendOptions("#input-preset", ["0", "1"]);
        AppendOptions("#input-theme", ["white", "black"]);
        AppendOptions("#input-timezone", ["Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore", "Asia/Dubai", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin", "Australia/Sydney"]);
        AppendOptions("#input-rotation", ["none", "countclockwise", "clockwise", "rotate-180"]);

        const usbBufferCanvas = new OffscreenCanvas(bp.resX, bp.resY);
        const usbBufferCtx = usbBufferCanvas.getContext("2d", { willReadFrequently: true });

        // --- 3. Animation & Compositor Logic ---
        $(workshop + " #Start").click(async function() {
          if ($(this).hasClass("disabled")) return;

          $(this).tooltip('hide');
          $(workshop + " #Start").addClass("disabled");
          $(workshop + " #Stop").removeClass("disabled");

          abort = false;
          const targetCanvas = $canvas[0]; 
          const targetCtx = targetCanvas.getContext("2d");
          
          const selectedTZs = $(workshop + " #input-timezone").val() || [];
          if (selectedTZs.length === 0) {
            alert("Please select at least one timezone!");
            return;
          }

          const rotation = $(workshop + " #input-rotation").val(); 
          const count = selectedTZs.length || 1;

          // Calculate dimensions for the individual clock buffers
          const isRotated = (rotation === "clockwise" || rotation === "countclockwise");
          const subW = isRotated ? bp.resY * scale : (bp.resX / count) * scale;
          const subH = isRotated ? (bp.resX / count) * scale : bp.resY * scale;

          // Initialize Independent Clock Instances
          clockInstances = selectedTZs.map((tz) => {
            const buffer = new OffscreenCanvas(subW, subH);
            const instance = new AnimateClockCanvas(
              buffer,
              $(workshop + " #input-theme").val(),
              $(workshop + " #input-pointer").val(),
              $(workshop + " #input-number").val(),
              $(workshop + " #SkipHourLabel").prop("checked"),
              $(workshop + " #ZoomSecond").prop("checked"),
              $(workshop + " #ShowDetailInfo").prop("checked"),
              $(workshop + " #ShowWeekDate").prop("checked"),
              $(workshop + " #ShowShadow").prop("checked"),
              $(workshop + " #input-preset").val(),
              tz
            );

            return { buffer, instance };
          });

          // --- Inside clockClass after canvas initialization ---
          const pixelCount = bp.resX * bp.resY;

          // Pre-allocate the 16-bit buffer (2 bytes per pixel)
          const rgb565Buffer = new Uint16Array(pixelCount);

          let frameCount = 0;
          let lastFpsUpdateTime = performance.now();

          async function updateCanvas() {
            if (abort) return;

            const startTime = performance.now();

            // 1. FPS Calculation (Update every 1 second)
            frameCount++;
            const now = performance.now();
            const elapsedSinceUpdate = now - lastFpsUpdateTime;

            if (elapsedSinceUpdate >= 1000) {
              const fps = Math.round((frameCount * 1000) / elapsedSinceUpdate);
              console.log(`%c [USB Stream] FPS: ${fps} | Interval: ${Math.round(1000/fps)}ms`, "color: #00ff00; font-weight: bold;");
              frameCount = 0;
              lastFpsUpdateTime = now;
            }

            // 2. Existing Drawing Logic (No changes needed)
            targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
            const slotWidth = (bp.resX * scale) / count;
            const slotHeight = bp.resY * scale;

            clockInstances.forEach((item, index) => {
 
              targetCtx.save();
              const centerX = (index * slotWidth) + (slotWidth / 2);
              const centerY = slotHeight / 2;
              targetCtx.translate(centerX, centerY);
              if (rotation === "clockwise")      targetCtx.rotate(Math.PI / 2);
              if (rotation === "countclockwise") targetCtx.rotate(-Math.PI / 2);
              if (rotation === "rotate-180")     targetCtx.rotate(Math.PI);
              targetCtx.drawImage(item.buffer, -subW / 2, -subH / 2);
              targetCtx.restore();
            });

            // 3. Downsample & Sync Transfer
            usbBufferCtx.drawImage(targetCanvas, 0, 0, targetCanvas.width, targetCanvas.height, 0, 0, bp.resX, bp.resY);

            // --- Inside the updateCanvas function ---
            try {
              const imgData = usbBufferCtx.getImageData(0, 0, bp.resX, bp.resY);
    
              // 1. Perform High-Speed Bitwise Conversion
              encodeRGB565(imgData.data, rgb565Buffer);
    
              // 2. Send the underlying ArrayBuffer
              // Use Transferable Objects if bp.sendMediaData supports it to avoid copying
              await bp.sendMediaData(rgb565Buffer.buffer); 
    
             } catch (err) {
               console.error("USB Transfer Error:", err);
             }

            // 4. Framerate Control (Targeting 30 FPS / 33ms)
            const loopDuration = performance.now() - startTime; 
            timerId = setTimeout(updateCanvas, Math.max(0, 33 - loopDuration));

          }

          await bp.sendPLHead({
            'cmdType': 5, 
            'fmtStr': `video/x-raw, format=RGB16, width=${bp.resX}, height=${bp.resY}, framerate=0/1`
          });

          updateCanvas();
        });   	        

                // 抽取清理函数以复用
        const cleanup = async () => {
          abort = true;

          if (timerId) {
            clearTimeout(timerId);
            timerId = null;
          }
          // 显式释放时钟实例占用的 Canvas 资源
          if (clockInstances) {
            clockInstances.forEach(item => {
              if (item.instance.stop) item.instance.stop();

              // 如果 AnimateClockCanvas 有销毁方法则调用
              if (item.instance.destroy) item.instance.destroy();
              item.buffer = null;
              item.instance = null;
            });
            clockInstances = null;
          }
        };

        $(workshop + " #Stop").click(async function() {
          $(this).tooltip('hide');

          await cleanup();
          await bp.sendSLHead({'cmdType': 2});

          $(workshop + " #Start").removeClass("disabled");
          $(workshop + " #Stop").addClass("disabled");
        });   	    

        $(workshop + " #Close").click(async function() {
          $(this).tooltip('hide');

          await cleanup();
          await bp.sendSLHead({'cmdType': 2});

          // Filter out this specific instance from the global array
          clockArray = clockArray.filter(item => item.tabIndex != tabIndex); 
          closeTab(tabIndex);
        });

        // Return the control object for the global array
        return {
            tabIndex: tabIndex,
            stop: () => { abort = true; },
            workshop: workshop
        };

    } catch (err) {
        console.error("Critical Load Error:", err);
        alert("Load clock wall form failed. Check console for details.");
        return null;
    }
  };
  
  /**
   * Register the application button in the UI
   */
  const clockReg = (bp) => {
    const btnHtml = `
      <button id="Play" type="button" class="btn btn-primary btn-app" 
            data-bs-toggle="tooltip" title="Lobby clock wall utility">
        <i class="bi-globe"></i>
      </button>`;

    $(btnHtml)
      .appendTo(".banner .crumbs")
      .on('click', async function() {
        $(this).tooltip('hide');

        // --- KEY CHANGE: Load JS only ONCE here ---
        const instance = await clockClass(bp); 
        if (instance) clockArray.push(instance);
      });
  };

    
  // Push the registration function to the app loader
  apps.push(clockReg);

})();

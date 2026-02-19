(function() {
  playArray = [];   

  let playClass = function(bp) {      	
    let inputIndex;
    let inputArray;   
    let tabIndex = addTab("Model "+bp.model+" Play Media");  	
    let workshop = ".tab-content #tab" + tabIndex;
 
    function addNew(tabIndex) {
      const hasEmptyInput = inputArray.some(el => el.files.length === 0);
      if (inputArray.length > 0 && hasEmptyInput) return;

      const $container = $('<div class="input-gap"></div>');
      const $input = $(`<input id="input_b6a_${inputIndex}" name="input-b6a[]" type="file" class="input-item" multiple>`);
    
      $container.append($input);
      $(`${workshop} .input-area`).append($container);

      $input.fileinput({
        showUpload: false,
        dropZoneEnabled: false,
        inputGroupClass: "input-group-sm",
      });

      $input.on('filecleared', function() {
        // 
        // 
        if (inputArray.length > 1) {
            inputArray = inputArray.filter(el => el !== this);
            $(this).fileinput('destroy');
            $container.remove(); // 
        }
      });

      $input.on('change', function() {
        if (this.files.length > 0) {
            addNew(tabIndex);
        }
      });

      inputArray.push($input[0]);
      inputIndex++;
    };

  	$(workshop).load("play.html", (response, status, xhr) => {
      if (status == "success") {  
        inputIndex = 0;
        inputArray = [];

        addNew(tabIndex);

        $(workshop+" input[type='number']").inputSpinner();
        $(workshop+" .bi-arrow-repeat").tooltip({trigger : 'hover'});
        $(workshop+" #Start").tooltip({trigger : 'hover'});
        $(workshop+" #Pause").tooltip({trigger : 'hover'});
        $(workshop+" #Stop").tooltip({trigger : 'hover'});
        $(workshop+" #Close").tooltip({trigger : 'hover'});

        let cc = $(workshop+" #interval_id");
        let dd = $(workshop+" #flexCheckChecked");

        let interrupt = {abort:false, pause:false};
        let GlobalProxy;

        const MDAT_ATOM = 0x6d646174;
        const MOOV_ATOM = 0x6d6f6f76;
        const FTYP_ATOM = 0x66747970;
        const STCO_ATOM = 0x7374636f;
        const CO64_ATOM = 0x636f3634;

        const sliceFile = (file, chunkSize = 256 * 1024) => {
          const count = Math.ceil(file.size / chunkSize);
          return Array.from({ length: count }, (_, i) => 
            file.slice(i * chunkSize, (i + 1) * chunkSize)
            );
        };

        let readSlice = (file) => {
          return new Promise((resolve, reject) => {
            var fr = new FileReader();  
            fr.onload = () => {
              resolve(fr.result);
            };
            fr.onerror = reject;
            fr.readAsArrayBuffer(file);
          });
        }

        // recusive searching in current file slice for specific atom box
        async function findAtomBox(file, tok) {
          let pos = 0;
          while ((pos+16) < file.size) {
            let xx = await readSlice(file.slice(pos, pos+16));
            let yy = new DataView(xx, 0, 16);

            // check if large size box
            const atom_size = (yy.getUint32(0) === 1) ? yy.getUint64(8) : yy.getUint32(0);

            // check if token match
            if (yy.getUint32(4) === tok) {
              return {pos, atom_size};
            }

            pos += atom_size;
          }

          return null;
        }

        // recusive searching in moov box for stco or co64 box
        async function patchMoovBox(obj) {
          const view = new DataView(obj.data);
          const delta = BigInt(obj.atom_size);
          let pos = 8;

          while (pos < obj.atom_size - 16) {
            const size = view.getUint32(pos);
            const type = view.getUint32(pos + 4);

            // Map box types to their specific data handling rules
            const config = {
              [STCO_ATOM]: { step: 4, get: 'getUint32', set: 'setUint32' },
              [CO64_ATOM]: { step: 8, get: 'getBigUint64', set: 'setBigUint64' }
            }[type];

            if (config) {
              const count = view.getUint32(pos + 12);
              const dataStart = pos + 16;

              // Validation: ensures atom and table data fit within the buffer
              if (pos + size > obj.atom_size || dataStart + count * config.step > obj.atom_size) {
                return null; 
              }

              for (let j = 0; j < count; j++) {
                const offsetPos = dataStart + (j * config.step);
                const current = BigInt(view[config.get](offsetPos));
        
                // Calculate new offset and cast back to Number only if 32-bit (stco)
                const updated = current + delta;
                view[config.set](offsetPos, config.step === 4 ? Number(updated) : updated);
              }
              pos += size;
            } else {
              pos++;
            }
          }
          return true;
        }

        function waitForResume(obj) {
          let resolve;
          const promise = new Promise((res) => { resolve = res; });

          let proxy = new Proxy(obj, {
            set(target, key, value) {
              target[key] = value;

              // If the specific property reaches the target value, unlock the promise
              if (interrupt.abort === true || interrupt.pause === false) {
                 resolve(value);
              }

              return true;
            }
          });

          return { proxy, promise };
        }

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        async function fire(bp, interval = 0, loop = false) {
          interrupt.abort = false;
          interrupt.pause = false;

          const checkAbort = (interrupt) => {
            if (interrupt.abort) {
              const err = new Error('User abort!');
              err.name = 'AbortError'; // 
              throw err;
            }
          };

          const handlePause = async () => {
            if (interrupt.pause) {
              const { proxy, promise } = waitForResume(interrupt);
              GlobalProxy = proxy;
              await promise;
            }
            checkAbort(interrupt); // 
          };

          do {
            for (const v of inputArray) {
              for (const t of v.files) {
                checkAbort(interrupt);

                let rest = t;
                let headerData = []; //  (ftyp + moov)

                // --- 1. MP4 Header (Moov resort) ---
                const ftypBox = await findAtomBox(t, FTYP_ATOM);
                if (ftypBox?.pos === 0) {
                  const [moovBox, mdatBox] = await Promise.all([
                    findAtomBox(t, MOOV_ATOM),
                    findAtomBox(t, MDAT_ATOM)
                  ]);

                  if (moovBox && mdatBox && moovBox.pos > mdatBox.pos) {
                    // read Box 
                    const [fData, mData] = await Promise.all([
                    readSlice(t.slice(ftypBox.pos, ftypBox.pos + ftypBox.atom_size)),
                    readSlice(t.slice(moovBox.pos, moovBox.pos + moovBox.atom_size))
                    ]);
            
                    moovBox.data = mData;
                    if (patchMoovBox(moovBox)) {
                      headerData = [fData, moovBox.data];
                      rest = t.slice(ftypBox.atom_size, moovBox.pos);
                    }
                  }
                }

                // --- 2. Send start tag ---
                await bp.sendPLHead({ cmdType: 5 });

                // --- 3. Send media header  ---
                for (const data of headerData) {
                  await bp.sendMediaData(data);
                }

                // --- 4. Send media slices ---
                const slices = sliceFile(rest);
                for (const n of slices) {
                  await handlePause(); // 

                  const chunk = await readSlice(n);
                  await bp.sendMediaData(new Uint8Array(chunk));
                }

                // --- 5. Interval process ---
                if (interval > 0) await sleep(interval * 1000);
        
                // --- 6. Send end tag ---
                await bp.sendPLHead({ cmdType: 6 });
              }
            }

            // Check abort
            checkAbort(interrupt);
          } while (loop);
        }
              
        $(workshop+" #Start").click(function() {
          $(this).tooltip('hide');

          // disable all buttons in UI
          $(workshop+' input[type="file"]').fileinput('disable');
          dd.prop("disabled", true);
          cc.prop("disabled", true);

          $(workshop+" #Start").addClass("disabled");
          $(workshop+" #Pause").removeClass("disabled");
          $(workshop+" #Stop").removeClass("disabled");

          fire(bp, $(workshop+" #interval_id").val(), $(workshop+" #flexCheckChecked").is(":checked")).then(function(){

          }).catch(error => {
            if (err.name !== 'AbortError') {
              $('.connect-container #sstatus').text(error.message);
              $(".banner .crumbs").empty();
            }
            }).finally(function() {

            // re-enable all UI buttons here
             $(workshop+' input[type="file"]').fileinput('enable');
             dd.prop("disabled", false);
             cc.prop("disabled", false);
 
             $(workshop+" #Start").removeClass("disabled");
             $(workshop+" #Pause").addClass("disabled");     
             $(workshop+" #Stop").addClass("disabled");          

            });  

        });   	        

        $(workshop+" #Stop").click(function() {
          $(this).tooltip('hide');
          interrupt.abort = true;
          GlobalProxy.abort = true;
 
        });   	    

        $(workshop+" #Pause").click(function() {
          if (interrupt.pause===false) {
            $(this).tooltip('hide');
            interrupt.pause=true;
          }
          else {
            GlobalProxy.pause=false;           
          }
 
        });   

        $(workshop+" #Close").click(function() {
          $(this).tooltip('hide');
          interrupt.abort=true;
          playArray = playArray.filter(item => item.tabIndex != tabIndex); 
          closeTab(tabIndex);
        });

      }
      else {
      	alert("Load play form failed");
      }
    });
  };
  
  const playReg = (bp) => {
    const btnHtml = `
      <button id="Play" type="button" class="btn btn-primary btn-app" 
            data-bs-toggle="tooltip" title="Play media file">
        <i class="bi-images"></i>
      </button>`;

    // Create, append, and handle in one fluent chain
    $(btnHtml)
      .appendTo(".banner .crumbs")
      .tooltip({ trigger: 'hover' })
      .on('click', function() {
        $(this).tooltip('hide');
        playArray.push(new playClass(bp));
      });
  };
    
  apps.push(playReg);

})();


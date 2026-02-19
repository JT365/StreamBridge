	var tabID = 0;

  function addTab(model) {
    let tempid = "tab"+tabID;
   
    $('.tab-content').append($('<div class="tab-pane active" id='+ tempid + '></div>'));
    $('.tab-list').append($('<li class="nav-item"><a href="#' + tempid + '" class="nav-link active" role="tab" data-bs-toggle="tab"><span>' + model +'</span></a></li>'));

    let tempobj=$('.tab-list a[href="#'+tempid+'"]');
    tempobj.click(clickHandler);

    showTab(tempobj[0]);    
    return tabID++;
  };
    
  function closeTab(tabID) {
    let tempid = "tab"+tabID;
    	
	  $('.tab-list a[href="#'+tempid+'"]').parent().remove();	
	  $('.tab-content #'+tempid).remove();

    let aa = $('.tab-list a:first');
    if (aa.length>0)
      showTab(aa[0]);
  };

  function showTab(item) {
    $('.tab-list a.active').removeClass("active");    
    $('.tab-content div.tab-pane.active').removeClass("active"); 
    $(item).addClass("active");

    let a = item.getAttribute('href');
    $('.tab-content '+a).addClass("active");  	
  }
  
  function clickHandler(e) {
    e.preventDefault();
    showTab(this);    
    }
  

var apps = [];   
(function() {

  $(document).ready(event => {
    let panel;

    $(".connect-container #connect").tooltip({trigger : 'hover'});
    // cache DOM 
    const $connectBtn = $(".connect-container #connect");
    const $status = $(".connect-container #sstatus");
    const $crumbs = $(".banner .crumbs");

    $connectBtn.click(async function() {
      // 1. check Web Serial
      if (!('serial' in navigator)) {
        alert("Your browser does not support Web Serial API. Please use Chrome, Edge, or Opera (version 89+).");
        return;
      }

      try {
        // 2. port request
        const selectedPort = await serial.requestPort();
        panel = selectedPort; // 
    
        // 3. connect
        await panel.connect();

        // 4. update model info
        const { name, model, fmver } = panel;
        $status.text(`Name: ${name} Model: ${model} Rev: ${fmver}`);
    
        $crumbs.empty();
    
        // 5. start apps
        apps.forEach(reg => reg(panel));

      } catch (error) {
        // 6. error process
        if (error.name === 'NotFoundError' || error.message.includes("No device selected")) {
          return; 
        }
    
        console.error("Serial connection failed:", error);
        $status.text(`Error: ${error.message}`);
      }
    });
  });

})();
  

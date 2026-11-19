(function(){
  if(window.__eliteNativeReady)return;window.__eliteNativeReady=true;
  function install(win){
    try{
      if(win.location.origin!=='https://diary.elitescholars.edu.pk'||win.__eliteBridgeInstalled)return;
      win.__eliteBridgeInstalled=true;
      win.print=function(){EliteNative.printDocument(win.document.documentElement.outerHTML);};
      // Keep each Blob at creation time: WebView/CSP may reject fetch(blob:...).
      var blobs=new Map(),create=win.URL.createObjectURL.bind(win.URL),revoke=win.URL.revokeObjectURL.bind(win.URL);
      win.URL.createObjectURL=function(blob){var url=create(blob);if(blobs.size>=32)blobs.delete(blobs.keys().next().value);blobs.set(url,blob);return url;};
      win.URL.revokeObjectURL=function(url){blobs.delete(url);return revoke(url);};
      function save(blob,filename){
        if(blob.size>20*1024*1024)throw Error('Export exceeds the 20 MB app download limit.');
        if(!/^(application\/pdf|application\/zip|image\/png|image\/jpeg)$/.test(blob.type))throw Error('Unsupported export file.');
        var reader=new win.FileReader();reader.onload=function(){try{EliteNative.saveFile(filename,blob.type,String(reader.result).split(',')[1]);}catch(error){win.alert('Unable to save this export. Please try again.');}};reader.onerror=function(){win.alert('Unable to read the export. Please try again.');};reader.readAsDataURL(blob);
      }
      win.document.addEventListener('click',function(event){
        var link=event.target.closest&&event.target.closest('a');
        if(!link||!link.download||!(/^(blob:|data:)/).test(link.href))return;
        event.preventDefault();event.stopImmediatePropagation();
        try{
          if(link.href.indexOf('blob:')===0){var blob=blobs.get(link.href);if(!blob)throw Error('The export is no longer available. Reopen the diary and try again.');save(blob,link.download);}
          else{var match=/^data:(application\/pdf|application\/zip|image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(link.href);if(!match)throw Error('Unsupported export file.');if(match[2].length>28*1024*1024)throw Error('Export exceeds the app download limit.');EliteNative.saveFile(link.download,match[1],match[2]);}
        }catch(error){win.alert(error.message||'Download failed. Please try again.');}
      },true);
      function frame(frame){frame.addEventListener('load',function(){install(frame.contentWindow);});try{install(frame.contentWindow);}catch(e){}}
      win.document.querySelectorAll('iframe').forEach(frame);
      new win.MutationObserver(function(records){records.forEach(function(record){record.addedNodes.forEach(function(node){if(node.nodeType!==1)return;if(node.tagName==='IFRAME')frame(node);node.querySelectorAll&&node.querySelectorAll('iframe').forEach(frame);});});}).observe(win.document.documentElement,{childList:true,subtree:true});
    }catch(error){}
  }
  install(window);
})();

define(function(require) {
  var $ = require("jquery");
  var Project = require("project");
  var SyncManager = require("../../project/sync-manager");

  var sync;
  var bramble;

  function saveAndSyncAll(callback) {
    if(!(bramble && sync)) {
      callback(new Error("[Thimble Error] saveAndSyncAll() called before init()"));
      return;
    }

    bramble.saveAll(function() {
      if(sync.getPendingCount() === 0) {
        callback(null);
      } else {
        sync.once("complete", callback);
      }
    });
  };

  function init(csrfToken) {
    // If an anonymous user is using thimble, they
    // will not have any persistence of files
    if(!Project.getUser()) {
      return null;
    }

    sync = SyncManager.init(csrfToken);

    sync.on("file-sync-start", function() {
      $("#navbar-save-indicator").removeClass("hide");
    });
    sync.on("file-sync-stop", function() {
      $("#navbar-save-indicator").addClass("hide");
    });

    Bramble.once("ready", function(bramble) {
      function handleFileChange(path) {
        sync.addFileUpdate(path);
      }

      function handleFileDelete(path) {
        sync.addFileDelete(path);
      }

      function handleFileRename(oldFilename, newFilename) {
        // Step 1: Create the new file
        sync.addFileUpdate(newFilename);
        // Step 2: Delete the old file    
        sync.addFileDelete(oldFilename);
      }

      bramble.on("fileChange", handleFileChange);
      bramble.on("fileDelete", handleFileDelete);
      bramble.on("fileRename", handleFileRename);
    });
  };

  return {
    init: init,
    saveAndSyncAll: saveAndSyncAll
  };
});

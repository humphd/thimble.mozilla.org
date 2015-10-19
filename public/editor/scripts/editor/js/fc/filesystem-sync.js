define(function(require) {
  var $ = require("jquery");
  var Project = require("project");
  var SyncManager = require("sync-manager");
  var SyncState = require("fc/sync-state");

  var sync;
  var brambleInstance;

  function saveAndSyncAll(callback) {
    if(!(brambleInstance && sync)) {
      callback(new Error("[Thimble Error] saveAndSyncAll() called before init()"));
      return;
    }

    brambleInstance.saveAll(function() {
      if(sync.getPendingCount() === 0) {
        callback(null);
      } else {
        sync.once("complete", callback);
      }
    });
  }

  function init(csrfToken) {
    // If an anonymous user is using thimble, they
    // will not have any persistence of files
    if(!Project.getUser()) {
      return null;
    }

    sync = SyncManager.init(csrfToken);

    // Update the UI with a "Saving..." indicator whenever we sync a file
    sync.on("file-sync-start", function() {
      $("#navbar-save-indicator").removeClass("hide");
    });
    sync.on("file-sync-stop", function() {
      $("#navbar-save-indicator").addClass("hide");
    });

    // Warn the user when we're syncing so they don't close the window by accident
    sync.on("sync-start", function() {
      SyncState.syncing();
    });
    sync.on("complete", function() {
      SyncState.completed();
    });

    Bramble.once("ready", function(bramble) {
      function handleFileChange(path) {
        Project.queueFileUpdate(path);
      }

      function handleFileDelete(path) {
        Project.queueFileDelete(path);
      }

      function handleFileRename(oldFilename, newFilename) {
        // Step 1: Create the new file
        Project.queueFileUpdate(newFilename);
        // Step 2: Delete the old file    
        Project.queueFileDelete(oldFilename);
      }

      bramble.on("fileChange", handleFileChange);
      bramble.on("fileDelete", handleFileDelete);
      bramble.on("fileRename", handleFileRename);

      brambleInstance = bramble;
    });
  }

  return {
    init: init,
    saveAndSyncAll: saveAndSyncAll
  };
});

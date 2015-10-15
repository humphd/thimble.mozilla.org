define(function(require) {
  var $ = require("jquery");
  var EventEmitter = require("EventEmitter");
  var SYNC_OPERATION_UPDATE = require("constants").SYNC_OPERATION_UPDATE;
  var SYNC_OPERATION_DELETE = require("constants").SYNC_OPERATION_DELETE;
  var Project = require("../../project/project");

  var _instance;

  function bufferToFormData(path, buffer, dateUpdated) {
    dateUpdated = dateUpdated || (new Date()).toISOString();

    var formData = new FormData();
    formData.append("dateUpdated", dateUpdated);
    formData.append("bramblePath", Project.stripRoot(path));
    // Don't worry about actual mime type, just treat as binary
    var blob = new Blob([buffer], {type: "application/octet-stream"});
    formData.append("brambleFile", blob);

    return formData;
  }

  /**
   * The SyncQueue keeps track of sync operations to be performed on paths.
   * This currently includes UPDATE and DELETE operations (create, update, delete
   * and rename are all done using these two). The data structure looks like this:
   * 
   * syncQueue = {
   *   current: {
   *     path: "/path/to/file/being/synced",
   *     operation: "update"
   *   },
   *   pending: {
   *     "/path/to/file/needing/sync": "update",
   *     "/path/to/another/file/needing/sync": "delete",
   *     ...
   *   }
   * }
   *
   * The `syncQueue.pending` object stores a backlog of paths and operations to be
   * synced. The `syncQueue.current` object is the file and operation currently being
   * done, or the one that was in process when the app was stopped/crashed/closed.
   *
   * The sync service picks a path at random from the `pending` list and moves it to 
   * `current`, before saving this sync state. Then it tries to do what is in `current`
   * and if it works, it clears `current` and repeats the process.  If it fails, the
   * path and operation in current are moved back to pending, and the process repeats.
   */

  function SyncManager(csrfToken) {
    this.csrfToken = csrfToken;
    this.fs = Bramble.getFileSystem();
    // Path of file currently being synced, if any
    this.pathBeingSynced = null;
    // The number of file paths yet to be synced
    this.pendingCount = 0;
    // Whether or not we are currently syncing
    this.syncing = false;
  }
  SyncManager.prototype = new EventEmitter();
  SyncManager.prototype.constructor = SyncManager;

  SyncManager.init = function(csrfToken) {
    _instance = new SyncManager(csrfToken);
    return _instance;
  };

  SyncManager.getInstance = function() {
    return _instance;
  };

  SyncManager.prototype.emitProgressEvent = function() {
    var self = this;
    var pendingCount = self.pendingCount;
    self.trigger("progress", [pendingCount]);      
 
     // Also emit a `complete` event if the pending count has gone to zero.
    if(pendingCount === 0) {
      self.trigger("complete");
    }
  };
  SyncManager.prototype.emitErrorEvent = function(err) {
    this.setSyncing(false);
    this.trigger("error", [err]);

    // Try again
    this.runNextOperation();
  };

  SyncManager.prototype.setPendingCount = function(syncQueue) {
    this.pendingCount = Object.keys(syncQueue.pending).length;    
  };
  SyncManager.prototype.getPendingCount = function() {
    return this.pendingCount;
  };

  SyncManager.prototype.requestInProgress = function() {
    return !!this.pathBeingSynced;
  };  
  SyncManager.prototype.requestStart = function(path) {
    this.pathBeingSynced = path;
  };
  SyncManager.prototype.requestStop = function() {
    this.pathBeingSynced = null;
  };

  SyncManager.prototype.updateOperation = function(path, callback) {
    var self = this;
    var csrfToken = self.csrfToken;
    var fs = self.fs;

    var options = {
      headers: {
        "X-Csrf-Token": csrfToken
      },
      type: "PUT",
      url: Project.getHost() + "/projects/" + Project.getID() + "/files",
      cache: false,
      contentType: false,
      processData: false
    };

    function send(id) {
      var request;

      if(id) {
        options.url = options.url + "/" + id;
      }

      self.requestStart(path);
      request = $.ajax(options);
      request.done(function() {
        self.requestStop();

        if(request.status !== 201 && request.status !== 200) {
          return callback(new Error("[Thimble] unable to persist `" + path + "`. Server responded with status " + request.status));
        }

        var data = request.responseJSON;
        Project.setFileID(path, data.id, callback);
      });
      request.fail(function(jqXHR, status, err) {
        self.requestStop();
        console.error("[Thimble] unable to persist the file to the server. Error was:", err);
        callback(err);
      });
    }

    fs.readFile(path, function(err, data) {
      if(err) {
        return callback(err);
      }

      options.data = bufferToFormData(path, data);
      Project.getFileID(path, function(err, id) {
        if(err) {
          return callback(err);
        }
        send(id);
      });
    });
  };
  SyncManager.prototype.deleteOperation = function(path, callback) {
    var self = this;
    var csrfToken = self.csrfToken;    

    function doDelete(id) {
      self.requestStart(path);
      var request = $.ajax({
        contentType: "application/json",
        headers: {
          "X-Csrf-Token": csrfToken
        },
        type: "DELETE",
        url: Project.getHost() + "/projects/" + Project.getID() + "/files/" + id + "?dateUpdated=" + (new Date()).toISOString(),
      });
      request.done(function() {
        self.requestStop();

        if(request.status !== 200) {
          return callback(new Error("[Thimble] unable to persist `" + path + "`. Server responded with status " + request.status));
        }

        Project.removeFile(path, callback);
      });
      request.fail(function(jqXHR, status, err) {
        self.requestStop();
        console.error("[Thimble] unable to persist the file to the server. Error was:", err);
        callback(err);
      });
    }

    Project.getFileID(path, function(err, id) {
      if(err) {
        return callback(err);
      }

      doDelete(id);
    });
  }
  // Run an operation in the queue, and return the number of pending operations after it
  // completes on the callback.
  SyncManager.prototype.runNextOperation = function() {
    var self = this;
    var currentPath;
    var currentOperation;

    self.setSyncing(true);

    function finalizeOperation(error) {
      Project.getSyncQueue(function(err, syncQueue) {
        if(err) {
          self.emitErrorEvent(err);
          return;
        }

        function finish() {
          delete syncQueue.current;

          Project.setSyncQueue(syncQueue, function(err) {
            if(err) {
              self.emitErrorEvent(err);
              return;
            }

            self.emitProgressEvent();

            // If there are more files to sync, run the next one
            if(self.getPendingCount() > 0) {
              self.runNextOperation();
            } else {
              self.setSyncing(false);
            }
          });
        }

        function queueOperation() {
          if(currentOperation === SYNC_OPERATION_UPDATE) {
            self.addFileUpdate(currentPath);
          } else {
            self.addFileDelete(currentPath);
          }      
        }

        // If the operation errored, put this file operation back in the pending list
        if(error) {
          queueOperation();
        }

        finish();
      });
    }

    function runCurrent() {
      if(currentOperation === SYNC_OPERATION_UPDATE) {
        self.updateOperation(csrfToken, currentPath, finalizeOperation);
      } else {
        self.deleteOperation(csrfToken, currentPath, finalizeOperation);
      }
    }

    function selectCurrent(syncQueue) {
      // If there are no pending paths to sync, we're done.
      if(self.pendingCount === 0) {
        self.setSyncing(false);
        return;
      }

      // Pick a random file operation from the pending list for the next one
      var randomIdx = Math.floor(Math.random() * (pathsCount + 1));
      var currentPath = paths[randomIdx];
      var currentOperation = syncQueue.pending[currentPath];

      // Update current to the new path/operation, and remove from pending
      syncQueue.current = {
        path: currentPath,
        operation: currentOperation
      };
      delete syncQueue.pending[currentPath];

      // Persist this sync info to disk before going further so we can recover
      // if there's a crash or other failure.
      Project.setSyncQueue(syncQueue, function(err) {
        if(err) {
          self.emitErrorEvent(err);
          return;
        }

        self.setPendingCount(syncQueue);
        runCurrent();
      });
    }

    function pickCurrentOperation(err, syncQueue) {
      if(err) {
        self.emitErrorEvent(err);
        return;
      }

      self.setPendingCount(syncQueue);

      // If there's already a current operation in the queue, restart it
      // since it probably means the browser shutdown before it could complete.
      // Otherwise, pick a random file/opeartion to run.
      if(syncQueue.current) {
        currentPath = syncQueue.current.path;
        currentOperation = syncQueue.current.operation;
        runCurrent();
      } else {
        selectCurrent(syncQueue);
      }
    }

    Project.getSyncQueue(pickCurrentOperation);
  };


  SyncManager.prototype.setSyncing = function(value) {
    this.syncing = value;

    if(value) {
      this.trigger("file-sync-start");
    } else {
      this.trigger("file-sync-stop");      
    }
  }
  SyncManager.prototype.isSyncing = function() {
    return !!this.syncing;
  }
  SyncManager.prototype.sync = function() {
    // If we're already in the process of syncing, bail
    if(this.syncing) {
      return;
    }
    this.runNextOperation();
  };

  function _mergeOperations(previous, requested) {
    // If there is no pending sync operation, or the new one is the same
    // (update followed by update), just return the new one.
    if(!previous || previous === requested) {
      return requested;
    }

    // A delete trumps a pending update (we can skip a pending update if we'll just delete later)
    if(previous === SYNC_OPERATION_UPDATE && requested === SYNC_OPERATION_DELETE) {
      return SYNC_OPERATION_DELETE;
    }

    // An update trumps a pending delete (we can just update the old contents with new)
    if(previous === SYNC_OPERATION_DELETE && requested === SYNC_OPERATION_UPDATE) {
      return SYNC_OPERATION_UPDATE;
    }

    // Should never hit this, but if we do, default to an update
    console.log("[Thimble Error] unexpected sync states, defaulting to update:" previous, requested);
    return SYNC_OPERATION_UPDATE;
  }

  function _queueOperationForPath(path, operation) {
    Project.getSyncQueue(function(err, syncQueue) {
      if(err) {
        console.error("[Thimble Error] unable to queue sync operation for path `" + path + "`", err);
        return;
      }

      var previous = syncQueue.pending[path] ? syncQueue.pending[path] : null;
      syncQueue.pending[path] = _mergeOperations(previous, operation);

      Project.setSyncQueue(syncQueue, function(err) {
        if(err) {
          console.error("[Thimble Error] unable to queue sync operation for path `" + path + "`", err);
        }
      });
    });
  }

  SyncManager.prototype.addFileUpdate = function(path) {
    _queueOperationForPath(path, SYNC_OPERATION_UPDATE);
  };

  SyncManager.prototype.addFileDelete = function(path) {
    _queueOperationForPath(path, SYNC_OPERATION_DELETE);
  }

  return SyncManager;
});

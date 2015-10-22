define(function(require) {
  var Constants = require("constants");
  var logger = require("logger");

  var SYNC_OPERATION_UPDATE = Constants.SYNC_OPERATION_UPDATE;
  var SYNC_OPERATION_DELETE = Constants.SYNC_OPERATION_DELETE;
  var items = [];

  // Decide between an update and delete operation, depending on previous operations.
  function mergeOperations(previous, requested) {
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
    console.log("[Thimble Error] unexpected sync states, defaulting to update:", previous, requested);
    return SYNC_OPERATION_UPDATE;
  }

  /**
   * The cache is an in-memory, localStorage-backed array of paths + operations to be
   * synced. It gets merged with the sync queue on a regular basis (i.e., written to
   * disk). We use it so that we don't have two separate writes to the sync queue.
   */
  function init(projectRoot) {
    var key = Constants.CACHE_KEY_PREFIX + projectRoot;

    if(!window.localStorage) {
      return;
    }

    // Register to save any in-memory cache operations before we close
    window.addEventListener("unload", function() {
      if(!items.length) {
        return;
      }

      localStorage.setItem(key, JSON.stringify(items));
    });

    var prev = localStorage.getItem(key);
    if(!prev) {
      return;
    }

    // Read any cached operations out of storage
    localStorage.removeItem(key);
    try {
      items = items.concat(JSON.parse(prev));
      logger("project", "initialized file operation cache from storage", items);
    } catch(e) {
      logger("project", "failed to initialize cached file operations from storage", prev);
      items = [];
    }
  }

  function getItems() {
    return items;
  }

  function transferToSyncQueue(syncQueue) {
    if(!items.length) {
      return syncQueue;
    }

    // Migrate cached items to sync queue
    items.forEach(function(item) {
      var path = item.path;
      var operation = item.operation;

      var previous = syncQueue.pending[path] || null;
      syncQueue.pending[path] = mergeOperations(previous, operation);
    });

    // Clear all cached items
    items.length = 0;

    return syncQueue;
  }

  return {
    init: init,
    getItems: getItems,
    transferToSyncQueue: transferToSyncQueue
  };
});

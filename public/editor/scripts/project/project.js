define(function(require) {
  var Constants = require("constants");
  var Remote = require("../../project/remote");
  var Metadata = require("../../project/metadata");
  var logger = require("logger");
  var Path = Bramble.Filer.Path;

  var _host;
  var _publishUrl;

  var _user;
  var _id;
  var _title;
  var _fs;
  var _anonymousId;
  var _remixId;
  var _description;

  var _cache;

  function getCache() {
    return _cache;
  }

  function getAnonymousId() {
    return _anonymousId;
  }

  function getDescription() {
    return _description;
  }

  function setDescription(newDescription) {
    _description = newDescription;
  }

  function getTitle() {
    return _title;
  }

  function setTitle(title, callback) {
    Metadata.setTitle(getRoot(), title, function(err) {
      if (err) {
        return callback(err);
      }

      _title = title;
      callback();
    });
  }

  function getUser() {
    return _user;
  }

  function getID() {
    return _id;
  }

  function getHost() {
    return _host;
  }

  function getPublishUrl() {
    return _publishUrl;
  }

  function getRoot() {
    if(!_user) {
      return Path.join(Constants.ANONYMOUS_USER_FOLDER, _anonymousId.toString());
    }

    return Path.join("/", _user.toString(), "projects", _id.toString());
  }

  // From /7/projects/5/index.html to /index.html
  function stripRoot(path) {
    return path.replace(getRoot(), "");
  }

  // From /index.html to /7/projects/5/index.html to
  function addRoot(path) {
    Path.join(getRoot(), path);
  }

  // Look up the publish.webmaker.org file id for this path
  function getFileID(path, callback) {
    Metadata.getFileID(getRoot(), stripRoot(path), callback);
  }

  // Update the files metadata for the project to use the given id for this path
  function setFileID(path, id, callback) {
    Metadata.setFileID(getRoot(), stripRoot(path), id, callback);
  }

  // Update the files metadata for the project to use the given id for this path
  function removeFile(path, callback) {
    Metadata.removeFile(getRoot(), stripRoot(path), callback);
  }

  // Sets a flag on the project root that indicates whether we need to update
  // the published version of this project or not
  function publishNeedsUpdate(value, callback) {
    Metadata.setPublishNeedsUpdate(getRoot(), value, callback);
  }

  // Gets the flag from the project root that indicates whether we need to
  // update the published version of this project or not
  function getPublishNeedsUpdate(callback) {
    Metadata.getPublishNeedsUpdate(getRoot(), callback);
  }

  // Gets the file sync operation queue on the project root, which has information
  // about all paths that need to be sync'ed with the server, and what needs to happen.
  function getSyncQueue(callback) {
    Metadata.getSyncQueue(getRoot(), callback);
  }

  // Sets the file sync operation queue on the project root
  function setSyncQueue(value, callback) {
    Metadata.setSyncQueue(getRoot(), value, callback);
  }

  /**
   * The cache is an in-memory, localStorage-backed array of paths + operations to be
   * synced. It gets merged with the sync queue on a regular basis (i.e., written to
   * disk). We use it so that we don't have two separate writes to the sync queue.
   */
  function Cache() {
    var items = [];

    this.getItems = function() {
      return items;
    };

    if(!window.localStorage) {
      return;
    }

    var key = Constants.CACHE_KEY_PREFIX + getRoot();

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

  function queueFileUpdate(path) {
    logger("project", "queueFileUpdate", path);

    _cache.getItems().push({
      path: path,
      operation: Constants.SYNC_OPERATION_UPDATE
    });
  }

  function queueFileDelete(path) {
    logger("project", "queueFileDelete", path);

    _cache.getItems().push({
      path: path,
      operation: Constants.SYNC_OPERATION_DELETE
    });
  }

  function init(projectDetails, host, callback) {
    _user = projectDetails.userID;
    _id = projectDetails.id;
    _anonymousId = projectDetails.anonymousId;
    _remixId = projectDetails.remixId;
    _host = host;
    _publishUrl = projectDetails.publishUrl;
    _fs = Bramble.getFileSystem();
    _description = projectDetails.description;
    _cache = new Cache();

    var metadataLocation = _user && _anonymousId ? Path.join(Constants.ANONYMOUS_USER_FOLDER, _anonymousId.toString()) : getRoot();

    // We have to check if we can access the 'title' stored
    // on an xattr first to know which value
    Metadata.getTitle(metadataLocation, function(err, title) {
      if (err) {
        if (err.code !== "ENOENT") {
          callback(err);
        } else {
          _title = projectDetails.title;
          callback();
        }
        return;
      }

      if (_user) {
        _title = title;
      } else if (title) {
        // Prefer the stored title in the anonymous case in case the
        // anonymous user changed it
        _title = title;
      } else {
        _title = projectDetails.title;
      }

      callback();
    });
  }

  // Set all necesary data for this project, based on makeDetails rendered into page.
  function load(csrfToken, callback) {
    // Step 1: download the project's contents (files + metadata) or upload an
    // anonymous project's content if this is an upgrade, and install into the root
    Remote.loadProject({
      root: getRoot(),
      host: _host,
      user: _user,
      id: _id,
      remixId: _remixId,
      anonymousId: _anonymousId
    }, function(err, pathUpdatesCache) {
      if(err) {
        return callback(err);
      }

      // If there are cached paths that need to be updated, queue those now
      if(pathUpdatesCache && pathUpdatesCache.length) {
        pathUpdatesCache.forEach(function(path) {
          queueFileUpdate(path);
        });
      }

      var now = (new Date()).toISOString();

      // Step 2: If this was a project upgrade (from anonymous to authenticated),
      // update the project metadata on the server
      Metadata.update({
        host: _host,
        update: !!_user && !!_anonymousId,
        id: _id,
        csrfToken: csrfToken,
        data: {
          title: _title,
          description: _description,
          dateCreated: now,
          dateUpdated: now
        }
      }, function(err) {
        if(err) {
          return callback(err);
        }

        // Step 3: download the project's metadata (project + file IDs on publish) and
        // install into an xattrib on the project root.
        Metadata.load({
          root: getRoot(),
          host: _host,
          user: _user,
          remixId: _remixId,
          id: _id,
          title: _title
        }, function(err) {
          if(err) {
            return callback(err);
          }

          // Find an HTML file to open in the project, hopefully /index.html
          var sh = new _fs.Shell();
          sh.find(getRoot(), {name: "*.html"}, function(err, found) {
            if(err) {
              return callback(err);
            }

            // Look for an HTML file to open, ideally index.html
            var indexPos = 0;
            found.forEach(function(path, idx) {
              if(Path.basename(path) === "index.html") {
                indexPos = idx;
              }
            });

            callback(null, found[indexPos]);
          });
        });
      });
    });
  }

  return {
    init: init,
    load: load,

    getRoot: getRoot,
    getUser: getUser,
    getID: getID,
    getHost: getHost,
    getPublishUrl: getPublishUrl,
    getFileID: getFileID,
    setFileID: setFileID,
    getTitle: getTitle,
    setTitle: setTitle,
    getDescription: getDescription,
    setDescription: setDescription,
    getAnonymousId: getAnonymousId,

    stripRoot: stripRoot,
    addRoot: addRoot,
    removeFile: removeFile,

    publishNeedsUpdate: publishNeedsUpdate,
    getPublishNeedsUpdate: getPublishNeedsUpdate,

    setSyncQueue: setSyncQueue,
    getSyncQueue: getSyncQueue,
    getCache: getCache,
    queueFileUpdate: queueFileUpdate,
    queueFileDelete: queueFileDelete
  };
});

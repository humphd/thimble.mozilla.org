define(function() {

  function log(module, data) {
    var args = Array.prototype.slice.call(arguments);

    if(args.length === 1) {
      data = module;
      module = "Thimble LOG";
    } else {
      module = "Thimble LOG (module=" + args[0] + ")";
      args.shift();
    }

    args.unshift("[" + module + "]");
    console.log.apply(console, args);
  }

  function noop() {}

  // To enable logging, use ?logging=1
  return (function(search) {
    // TODO: fix this to do the check, always return log() for now
    return log;

    if(search.indexOf("logging=1") > -1) {
      return log;
    }

    return noop;
  }(window.location.search));
});

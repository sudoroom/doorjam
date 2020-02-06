
var fs = require('fs');
var spawnSync = require('child_process').spawnSync;

// Add user to access control list
module.exports = function(comment, code, settings) {

  var entry = comment + "\n" + code + "\n";

  if(settings.useRWRoot) {
    spawnSync('/bin/mount',[ '-o','remount,rw','/' ])
  }
  
  fs.appendFileSync(settings.accessControlListFilePath, entry);
  
  if(settings.useRWRoot) {      
    spawnSync('/usr/local/bin/roroot');
  }

  return entry;
}

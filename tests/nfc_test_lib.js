#!/usr/bin/env nodejs

var child_process = require('child_process');
var nfc = require('nfc').nfc;


function init_nfc(callback, attempt) {
    attempt = attempt || 0;

    var device = new nfc.NFC();
    
    device.on('read', function(tag) {
        if(tag.uid) {
            console.log(tag.uid);
        }
    })
    
    device.on('error', function(err) {
        console.error("Error: " + err);
    })

    // This is a workaround since the first attempt will sometimes fail
    // see https://github.com/camme/node-nfc/issues/9
    try {
        device.start();
        return callback(null, device);
    } catch(e) {
        attempt++;
        if(attempt > 2) {
            return callback("Could not initialize NFC device");
        } else {
            setTimeout(function() {
                init_nfc(callback, attempt);
            }, 300);
        }
    }
}

init_nfc(function(err, device) {
    if(err) {
        console.error("Could not initialize NFC device");
        process.exit(1);
    }

    console.log("NFC device initialized");
});

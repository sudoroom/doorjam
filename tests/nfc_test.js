#!/usr/bin/env nodejs


var child_process = require('child_process');

function nfc_scan(callback) {
    child_process.exec('nfc-list', function(err, stdout, stderr) {
        if(err) {
            return callback(err);
        }
        var m = stdout.match(/UID.*\:(.*)/)
        if(!m) {
            return callback(null, null);
        }
        var uid = m[1].replace(/\s+/g, '');
        callback(null, uid);
    });
}

function nfc_scan_loop(repeat, callback) {
    repeat = repeat || 300; // ms
    nfc_scan(function(err, uid) {
        if(err) {
            callback(err);
            setTimeout(function() {
                nfc_scan_loop(repeat, callback);
            }, repeat);
            return;
        }
        if(!uid) {
            setTimeout(function() {
                nfc_scan_loop(repeat, callback);
            }, repeat);
            return;
        }

        callback(null, uid);
        setTimeout(function() {
            nfc_scan_loop(repeat, callback);
        }, repeat);
    });

}

nfc_scan_loop(300, function(err, uid) {
    if(err) {
        console.error("Error: " + err);
        return;
    }
    console.log("scanned rfid: " + uid);
});




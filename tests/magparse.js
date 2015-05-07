#!/usr/bin/env nodejs

var HID = require('node-hid');
var scancodeDecode = require('../lib/scancode_decode.js');

var magStripeProductName = 'USB Swipe Reader';

function findMagStripeReader() {
    var devices = HID.devices();
    var i;
    var product = false;
    for(i=0; i < devices.length; i++) {
        if(devices[i].product) {
            product = true;
        }
        if(devices[i].product == magStripeProductName) {
            try {
                var dev = new HID.HID(devices[i].path);
            } catch(e) {
                console.error("Failed to initialize magstripe reader");
                console.error("Hint: You may need to be root");
                return null;
            }
            return dev;
        }
    }
    if(!product) {
        console.error("Failed to find magstripe reader");
        console.error("Hint: You may need to be root");
    }
    return null;
}


var dev = findMagStripeReader();

dev.on('data', function(data) {

    var str = scancodeDecode(data);
    if(str) {
        var i;
        for(i=0; i < str.length; i++) {
            dev.emit('char', str[i]);
        }
    }
});

var lineBuffer = '';

dev.on('char', function(char) {
    lineBuffer += char;

    if(char == '\n') {
        dev.emit('line', lineBuffer);
        lineBuffer = '';
    }
});

// parse a magcard line
// return an array of three strings (one for each track)
//   strings are empty if track didn't exist or had no data
// returns null if all tracks are empty or there was an error reading any track
function magParse(line) {
    if(!line) return null;
    var f = {
        '%': 0,
        ';': 1,
        '+': 2
    };
    var fields = ['', '' , ''];
    var i, ch;
    var field;
    for(i=0; i < line.length; i++) {
        ch = line[i];
        if(field !== undefined) {
            if(ch == '?') {
                field = undefined;
                continue;
            }
            fields[field] += ch;
        } else {
            if(f[ch] !== undefined) {
                field = f[ch];
            }
        }
    }

    var empty = true;
    for(i=0; i < fields.length; i++) {
        if(!fields[i]) {
            continue;
        }
        if((fields.length > 0) && (fields[i].toUpperCase() == 'E')) {
            return null;
        }
        empty = false;
    }
    if(empty) {
        return null;
    }

    return fields;
}

dev.on('line', function(line) {
    var fields = magParse(line);
    console.log(fields);
});

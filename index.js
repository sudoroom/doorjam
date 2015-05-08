#!/usr/bin/env node

var fs = require('fs');
var HID = require('node-hid');
var crypto = require('crypto');
var SerialPort = require('serialport').SerialPort;
var sleep = require('sleep').sleep;
var randomstring = require('randomstring');
var StringDecoder = require('string_decoder').StringDecoder;

var magStripeProductName = 'USB Swipe Reader';

var serialDevice = '/dev/serial/by-id/usb-Arduino__www.arduino.cc__0043_74937303936351111051-if00';
var minLength = 8; // minimum entry code length
var initPeriod = 500; // time to stay in init period in ms (when buffer is flushed)

var state = 'init'; // The current state of this program. Will change to 'running' after initialization.
var salt = null;

if(!fs.existsSync('SALT')) {
    console.log("=========== WARNING ===========");
    console.log("  The SALT file did not exist  ");
    console.log("  a new one will be generated  ");
    console.log("    if you have an existing    ");
    console.log("      access control list       ");
    console.log("   then it will stop working   ");

    salt = randomstring.generate(128);
    fs.writeFileSync('SALT', salt);
} else {
    salt = fs.readFileSync('SALT');
}

var serial = new SerialPort(serialDevice, {
    baudrate: 9600,
    databits: 8,
    stopbits: 1,
    parity: 'none',
    openImmediately: false
});

serial.on('error', function(err) {
    console.log(err);
    if(state == 'init') {
        console.log("Could not open serial device (arduino). Exiting.");
        process.exit(1);
    }
});

// there is a fake open event before the real one
// must be a bug in the serial library
var openEvents = 0;
serial.on('open', function() {
    if(openEvents > 0) {
        console.log("Opened serial connection to arduino!");
    }
    openEvents += 1;
});

serial.open();
/*
} catch(e) {
    console.log("Unable to open serial device (arduino). Are you sure it's plugged in?");
    process.exit(1);
}
*/

function findMagStripeReader() {
    var devices = HID.devices();
    var i;
    for(i=0; i < devices.length; i++) {
        if(devices[i].product == magStripeProductName) {
            try {
                var dev = new HID.HID(devices[i].path);
            } catch(e) {
                console.log("Failed to initialize magstripe reader");
                console.log("Hint: You may need to be root");
                return null;
            }
            console.log("Initialized magstripe reader!");
            return dev;
        }
    }
    console.log("Magstripe reader not found. Exiting.");
    process.exit(1);
}

function checkACL(inputline) {

    if(!fs.existsSync('access_control_list')) {
        fs.writeFileSync('access_control_list', "# Acces control list for DoorJam\n");
        fs.chmodSync('access_control_list', '600');
    }
    var acl = fs.readFileSync('access_control_list', {encoding: 'utf8'}).split("\n");

    var i, line;
    for(i=0; i < acl.length; i++) {
        line = acl[i];
        line = line.replace(/\s+/g, ''); // remove whitespace
        if((line.length <= minLength) || (line.length < 2)) {
            continue; // skip lines that are too short (includes empty lines)
        }
        if(line[0] == '#') {
            continue; // skip comments 
        }
        if(line == inputline) {
            return true;
        }
    }
    return false;
}

function logAttempt(line) {
    console.log("Access denied. Your attempt has been logged.");

    fs.appendFileSync('failed_attempts', JSON.stringify({
        code: line,
        date: new Date()
    })+"\n", {encoding: 'utf8'});
}

function grantAccess() {
    console.log("Access granted on " + new Date());
    serial.write("o");
}


function makeHash() {
    var hash = crypto.createHash('sha1');
    hash.update(salt);
    return hash;
}

var decoder = new StringDecoder('utf8');
var dev = findMagStripeReader();
if(!dev) {
    process.exit(1);
}

var hash = makeHash();

// the data is raw USB HID scan codes: 
// http://www.mindrunway.ru/IgorPlHex/USBKeyScan.pdf
dev.on('data', function(data) { 
    if(state == 'init') {
        return; // flush data during init period
    }
    
    // ignore codes that consist of all zeroes
    var i;
    var zero = true;
    for(i=0; i < data.length; i++) {
        if(data[i] != 0) {
            zero = false;
        }
    }
    if(zero) {
        return;
    }
    hash.update(data);
    
    // 0x28 is the scancode for enter
    if(data[2] == 0x28) {
        var line = hash.digest('hex');
        console.log(line);
        
        if(checkACL(line)) {
            grantAccess();
        } else {
            logAttempt(line);
        }
        line = '';
        hash = makeHash();
    }    
});


function endInit() {
    state = 'running';
    console.log("Everything initialized and ready");
}

console.log("Initializing");

setTimeout(endInit, initPeriod);

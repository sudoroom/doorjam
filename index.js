#!/usr/bin/env node

var fs = require('fs');
var HID = require('node-hid');
var nfc = require('nfc').nfc;
var crypto = require('crypto');
var SerialPort = require('serialport').SerialPort;
var sleep = require('sleep').sleep;
var randomstring = require('randomstring');
var StringDecoder = require('string_decoder').StringDecoder;
var argv = require('minimist')(process.argv.slice(2));

var magStripeProductName = 'USB Swipe Reader';

var serialDevice = '/dev/ttyACM0';
var minLength = 8; // minimum entry code length
var initPeriod = 500; // time to stay in init period in ms (when buffer is flushed)

var state = 'init'; // The current state of this program. Will change to 'running' after initialization.
var salt = null;
var hash = null;
var serial;

function findMagStripeReader() {
    var devices = HID.devices();
    var i;
    for(i=0; i < devices.length; i++) {
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
    return null;
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

function init_magstripe() {

    var decoder = new StringDecoder('utf8');
    var magdev = findMagStripeReader();
    if(!magdev) {
        console.error("Magstripe reader not found. Exiting.");
        return null;
    }

    // the data is raw USB HID scan codes: 
    // http://www.mindrunway.ru/IgorPlHex/USBKeyScan.pdf
    magdev.on('data', function(data) { 
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
            
            if(checkACL(line)) {
            grantAccess();
            } else {
                logAttempt(line);
            }
            line = '';
            hash = makeHash();
    }    
    });
}


function init_nfc(callback, attempt) {
    attempt = attempt || 0;

    var nfcdev = new nfc.NFC();
    
    var last_nfc_attempt = {
        time: new Date(0),
        code: null
    };
    
    nfcdev.on('read', function(tag) {
        if(!tag.uid) {
            return
        }

        hash.update(tag.uid);
        var code = hash.digest('hex');
        
        var a_bit_ago = new Date();
        a_bit_ago.setSeconds(a_bit_ago.getSeconds()-3);
        var now = new Date();
        
        // prevent the same code from being used more than once every 3 seconds
        // this is needed since most nfc tag reads will result in multiple
        // reads very rapidly following each other
        if(last_nfc_attempt.time >= a_bit_ago) {
            if(last_nfc_attempt.code === code) {
                hash = makeHash();
                return;
            }
        }
        
        if(checkACL(code)) {
        grantAccess();
        } else {
            logAttempt(code);
        }
        
        hash = makeHash();
        last_nfc_attempt = {
            time: now,
            code: code
        };
    });

    nfcdev.on('error', function(err) {
        console.error("NFC device error: " + err);
    });


    // This is a workaround since the first attempt will sometimes fail
    // see https://github.com/camme/node-nfc/issues/9
    try {
        nfcdev.start();
        return callback(null, nfcdev);
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

function init_salt() {
    var salt;
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
    return salt;
}


function init_arduino_real(callback) {

    var serial = new SerialPort(serialDevice, {
        baudrate: 9600,
        databits: 8,
        stopbits: 1,
        parity: 'none',
        openImmediately: false
    });
    
    serial.on('error', function(err) {
        console.error(err);
        if(state == 'init') {
            return callback(err);
        }
    });
    
    var openEvents = 0;
    serial.on('open', function() {
        return callback(null, serial);
    });
    
}

function init_arduino_fake(callback) {
    callback(null, {
        write: function(str) {
            console.log("[fake arduino write]: " + str);
        }
    });
}

function init_done() {
    state = 'running';
    console.log("Everything initialized and ready");
}

function usage(f) {
    f = f || prcess.stderr;

    f.write("usage: sudo index.js\n");
    f.write("\n");
    f.write("       --fake-arduino : Pretend an arduino is connected\n");
    f.write("       --disable-rfid : Disable RFID (NFC) functionality\n");
    f.write("  --disable-magstripe : Disable magstripe functionality\n");
    f.write("                   -h : This help screen\n");
    f.write("\n");
}

// ------------ end functions ---------------

if(argv.h || argv.help) {
    usage(process.stdout);
    process.exit(0);
}

salt = init_salt();
hash = makeHash();

var init_arduino;

if(argv['fake-arduino']) {
    init_arduino = init_arduino_fake;
} else {
    init_arduino = init_arduino_real;
}

console.log(argv);

console.log("Initializing");

init_arduino(function(err, ser) {
    if(err) {
        console.error("Could not open serial device (arduino): " + err);
        return;
    }
    
    serial = ser; // set global
    
    console.log("Opened serial connection to arduino!");

    if(!argv['disable-magstripe']) {
        console.log("Initializing magstripe reader");
        init_magstripe();
    }

    if(!argv['disable-rfid']) {
        console.log("Initializing RFID reader");
        init_nfc(function(err, device) {
            if(err) {
                console.error("Could not initialize NFC device");
                process.exit(1);
            }
            console.log("NFC device initialized");

            setTimeout(init_done, initPeriod);
        });       
    } else {
        setTimeout(init_done, initPeriod);
    }        

});

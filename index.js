#!/usr/bin/env node

var split=require('split2');
var through=require('through2');
var fs = require('fs');
var HID = require('node-hid');
var crypto = require('crypto');
var SerialPort = require('serialport').SerialPort;
var sleep = require('sleep').sleep;
var randomstring = require('randomstring');
var StringDecoder = require('string_decoder').StringDecoder;
var scancodeDecode = require('./lib/scancode_decode.js');
var magStripeProductName = 'USB Swipe Reader';
var serialDevice = '/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_A9007KT3-if00-port0';
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

var health = { // data from the arduino
    voltage : -1, // what voltage has the arduino reported?
    sinceVoltage : 0, // how long since the lasts voltage update?
    lastVoltage : 0, // when did we last get a voltage update?
    sinceMotor : 0, // how long since the last time the motor was activated?
    lastMotor : 0 // what (local) time was motor last activated?
}

serial.pipe(split()).pipe(through(function(data,encoding,next) {
    if(/^voltage/.test(data)) { // if the arduino will tell us voltage
        health.voltage = parseFloat(data.toString().split(/\s+/)[1])
        if(!isNaN(health.voltage)) {
            health.lastVoltage = Date.now()
            console.log('voltage is ',health.voltage);
        } else {
            console.log('WTF arduino sent ^voltage and then NaN');
        }
    }
    if(/opening/.test(data)) health.lastMotor = Date.now()
    if(/closing/.test(data)) health.lastMotor = Date.now()
    next()
}));

serial.on('error', function(err) {
    console.log('SERIAL ERROR', err);
    process.exit(1);
});

serial.on('close', function () {
    console.log('SERIAL ERROR serial closed');
    process.exit(1);
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

    var i, line, prevCommment;
    for(i=0; i < acl.length; i++) {
        line = acl[i];
        line = line.replace(/\s+/g, ''); // remove whitespace
        if((line.length <= minLength) || (line.length < 2)) {
            continue; // skip lines that are too short (includes empty lines)
        }
        if(line[0] == '#') {
            prevComment = line;
            continue; // skip comments 
        }
        if(line == inputline) {
            console.log(prevComment);
            return true;
        }
    }
    return false;
}

function logAttempt(line) {
    console.log("Access denied. Your attempt has been logged. " + new Date());
    serial.write("s"); // make the speaker make a sad sound :(

    fs.appendFileSync('/var_rw/failed_attempts', JSON.stringify({
        date: (new Date()).toString(),
        code: line
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

var decoder = new StringDecoder('utf8');
var dev = findMagStripeReader();
if(!dev) {
    process.exit(1);
}

function CheckCode(code) {
    if(checkACL(code)) {
        grantAccess();
    } else {
        logAttempt(code);
    }
}
var hash = makeHash();
var hash_oldstyle = makeHash();
var dataSize = 0
dev.on('data', function(data) {

    // old style scan decoding (to accept old hashes)
    if (state == 'init') return
    var i
    var zero = true
    for (i=0; i < data.length; i++) {
        if(data[i] != 0) {
            zero = false;
        }
    }
    if (zero) return
    dataSize += data.length
    hash_oldstyle.update(data)
    if (data[2] == 0x28) {
        var line = hash_oldstyle.digest('hex')
        if (dataSize >= 100) CheckCode(line)
        dataSize = 0
        hash_oldstyle = makeHash()
    }

    // new style scan decoding
    var newstr = scancodeDecode(data);
    if(newstr) {
        var i;
        for(i=0; i < newstr.length; i++) {
            dev.emit('char', newstr[i]);
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
dev.on('line', function(line) {
    var fields = magParse(line);
    if(!fields) {
        console.log("Ignored unreadable card");
        return;
    }    
    fields = fields.join('');
    hash.update(fields);
    var code = hash.digest('hex');
    CheckCode(code)
    hash = makeHash();
});
dev.on('error', function(err) {
    console.log('MAGSTRIPE ERROR', err)
    process.exit(1);
});

function endInit() {
    state = 'running';
    console.log("Everything initialized and ready");
}

console.log("Initializing");

setTimeout(endInit, initPeriod);

function batteryRequest() {
    serial.write("b") // tell arduino to send us voltage
}

setTimeout(batteryRequest, 1000 * 30); // tell arduino to send us voltage before first health report

setInterval(batteryRequest, 1000 * 60 * 1); // then every 1 minute

setInterval(function () {
    health.sinceMotor = Date.now() - health.lastMotor
    health.sinceVoltage = Date.now() - health.lastVoltage
    console.log('health',JSON.stringify(health))
}, 1000 * 60 * 1); // every 1 minute

// allow granting access from outside the process
process.on('SIGUSR2', grantAccess);

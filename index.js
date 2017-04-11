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
var dgram = require('dgram');

var magStripeProductName = 'USB Swipe Reader';

var serialDevice = '/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_A9007KT3-if00-port0';
var minLength = 8; // minimum entry code length
var initPeriod = 500; // time to stay in init period in ms (when buffer is flushed)

var state = 'init'; // The current state of this program. Will change to 'running' after initialization.
var salt = null;

var socketPort = 13667; // port of loopback control socket

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

var decoder = new StringDecoder('utf8');
var dev = findMagStripeReader();
if(!dev) {
    process.exit(1);
}

var hash = makeHash();

// the data is raw USB HID scan codes: 
// http://www.mindrunway.ru/IgorPlHex/USBKeyScan.pdf
var dataSize = 0;
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
    // console.log(data.toString('hex')); // for debugging to figure out what error codes look like
    dataSize += data.length;
    hash.update(data);
    
    // 0x28 is the scancode for enter
    if(data[2] == 0x28) {
        var line = hash.digest('hex');
        console.log(line);
        
        if(dataSize >= 100 && checkACL(line)) {
            grantAccess();
        } else if (dataSize < 100) {
            logAttempt('less than 100 bytes: ' + dataSize + ' bytes');
        } else {
            logAttempt(line);
        }
        line = '';
        dataSize = 0;
        hash = makeHash();
    }    
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

// Listen for socket commands and pass them through to the serial port
var server = dgram.createSocket('udp4');

server.on('error', function (err) {
    console.error('socket server error: ' + err)
});

server.on('message', function (msg, rinfo) {
    switch (msg.toString('ascii')) {
        case 'o': return grantAccess();
    }
});

server.bind(socketPort, '127.0.0.1', function () {
    var address = server.address();
    console.log('dgram server listening on localhost:'+socketPort)
});

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
var exec = require('child_process').exec;

var settings = require('./settings.js');

var minLength = 8; // minimum entry code length
var initPeriod = 500; // time to stay in init period in ms (when buffer is flushed)
var serialIsOpen = false; // has the serial port been opened successfully?

var state = 'init'; // The current state of this program. Will change to 'running' after initialization.
var salt = null;

var lastDoorOpenSent; // time when the last door open command was sent to the arduino
var lastDoorOpenReceived; // time when the last message was received from the arduino indicating that it opened the door
var doorSensorGPIO; // byte from /sys/class/gpio/gpio60/value indicating whether door sensor is open or closed
var lastDoorOpenSensed; // most recent time door was open
var lastDoorClosedSensed; // last time door state CHANGED to closed

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

var serial = new SerialPort(settings.serialDevice, {
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

function writeSerial(data) {
  if(!serialIsOpen) return;
  serial.write(data);
}

serial.pipe(split()).pipe(through(function(data,encoding,next) {
    if(/^voltage/.test(data)) { // if the arduino will tell us voltage
        health.voltage = parseFloat(data.toString().split(/\s+/)[1])
        if(!isNaN(health.voltage)) {
            health.lastVoltage = Date.now()
            // console.log('voltage is ',health.voltage);
        } else {
            console.log('WTF arduino sent ^voltage and then NaN');
        }
    }
    if(/opening/.test(data)) {
        health.lastMotor = Date.now();
        lastDoorOpenReceived = new Date();
    }
    if(/closing/.test(data)) health.lastMotor = Date.now()
    next()
}));

serial.on('error', function(err) {
    console.log('SERIAL ERROR', err);
//    process.exit(1);
});

serial.on('close', function () {
    console.log('SERIAL ERROR serial closed');
    process.exit(1);
});

// there is a fake open event before the real one
// must be a bug in the serial library
var openEvents = 0;
serial.on('open', function(error) {
    if(openEvents > 0 && !error) {
      console.log("Opened serial connection to arduino!");
      serialIsOpen = true;
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
        if(devices[i].product == settings.magStripeProductName) {
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
    console.log("Magstripe reader not found.");
//    process.exit(1);
}

function checkACL(inputline) {

    if(!fs.existsSync('access_control_list')) {
        fs.writeFileSync('access_control_list', "# Acces control list for DoorJam\n");
        fs.chmodSync('access_control_list', '600');
    }
    var acl = fs.readFileSync('access_control_list', {encoding: 'utf8'}).split("\n");

    var i, line, prevCommment; // this prevCommment is a type, does that have any effect?
    for(i=0; i < acl.length; i++) {
        lineRaw = acl[i];
        line = lineRaw.replace(/\s+/g, ''); // remove whitespace
        if((line.length <= minLength) || (line.length < 2)) {
            continue; // skip lines that are too short (includes empty lines)
        }
        if(line[0] == '#') {
            prevComment = lineRaw;
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
    writeSerial("s"); // make the speaker make a sad sound :(

    fs.appendFileSync('/var_rw/failed_attempts', JSON.stringify({
        date: (new Date()).toString(),
        code: line
    })+"\n", {encoding: 'utf8'});
}

function grantAccess(line) {
    console.log("Access granted on " + new Date());
    writeSerial("o");
    lastDoorOpenSent = new Date();
    exec(settings.grantAccessCommand, function(err, stdout, stderr) {
        if(err) return console.error(err);
        if(stdout) console.log("grantAccessCommand said:", stdout);
        if(stderr) console.error("grantAccessCommand stderr said:", stderr);
    });
    fs.appendFileSync('/var_rw/good_swipe_log', JSON.stringify({
        date: (new Date()).toString(),
        code: line.replace(/\n/g," ")
    })+"\n", {encoding: 'utf8'});
}


function makeHash() {
    var hash = crypto.createHash('sha1');
    hash.update(salt);
    return hash;
}

var decoder = new StringDecoder('utf8');
var dev = findMagStripeReader();
if(!dev) {
//    process.exit(1);
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
        
        if(dataSize >= 75 && checkACL(line)) {
            grantAccess(line);
        } else if (dataSize < 75) {
            logAttempt('less than 75 bytes: ' + dataSize + ' bytes');
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
//    process.exit(1);
});

function endInit() {
    state = 'running';
    console.log("Everything initialized and ready");
}

console.log("Initializing");

setTimeout(endInit, initPeriod);

function batteryRequest() {
    writeSerial("b") // tell arduino to send us voltage
}

// Called when it is detected that a door open command
// sent to the arduino did not result in the arduino
// reporting back that it opened the door
function doorOpenRequestIgnored() {
    console.log("Error: arduino did not respond to door open request");
}

setTimeout(batteryRequest, 1000 * 30); // tell arduino to send us voltage before first health report

setInterval(batteryRequest, 1000 * 60 * 1); // then every 1 minute

setInterval(function () { // checkDoorOpenSensor
    if(fs.existsSync('/sys/class/gpio/gpio60/value')) {
        var previousDoorSensorGPIO = doorSensorGPIO
        var gpio60Value = fs.readFileSync('/sys/class/gpio/gpio60/value'); // returns "0\n" if door is open, "1\n" if door closed
        if(!gpio60Value || gpio60Value.length < 1) return; // TODO maybe log error here?
        doorSensorGPIO = gpio60Value[0];
        if(doorSensorGPIO == 48) { // "0"
            lastDoorOpenSensed = new Date();
            if (previousDoorSensorGPIO == 49) { console.log('door opened'); }
        }
        if(doorSensorGPIO == 49 && previousDoorSensorGPIO == 48) { // "1"
            lastDoorClosedSensed = new Date(); // only store when the door CHANGED to closed
            console.log('door closed');
        }
    }
}, 1000); // every second

// Every 10 seconds
// check if the arduino reported door open
// after the last attempted door open commend that was sent to the arduino
setInterval(function () {
  if(!lastDoorOpenReceived || !lastDoorOpenSent) {
    return;
  }
  // if there was more than 3 seconds between last
  // door open request sent and last "i opened the door" message received
  // to/from the arduino, then call doorOpenRequestIgnored()
  if(((lastDoorOpenReceived - lastDoorOpenSent) / 1000) > 3) {
    doorOpenRequestIgnored();
    lastDoorOpenReceived = undefined;
    lastDoorOpenSent = undefined;
  }
}, 10 * 1000); 
            
setInterval(function () {
    health.sinceMotor = Date.now() - health.lastMotor
    health.sinceVoltage = Date.now() - health.lastVoltage
    console.log('health',JSON.stringify(health))
}, 1000 * 60 * 10); // every 10 minutes

// allow granting access from outside the process
process.on('SIGUSR2', grantAccess.bind(null,"sigusr"));

#!/usr/bin/env node

var fs = require('fs');
var HID = require('node-hid');
//var nfc = require('nfc').nfc;
var crypto = require('crypto');
var SerialPort = require('serialport').SerialPort;
var sleep = require('sleep').sleep;
var randomstring = require('randomstring');
var StringDecoder = require('string_decoder').StringDecoder;
var argv = require('minimist')(process.argv.slice(2));

var scancodeDecode = require('../lib/scancode_decode.js');

var settings = require('../settings.js');

var minLength = 8; // minimum entry code length
var initPeriod = 500; // time to stay in init period in ms (when buffer is flushed)

var state = 'init'; // The current state of this program. Will change to 'running' after initialization.
var salt = null;
var hash = null;
var arduino = null;
//var nfcdev = null;
var magdev = null;

var health = { // data from the arduino
  voltage : -1, // what voltage has the arduino reported?
  sinceVoltage : 0, // how long since the lasts voltage update?
  lastVoltage : 0, // when did we last get a voltage update?
  sinceMotor : 0, // how long since the last time the motor was activated?
  lastMotor : 0 // what (local) time was motor last activated?
}

function exitCleanup(exit) {
  //    if(nfcdev) {
  //        console.log("Stopping NFC device");
  //        nfcdev.stop();
  //        nfcdev = null;
  //    }
  if(exit) {
    console.log("Exiting");
    process.exit(1);
  }
}

process.on('exit', exitCleanup.bind(null, false));
process.on('SIGINT', exitCleanup.bind(null, true));
process.on('SIGTERM', exitCleanup.bind(null, true));
//process.on('uncaughtException', exitCleanup.bind(null, true));

function findMagStripeReader() {
  var devices = HID.devices();
  var i;
  var product = false;
  for(i=0; i < devices.length; i++) {
    if(devices[i].product) {
      product = true;
    }
    if(devices[i].product == settings.magStripeProductName) {
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

function checkACL(inputline) {

  if(!fs.existsSync('access_control_list')) {
    fs.writeFileSync('access_control_list', "# Acces control list for DoorJam\n");
    fs.chmodSync('access_control_list', '600');
  }
  var acl = fs.readFileSync('access_control_list', {encoding: 'utf8'}).split("\n");

  var i, line, prevComment;
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
      console.log("Access granted to: " +prevComment);
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
  arduino.write("o");
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

function init_magstripe() {

  var decoder = new StringDecoder('utf8');
  var magdev = findMagStripeReader();
  if(!magdev) {
    console.error("Magstripe reader not found.");
    return null;
  }

  magdev.on('error', function(err) {
    console.error("Magstripe error: " + err);
    process.exit(1);
  });

  magdev.on('data', function(data) {
    
    var str = scancodeDecode(data);
    if(str) {
      var i;
      for(i=0; i < str.length; i++) {
        magdev.emit('char', str[i]);
      }
    }
  });

  var lineBuffer = '';

  magdev.on('char', function(char) {
    lineBuffer += char;
    
    if(char == '\n') {
      magdev.emit('line', lineBuffer);
      lineBuffer = '';
    }
  });

  magdev.on('line', function(line) {
    var fields = magParse(line);
    if(!fields) {
      console.log("Ignored unreadable card");
      return;
    }
    
    fields = fields.join('');

    hash.update(fields);

    var code = hash.digest('hex');

    if(checkACL(code)) {
      grantAccess();
    } else {
      logAttempt(code);
    }

    hash = makeHash();
  });
  return magdev;
}


/*
  function init_nfc(callback) {

  var nfcdev = new nfc.NFC();
  
  var last_nfc_attempt = {
  time: new Date(0),
  code: null
  };
  
  nfcdev.on('read', function(tag) {
  if(!tag.uid) {
  return;
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
  // all errors are fatal
  console.error("NFC device error: " + err);
  process.exit(1);
  });

  nfcdev.start();
  return callback(null, nfcdev);
  }
*/

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

  var serial = new SerialPort(settings.arduinoDevice, {
    baudrate: 9600,
    databits: 8,
    stopbits: 1,
    parity: 'none',
    openImmediately: false
  });
  
  serial.pipe(split()).pipe(through(function(data,encoding,next) {
    if(/^voltage/.test(data)) { // if the arduino will tell us voltage
      health.voltage = parseFloat(data.toString().split(/\s+/)[1])
      if(!isNaN(health.voltage)) {
        health.lastVoltage = Date.now()
        console.log('voltage is ',health.voltage);
      } else {
        console.log('WTF arduino sent ^voltage and then NaN');
      }
    } else if(/opening/.test(data)) {
      health.lastMotor = Date.now();
    } else if(/closing/.test(data)) {
      health.lastMotor = Date.now();
    }
    next();
  }));
  
  function batteryRequest() {
    serial.write("b"); // tell arduino to tell us the battery voltage
  }
  setTimeout(batteryRequest, 1000 * 20); // tell arduino to send us voltage before first health report
  setInterval(batteryRequest, 1000 * 60 * 1); // then every 1 minute

  setInterval(function () {
    if(health.lastMotor) health.sinceMotor = Date.now() - health.lastMotor;
    if(health.lastVoltage) health.sinceVoltage = Date.now() - health.lastVoltage;
    console.log('health', JSON.stringify(health)) // log health to console
  }, 1000 * 30 * 1); // every 30 seconds

  serial.on('error', function(err) {
    console.error(err);
    if(state == 'init') {
      return callback(err);
    }
    process.exit(1);
  });
  
  var openEvents = 0;
  serial.on('open', function() {
    return callback(null, serial);
  });

  serial.on('close', function() {
    console.log("Lost serial connection. Exiting");
    process.exit(1);
  });
  
}

function init_arduino_fake(callback) {

  function fakeBatteryRequest() {
    health.voltage = 14;
    health.lastVoltage = Date.now();
    console.log('fake voltage is ', health.voltage);
  }

  setTimeout(fakeBatteryRequest, 1000 * 20); // tell arduino to send us voltage before first health report
  setInterval(fakeBatteryRequest, 1000 * 60 * 1); // then every 1 minute

  setInterval(function () {
    if(health.lastMotor) health.sinceMotor = Date.now() - health.lastMotor;
    if(health.lastVoltage) health.sinceVoltage = Date.now() - health.lastVoltage;
    console.log('health', JSON.stringify(health)) // log health to console
  }, 1000 * 30 * 1); // every 30 seconds

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
  f = f || process.stderr;

  f.write("usage: sudo index.js\n");
  f.write("\n");
  f.write("       --fake-arduino : Pretend an arduino is connected\n");
  //    f.write("       --disable-rfid : Disable RFID (NFC) functionality\n");
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

console.log("Initializing");

init_arduino(function(err, ard) {
  if(err) {
    console.error("Could not open serial device (arduino): " + err);
    process.exit(1);
  }
  
  arduino = ard; // set global
  
  console.log("Opened serial connection to arduino!");

  if(!argv['disable-magstripe']) {
    console.log("Initializing magstripe reader");
    magdev = init_magstripe();
    if(!magdev) {
      console.error("Magstripe initialization failed");
      process.exit(1);
    }
    
  }

  if(!argv['disable-rfid']) {
    /*
      console.log("Initializing RFID reader");

      init_nfc(function(err, dev) {
      nfcdev = dev;
      if(err) {
      console.error("Could not initialize NFC device");
      process.exit(1);
      }
      console.log("NFC device initialized");

      setTimeout(init_done, initPeriod);
      });  
    */     
  } else {
    setTimeout(init_done, initPeriod);
  }        

});

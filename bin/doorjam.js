#!/usr/bin/env node

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var HID = require('node-hid');
//var nfc = require('nfc').nfc;
var SerialPort = require('serialport');
var sleep = require('sleep').sleep;
var randomstring = require('randomstring');
var through = require('through2');

var argv = require('minimist')(process.argv.slice(2), {
  boolean: [
    'h',
    'help',
    'debug',
    'disable-magstripe',
    'fake-arduino'
  ]
});

var parseHIDKeyboardPacket = require('../lib/hid_parser/keyboard-parser.js');

var settings = require('../settings.js');

// Fix relative file paths
if(settings.accessControlListFilePath[0] !== '/') {
  settings.accessControlListFilePath = path.join(__dirname, '..', settings.accessControlListFilePath);
}
if(settings.failedAttemptsFilePath[0] !== '/') {
  settings.failedAttemptsFilePath = path.join(__dirname, '..', settings.failedAttemptsFilePath);
}
if(settings.saltFilePath[0] !== '/') {
  settings.saltFilePath = path.join(__dirname, '..', settings.saltFilePath);
}


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
        console.error(e);
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

function addToACL(hash) {
  console.log("TODO addToACL not yet implemented");
}

function checkACL(hash) {

  if(!fs.existsSync(settings.accessControlListFilePath)) {
    fs.writeFileSync(settings.accessControlListFilePath, "# Acces control list for DoorJam\n");
    fs.chmodSync(settings.accessControlListFilePath, '600');
  }
  var acl = fs.readFileSync(settings.accessControlListFilePath, {encoding: 'utf8'}).split("\n");

  var i, line, prevComment;
  for(i=0; i < acl.length; i++) {
    line = acl[i];
    line = line.replace(/\s+/g, ''); // remove whitespace
    if((line.length <= minLength) || (line.length < 2)) {
      continue; // skip lines that are too short (includes empty lines)
    }
    if(line[0] === '#') {
      prevComment = acl[i];
      continue; // skip comments 
    }
    if(line === hash) {
      console.log("Access granted to: " +prevComment);
      return true;
    }
  }
  return false;
}

function logAttempt(line) {
  console.log("Access denied. Your attempt has been logged. " + new Date());
  if(arduino) {
    arduino.write("s"); // make the speaker make a sad sound :(
  }

  fs.appendFileSync(settings.failedAttemptsFilePath, JSON.stringify({
    date: (new Date()).toString(),
    code: line
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

// Parse a magcard line
// Refer to USB KB SureSwipe Reader Technical Reference Manual
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
    // If a track can't be read, according to the MagTek documentation
    // the field will contain an 'E'
    if((fields.length > 0) && (fields[i] == 'E')) {
      return null;
    }
    empty = false;
  }
  if(empty) {
    return null;
  }

  return fields;
}

function parseHIDDataToChar(packet) {
  packet = parseHIDKeyboardPacket(packet);
  var charCodes = [];
  var i;
  for(i=0; i < packet.charCodes.length; i++) {
    if(packet.charCodes[i]) charCodes.push(packet.charCodes[i]);
  }
  if(packet.errorState) {
    throw new Error("Packet rollover error (user pressed too many keys on keyboard)");
  }
  if(charCodes.length > 1) {
    throw new Error("Somehow the magnetic card reader sent the equivalent signal of a the user pressing two (non-modifier) keys at once. There is no way to know the order of these characters: " + packet.charCodes.join(', '));
  }
  if(charCodes.length < 1) {
    return '';
  }
  return charCodes[0];
}

function debug() {
  if(!argv.debug) return;
  if(!arguments.length) return;

  // prepend '[debug]' to output
  const args = Array.prototype.slice.apply(arguments);
  ['[debug]'].concat(args)
  
  console.log.apply(this, args);
}

function debugMagstripeFields(fields) {
  if(!argv.debug) return;

  var i;
  for(i=0; i < 3; i++) {
    if(!fields[i]) {
      debug("MagStripe field "+(i+1)+": <empty>");
    } else {
      debug("MagStripe field "+(i+1)+":", fields[i]);
    }
  }
  
}

// return a 'sudo room v1' hash
function formatHashV1(hash) {
  return '|1|' + hash.digest('hex');
}

function hashV1FromMagstripeLine(line) {
  debug("MagStripe line received:", line);
  var fields = magParse(line);
  if(!fields) {
    console.log("Ignored unreadable card");
    return null;
  }
  debugMagstripeFields(fields);

  var hash = makeHash();

  var i;
  for(i=0; i < fields.length; i++) {
    if(!fields[i]) continue;
    hash.update(fields[i]);
  }

  var code = formatHashV1(hash);

  return code;
}

// Callback is called every time a valid card is swiped
// First callback arg is error (if any)
// Second arg is the v1 hash
// Third arg is v0 hash if settings.allowV0Hash is true
function init_magstripe(cb) {

  var remain = Buffer.alloc(0);
  var remainTime = Date.now();
  var magdev = findMagStripeReader();
  if(!magdev) {
    console.error("Magstripe reader not found.");
    return null;
  }

  magdev.on('error', function(err) {
    console.error("Magstripe error: " + err);
    process.exit(1);
  });

  var line = '';
  var str, ch, packet, newlinePos, dat;
  if(settings.allowV0Hash) {
    var rawDataBytes = 0;
    var hashV0 = makeHash();
    var hashV0Str;
  }
  magdev.on('data', function(data) {
    if(state === 'init') {
      return; // flush data during init period (as it may be junk)
    }
    dat = data;
    
    // Pre-pend remaining bytes from last run
    // but only if less than 0.25 seconds have passed
    // since last data arrived
    if(remain.length && (Date.now() - remainTime) < 250) {
      data = Buffer.concat([remain, data]);
    }
    remain = Buffer.alloc(0);

    str = '';
    while(data.length >= 8) {
      packet = data.slice(0, 8);
      data = data.slice(8);
      try {
        ch = '';
        ch = parseHIDDataToChar(packet);
      } catch(e) {
        magdev.emit('error', e);
      }
      if(ch) {
        str += ch;
      }
    }
    if(data.length) {
      remain = data;
    }
    line += str;

    if(settings.allowV0Hash) {
      // ignore codes that consist of all zeroes
      var i;
      var zero = true;
      for(i=0; i < dat.length; i++) {
        if(dat[i] != 0) {
          zero = false;
        }
      }
      if(!zero) {
        hashV0.update(dat);
        rawDataBytes += dat.length
      }
    }
    
    // Encountered a newline
    newlinePos = line.indexOf('\n');
    if(newlinePos >= 0) {

      // Calculate the V0 hash?
      if(settings.allowV0Hash) {
        if(rawDataBytes >= 100) {
          hashV0Str = hashV0.digest('hex');
        } else {
          hashV0Str = null;
        }
      
        rawDataBytes = 0;
        hashV0 = makeHash();
      }

      var hashV1Str = hashV1FromMagstripeLine(line.slice(0, newlinePos));
      
      // Since the v1 hash will return null on errors
      // and is much better at detecting errors
      // we don't call the callback at all if we don't have a v1 hash
      // even though we might still have a v0 hash
      if(hashV1Str) {
        cb(null, hashV1Str, hashV0Str);
      }
      line = line.slice(newlinePos + 1);
    }
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
  if(!fs.existsSync(settings.saltFilePath)) {
    console.log("=========== WARNING ===========");
    console.log("  The SALT file did not exist  ");
    console.log("  a new one will be generated  ");
    console.log("    if you have an existing    ");
    console.log("      access control list       ");
    console.log("   then it will stop working   ");
    
    salt = randomstring.generate(128);
    fs.writeFileSync(settings.saltFilePath, salt);
  } else {
    salt = fs.readFileSync(settings.saltFilePath);
  }
  return salt;
}


function init_arduino_real(callback) {

  var serial = new SerialPort(settings.arduinoDevice, {
    baudRate: settings.arduniBaudRate || 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    autoOpen: false
  });

  var lineReader = new SerialPort.parsers.Readline({
    delimiter: '\n'
  });
  
  // Use the line parser to get a stream of lines
  serial.pipe(lineReader)
    .pipe(through(function(data, encoding, next) {
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

  serial.open();
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
  f.write("              --debug : Enable debug output");
  f.write("                   -h : This help screen\n");
  f.write("\n");
}

// ------------ end functions ---------------

if(argv.h || argv.help) {
  usage(process.stdout);
  process.exit(0);
}

salt = init_salt();

var init_arduino;

if(argv['fake-arduino']) {
  init_arduino = init_arduino_fake;
} else {
  init_arduino = init_arduino_real;
}

// allow granting access from outside the process
process.on('SIGUSR2', grantAccess);

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
    
    magdev = init_magstripe(function(err, hashV1, hashV0) {

      debug("Calculated hash(es):");
      debug("  v1 hash:", hashV1);
      if(hashV0) {
        debug("  v0 hash:", hashV0);
      }
      
      if(checkACL(hashV1)) {
        grantAccess();
      } else if(settings.allowV0Hash && hashV0 && checkACL(hashV0)) {
        grantAccess();
        addToACL(hashV1);
      } else {
        logAttempt(hashV1);
      }
    });
    
    if(!magdev) {
      console.error("Magstripe initialization failed");
      process.exit(1);
    }
    
  }

  /*
  if(!argv['disable-rfid']) {

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
  }
  */

  setTimeout(init_done, initPeriod);

});

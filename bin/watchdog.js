#!/usr/bin/env nodejs

var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;
var split = require('split2');
var through = require('through2');

var settings = require('../settings.js');

var dev = settings.watchdogDevice;

if(!dev) {
    console.error("Fatal error: No watchdog device set in settings file " + path.resolve('../settings.js'));
    process.exit(1);
}

try {
    fs.statSync(dev);
} catch(e) {
    console.error("Fatal error: Watchdog device " + dev + " not found or not readable");
    console.error(e.message);
    process.exit(1);
}

var dogStream = fs.createWriteStream(dev, {flags: 'w'});

dogStream.on('error', function(err) {
    console.error("Watchdog error on " + dev + ":" + err);
    process.exit(1);
});

dogStream.on('open', function(fd) {
    dogStream.write("\n");
    console.log("Initialized watchdog " + dev);
});

function keepAlive() {
    console.log("Writing keep-alive to " + dev);
    dogStream.write("\n");
}

function startMonitor() {
    var monitor = spawn('psy', [ 'log', 'doorjam' ]);
    monitor.on('exit', function () {
        setTimeout(startMonitor, 5000);
    });
    monitor.stderr.pipe(process.stderr);
    monitor.stdout.pipe(process.stdout);
    monitor.stdout.on('data', function(chunk) {
        console.log("["+new Date()+"] Got heartbeat from doorjam");
        keepAlive();
    });
}

startMonitor();

// disable the watchdog and shut down nicely
function shutdown() {
    console.log("Stopping watchdog nicely");
    dogStream.close();
    dogStream.end();
    console.log("Exiting");
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

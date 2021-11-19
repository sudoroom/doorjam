#!/usr/bin/env node

/*
  Running this script will add the last attempted login to the access list
*/

var fs = require('fs');
var spawn = require('child_process').spawn;
var split = require('split2');
var through = require('through2');
var strftime = require('strftime');

if(!fs.existsSync('/var_rw/failed_attempts')) {
    console.log("It appears that there have been no failed attempts (the /var_rw/failed_attempts file doesn't exist)");
    process.exit(1);
}

if(process.argv.length < 3) {
    console.log("Usage: "+process.argv[1]+" <name of new user>")
    process.exit(1);
}

var attempts = fs.readFileSync('/var_rw/failed_attempts', {encoding: 'utf8'}).split("\n");
var i, lastAttempt;
for(i=attempts.length-1; i >= 0; i--) {
    lastAttempt = attempts[i];
    if(lastAttempt.replace(/^\s+$/g, '').length > 4) {
        lastAttempt = JSON.parse(lastAttempt);
        if (/^less than/.test(lastAttempt.code)) {
            console.error('last failed attempt was a bad read');
            process.exit(1);
        }
        break;
    }
}

askPrompts([
    { key: 'announce', msg: 'How should the IRC bot announce this user?' },
    { key: 'contactInfo', msg: 'What is their email and/or phone number?' },
    { key: 'collective', msg: 'Which collective are they a member of?' },
    { key: 'addedBy', msg: 'Who are you, the person granting access?' }
], addUser);

function askPrompts (prompts, cb) {
    var current = prompts.shift();
    var answers = {};
    process.stdout.write(current.msg + ' ');
    process.stdin.pipe(split()).pipe(through(function (buf, enc, next) {
        var line = buf.toString();
        if (!/\S/.test(line)) {
            process.stdout.write(current.msg + ' ');
            return next();
        }
        answers[current.key] = line;
        if (prompts.length > 0) {
            current = prompts.shift();
            process.stdout.write(current.msg + ' ');
            next();
        } else cb(answers);
    }));
}

function addUser (answers) {
    var comment = '# ' + process.argv.slice(2).join(' ') + " | added on " + new Date() + process.env.SSH_CLIENT + process.env.TERM + " user: " + process.env.USER + "\n";
    var name = process.argv.slice(2).join(' ')
    var comment = '#ANNOUNCE ' + JSON.stringify(answers.announce) + ' ' + name
        + ' ' + answers.contactInfo
        + ' ' + answers.collective
        + ' | added by ' + answers.addedBy
        + ' (' + process.env.USER
        + ') on ' + strftime('%FT%T')
        + '\n';

    // #ANNOUNCE "gumby" ben bgdaniels@gmail.com / commons wg | added by jake Wed Feb 10 22:29:19 PST 2016

    var entry = comment + lastAttempt.code + "\n";

    try {
        spawn('/bin/mount',[ '-o','remount,rw','/' ])
          .stdout.on('end', function(){
            fs.appendFileSync(__dirname + '/access_control_list', entry);
            spawn('/usr/local/bin/roroot');
          })
    } catch(e) {
        console.log("Error: Hm. Are you sure you have permission to write to the access_control_list file?")
        process.exit(1);
    }

    console.log("Added: \n" + entry);
    process.stdin.destroy();
}

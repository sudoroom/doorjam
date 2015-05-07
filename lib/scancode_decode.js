
// symbols and punctuation
// first item is without shift held down, second is with
var symPunct = {
    45: ['-', '_'],
    46: ['=', '+'],
    47: ['[', '{'],
    48: [']', '}'],
    49: ['\\', '|'],
    51: [';', ':'],
    52: ["'", '"'],
    53: ['`', '~'],
    54: [',', '<'],
    55: ['.', '>'],
    56: ['/', '?']
};
    

// the symbols above the numeric keys, indexed by the numeric key number
var numericAlts = [')', '!', '@', '#', '$', '%', '^', '&', '*', '('];

var parseModifiers = function parseModifiers(bits) {

    var modifiers = {};

	if(bits & 1) { modifiers.ctrl = true; }
	if(bits & 2) { modifiers.shift = true; }
	if(bits & 4) { modifiers.alt = true; }
	if(bits & 8) { modifiers.meta = true; }
	if(bits & 16) { modifiers.rCtrl = true; }
	if(bits & 32) { modifiers.rShift = true; }
	if(bits & 64) { modifiers.rAlt = true; }
	if(bits & 128) { modifiers.rMeta = true; }

  return modifiers;
};

var parseCharCodes = function parseCharCodes(keys, modifiers) {
    var str = '';

    var range = function(lower, upper) { 

			return this >= lower && this <= upper; 
		}

    var character = function(num) {
        if(num instanceof Array) {
            if(modifiers.shift || modifiers.rShift) {
                return num[1];
            } else {
                return num[0];
            }
        } else {
            var ch = String.fromCharCode(num);
            if(modifiers.shift || modifiers.rShift) {
                return ch.toUpperCase();
            }
            return ch;
        }
    }

    var i, key;
    for(i=0; i < keys.length; i++) {
        key = keys[i];
			  // range check key shorthand
			  var r = range.bind(key); 
			  if(r(4, 29)) { // alpha
            
				    str += character(key + 93);
            
			  }  else if(r(30, 39)) { // numeric
				    // tacky hack to fix 0 because it's not in order
            var n = (key - 29) % 10;
				    str += character([String(n), numericAlts[n]]);
			  }
			  else if(key == 40) { // enter
            str += "\n";
			  }
			  else if(r(40, 43)) { // controls
            // TODO implement backspace
			  }
			  else if(key == 44) { // spacebar
            str += ' ';
			  }
			  else if(r(45, 56)) { // symbols and punctuation
            if(key == 50) {
                continue;
            }
            str += character(symPunct[key]);
			  }
			  else if(key == 57) { // capslock
            // TODO implement capslock
			  }
			  else if(r(58, 69)) { // F keys
            
			  }
			  else if(r(70, 82)) { // control
            
			  }
			  else if(r(82, 103)) { // keypad
            if(key == 88) { // numpad return
                str += ' ';
                continue;
            }
            if(r(89, 98)) {
                str += String((key - 88) % 10);
            }
			  }
		}
    if(str == '') {
        return false;
    }
    return str;
}; 


module.exports = function(data) {
    if(data.length > 8) {
        // TODO handle this correctly
        console.error("Error: Received more than one byte at a time")
        process.exit(1);
    }
    data = data.toJSON(); // doesn't actually convert it to json, just to an object
    var modifiers = parseModifiers(data.shift());
    data.shift();
    return parseCharCodes(data, modifiers);
};

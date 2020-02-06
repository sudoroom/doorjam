'use strict';

// This code borrowed from:
// https://github.com/agirorn/node-hid-stream

/*
  Copyright (c) 2016 Emily Rose <nexxy@symphonysubconscious.com>

  Permission is hereby granted, free of charge, to any person obtaining a copy of
  this software and associated documentation files (the "Software"), to deal in
  the Software without restriction, including without limitation the rights to
  use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
  the Software, and to permit persons to whom the Software is furnished to do so,
  subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
  FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
  COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
  IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
  CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/**
 * HID Keyboard Packet object
 */
class HidKeyboardPacket {
  constructor() {
    this.modifiers = {
      l_shift: false,
      l_control: false,
      l_alt: false,
      l_meta: false,
      r_control: false,
      r_shift: false,
      r_alt: false,
      r_meta: false,
    };

    this.keyCodes = [];
    this.charCodes = [];
    this.errorStatus = false; // keyboard rollover
  }

  empty() {
    return !this.mod() && this.keyCodes.length === 0;
  }

  control() {
    return this.modifiers.l_control || this.modifiers.r_control;
  }

  shift() {
    return this.modifiers.l_shift || this.modifiers.r_shift;
  }

  meta() {
    return this.modifiers.l_meta || this.modifiers.r_meta;
  }

  alt() {
    return this.modifiers.l_alt || this.modifiers.r_alt;
  }

  mod() {
    const modifiers = this.modifiers;
    return (
      modifiers.l_shift || modifiers.r_shift ||
      modifiers.l_control || modifiers.r_control ||
      modifiers.l_alt || modifiers.r_alt ||
      modifiers.l_meta || modifiers.r_meta
    );
  }
}

module.exports = HidKeyboardPacket;

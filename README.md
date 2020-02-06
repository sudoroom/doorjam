DoorJam is the meatspace firewall for Omni Commons.

# Prerequisites

```
sudo apt install build-essential libusb-1.0-0-dev libnfc-bin libnfc-dev

npm install
```

# Hardware

This only works with `Magtek USB KB SureSwipe` readers. Be aware that a different type `Magtek USB HID SureSwipe` also exists. This one does _not_ act as a keyboard device and would require us to write custom USB HID parsing code for that specific type of reader.

# Usage

Users swipe their access card in a Magtek USB KB magnetic swipe card reader and if the hash of their card data matches a hash in the access control file then a character is sent over serial to an arduino that then closes a relay for a number of seconds to open the door.

If the card is not recognized then its hash is logged in the failed_attempts file with the date and time of the attempt.

Swipe a new card and run the grant_access_to_last_failed_attempt.js script to grant people access.

# Autostart on boot

## With forever (autostart on fail)

```
sudo cp doorjam.initd.with-forever /etc/init.d/doorjam
sudo update-rc.d doorjam defaults
```

Now edit the /etc/init.d/doorjam file to ensure all paths are correct.

## Without forever (no autostart on fail)

```
sudo cp doorjam.initd.no-forever /etc/init.d/doorjam
sudo update-rc.d doorjam defaults
```

Now edit the /etc/init.d/doorjam file to ensure all paths are correct.

# Granting access remotely

Change the IP, path and <name and contact info of new user>:

```
ssh root@192.168.1.2 "cd /root/doorjam; ./grant_access_to_last_attempt.js <name and contact info of new user>"
```

You can also use the sudo_grant_access.sh script, but you should edit it to suit your environment.

# License and copyright

GPLv3+

Copyright 2014 Marc Juul

# Known bugs

If the program is killed (or dies) then the program will stall on next startup until an rfid chip is scanned. This is because of this problem: https://github.com/camme/node-nfc/issues/9
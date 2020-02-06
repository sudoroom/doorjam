DoorJam is the meatspace firewall for Omni Commons.

# Prerequisites

```
sudo apt install build-essential libusb-1.0-0-dev libnfc-bin libnfc-dev

npm install
```

Copy settings file (and modify to suit your needs):

```
cp settings.js.example settings.js
```

For the Omni building you should use:

```
cp settings.js.omni settings.js
```

# Hardware

This only works with `Magtek USB KB SureSwipe` readers. Be aware that a different type `Magtek USB HID SureSwipe` also exists. This one does _not_ act as a keyboard device and would require us to write custom USB HID parsing code for that specific type of reader.

# Usage

Users swipe their access card in a Magtek USB KB magnetic swipe card reader and if the hash of their card data matches a hash in the access control file then a character is sent over serial to an arduino that then closes a relay for a number of seconds to open the door.

If the card is not recognized then its hash is logged in the failed_attempts file with the date and time of the attempt.

Swipe a new card and run the grant_access_to_last_failed_attempt.js script to grant people access.

People seeking access can also swipe their own cards (at least 3x) and fill out the form at https://omnicommons.org/keys/

Recommended cards are Safeway, Peets, and other store membership cards. Hotel keycards do not work. Recommend that folks not use cards with identifying or otherwise valuable information such as credit cards.

## Step-by-step:
* Ensure you're on the local SSID peoplesopen.net or otherwise logged into room.sudoroom.org
* You must be on a mac or linux machine with avahi-daemon installed
```
ssh root@omnidoor.local 

rwroot

tail -f /var_rw/failed_attempts
```
* Swipe card three times
* Ensure last 3 failed attempts match each other
```
./grant_access_to_last_attempt.js <name>
```
* Check that card works!
```
roroot
```

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

change /etc/bash.bashrc to remind you when the filesystem is not read-only:
# PS1='${debian_chroot:+($debian_chroot)}\u@\h:\w\$ '
PS1='${debian_chroot:+($debian_chroot)}\u@\h`if grep "ec2c7555affb / ext4 rw" /proc/mounts > /dev/null; then echo \ FILESYSTEM IS WRITABLE, RUN roroot TO FIX; fi`:\w\$ '

# License and copyright

Most code is GPLv3+ and copyright 2014 Marc Juul + other contributors (see commit log). However, the files in `lib/hid_parser/` have their own license and copyright notices at the top of each file.

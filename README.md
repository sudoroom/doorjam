DoorJam is the meatspace firewall for sudo room

# Prerequisites

```
sudo aptitude install build-essential libusb-1.0-0-dev

npm install
```

# Usage

Users swipe their access card in a Magtek USB magnetic swipe card reader and if the hash of their card data matches a hash in the access control file then a character is sent over serial to an arduino that then closes a relay for a number of seconds to open the door.

If the card is not recognized then its hash is logged in the failed_attempts file with the date and time of the attempt.

Swipe a new card and run the grant_access_to_last_failed_attempt.js script to grant people access.

*Warning: If the last failed swipe was improperly registered, then you could potentially be granting access to one of several common error codes, rendering the system insecure. See the bottom of this README for common magstripe error code hashes to blacklist.*

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

GPLv3+

Copyright 2014 Marc Juul

blacklist the following hashes (magstripe error codes):
b8548d912086cc19f0f4633a4307af3c35b6ea81
dd51c7f8b6b1c7b478217b10cb228a0d1d5fb310
1d9358c91b137d93541672ff240b3f795587bd6d
05475cb790516f8bdd63504f24c295ddea6f086a (i think)
1177c84cedb98aca496cb2997d84f654a902f1dc
2d71b8483fb11a1e52849c3ce54c07f43b640852
684f2ce81f430e49406911da84c44cc3a9b65230
7d7b38dbdd71860c9c4502505a0cb5842bfa9fe6
4adc1dbd9253e3ec41bc037d2f5fd393c790ece5

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
blacklist the following hashes (magstripe error codes):
b8548d912086cc19f0f4633a4307af3c35b6ea81
dd51c7f8b6b1c7b478217b10cb228a0d1d5fb310
1d9358c91b137d93541672ff240b3f795587bd6d

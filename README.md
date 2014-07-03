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

```
sudo cp doorjam.init /etc/init.d/doorjam
sudo update-rc.d doorjam defaults
```

# License and copyright

GPLv3+

Copyright 2014 Marc Juul

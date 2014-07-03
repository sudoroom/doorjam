DoorJam is the meatspace firewall for sudo room

Users swipe their access card in a Magtek USB magnetic swipe card reader and if the hash of their card data matches a hash in the access control file then a character is sent over serial to an arduino that then closes a relay for a number of seconds to open the door.

If the card is not recognized then its hash is logged in the failed_attempts file with the date and time of the attempt.

Swipea new card and run the grant_access_to_last_failed_attempt.js script to grant people access.
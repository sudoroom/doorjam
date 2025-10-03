#!/bin/bash
echo "Content-type: text/html"
echo ""	# this is necessary
echo "<html>"
echo "<p>$(date) </p>"
echo welcome $REMOTE_USER '<br>'
logger "$(date) $REMOTE_USER omnindoor-check-and-open.sh"

#echo "<style> * {font:40px bold;color:White;background:Black;padding: 20px;border-radius: 10px;text-decoration: none;line-height:3.5;} </style>"
#echo "<a style="background-color:Red">Unfortunately this door motor is not working 6/27/2025</a><br>"
#exit

function sendCommand {
  CMND=$(echo "$@" | sed 's/ /+/g')
  curl --silent -u "admin:1230idj" "http://100.64.65.3/cm?cmnd=$CMND"
  echo '<p>'
}

sendCommand "rule1" | grep '{"Rule1":{"State":"ON","Once":"OFF","StopOnError":"OFF","Length":.*,"Rules":"ON Power1#state=1 DO backlog Delay 50; Power1 0 ENDON"}}' >/dev/null || exit 1
sendCommand "rule2" | grep '{"Rule2":{"State":"ON","Once":"OFF","StopOnError":"OFF","Length":.*,"Rules":"ON Power2#state=1 DO backlog Delay 50; Power2 0 ENDON"}}' >/dev/null || exit 2
sendCommand "rule3" | grep '{"Rule3":{"State":"ON","Once":"OFF","StopOnError":"OFF","Length":.*,"Rules":"ON ANALOG#Voltage1>80 DO Power1 0; Power2 0 ENDON"}}' >/dev/null || exit 3
sendCommand "adcparam1" | grep '{"AdcParam1":\[33,0,4095,0,100\]}' >/dev/null || exit 4
echo "<style> * {font:40px bold;color:White;background:Black;padding: 20px;border-radius: 10px;text-decoration: none;line-height:3.5;} </style>"
sendCommand "rule2 1" >/dev/null # make sure rule is on
sendCommand "rule3 0" >/dev/null # disable current measurement
sendCommand "power2 1" >/dev/null # UN-LOCK door
sleep 0.8 # wait before enabling current detect
sendCommand "rule3 1" >/dev/null # enable current measurement
echo "waiting  seconds before re-locking<p>"
sleep 1.7 # wait for person to open door
sendCommand "rule1 1" >/dev/null # make sure rule is on
sendCommand "rule3 0" >/dev/null # disable current measurement
sendCommand "power1 1" >/dev/null # LOCK door
sleep 1.2 # wait before enabling current detect
sendCommand "rule3 1" >/dev/null # enable current measurement
logger "$(date) $REMOTE_USER omnindoor complete"
echo "locked"
echo "</html>"

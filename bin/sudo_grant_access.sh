#!/bin/bash

# Grant access to last failed attempt remotely
# Change the following three variables to match your environment

REMOTE_HOST=omnidoor.local # hostname
REMOTE_USER=root # user on remote host
REMOTE_PATH=/root/doorjam # Path to the doorjam directory

if [[ "$#" -lt 1 ]]; then
  echo "Usage: sudo_grant_access.sh <name and contact info for new user>"
  exit 1
fi

ssh ${REMOTE_USER}@${REMOTE_HOST} <<EOF
cd ${REMOTE_PATH}; ./grant_access_to_last_attempt.js $@
EOF

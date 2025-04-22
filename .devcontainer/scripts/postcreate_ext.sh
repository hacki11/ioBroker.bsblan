#!/bin/bash

set -e

# Load environment variables from .env file if it exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

iob object set system.adapter.bsblan.0 native.host=$BSB_IP
iob object set system.adapter.bsblan.0 native.user=$BSB_USER
iob object set system.adapter.bsblan.0 native.password=$BSB_PASSWORD
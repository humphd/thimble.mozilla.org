#!/bin/bash

# https://github.com/joyent/node/wiki/installing-node.js-via-package-manager#debian-and-ubuntu-based-linux-distributions

curl --silent --location https://deb.nodesource.com/setup_0.12 | sudo bash -
apt-get update -qq
apt-get install -qq -y \
	build-essential \
	nodejs \
	nodejs-legacy
apt-get autoremove -y -qq

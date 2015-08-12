#!/bin/bash

apt-get update -qq
apt-get install -qq -y \
	curl \
	git \
	portmap
apt-get autoremove -y -qq

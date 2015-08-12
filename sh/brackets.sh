#!/usr/bin/env bash

cd ~

# If we don't have brackets checked out, clone it now.
if ! [ -e "./brackets/.git" ];
then
    git clone --recursive https://github.com/humphd/brackets.git
    git checkout bramble
	npm install --production
fi

cd brackets
npm start

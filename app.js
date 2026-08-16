'use strict';

const alertEvents = require('./lib/AlertEvents');
const glob = require('glob');
const path = require('path');
const { WebhookClient } = require('discord.js');

require('dotenv').config();
const webhookClient = new WebhookClient({ id: process.env.DISCORD_WEBHOOK_ID, token: process.env.DISCORD_WEBHOOK_TOKEN });

// Include date in any console.log() calls.
const origLog = console.log;
console.log = (...args) => {
  const ts = new Date().toISOString();
  origLog(`[${ts}]`, ...args);
};

// Listen for alerts and send the included messages to Discord.
alertEvents.onAlert((message) => {
  webhookClient.send({
    content: message,
  });
});

// Load all the alert plugins from the "alerts" directory.
glob.sync('./alerts/*').forEach((file) => {
  require(path.resolve(file));
});
